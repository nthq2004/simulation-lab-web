import { BaseComponent } from './BaseComponent.js';

/**
 * 串励直流电动机仿真组件
 * （Series-Wound DC Motor）
 *
 * ── 串励电机结构 ──────────────────────────────────────────────
 *  串励接法：励磁绕组与电枢绕组串联，共用同一电流 I。
 *
 *  ┌─────────────────────────────────────────────┐
 *  │  V_s ─── 励磁绕组（Rse，少匝粗线）─── 电枢（Ra）─── GND  │
 *  │             I_se = I_a = I（同一电流）        │
 *  └─────────────────────────────────────────────┘
 *
 *  特点：
 *    励磁电流 = 电枢电流（随负载变化！）
 *    → 轻载时磁通小、转速高（可能飞车！危险！）
 *    → 重载时磁通大、转速低、转矩大（双重增强）
 *
 * ── 电机方程 ──────────────────────────────────────────────────
 *
 *  磁通量（不饱和区线性假设）：
 *    Φ = K_f × I      (K_f = 励磁系数)
 *
 *  反电动势：
 *    E_b = K_e × Φ × ω = K_e × K_f × I × ω
 *
 *  电路方程：
 *    V_s = E_b + I × (Ra + Rse)
 *    V_s = K_e × K_f × I × ω + I × R_total
 *
 *  电磁转矩：
 *    T_em = K_t × Φ × I = K_t × K_f × I²    ← 转矩与电流平方成正比！
 *
 *  稳态转速解（令 T_em = T_L + T_friction）：
 *    I = √(T_L / (K_t × K_f))
 *    ω = (V_s - I × R_total) / (K_e × K_f × I)
 *    → ω ≈ V_s / (K_e × K_f × I) - R_total/(K_e × K_f)
 *    → ω ∝ 1/I ∝ 1/√T_L    （双曲线特性！）
 *
 *  运动方程：
 *    J × dω/dt = T_em - T_L - B × ω
 *
 * ── 串励电机的独特特性 ───────────────────────────────────────
 *  ① 起动转矩大（T_em ∝ I²，起动时电流大→转矩大）
 *  ② 速度特性软（双曲线，空载飞车危险！）
 *  ③ 自动适应负载（重载低速大力，轻载高速小力）
 *  ④ 禁止空载或轻载运行（可能飞车损坏电机）
 *  ⑤ 典型用途：电力机车、起重机、电动工具、汽车启动机
 *
 * ── 仿真演示内容 ─────────────────────────────────────────────
 *  ① 串励接线图（可视化电路拓扑）
 *  ② 定子串励绕组（粗导线，少匝数，橙色）
 *  ③ 转子电枢绕组（随电流变化的颜色）
 *  ④ 双曲线速度-转矩特性曲线（工作点实时追踪）
 *  ⑤ 转矩与 I² 的关系可视化
 *  ⑥ 飞车危险警告动画（空载 / 轻载时）
 *  ⑦ 动态三路波形：ω(t)、I(t)、T_em(t)
 *  ⑧ 负载调节滑块（含飞车警告）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_vs_p  — 电源正极
 *  wire_vs_n  — 电源负极
 *  pipe_shaft — 输出轴
 */
export class SeriesWoundDCMotor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || 480);
        this.height = Math.max(340, config.height || 400);

        this.type    = 'series_dc_motor';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.Vs        = config.Vs        || 220;    // 电源电压 V
        this.Ra        = config.Ra        || 0.3;    // 电枢电阻 Ω
        this.Rse       = config.Rse       || 0.2;    // 串励绕组电阻 Ω（粗线少匝）
        this.Ke        = config.Ke        || 0.5;    // 反电动势系数（含 K_f）V·s·A/rad
        this.Kt        = config.Kt        || 0.5;    // 转矩系数（含 K_f）N·m/A²
        this.J         = config.J         || 0.08;   // 转动惯量 kg·m²
        this.B         = config.B         || 0.005;  // 粘性摩擦系数
        this.maxRPM    = config.maxRPM    || 3000;   // 额定转速（额定负载下）rpm
        this.ratedLoad = config.ratedLoad || 50;     // 额定负载（T_L，N·m）
        this.polePairs = config.polePairs || 2;
        this.slots     = config.slots     || 10;

        // 总电路电阻
        this._Rtotal = this.Ra + this.Rse;
        this._maxI   = this.Vs / this._Rtotal;   // 堵转电流（参考）

        // ── 飞车阈值（空载/轻载保护）──
        this.flyOverRPM    = config.flyOverRPM || Math.round(this.maxRPM * 2.5);
        this.dangerRPM     = config.dangerRPM  || Math.round(this.maxRPM * 1.8);
        this.minSafeLoad   = config.minSafeLoad || 3;   // 最小安全负载 N·m

        // ── 状态 ──
        this.omega       = 0;
        this.current     = 0;
        this.backEMF     = 0;
        this.torqueEM    = 0;
        this.loadTorque  = config.initLoad ?? 20;   // N·m
        this._targetLoad = config.initLoad ?? 20;
        this.rpm         = 0;
        this.elecPower   = 0;
        this.mechPower   = 0;
        this.efficiency  = 0;
        this.powered     = true;
        this.isBreak     = false;

        this._isFlyover   = false;   // 飞车状态
        this._isDanger    = false;   // 危险（转速过高）
        this._inTransient = false;
        this._transientCooldown = 0;

        // ── 动画 ──
        this._rotorAngle  = 0;
        this._sparkPhase  = 0;
        this._phase       = 0;
        this._flyPhase    = 0;   // 飞车警示闪烁相位
        this._warningBlink= 0;

        // ── 波形缓冲 ──
        this._wavLen  = 260;
        this._wavN    = new Float32Array(this._wavLen).fill(0);
        this._wavI    = new Float32Array(this._wavLen).fill(0);
        this._wavTem  = new Float32Array(this._wavLen).fill(0);
        this._wavAcc  = 0;

        // ── 几何布局 ──
        this._motorCX  = Math.round(this.width * 0.24);
        this._motorCY  = Math.round(this.height * 0.42);
        this._statorR  = Math.round(Math.min(this.width * 0.19, this.height * 0.33));
        this._rotorR   = Math.round(this._statorR * 0.60);

        this._headX    = Math.round(this.width * 0.51);
        this._headY    = 28;
        this._headW    = this.width - this._headX - 8;
        this._headH    = Math.round(this.height * 0.48);

        this._curveX   = this._headX;
        this._curveY   = this._headY + this._headH + 8;
        this._curveW   = this._headW;
        this._curveH   = Math.round(this.height * 0.22);

        this._wavX     = 6;
        this._wavY     = this._motorCY + this._statorR + 20;
        this._wavW     = Math.round(this.width * 0.48);
        this._wavH     = this.height - this._wavY - 6;

        this._loadPanelX = this._wavX + this._wavW + 8;
        this._loadPanelY = this._wavY;
        this._loadPanelW = this.width - this._loadPanelX - 6;
        this._loadPanelH = this._wavH;

        this.knobs    = {};

        this.config = {
            id: this.id, Vs: this.Vs, Ra: this.Ra, Rse: this.Rse,
            Ke: this.Ke, Kt: this.Kt, J: this.J,
        };

        this._init();

        this.addPort(this._motorCX - this._statorR - 10, this._motorCY - 20, 'vs_p', 'wire', 'V+');
        this.addPort(this._motorCX - this._statorR - 10, this._motorCY + 20, 'vs_n', 'wire', 'GND');
        this.addPort(this._motorCX + this._statorR + 10, this._motorCY,      'shaft', 'pipe', '轴');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawStatorShell();
        this._drawSeriesFieldWinding();
        this._drawAirGap();
        this._drawRotorCore();
        this._drawRotorSlots();
        this._drawCommutator();
        this._drawShaft();
        this._drawCircuitSchematic();
        this._drawForceLayer();
        this._drawFlowLayer();
        this._drawFlyoverWarningLayer();
        this._drawInstrHead();
        this._drawLCD();
        this._drawSpeedTorqueCurve();
        this._drawLoadPanel();
        this._drawWaveform();
        
    }

    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '串励直流电动机（Series DC Motor）— T∝I²  双曲线特性',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 定子外壳 ─────────────────────────────
    _drawStatorShell() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        this._staticGroup.add(new Konva.Circle({ x: cx, y: cy, radius: R+12, fill: '#37474f', stroke: '#263238', strokeWidth: 2.5 }));
        for (let i = 0; i < 4; i++) {
            const a = (i/4)*Math.PI*2 + Math.PI/4;
            this._staticGroup.add(new Konva.Circle({ x: cx+(R+9)*Math.cos(a), y: cy+(R+9)*Math.sin(a), radius: 5, fill: '#263238' }));
        }
        this._staticGroup.add(new Konva.Circle({ x: cx, y: cy, radius: R, fill: '#0a1520' }));
        this._staticGroup.add(new Konva.Text({ x: cx-R, y: cy-R-22, width: R*2, text: '串励直流电动机', fontSize: 9, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));
    }

    // ── 串励绕组（粗导线，少匝，橙色）────────
    _drawSeriesFieldWinding() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        const p  = this.polePairs;

        for (let i = 0; i < p*2; i++) {
            const poleAngle = (i/(p*2))*Math.PI*2;
            const poleArc   = Math.PI/(p*2)*0.72;
            const ir = R-24, or = R-5;

            // 铁芯极靴
            this._staticGroup.add(new Konva.Arc({ x: cx, y: cy, innerRadius: ir-8, outerRadius: ir+2, angle: poleArc*180/Math.PI*1.4, rotation: (poleAngle-poleArc*0.7)*180/Math.PI-90, fill: '#455a64', stroke: '#2a3a44', strokeWidth: 0.5 }));

            // 串励线圈（橙色/黄色，粗线少匝）—— 外观比并励绕组更粗更少圈
            const isN = i%2===0;
            const coilCol = isN ? '#ff8f00' : '#ffa726';

            // 用多个弧段模拟"粗线绕制"外观
            for (let t = 0; t < 3; t++) {
                this._staticGroup.add(new Konva.Arc({
                    x: cx, y: cy,
                    innerRadius: ir + t*4, outerRadius: ir+4+t*4,
                    angle: poleArc*180/Math.PI,
                    rotation: (poleAngle-poleArc/2)*180/Math.PI-90,
                    fill: 'none', stroke: coilCol, strokeWidth: 3 - t*0.5, opacity: 0.85 - t*0.15,
                }));
            }

            // 极性标记（N/S）
            const mr  = (ir+or)/2;
            this._staticGroup.add(new Konva.Text({ x: cx+mr*Math.cos(poleAngle-Math.PI/2)-5, y: cy+mr*Math.sin(poleAngle-Math.PI/2)-6, width: 10, text: isN?'N':'S', fontSize: 9, fontStyle: 'bold', fill: '#fff', align: 'center' }));
        }
        // 标注
        this._staticGroup.add(new Konva.Text({ x: cx-R, y: cy+R+14, width: R*2, text: `Rse=${this.Rse}Ω（粗线少匝，I=I_a）`, fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'center' }));
    }

    _drawAirGap() {
        const cx = this._motorCX, cy = this._motorCY;
        this._airGapRing = new Konva.Ring({ x: cx, y: cy, innerRadius: this._rotorR+2, outerRadius: this._statorR-30, fill: 'rgba(255,167,38,0.03)' });
        this._staticGroup.add(this._airGapRing);
    }

    _drawRotorCore() {
        const cx = this._motorCX, cy = this._motorCY;
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });
        const R = this._rotorR;
        this._rotorGroup.add(new Konva.Circle({ radius: R, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5 }));
        this._rotorGroup.add(new Konva.Circle({ x: -R*0.16, y: -R*0.16, radius: R*0.13, fill: 'rgba(255,255,255,0.10)' }));
        this._rotorGroup.add(new Konva.Circle({ radius: R*0.10, fill: '#263238', stroke: '#1a2634', strokeWidth: 1 }));
        this._rotorGroup.add(new Konva.Rect({ x: -R*0.045, y: -R*0.10, width: R*0.09, height: R*0.05, fill: '#1a252f' }));
        this._staticGroup.add(this._rotorGroup);
    }

    _drawRotorSlots() {
        const cx = this._motorCX, cy = this._motorCY, R = this._rotorR;
        this._coilGroup = new Konva.Group({ x: cx, y: cy });
        this._coilLines = [];
        for (let i = 0; i < this.slots; i++) {
            const a = (i/this.slots)*Math.PI*2;
            const coil = new Konva.Line({ points: [R*0.20*Math.cos(a), R*0.20*Math.sin(a), R*0.88*Math.cos(a), R*0.88*Math.sin(a)], stroke: '#80cbc4', strokeWidth: 2.2, lineCap: 'round' });
            this._coilLines.push({ coil, angle: a });
            this._coilGroup.add(coil);
        }
        this._staticGroup.add(this._coilGroup);
    }

    _drawCommutator() {
        const cx = this._motorCX, cy = this._motorCY, R = this._rotorR, comR = R*0.32;
        this._comGroup = new Konva.Group({ x: cx, y: cy });
        for (let i = 0; i < this.slots; i++) {
            const a = (i/this.slots)*Math.PI*2;
            this._comGroup.add(new Konva.Arc({ innerRadius: comR-5, outerRadius: comR, angle: (0.82/this.slots)*360, rotation: a*180/Math.PI-90, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 0.4 }));
        }
        this._comGroup.add(new Konva.Circle({ radius: comR-6, fill: '#455a64', stroke: '#37474f', strokeWidth: 1 }));
        this._staticGroup.add(this._comGroup);
        this._brushSparks = [];
        [{ a: -Math.PI/2, col: '#ffcc80' }, { a: Math.PI/2, col: '#fff9c4' }].forEach(({ a, col }) => {
            const bx2 = cx+(comR+8)*Math.cos(a), by2 = cy+(comR+8)*Math.sin(a);
            this._staticGroup.add(new Konva.Rect({ x: bx2-5, y: by2-4, width: 10, height: 8, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1, cornerRadius: 1 }));
            const spark = new Konva.Circle({ x: bx2-5*Math.cos(a), y: by2-5*Math.sin(a), radius: 0, fill: col });
            this._brushSparks.push({ spark, bx: bx2, by: by2, angle: a, col });
            this._staticGroup.add(spark);
        });
    }

    _drawShaft() {
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        this._staticGroup.add(new Konva.Ellipse({ x: cx+R+6, y: cy, radiusX: 8, radiusY: R*0.48, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5 }));
        this._staticGroup.add(new Konva.Rect({ x: cx+R+8, y: cy-5, width: 26, height: 10, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Ellipse({ x: cx-R-6, y: cy, radiusX: 8, radiusY: R*0.48, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5 }));
    }

    // ── 串励接线图（小型示意）──────────────
    _drawCircuitSchematic() {
        const sx = this._motorCX + this._statorR + 48;
        const sy = this._motorCY - 40;
        const sw = Math.round(this.width * 0.11), sh = 76;

        this._staticGroup.add(new Konva.Rect({ x: sx, y: sy, width: sw, height: sh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 3 }));
        this._staticGroup.add(new Konva.Text({ x: sx+2, y: sy+2, width: sw-4, text: '串励接法', fontSize: 7.5, fill: '#ffa726', align: 'center' }));

        const mx = sx + sw/2;
        // V_s → Rse → Ra(E_b) → GND 串联路径
        this._staticGroup.add(new Konva.Text({ x: sx+3, y: sy+14, text: 'V_s', fontSize: 7, fontStyle: 'bold', fill: '#ef9a9a' }));
        this._staticGroup.add(new Konva.Line({ points: [sx+3, sy+22, mx, sy+22], stroke: '#ffa726', strokeWidth: 1.5 }));
        this._staticGroup.add(new Konva.Text({ x: sx+3, y: sy+25, text: 'Rse（串励）', fontSize: 6.5, fill: '#ffa726' }));
        this._staticGroup.add(new Konva.Line({ points: [mx, sy+33, mx, sy+44], stroke: '#ffa726', strokeWidth: 1.5 }));
        this._staticGroup.add(new Konva.Text({ x: sx+3, y: sy+36, text: 'Ra + E_b', fontSize: 6.5, fill: '#ef9a9a' }));
        this._staticGroup.add(new Konva.Line({ points: [mx, sy+44, sx+sw-3, sy+44], stroke: '#ffa726', strokeWidth: 1.5 }));
        this._staticGroup.add(new Konva.Text({ x: sx+3, y: sy+47, text: 'I_a = I_se = I', fontSize: 6.5, fill: '#fff59d' }));
        this._staticGroup.add(new Konva.Text({ x: sx+3, y: sy+57, text: 'T∝I²（双重增磁）', fontSize: 6.5, fill: '#ffa726' }));
        this._schIText = new Konva.Text({ x: sx+3, y: sy+67, text: 'I=0A', fontSize: 7, fontFamily: 'Courier New, monospace', fill: '#fff59d' });
        this._staticGroup.add(this._schIText);
    }

    // ── 动态层 ───────────────────────────────
    _drawForceLayer()   { this._forceGroup = new Konva.Group(); this._staticGroup.add(this._forceGroup); }
    _drawFlowLayer()    { this._flowGroup  = new Konva.Group(); this._staticGroup.add(this._flowGroup);  }

    // ── 飞车警告层 ────────────────────────────
    _drawFlyoverWarningLayer() {
        this._warnGroup = new Konva.Group();
        const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
        this._warnRing = new Konva.Circle({ x: cx, y: cy, radius: R+12, fill: 'none', stroke: 'rgba(239,83,80,0)', strokeWidth: 4 });
        this._warnText = new Konva.Text({ x: cx-30, y: cy-8, width: 60, text: '⚠ 飞车！', fontSize: 11, fontStyle: 'bold', fill: 'rgba(239,83,80,0)', align: 'center' });
        this._warnGroup.add(this._warnRing, this._warnText);
        this._staticGroup.add(this._warnGroup);
    }

    // ── 仪表头 ───────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY, hw = this._headW, hh = this._headH;
        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this._staticGroup.add(new Konva.Line({ points: [hx, hy+6+i*10, hx+hw, hy+6+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'M-SER-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this._staticGroup.add(new Konva.Text({ x: hx+8, y: hy+17, width: hw-16, text: `${this.Vs}V  串励接法`, fontSize: 7, fill: '#78909c', align: 'center' }));
        this._staticGroup.add(new Konva.Text({ x: hx+8, y: hy+27, width: hw-16, text: 'SERIES DC MOTOR', fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this._staticGroup.add(jBox, plate, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH-44)*0.46;
        const lcx = hx + hw/2;
        const R   = Math.min(hw*0.38, 40);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this._staticGroup.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#201000', stroke: '#f57f17', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._speedArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ffa726', rotation: -90 });
        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0',      fontSize:R*.44, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#ffa726', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'rpm',    fontSize:R*.17, fill:'#201000', align:'center' });
        this._lcdI     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.29, width:(R-4)*2, text:'I=0A',   fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#fff59d', align:'center' });
        this._lcdTem   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'T∝I²=0', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#ffcc80', align:'center' });
        this._lcdEb    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.47, width:(R-4)*2, text:'Eb=0V',  fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });
        this._warnRingLcd = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: 'none', stroke: 'rgba(239,83,80,0)', strokeWidth: 3 });
        this._staticGroup.add(ring, this._lcdBg, this._speedArc, this._warnRingLcd, this._lcdMain, this._lcdUnit, this._lcdI, this._lcdTem, this._lcdEb);
    }

    // ── 速度-转矩双曲线特性曲线 ──────────────
    _drawSpeedTorqueCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;
        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'n-T 双曲线特性（ω∝1/√T）', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        const ox = cx2+12, oy = cy2+ch-12, aw = cw-20, ah = ch-22;
        this._staticGroup.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this._staticGroup.add(new Konva.Text({ x: ox-10, y: cy2+13, text: 'n', fontSize: 7.5, fill: '#ffa726' }));
        this._staticGroup.add(new Konva.Text({ x: cx2+cw-12, y: oy+2, text: 'T', fontSize: 7.5, fill: '#ffa726' }));

        // 双曲线（预绘静态参考线）
        const curvePts = [];
        const maxT = this.ratedLoad * 3;
        for (let ti = 2; ti <= maxT; ti += maxT/30) {
            const I_est  = Math.sqrt(ti / this.Kt);
            const eb_est = this.Vs - I_est * this._Rtotal;
            if (eb_est <= 0) break;
            const w_est  = eb_est / (this.Ke * I_est);
            const rpmEst = w_est * 60 / (2*Math.PI);
            const tx = ox + (ti/maxT) * (aw-2);
            const ty = oy - Math.min(ah-2, (rpmEst/this.flyOverRPM) * (ah-2));
            curvePts.push(tx, ty);
        }
        if (curvePts.length > 2) {
            this._staticGroup.add(new Konva.Line({ points: curvePts, stroke: '#ffa726', strokeWidth: 1.5, opacity: 0.5, lineJoin: 'round' }));
        }

        // 飞车危险区（左侧高速区）
        this._staticGroup.add(new Konva.Rect({ x: ox, y: oy-ah+2, width: aw*0.12, height: ah-4, fill: 'rgba(239,83,80,0.15)', cornerRadius: 1 }));
        this._staticGroup.add(new Konva.Text({ x: ox+1, y: cy2+16, text: '飞车\n危险', fontSize: 6.5, fill: '#ef9a9a', lineHeight: 1.3 }));

        // 工作点
        this._charPoint = new Konva.Circle({ x: ox+aw*0.5, y: oy-ah*0.3, radius: 5, fill: '#ffa726', stroke: '#e65100', strokeWidth: 1 });

        this._charOX = ox; this._charOY = oy; this._charAW = aw; this._charAH = ah;
        this._charMaxT = maxT;
        this._staticGroup.add(bg, titleBg, this._charPoint);
    }

    // ── 负载调节面板 ─────────────────────────
    _drawLoadPanel() {
        const px = this._loadPanelX, py = this._loadPanelY;
        const pw = this._loadPanelW, ph = this._loadPanelH;

        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '负载阻力矩 T_L', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        // 进度条
        const barX = px+5, barY = py+18, barW = pw-10, barH = 10;
        this._staticGroup.add(new Konva.Rect({ x: barX, y: barY, width: barW, height: barH, fill: '#0d2030', cornerRadius: 3 }));
        this._loadBar = new Konva.Rect({ x: barX, y: barY, width: 0, height: barH, fill: '#ffa726', cornerRadius: 3 });
        this._staticGroup.add(this._loadBar);

        this._loadValText = new Konva.Text({ x: px+4, y: py+31, width: pw-8, text: 'T_L = 20.0 N·m', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'center' });

        // 飞车警告框
        this._flyWarnBox = new Konva.Rect({ x: px+4, y: py+44, width: pw-8, height: 20, fill: '#3a0000', stroke: 'rgba(239,83,80,0)', strokeWidth: 1, cornerRadius: 2, opacity: 0 });
        this._flyWarnText = new Konva.Text({ x: px+4, y: py+48, width: pw-8, text: '⚠ 轻载危险！可能飞车！', fontSize: 8.5, fontStyle: 'bold', fill: '#ef5350', align: 'center', opacity: 0 });

        // 预设按钮
        const btnY = py + ph - 18;
        const presets = [5, 20, 40, 60, 80];
        const labels  = ['轻载\n⚠', '25%', '50%', '75%', '重载'];
        const btnW    = (pw-10)/5;
        presets.forEach((tl, i) => {
            const bx = px+5+i*(btnW+2);
            const btn = new Konva.Rect({ x: bx, y: btnY, width: btnW, height: 14, fill: '#0d2030', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: btnY+2, width: btnW, text: labels[i], fontSize: tl===5?7:8, fill: tl===5?'#ef5350':'#78909c', align: 'center', lineHeight: 1.1 });
            btn.on('click tap', () => {
                this._targetLoad = tl;
                this._inTransient = true;
                this._transientCooldown = 3.0;
            });
            btn.on('mouseenter', () => { btn.fill('#1a2a1a'); lbl.fill('#ffa726'); });
            btn.on('mouseleave', () => { btn.fill('#0d2030'); lbl.fill(tl===5?'#ef5350':'#78909c'); });
            this._interactGroup.add(btn, lbl);
        });

        // 拖拽滑块
        const sliderHit = new Konva.Rect({ x: barX, y: barY-4, width: barW, height: barH+8, fill: 'transparent', listening: true });
        sliderHit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._sliderDrag = true;
            this._updateLoad(e, barX, barW);
        });
        const sm = e => { if (!this._sliderDrag) return; this._updateLoad(e, barX, barW); };
        const su = () => { this._sliderDrag = false; };
        window.addEventListener('mousemove', sm);
        window.addEventListener('touchmove', sm, { passive: true });
        window.addEventListener('mouseup', su);
        window.addEventListener('touchend', su);
        this._interactGroup.add(sliderHit);

        this._barX = barX; this._barW = barW;
        this._staticGroup.add(bg, titleBg, this._loadBar, this._loadValText, this._flyWarnBox, this._flyWarnText);
        this._dynText = new Konva.Text({ x: px+4, y: py+44, width: pw-8, text: '', fontSize: 8, fill: '#66bb6a', align: 'center' });
        this._staticGroup.add(this._dynText);
    }

    _updateLoad(e, barX, barW) {
        const stage = this.group.getStage?.();
        const pos   = stage?.getPointerPosition?.() ?? { x: (e.evt?.clientX ?? e.clientX ?? 0) };
        const relX  = pos.x - (this.group.x?.() ?? 0) - barX;
        const ratio = Math.max(0, Math.min(1, relX/barW));
        this._targetLoad = 2 + ratio * (this.ratedLoad * 2.2);
        this._inTransient = true;
        this._transientCooldown = 3.0;
    }

    // ── 波形示波器 ────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 20) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'n(rpm)  I(A)  T_em(N·m)', fontSize: 8, fontStyle: 'bold', fill: '#ffa726', align: 'center' }));

        const h3 = (wh-13)/3;
        this._wavMids = [wy+13+h3*0.5, wy+13+h3*1.5, wy+13+h3*2.5];
        this._wavMids.forEach(my => {
            this._staticGroup.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.09)', strokeWidth: 0.5, dash: [4,3] }));
        });
        this._wLineN   = new Konva.Line({ points: [], stroke: '#ffa726', strokeWidth: 1.7, lineJoin: 'round' });
        this._wLineI   = new Konva.Line({ points: [], stroke: '#fff59d', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineTem = new Konva.Line({ points: [], stroke: '#ffcc80', strokeWidth: 1.4, lineJoin: 'round' });
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+13+4, text: 'n', fontSize: 8, fill: '#ffa726' }));
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+13+h3+4, text: 'I', fontSize: 8, fill: '#fff59d' }));
        this._staticGroup.add(new Konva.Text({ x: wx+4, y: wy+13+h3*2+4, text: 'T', fontSize: 8, fill: '#ffcc80' }));
        this._wNLbl   = new Konva.Text({ x: wx+ww-80, y: wy+13+4, width: 76, text: '0 rpm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'right' });
        this._wILbl   = new Konva.Text({ x: wx+ww-80, y: wy+13+h3+4, width: 76, text: '0 A', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#fff59d', align: 'right' });
        this._wTLbl   = new Konva.Text({ x: wx+ww-80, y: wy+13+h3*2+4, width: 76, text: '0 N·m', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffcc80', align: 'right' });
        this._staticGroup.add(bg, titleBg, this._wLineN, this._wLineI, this._wLineTem, this._wNLbl, this._wILbl, this._wTLbl);
        this._wavH3 = h3;
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickViz(dt);
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }


    // ── 串励电机物理方程 ──────────────────────
    _tickPhysics(dt) {
        // 负载平滑
        this.loadTorque += (this._targetLoad - this.loadTorque) * Math.min(1, dt*4);

        // 串励：E_b = Ke * I * ω（磁通 ∝ I）
        // 电路方程：V = E_b + I*(Ra+Rse) = Ke*I*ω + I*R_total
        // 求解当前 I（由 ω 决定）：
        //   I = V / (Ke*ω + R_total)
        const denominator = this.Ke * this.omega + this._Rtotal;
        this.current = this.Vs / denominator;
        if (this.current < 0) this.current = 0;

        // 反电动势
        this.backEMF = this.Ke * this.current * this.omega;

        // 串励转矩 T_em = Kt * I² （因 Φ ∝ I）
        this.torqueEM = this.Kt * this.current * this.current;

        // 摩擦
        const frictionTq = this.B * this.omega;

        // 运动方程
        const netTq = this.torqueEM - this.loadTorque - frictionTq;
        this.omega += (netTq / this.J) * dt;
        this.omega  = Math.max(0, Math.min(this.omega, this.flyOverRPM * 2 * Math.PI / 60));

        this.rpm = Math.round(this.omega * 60 / (2*Math.PI));

        // 功率效率
        this.elecPower = this.Vs * this.current;
        this.mechPower = this.torqueEM * this.omega;
        this.efficiency = this.elecPower > 1 ? Math.min(99, this.mechPower/this.elecPower*100) : 0;

        // 飞车 / 危险检测
        this._isDanger  = this.rpm > this.dangerRPM;
        this._isFlyover = this.rpm > this.flyOverRPM;

        // 动态状态检测
        const omegaSteady = this.Vs / (this.Ke * Math.sqrt(this.loadTorque/this.Kt) + this._Rtotal / this.Ke);
        const deviation = Math.abs(this.omega - Math.max(0, omegaSteady)) / (Math.max(1, omegaSteady));
        if (deviation > 0.015) { this._inTransient = true; this._transientCooldown = 2.5; }
        else if (this._transientCooldown > 0) { this._transientCooldown -= dt; if (this._transientCooldown<=0) this._inTransient = false; }

        this._rotorAngle += this.omega * dt;
        this._sparkPhase += dt * Math.max(0.5, this.omega*0.25);
        this._phase      += dt * 3;
        this._flyPhase   += dt * 5;

        // 气隙辉光
        const iNorm = Math.min(1, this.current / this._maxI);
        if (this._airGapRing) this._airGapRing.fill(`rgba(255,${Math.round(150+iNorm*100)},50,${0.03+iNorm*0.10})`);
        if (this._speedArc) { this._speedArc.angle(Math.min(1, this.rpm/this.flyOverRPM)*360); this._speedArc.fill(this._isDanger?'#ef5350':this._inTransient?'#ff8f00':'#ffa726'); }
        if (this._schIText) this._schIText.text(`I=${this.current.toFixed(1)}A`);
    }

    _tickViz(dt) {
        const angle  = this._rotorAngle * 180/Math.PI;
        if (this._rotorGroup) this._rotorGroup.rotation(angle);
        if (this._coilGroup)  this._coilGroup.rotation(angle);
        if (this._comGroup)   this._comGroup.rotation(angle);

        const iNorm = Math.min(1, this.current / this._maxI);
        // 线圈颜色（串励：随负载电流增强）
        if (this._coilLines) {
            this._coilLines.forEach(({ coil, angle: a }) => {
                const absA = ((this._rotorAngle+a) % (Math.PI*2) + Math.PI*2)%(Math.PI*2);
                const inField = Math.abs(Math.sin(absA*this.polePairs)) > 0.2;
                const r = Math.round(180+iNorm*75), g = Math.round(100+iNorm*50), b = Math.round(50+iNorm*50);
                coil.stroke(inField ? `rgba(${r},${g},${b},${0.4+iNorm*0.6})` : 'rgba(128,180,180,0.25)');
                coil.strokeWidth(2+iNorm*2);
            });
        }

        // 换向火花（串励电机火花更大，因为电流更大）
        if (this._brushSparks) {
            this._brushSparks.forEach(({ spark, angle: a, col }) => {
                if (this.current > 0.5 && this.omega > 5) {
                    const sp = Math.abs(Math.sin(this._sparkPhase + a));
                    spark.radius(2 + iNorm * 5 * sp);
                    const r2=parseInt(col.slice(1,3),16), g2=parseInt(col.slice(3,5),16), b2=parseInt(col.slice(5,7),16);
                    spark.fill(`rgba(${r2},${g2},${b2},${sp*iNorm})`);
                } else { spark.radius(0); }
            });
        }

        // 安培力箭头（T∝I²，箭头长度∝I²）
        this._forceGroup.destroyChildren();
        if (this.current > 0.3) {
            const cx = this._motorCX, cy = this._motorCY, R = this._rotorR;
            const arrowLen = 6 + iNorm * iNorm * 14;
            for (let s = 0; s < 2; s++) {
                const fa = this._rotorAngle + s*Math.PI;
                const px2 = cx+R*0.72*Math.cos(fa), py2 = cy+R*0.72*Math.sin(fa);
                const ta = fa + Math.PI/2;
                this._forceGroup.add(new Konva.Arrow({ points: [px2, py2, px2+arrowLen*Math.cos(ta), py2+arrowLen*Math.sin(ta)], stroke: '#ffd54f', fill: '#ffd54f', strokeWidth: 2, pointerLength: 5, pointerWidth: 4, opacity: 0.5+0.5*iNorm }));
            }
        }

        // 电流输入粒子
        this._flowGroup.destroyChildren();
        if (this.current > 0.2) {
            const cx = this._motorCX, cy = this._motorCY, R = this._statorR;
            for (let i = 0; i < 3; i++) {
                const t = ((this._phase*0.09+i/3)%1+1)%1;
                this._flowGroup.add(new Konva.Circle({ x: cx-R-8+t*10, y: cy-18, radius: 2.5, fill: `rgba(255,213,79,${iNorm*(1-t)*0.9})` }));
            }
        }

        // 飞车警告
        const danger = this._isDanger || this._isFlyover;
        if (this._warnRing) {
            const blink = danger ? (0.5+0.5*Math.abs(Math.sin(this._flyPhase))) : 0;
            this._warnRing.stroke(`rgba(239,83,80,${blink*0.7})`);
        }
        if (this._warnText) {
            const blink = danger ? Math.abs(Math.sin(this._flyPhase)) : 0;
            this._warnText.fill(`rgba(239,83,80,${blink})`);
        }
        if (this._warnRingLcd) {
            const b2 = danger ? (0.4+0.4*Math.abs(Math.sin(this._flyPhase*1.5))) : 0;
            this._warnRingLcd.stroke(`rgba(239,83,80,${b2})`);
        }

        // 负载条
        if (this._loadBar) {
            const maxTL = this.ratedLoad * 2.2;
            const ratio = Math.min(1, this.loadTorque / maxTL);
            this._loadBar.width(ratio * this._barW);
            this._loadBar.fill(ratio < 0.1 ? '#ef5350' : ratio > 0.8 ? '#ff5722' : '#ffa726');
        }

        // 飞车警告框
        if (this._flyWarnBox && this._flyWarnText) {
            const b3 = danger ? Math.abs(Math.sin(this._flyPhase)) : 0;
            this._flyWarnBox.opacity(b3 * 0.9);
            this._flyWarnBox.stroke(`rgba(239,83,80,${b3})`);
            this._flyWarnText.opacity(b3);
        }

        // 工作点在特性曲线上
        if (this._charPoint) {
            const tNorm = Math.min(1, this.torqueEM / (this._charMaxT + 0.001));
            const nNorm = Math.min(1, this.rpm / (this.flyOverRPM + 1));
            this._charPoint.x(this._charOX + tNorm * (this._charAW-4));
            this._charPoint.y(this._charOY - nNorm * (this._charAH-4));
            this._charPoint.fill(danger ? '#ef5350' : '#ffa726');
        }
    }

    _tickWaveform(dt) {
        if (!this._wavH3 || this._wavH < 20) return;
        this._wavAcc += 1.4*dt*this._wavLen;
        const steps = Math.floor(this._wavAcc); this._wavAcc -= steps;
        const maxI = this._maxI, maxRPM = this.flyOverRPM, maxTem = this.Kt * maxI * maxI;
        for (let i = 0; i < steps; i++) {
            this._wavN   = new Float32Array([...this._wavN.slice(1),   this.rpm]);
            this._wavI   = new Float32Array([...this._wavI.slice(1),   this.current]);
            this._wavTem = new Float32Array([...this._wavTem.slice(1), this.torqueEM]);
        }
        const wx = this._wavX+3, ww = this._wavW-6, n = this._wavLen, dx = ww/n, h3 = this._wavH3;
        const [midN, midI, midTem] = this._wavMids;
        const aN = h3*0.42, aI = h3*0.40, aTem = h3*0.40;
        const nPts=[], iPts=[], tPts=[];
        for (let i = 0; i < n; i++) {
            const x = wx+i*dx;
            nPts.push(x, midN  -(this._wavN[i]/maxRPM)  *aN);
            iPts.push(x, midI  -(this._wavI[i]/maxI)     *aI);
            tPts.push(x, midTem-(this._wavTem[i]/maxTem) *aTem);
        }
        if (this._wLineN)   this._wLineN.points(nPts);
        if (this._wLineI)   this._wLineI.points(iPts);
        if (this._wLineTem) this._wLineTem.points(tPts);
        if (this._wNLbl)  this._wNLbl.text(`${this.rpm} rpm`);
        if (this._wILbl)  this._wILbl.text(`${this.current.toFixed(2)} A`);
        if (this._wTLbl)  this._wTLbl.text(`${this.torqueEM.toFixed(3)} N·m`);
    }

    _tickDisplay() {
        const danger = this._isDanger || this._isFlyover;
        const mc = danger ? '#ef5350' : this._inTransient ? '#ff8f00' : '#ffa726';
        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(this.rpm.toString()); this._lcdMain.fill(mc); }
        if (this._lcdI)    this._lcdI.text(`I=${this.current.toFixed(2)}A`);
        if (this._lcdTem)  this._lcdTem.text(`T∝I²=${this.torqueEM.toFixed(2)}`);
        if (this._lcdEb)   this._lcdEb.text(`Eb=${this.backEMF.toFixed(1)}V`);
        if (this._loadValText) this._loadValText.text(`T_L=${this.loadTorque.toFixed(2)} N·m`);
        if (this._dynText) {
            if (danger) { this._dynText.text(`⚠ 危险！转速过高 ${this.rpm}rpm`); this._dynText.fill('#ef5350'); }
            else if (this._inTransient) { this._dynText.text(`▶ 动态调节中…`); this._dynText.fill('#ffa726'); }
            else { this._dynText.text(`● 稳定  η=${this.efficiency.toFixed(1)}%`); this._dynText.fill('#66bb6a'); }
        }
    }

    // ═══════════════════════════════════════════
    update(loadTorque) {
        if (typeof loadTorque === 'number') {
            this._targetLoad = Math.max(0.5, loadTorque);
            this._inTransient = true;
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',            key: 'id',         type: 'text'   },
            { label: '电源电压 Vs (V)',       key: 'Vs',         type: 'number' },
            { label: '电枢电阻 Ra (Ω)',       key: 'Ra',         type: 'number' },
            { label: '串励电阻 Rse (Ω)',      key: 'Rse',        type: 'number' },
            { label: '转矩系数 Kt (N·m/A²)', key: 'Kt',         type: 'number' },
            { label: '转动惯量 J (kg·m²)',    key: 'J',          type: 'number' },
            { label: '飞车转速 (rpm)',         key: 'flyOverRPM', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.Vs         = parseFloat(cfg.Vs)         || this.Vs;
        this.Ra         = parseFloat(cfg.Ra)         || this.Ra;
        this.Rse        = parseFloat(cfg.Rse)        || this.Rse;
        this.Kt         = parseFloat(cfg.Kt)         || this.Kt;
        this.Ke         = this.Kt;
        this.J          = parseFloat(cfg.J)          || this.J;
        this.flyOverRPM = parseFloat(cfg.flyOverRPM) || this.flyOverRPM;
        this._Rtotal    = this.Ra + this.Rse;
        this._maxI      = this.Vs / this._Rtotal;
        this.config     = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}