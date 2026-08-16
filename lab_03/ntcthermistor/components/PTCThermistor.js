import { BaseComponent } from './BaseComponent.js';

/**
 * 热敏电阻（PTC）仿真组件
 * （PTC Thermistor — Positive Temperature Coefficient）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  PTC 热敏电阻基于钛酸钡（BaTiO₃）等铁电陶瓷材料制成，
 *  具有独特的"开关型"电阻-温度特性：
 *
 *  1. 三阶段特性：
 *     ① 负温系数区（NTC 区，< T_switch）：
 *        室温→切换点：电阻随温度轻微下降（NTC 行为，半导体特性）
 *        R ≈ R_min × exp(-α × (T - T_switch))，α > 0
 *
 *     ② 居里点突变区（切换区，T_switch ~ T_curie）：
 *        电阻在极小温度范围内突然增大数个数量级（10³~10⁸倍！）
 *        这是铁电→顺电相变引起的，是 PTC 的核心特性
 *
 *     ③ 高温区（> T_curie）：
 *        电阻达到最大值后略有下降，再次呈轻微 NTC 行为
 *
 *  2. 模型方程（分段）：
 *     T < T_switch：
 *       R(T) = R_min × exp[-α_ntc × (T - T_switch)]
 *
 *     T_switch ≤ T ≤ T_max：
 *       R(T) = R_min × exp[β × (T - T_switch)²]
 *       β = ln(R_max/R_min) / (T_max - T_switch)²
 *
 *  3. 自恢复过电流保护（PPTC / Resettable Fuse）：
 *     正常温度 → R_min（几欧到几十欧）→ 允许正常电流通过
 *     过流/过热 → 焦耳热 → T↑→ 居里点 → R 突增 → 限流
 *     → 停止外部激励或降温 → T↓→ 自动恢复到 R_min
 *
 *  4. 典型参数（BaTiO₃ 系）：
 *     T_switch ≈ 60~120°C（可由掺杂控制）
 *     T_curie  ≈ T_switch + 20~30°C
 *     R_min    ≈ 数Ω ~ 数百Ω（常温）
 *     R_max    ≈ R_min × 10⁶（居里点附近）
 *
 *  5. 主要应用：
 *     ① 过流保护（自恢复保险丝，PPTC/Polyfuse）
 *     ② 电机过热保护
 *     ③ 限流起动器（电机软起动）
 *     ④ 温度传感（切换型开关）
 *     ⑤ 加热元件（自稳温加热器）
 *
 * ── 与 NTC 的核心区别 ────────────────────────────────────────
 *  NTC：连续单调下降（适合温度测量）
 *  PTC：低温 NTC + 居里点突变 + 高温饱和（适合保护/开关）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 圆片形 PTC 探头（压敏陶瓷片，金属电极）
 *  ② 铁电相变动画（居里点附近晶格结构变化）
 *  ③ R-T 特性曲线（对数纵坐标，"浴盆"形状）
 *  ④ 自恢复保护电路仿真（负载 + 过流检测）
 *  ⑤ 工作状态指示（正常/限流/保护/复位）
 *  ⑥ 功率耗散可视化（焦耳热计算）
 *  ⑦ 实时波形（T、R、I、P）
 *  ⑧ 保护触发动画（过流→限流→自恢复流程）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_p     — 正极
 *  wire_n     — 负极
 */
export class PTCThermistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || 480);
        this.height = Math.max(340, config.height || 400);

        this.type    = 'resistor';
        this.special = 'ptc';
        this.cache   = 'fixed';

        // ── PTC 材料参数 ──
        this.Rmin      = config.Rmin      || 10;      // Ω（低温最小电阻，常温正常值）
        this.Rmax      = config.Rmax      || 1e7;     // Ω（居里点最大电阻）
        this.Tswitch   = config.Tswitch   || 80;      // °C（NTC→PTC 切换点，≈居里温度起点）
        this.Tcurie    = config.Tcurie    || 110;     // °C（居里点，电阻最大值处）
        this.alphaNTC  = config.alphaNTC  || 0.02;   // NTC 区衰减系数（负）
        this.Tambient  = config.Tambient  || 25;     // 环境温度 °C

        // ── 保护电路参数 ──
        this.Vsupply   = config.Vsupply   || 12;     // 供电电压 V
        this.Rload     = config.Rload     || 5;      // 负载电阻 Ω
        this.Ilimit    = config.Ilimit    || 2.0;    // 限流阈值 A（过流保护触发）
        this.thermalCap= config.thermalCap|| 0.5;    // 热容 J/°C（影响热响应速度）
        this.thermalRes= config.thermalRes|| 15;     // 热阻 °C/W（散热能力）
        this.deltaConst= config.deltaConst|| 5;      // 耗散系数 mW/°C（静态散热）

        // ── 状态 ──
        this.temperature  = config.initTemp   || 25;   // °C（当前器件温度）
        this._manualTemp  = config.initTemp   || 25;   // 手动调节温度
        this._useManual   = true;   // 初始使用手动温度

        // 自动热仿真状态（在保护模式下自动计算）
        this._autoTemp    = 25;
        this._autoMode    = false;  // true=开启自动热仿真

        this.currentResistance   = this.Rmin;
        this.current      = 0;
        this.voltage      = 0;
        this.power        = 0;
        this.state        = 'normal';  // 'normal' | 'limiting' | 'protected' | 'recovering'

        this.isBreak      = false;

        // ── 铁电相变动画状态 ──
        this._phaseState  = 0;    // 0=铁电 1=顺电（相变动画）
        this._latticePhase= 0;

        // ── 动画 ──
        this._phase        = 0;
        this._heatGlow     = 0;
        this._sparkActive  = false;
        this._recoveryTimer= 0;

        // ── 波形缓冲（四路）──
        this._wavLen    = 240;
        this._wavT      = new Float32Array(this._wavLen).fill(25);
        this._wavR      = new Float32Array(this._wavLen).fill(10);
        this._wavI      = new Float32Array(this._wavLen).fill(0);
        this._wavP      = new Float32Array(this._wavLen).fill(0);
        this._wavAcc    = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartT  = 0;

        // ── 预设型号 ──
        this._presets = {
            'PPTC-50': { Rmin: 0.5,  Tswitch: 50,  Tcurie: 75,  Vsupply: 5,  label: '自恢复保险 50°C' },
            'PTC-80':  { Rmin: 10,   Tswitch: 80,  Tcurie: 110, Vsupply: 12, label: '过热保护 80°C' },
            'PTC-120': { Rmin: 50,   Tswitch: 120, Tcurie: 150, Vsupply: 24, label: '高温保护 120°C' },
            'PTC-HTR': { Rmin: 200,  Tswitch: 60,  Tcurie: 85,  Vsupply: 220,label: '自稳温加热 60°C' },
        };
        this.presetKey = config.presetKey || 'PTC-80';

        // ── 几何布局 ──
        // 探头区（左侧）
        this._probeX   = 8;
        this._probeY   = Math.round(this.height * 0.06);
        this._probeW   = Math.round(this.width  * 0.20);
        this._probeH   = Math.round(this.height * 0.72);
        this._probeCX  = this._probeX + this._probeW / 2;

        // R-T 特性曲线（中部）
        this._curveX   = this._probeX + this._probeW + 10;
        this._curveY   = this._probeY;
        this._curveW   = Math.round(this.width  * 0.32);
        this._curveH   = Math.round(this.height * 0.50);

        // 保护电路图（曲线下方）
        this._circX    = this._curveX;
        this._circY    = this._curveY + this._curveH + 6;
        this._circW    = this._curveW;
        this._circH    = Math.round(this.height * 0.22);

        // LCD 仪表（右侧）
        this._lcdX     = this._curveX + this._curveW + 10;
        this._lcdY     = this._probeY;
        this._lcdW     = this.width - this._lcdX - 6;
        this._lcdH     = Math.round(this.height * 0.62);

        // 波形区（底部）
        this._wavX     = this._probeX;
        this._wavY     = this._probeY + this._probeH + 8;
        this._wavW     = this.width - this._probeX * 2;
        this._wavH     = this.height - this._wavY - 6;

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, Rmin: this.Rmin, Tswitch: this.Tswitch,
            Tcurie: this.Tcurie, Vsupply: this.Vsupply, Rload: this.Rload,
        };

        this._init();

        this.addPort(this._probeCX - 12, this.height - 4, 'l',    'wire', 'p');
        this.addPort(this._probeCX + 12, this.height - 4, '4',    'wire');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawProbeHousing();
        this._drawPTCElement();
        this._drawLatticeLayer();
        this._drawLeads();
        this._drawRTCurve();
        this._drawProtectCircuit();
        this._drawPresetSelector();
        this._drawInstrHead();
        this._drawLCD();
        this._drawStatePanel();
        this._drawWaveform();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: 'PTC 热敏电阻（Positive Temperature Coefficient — 铁电相变 · 自恢复保护）',
            fontSize: 11.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── PTC 圆片探头外观 ──────────────────────
    _drawProbeHousing() {
        const cx2 = this._probeCX;
        const py = this._probeY, pw = this._probeW, ph = this._probeH;

        // 接线盒（顶部）
        const headH = Math.round(ph * 0.22);
        const headW = pw - 4;
        const headX = this._probeX + 2;
        const head  = new Konva.Rect({ x: headX, y: py, width: headW, height: headH, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 2, cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Rect({ x: headX+5, y: py+headH/2-10, width: headW-10, height: 20, fill: '#0a1520', cornerRadius: 2 }));
        this._typeLbl = new Konva.Text({ x: headX+5, y: py+headH/2-8, width: headW-10, text: `PTC\n${this.presetKey}`, fontSize: 8.5, fontStyle: 'bold', fill: '#f57f17', align: 'center', lineHeight: 1.3 });
        [[headX+8,py+8],[headX+headW-8,py+8],[headX+8,py+headH-8],[headX+headW-8,py+headH-8]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 3.5, fill: '#0d1520' }));
        });

        // 引线保护管（细长管，中段）
        const tubeY = py + headH;
        const tubeH = Math.round(ph * 0.32);
        const tubeW = Math.round(pw * 0.25);
        const tube  = new Konva.Rect({ x: cx2-tubeW/2, y: tubeY, width: tubeW, height: tubeH, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.2, cornerRadius: [0,0,2,2] });
        // 管体高光
        this.group.add(new Konva.Rect({ x: cx2-tubeW/2+2, y: tubeY, width: 3, height: tubeH, fill: 'rgba(255,255,255,0.15)' }));

        // PTC 圆片本体（扁平圆盘，特征外观）
        const discY = tubeY + tubeH;
        const discRX= Math.round(pw * 0.44), discRY = Math.round(ph * 0.085);
        this._discEllipse = new Konva.Ellipse({ x: cx2, y: discY + discRY, radiusX: discRX, radiusY: discRY, fill: '#5d4037', stroke: '#3e2723', strokeWidth: 2 });
        // 上电极（金属化面，银色）
        const elecH = Math.round(discRY * 0.35);
        this._topElec  = new Konva.Ellipse({ x: cx2, y: discY + discRY - discRY*0.6, radiusX: discRX*0.85, radiusY: discRY*0.25, fill: '#c0c0c0', stroke: '#a0a0a0', strokeWidth: 0.8 });
        this._botElec  = new Konva.Ellipse({ x: cx2, y: discY + discRY*1.65, radiusX: discRX*0.85, radiusY: discRY*0.25, fill: '#c0c0c0', stroke: '#a0a0a0', strokeWidth: 0.8 });
        // 圆片高光
        this.group.add(new Konva.Ellipse({ x: cx2-discRX*0.25, y: discY+discRY*0.6, radiusX: discRX*0.22, radiusY: discRY*0.18, fill: 'rgba(255,255,255,0.25)' }));

        // 热辉光（随温度升高）
        this._discGlow = new Konva.Ellipse({ x: cx2, y: discY+discRY, radiusX: discRX*1.5, radiusY: discRY*2.0, fill: 'rgba(255,87,34,0)' });

        // 刻度尺（右侧）
        const scaleX = this._probeX + pw + 4;
        const Tlo = 0, Thi = this.Tcurie + 50;
        for (let i = 0; i <= 5; i++) {
            const T  = Tlo + i*(Thi-Tlo)/5;
            const fy = tubeY + (1-i/5)*tubeH;
            this.group.add(new Konva.Line({ points: [scaleX, fy, scaleX+7, fy], stroke: '#37474f', strokeWidth: i===0||i===5?1.2:0.7 }));
            if (i%2===0) this.group.add(new Konva.Text({ x: scaleX+9, y: fy-5, text: `${Math.round(T)}°`, fontSize: 7.5, fill: '#546e7a' }));
        }
        // T_switch 和 T_curie 标注线
        const tsFrac = (this.Tswitch-Tlo)/(Thi-Tlo);
        const tcFrac = (this.Tcurie-Tlo)/(Thi-Tlo);
        const tsY = tubeY + (1-tsFrac)*tubeH;
        const tcY = tubeY + (1-tcFrac)*tubeH;
        this.group.add(new Konva.Line({ points: [scaleX-4, tsY, scaleX+22, tsY], stroke: 'rgba(255,213,79,0.55)', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Text({ x: scaleX+24, y: tsY-5, text: `Ts=${this.Tswitch}°C`, fontSize: 6.5, fill: '#ffd54f' }));
        this.group.add(new Konva.Line({ points: [scaleX-4, tcY, scaleX+22, tcY], stroke: 'rgba(239,83,80,0.55)', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Text({ x: scaleX+24, y: tcY-5, text: `Tc=${this.Tcurie}°C`, fontSize: 6.5, fill: '#ef9a9a' }));

        this._probeHeadH   = headH;
        this._probeTubeY   = tubeY;
        this._probeTubeH   = tubeH;
        this._probeTubeW   = tubeW;
        this._probeDiscY   = discY;
        this._probeDiscRX  = discRX;
        this._probeDiscRY  = discRY;
        this._probeScaleTlo= Tlo;
        this._probeScaleThi= Thi;

        this.group.add(head, tube, this._discGlow, this._discEllipse, this._topElec, this._botElec, this._typeLbl);
    }

    // ── PTC 内部陶瓷结构示意 ──────────────────
    _drawPTCElement() {
        const cx2 = this._probeCX;
        const dy   = this._probeDiscY, dRX = this._probeDiscRX, dRY = this._probeDiscRY;

        // 内部截面：BaTiO₃ 陶瓷晶粒
        this._ceramicGroup = new Konva.Group({ x: cx2, y: dy+dRY });
        const grainN = 12;
        this._grains = [];
        for (let i = 0; i < grainN; i++) {
            const a  = (i/grainN)*Math.PI*2;
            const r2 = dRX*0.6;
            const gr = new Konva.Circle({ x: r2*Math.cos(a), y: r2*Math.sin(a)*0.4, radius: Math.round(dRX*0.09), fill: '#795548', stroke: '#5d4037', strokeWidth: 0.5, opacity: 0.7 });
            this._grains.push(gr);
            this._ceramicGroup.add(gr);
        }
        // 晶界（模拟晶粒边界）
        this._ceramicGroup.add(new Konva.Circle({ radius: dRX*0.22, fill: '#6d4c41', opacity: 0.6 }));
        this.group.add(this._ceramicGroup);

        // 温度指示点（管内）
        this._tempIndicator = new Konva.Circle({ x: cx2, y: this._probeTubeY + this._probeTubeH/2, radius: 5.5, fill: '#f57f17', stroke: '#e65100', strokeWidth: 1.5 });
        this.group.add(this._tempIndicator);
    }

    // ── 铁电晶格相变动画层 ────────────────────
    _drawLatticeLayer() {
        this._latticeGroup = new Konva.Group();
        this.group.add(this._latticeGroup);
    }

    // ── 引线 ─────────────────────────────────
    _drawLeads() {
        const cx2 = this._probeCX;
        const leadY = this._probeDiscY + this._probeDiscRY * 2 + 4;
        this._lead1 = new Konva.Line({ points: [cx2-10, leadY, cx2-10, this.height-6], stroke: '#ef9a9a', strokeWidth: 2.5, lineCap: 'round' });
        this._lead2 = new Konva.Line({ points: [cx2+10, leadY, cx2+10, this.height-6], stroke: '#90caf9', strokeWidth: 2.5, lineCap: 'round' });
        this.group.add(new Konva.Text({ x: cx2-24, y: this.height-18, text: 'P+', fontSize: 7.5, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: cx2+14, y: this.height-18, text: 'P−', fontSize: 7.5, fill: '#90caf9' }));
        this.group.add(this._lead1, this._lead2);
    }

    // ── R-T 特性曲线（对数纵坐标，浴盆形）────
    _drawRTCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;
        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'R-T 特性（"浴盆"曲线 — PTC 居里点突变）', fontSize: 8, fontStyle: 'bold', fill: '#f57f17', align: 'center' }));

        const ox = cx2+18, oy = cy2+ch-12, aw = cw-24, ah = ch-26;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ox-16, y: cy2+14, text: 'R(Ω)', fontSize: 7, fill: '#f57f17' }));
        this.group.add(new Konva.Text({ x: cx2+cw-14, y: oy+2, text: 'T(°C)', fontSize: 7, fill: '#f57f17' }));

        // 温度轴
        const tMin = -10, tMax = this.Tcurie + 60;
        [0, 25, 50, 80, 100, 130, 150].forEach(T => {
            if (T > tMax) return;
            const tx = ox + (T-tMin)/(tMax-tMin)*(aw-2);
            this.group.add(new Konva.Line({ points: [tx, oy, tx, oy+3], stroke: '#37474f', strokeWidth: 0.8 }));
            if (T%50===0||T===25) this.group.add(new Konva.Text({ x: tx-8, y: oy+4, width: 16, text: T.toString(), fontSize: 6, fill: '#37474f', align: 'center' }));
        });
        // 电阻轴（对数）
        const rMax = this.Rmax * 1.5;
        const rMin = this.Rmin * 0.2;
        const logRMax = Math.log10(rMax), logRMin = Math.log10(rMin);
        const rValues = [0.1,1,10,100,1e3,1e4,1e5,1e6,1e7,1e8];
        rValues.forEach(R => {
            if (R < rMin*0.5 || R > rMax*2) return;
            const logR = Math.log10(R);
            const ry = oy - (logR-logRMin)/(logRMax-logRMin)*(ah-4);
            if (ry < cy2+14 || ry > oy) return;
            this.group.add(new Konva.Line({ points: [ox-3, ry, ox, ry], stroke: '#37474f', strokeWidth: 0.8 }));
            const rStr = R>=1e6?(R/1e6)+'M':R>=1000?(R/1000)+'k':R.toString();
            this.group.add(new Konva.Text({ x: ox-20, y: ry-4, width: 18, text: rStr, fontSize: 6, fill: '#37474f', align: 'right' }));
        });

        // PTC 特性曲线（分段计算，"浴盆"形）
        const curvePts = [];
        for (let T = tMin; T <= tMax; T += 1) {
            const R = this._calcR(T);
            const logR = Math.log10(Math.max(rMin*0.5, R));
            const tx = ox + (T-tMin)/(tMax-tMin)*(aw-2);
            const ry = oy - (logR-logRMin)/(logRMax-logRMin)*(ah-4);
            if (ry < cy2+13 || tx > cx2+cw) continue;
            curvePts.push(tx, Math.max(cy2+13, Math.min(oy, ry)));
        }
        this.group.add(new Konva.Line({ points: curvePts, stroke: '#f57f17', strokeWidth: 2, lineJoin: 'round', opacity: 0.85 }));

        // Tswitch 和 Tcurie 标注
        const tsX = ox + (this.Tswitch-tMin)/(tMax-tMin)*(aw-2);
        const tcX = ox + (this.Tcurie-tMin)/(tMax-tMin)*(aw-2);
        this.group.add(new Konva.Line({ points: [tsX, oy-ah+2, tsX, oy], stroke: 'rgba(255,213,79,0.4)', strokeWidth: 1, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: tsX-14, y: cy2+14, text: `T_sw\n${this.Tswitch}°C`, fontSize: 6.5, fill: '#ffd54f', lineHeight: 1.3 }));
        this.group.add(new Konva.Line({ points: [tcX, oy-ah+2, tcX, oy], stroke: 'rgba(239,83,80,0.4)', strokeWidth: 1, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: tcX-14, y: cy2+14+12, text: `T_c\n${this.Tcurie}°C`, fontSize: 6.5, fill: '#ef9a9a', lineHeight: 1.3 }));

        // 区域着色（三段）
        this.group.add(new Konva.Rect({ x: ox, y: cy2+13, width: tsX-ox, height: ah-4-13+cy2-cy2, fill: 'rgba(66,165,245,0.06)', cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: ox+2, y: cy2+14, text: 'NTC区', fontSize: 6.5, fill: 'rgba(66,165,245,0.5)' }));
        this.group.add(new Konva.Rect({ x: tsX, y: cy2+13, width: tcX-tsX, height: oy-cy2-13, fill: 'rgba(239,83,80,0.08)', cornerRadius: 1 }));
        this.group.add(new Konva.Text({ x: tsX+2, y: cy2+14, text: '突变区', fontSize: 6.5, fill: 'rgba(239,83,80,0.55)' }));

        // 工作点
        this._rtPoint = new Konva.Circle({ x: ox, y: oy, radius: 5.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this._rtHLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._rtVLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._rtLabel = new Konva.Text({ x: 0, y: 0, text: '', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#f57f17' });

        this._rtOX = ox; this._rtOY = oy; this._rtAW = aw; this._rtAH = ah;
        this._rtTMin = tMin; this._rtTMax = tMax;
        this._rtLogRMin = logRMin; this._rtLogRMax = logRMax;

        this.group.add(bg, titleBg, this._rtPoint, this._rtHLine, this._rtVLine, this._rtLabel);
    }

    // ── 保护电路图 ───────────────────────────
    _drawProtectCircuit() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;
        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: '自恢复保护电路仿真', fontSize: 8, fontStyle: 'bold', fill: '#f57f17', align: 'center' }));

        const lx = cx2+8, rx = cx2+cw-8, midY = cy2+ch/2+4;

        // Vs → PTC → Rload → GND
        this.group.add(new Konva.Text({ x: lx, y: midY-28, text: `Vs=${this.Vsupply}V`, fontSize: 8, fill: '#ef9a9a' }));
        this.group.add(new Konva.Line({ points: [lx+30, midY-22, lx+52, midY-22], stroke: '#ef9a9a', strokeWidth: 1.5 }));

        // PTC 符号（正方形加斜线，IEC）
        const ptcX = lx+52, ptcY = midY-30;
        this.group.add(new Konva.Rect({ x: ptcX, y: ptcY, width: 24, height: 16, fill: 'none', stroke: '#f57f17', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [ptcX, ptcY+16, ptcX+24, ptcY], stroke: '#f57f17', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: ptcX+2, y: ptcY+2, text: 'PTC', fontSize: 7, fill: '#f57f17' }));
        this.group.add(new Konva.Text({ x: ptcX+26, y: ptcY+3, text: '+T', fontSize: 7, fill: '#ffd54f' }));
        this.group.add(new Konva.Line({ points: [ptcX+24, midY-22, ptcX+50, midY-22, ptcX+50, midY-10], stroke: '#ffd54f', strokeWidth: 1.5 }));

        // V_ptc 测量点
        this._circVptcLbl = new Konva.Text({ x: ptcX+52, y: midY-26, text: 'V_ptc=--V', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#f57f17' });

        // Rload
        const rlX = ptcX+45, rlY = midY-10;
        this.group.add(new Konva.Rect({ x: rlX, y: rlY, width: 10, height: 22, fill: 'none', stroke: '#66bb6a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: rlX+12, y: rlY+5, text: `RL\n${this.Rload}Ω`, fontSize: 7, fill: '#66bb6a', lineHeight: 1.2 }));
        this.group.add(new Konva.Line({ points: [rlX+5, rlY+22, rlX+5, midY+20], stroke: '#66bb6a', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [lx+28, midY+20, rlX+5, midY+20], stroke: '#b0bec5', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: lx+28, y: midY+22, text: '⏚ GND', fontSize: 7.5, fill: '#546e7a' }));
        this.group.add(new Konva.Line({ points: [lx+30, midY-22, lx+28, midY-22, lx+28, midY+20], stroke: '#ef9a9a', strokeWidth: 1.5 }));

        // 电流/功率显示
        this._circILbl   = new Konva.Text({ x: cx2+4, y: cy2+ch-30, text: 'I=--A  P=--W', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4' });
        this._circStateLbl= new Konva.Text({ x: cx2+4, y: cy2+ch-18, text: '● 正常', fontSize: 9, fontStyle: 'bold', fill: '#66bb6a' });

        // 模拟按钮（触发过流）
        const btnX = rx-44, btnY = midY-14;
        const trigBtn = new Konva.Rect({ x: btnX, y: btnY, width: 44, height: 16, fill: '#1a0808', stroke: '#c62828', strokeWidth: 1, cornerRadius: 2 });
        const trigLbl = new Konva.Text({ x: btnX, y: btnY+3, width: 44, text: '触发过流', fontSize: 8, fill: '#ef5350', align: 'center' });
        trigBtn.on('click tap', () => {
            this._autoMode = true; this._useManual = false;
            this._autoTemp = this.Tswitch - 5;
        });
        trigBtn.on('mouseenter', () => { trigBtn.fill('#3a0a0a'); });
        trigBtn.on('mouseleave', () => { trigBtn.fill('#1a0808'); });
        const resetBtn  = new Konva.Rect({ x: btnX, y: btnY+20, width: 44, height: 16, fill: '#0a1a0a', stroke: '#2e7d32', strokeWidth: 1, cornerRadius: 2 });
        const resetLbl  = new Konva.Text({ x: btnX, y: btnY+23, width: 44, text: '手动复位', fontSize: 8, fill: '#66bb6a', align: 'center' });
        resetBtn.on('click tap', () => {
            this._autoMode = false; this._useManual = true; this._autoTemp = 25; this._manualTemp = 25;
        });
        resetBtn.on('mouseenter', () => { resetBtn.fill('#0a2a0a'); });
        resetBtn.on('mouseleave', () => { resetBtn.fill('#0a1a0a'); });
        this.group.add(bg, titleBg, this._circVptcLbl, this._circILbl, this._circStateLbl, trigBtn, trigLbl, resetBtn, resetLbl);
    }

    // ── 型号预设选择器 ───────────────────────
    _drawPresetSelector() {
        // 放置在LCD下方
    }

    // ── 仪表头 ────────────────────────────────
    _drawInstrHead() {
        const hx = this._lcdX, hy = this._lcdY, hw = this._lcdW;
        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+7, y: hy+4, width: hw-14, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+7, y: hy+7, width: hw-14, text: this.id || 'PTC-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+7, y: hy+17, width: hw-14, text: 'PTC THERMISTOR', fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+7, y: hy+27, width: hw-14, text: `Ts=${this.Tswitch}°C  Tc=${this.Tcurie}°C`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-9, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: this._lcdH-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        [['mA+','#ffd54f',14],['mA−','#90a4ae',34]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Text({ x: hx+6, y: hy+ty-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────────
    _drawLCD() {
        const hx = this._lcdX, hw = this._lcdW;
        const lcy = this._lcdY + 44 + (this._lcdH-44)*0.44;
        const lcx = hx + hw/2;
        const R   = Math.min(hw*0.40, 40);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1a0a00', stroke: '#e65100', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._tempArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#f57f17', rotation: -90 });

        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'25.0',   fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#f57f17', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'°C',     fontSize:R*.18, fill:'#1a0a00', align:'center' });
        this._lcdR2    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'--Ω',    fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdI     = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'--A',    fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdState2= new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'正常',   fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#66bb6a', align:'center' });

        this.group.add(ring, this._lcdBg, this._tempArc, this._lcdMain, this._lcdUnit, this._lcdR2, this._lcdI, this._lcdState2);
    }

    // ── 状态面板（LCD 下方）──────────────────
    _drawStatePanel() {
        const hx = this._lcdX, hw = this._lcdW;
        const panY = this._lcCY + this._lcR + 12;

        // 四状态 LED
        this._stateNames = ['正常','限流','保护','恢复'];
        this._stateCols  = ['#4caf50','#ffa726','#ef5350','#42a5f5'];
        this._stateXs    = [hx+hw*0.14, hx+hw*0.38, hx+hw*0.62, hx+hw*0.86];
        this._stateLeds  = [];
        this._stateNames.forEach((name, i) => {
            const led = new Konva.Circle({ x: this._stateXs[i], y: panY, radius: 6, fill: i===0?this._stateCols[0]:'#1a1a1a', stroke: '#333', strokeWidth: 1 });
            const txt = new Konva.Text({ x: this._stateXs[i]-14, y: panY+9, width: 28, text: name, fontSize: 7, fill: i===0?this._stateCols[0]:'#37474f', align: 'center' });
            this._stateLeds.push({ led, txt });
            this.group.add(led, txt);
        });

        // 型号预设按钮（放在状态面板下）
        const btnPanY = panY + 24;
        const btnPanH = this.height - btnPanY - this._wavH - 12;
        if (btnPanH > 14) {
            const bg = new Konva.Rect({ x: hx, y: btnPanY, width: hw, height: Math.max(14, btnPanH), fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 3 });
            this.group.add(new Konva.Text({ x: hx+2, y: btnPanY+2, width: hw-4, text: '型号预设', fontSize: 7.5, fill: '#37474f', align: 'center' }));
            const keys = Object.keys(this._presets);
            const btnW = (hw-8) / 2;
            keys.forEach((key, i) => {
                const pr = this._presets[key];
                const bx = hx+4+(i%2)*(btnW+2), by = btnPanY+12+Math.floor(i/2)*18;
                if (by + 14 > this.height - this._wavH - 10) return;
                const isAct = key === this.presetKey;
                const btn = new Konva.Rect({ x: bx, y: by, width: btnW, height: 14, fill: isAct?'#2a1a08':'#0d2030', stroke: isAct?'#f57f17':'#1a3040', strokeWidth: 1, cornerRadius: 2 });
                const lbl = new Konva.Text({ x: bx, y: by+3, width: btnW, text: key, fontSize: 7.5, fill: isAct?'#f57f17':'#37474f', align: 'center' });
                btn.on('click tap', () => {
                    const p = this._presets[key];
                    this.presetKey = key;
                    this.Rmin = p.Rmin; this.Tswitch = p.Tswitch;
                    this.Tcurie = p.Tcurie; this.Vsupply = p.Vsupply;
                    if (this._typeLbl) this._typeLbl.text(`PTC\n${key}`);
                    this._refreshCache();
                });
                this.group.add(btn, lbl);
            });
            this.group.add(bg);
        }
    }

    // ── 波形区 ───────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'T(t)  R(t)  I(t)  P(t)', fontSize: 8, fontStyle: 'bold', fill: '#f57f17', align: 'center' }));

        const h4 = (wh-13)/4;
        this._wavMids = [wy+13+h4*0.5, wy+13+h4*1.5, wy+13+h4*2.5, wy+13+h4*3.5];
        this._wavMids.forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineT = new Konva.Line({ points: [], stroke: '#f57f17', strokeWidth: 1.7, lineJoin: 'round' });
        this._wLineR = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.4, lineJoin: 'round' });
        this._wLineI = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineP = new Konva.Line({ points: [], stroke: '#80cbc4', strokeWidth: 1.3, lineJoin: 'round' });

        const cols = ['#f57f17','#ffd54f','#ef9a9a','#80cbc4'];
        ['T(°C)','R(Ω)','I(A)','P(W)'].forEach((lbl,i) => {
            this.group.add(new Konva.Text({ x: wx+4, y: wy+13+h4*i+4, text: lbl, fontSize: 8, fill: cols[i] }));
        });

        this._wTLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+4,    width: 76, text: '--°C', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#f57f17', align: 'right' });
        this._wRLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h4+4, width: 76, text: '--Ω',  fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });
        this._wILbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h4*2+4,width:76, text: '--A',  fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'right' });
        this._wPLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h4*3+4,width:76, text: '--W',  fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'right' });

        this.group.add(bg, titleBg, this._wLineT, this._wLineR, this._wLineI, this._wLineP, this._wTLbl, this._wRLbl, this._wILbl, this._wPLbl);
        this._wavH4 = h4;
    }

    // ── 拖拽 ─────────────────────────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._probeX, y: this._probeY, width: this._probeW, height: this._probeH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartT = this._useManual ? this._manualTemp : this._autoTemp;
            this._dragActive = true;
            this._useManual = true; this._autoMode = false;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy2 = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            const range = this._probeScaleThi - this._probeScaleTlo;
            this._manualTemp = Math.max(this._probeScaleTlo, Math.min(this._probeScaleThi, this._dragStartT + (this._dragStartY - cy2) * (range / this._probeTubeH)));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ── PTC 电阻计算（分段模型）─────────────
    _calcR(T) {
        if (T < this.Tswitch) {
            // NTC 区：轻微负温系数
            return this.Rmin * Math.exp(-this.alphaNTC * (T - this.Tswitch));
        } else {
            // PTC 区：指数上升
            const Tmax = this.Tcurie + 20;
            if (T > Tmax) {
                // 超过居里点后轻微下降（饱和）
                return this.Rmax * Math.exp(-0.01 * (T - Tmax));
            }
            const beta = Math.log(this.Rmax / this.Rmin) / Math.pow(this.Tcurie - this.Tswitch, 2);
            return this.Rmin * Math.exp(beta * Math.pow(T - this.Tswitch, 2));
        }
    }

    _fmtR(R) {
        if (R >= 1e6)  return (R/1e6).toFixed(2)+'MΩ';
        if (R >= 1000) return (R/1000).toFixed(2)+'kΩ';
        return R.toFixed(2)+'Ω';
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts-this._lastTs)/1000, 0.05);
                this._tickPhysics(dt);
                this._tickProbeViz(dt);
                this._tickRTPoint();
                this._tickLattice(dt);
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

    // ── 物理计算 ─────────────────────────────
    _tickPhysics(dt) {
        // 温度来源：手动或自动热仿真
        if (this._autoMode) {
            // 热平衡：J·dT/dt = P_joule - P_dissipate
            const R_cur   = this._calcR(this._autoTemp);
            const V_ptc   = this.Vsupply * R_cur / (R_cur + this.Rload);
            const I_auto  = this.Vsupply / (R_cur + this.Rload);
            const P_joule = I_auto * I_auto * R_cur;
            const P_diss  = (this._autoTemp - this.Tambient) * this.deltaConst / 1000;
            const dTdt    = (P_joule - P_diss) / this.thermalCap;
            this._autoTemp = Math.max(this.Tambient, Math.min(200, this._autoTemp + dTdt * dt));
            this.temperature = this._autoTemp;
        } else {
            this.temperature = this._manualTemp;
        }

        // 电阻
        this.currentResistance = this._calcR(this.temperature);

        // 电路参数
        const Rtotal = this.currentResistance + this.Rload;
        this.current  = this.Vsupply / Rtotal;
        this.voltage  = this.Vsupply * this.currentResistance / Rtotal;
        this.power    = this.current * this.current * this.currentResistance;

        // 工作状态判断
        if (this.current > this.Ilimit) {
            this.state = 'limiting';
        } else if (this.temperature >= this.Tswitch && this.currentResistance > this.Rmin * 100) {
            this.state = 'protected';
        } else if (this.temperature < this.Tswitch && this.state === 'protected') {
            this.state = 'recovering';
            this._recoveryTimer = 1.5;
        } else if (this.state === 'recovering') {
            this._recoveryTimer -= dt;
            if (this._recoveryTimer <= 0) this.state = 'normal';
        } else {
            this.state = 'normal';
        }

        // 4-20mA（温度）
        const range = (this.Tcurie + 50) - 0 + 0.01;
        this.outputMA = 4 + Math.max(0, Math.min(1, this.temperature / range)) * 16;

        // 铁电相变状态
        this._phaseState = this.temperature >= this.Tswitch ? Math.min(1, (this.temperature - this.Tswitch) / 20) : 0;

        // 温度弧
        if (this._tempArc) {
            const tNorm = Math.min(1, this.temperature / (this.Tcurie + 50));
            this._tempArc.angle(tNorm * 360);
            this._tempArc.fill(this.temperature >= this.Tcurie ? '#ef5350' : this.temperature >= this.Tswitch ? '#ffa726' : '#f57f17');
        }

        // 热辉光
        this._heatGlow = Math.max(0, Math.min(0.5, (this.temperature - 50) / 80));
        this._phase   += dt * 3;
        this._latticePhase += dt * 6;
    }

    // ── 探头可视化 ───────────────────────────
    _tickProbeViz(dt) {
        const T = this.temperature;
        const tNorm = Math.min(1, Math.max(0, T / (this.Tcurie + 30)));

        // 圆盘颜色（冷=棕色 → 热=橙红色）
        if (this._discEllipse) {
            const r = Math.round(93 + tNorm*162), g = Math.round(64 - tNorm*24), b = 37;
            this._discEllipse.fill(`rgb(${r},${Math.max(0,g)},${b})`);
        }
        // 热辉光
        if (this._discGlow) {
            const glA = this._heatGlow + 0.07 * Math.abs(Math.sin(this._phase * 2));
            const r = Math.round(255), g2 = Math.round(87-tNorm*50);
            this._discGlow.fill(`rgba(${r},${Math.max(0,g2)},34,${glA})`);
        }
        // 温度指示点
        if (this._tempIndicator) {
            const iy = this._probeTubeY + (1-tNorm)*this._probeTubeH;
            this._tempIndicator.y(iy);
            this._tempIndicator.fill(T>=this.Tcurie ? '#ef5350' : T>=this.Tswitch ? '#ffa726' : '#f57f17');
        }

        // 晶粒颜色变化（相变）
        if (this._grains) {
            this._grains.forEach((gr, i) => {
                const ps  = this._phaseState;
                const r2  = Math.round(121+ps*100), g3 = Math.round(85-ps*60), b3 = Math.round(72-ps*40);
                gr.fill(`rgb(${r2},${Math.max(0,g3)},${Math.max(0,b3)})`);
            });
        }

        // 状态 LED 更新
        if (this._stateLeds) {
            const stateIdx = {'normal':0,'limiting':1,'protected':2,'recovering':3}[this.state]??0;
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 3));
            this._stateLeds.forEach((led, i) => {
                const isAct = i === stateIdx;
                led.led.fill(isAct ? (i===0 ? this._stateCols[i] : `rgba(${this._hexToRgb(this._stateCols[i])},${pulse})`) : '#1a1a1a');
                led.txt.fill(isAct ? this._stateCols[i] : '#37474f');
            });
        }

        // 电路图更新
        if (this._circVptcLbl) this._circVptcLbl.text(`V_ptc=${this.voltage.toFixed(3)}V`);
        if (this._circILbl) this._circILbl.text(`I=${this.current.toFixed(4)}A  P=${this.power.toFixed(3)}W`);
        if (this._circStateLbl) {
            const states = {normal:'● 正常运行',limiting:'▶ 限流保护',protected:'■ 高阻保护',recovering:'○ 自动恢复'};
            const cols   = {normal:'#66bb6a',limiting:'#ffa726',protected:'#ef5350',recovering:'#42a5f5'};
            this._circStateLbl.text(states[this.state]);
            this._circStateLbl.fill(cols[this.state]);
        }
    }

    // ── R-T 工作点 ───────────────────────────
    _tickRTPoint() {
        const T = this.temperature, R = this.currentResistance;
        const { _rtOX: ox, _rtOY: oy, _rtAW: aw, _rtAH: ah, _rtTMin: tMin, _rtTMax: tMax, _rtLogRMin: logRMin, _rtLogRMax: logRMax } = this;

        const logR  = Math.log10(Math.max(0.01, R));
        const tClamp= Math.max(tMin, Math.min(tMax, T));
        const tx    = ox + (tClamp-tMin)/(tMax-tMin)*(aw-2);
        const ry    = oy - (logR-logRMin)/(logRMax-logRMin)*(ah-4);

        if (this._rtPoint) { this._rtPoint.x(tx); this._rtPoint.y(Math.max(this._curveY+14, Math.min(oy, ry))); }
        if (this._rtHLine) this._rtHLine.points([ox, Math.max(this._curveY+14,ry), tx, Math.max(this._curveY+14,ry)]);
        if (this._rtVLine) this._rtVLine.points([tx, Math.max(this._curveY+14,ry), tx, oy]);
        if (this._rtLabel) {
            this._rtLabel.x(tx+4); this._rtLabel.y(Math.max(this._curveY+16, ry-15));
            this._rtLabel.text(`${T.toFixed(1)}°C\n${this._fmtR(R)}`);
        }
    }

    // ── 铁电晶格相变动画 ─────────────────────
    _tickLattice(dt) {
        this._latticeGroup.destroyChildren();
        const cx2 = this._probeCX, dy = this._probeDiscY, dRX = this._probeDiscRX, dRY = this._probeDiscRY;
        const ps = this._phaseState;

        // 晶胞偏移动画（铁电态：极化偏移；顺电态：中心对称）
        const nCells = 8;
        for (let i = 0; i < nCells; i++) {
            const a = (i/nCells)*Math.PI*2 + this._latticePhase*0.05;
            const r = dRX*0.52;
            const cx3 = cx2 + r*Math.cos(a), cy3 = dy+dRY + r*Math.sin(a)*0.45;
            // 铁电态：钛离子偏移（小点偏心）
            const offsetX = ps > 0.5 ? 0 : Math.cos(a)*2.5;
            const offsetY = ps > 0.5 ? 0 : Math.sin(a)*1.5;
            // 氧八面体（蓝色框）
            this._latticeGroup.add(new Konva.Rect({ x: cx3-4+offsetX, y: cy3-3+offsetY, width: 8, height: 6, fill: 'none', stroke: `rgba(66,165,245,${0.3*(1-ps)+0.1})`, strokeWidth: 0.8, cornerRadius: 1 }));
            // 中心钛离子（橙色点）
            this._latticeGroup.add(new Konva.Circle({ x: cx3+offsetX, y: cy3+offsetY, radius: 2.5, fill: `rgba(255,${Math.round(140+ps*60)},0,${0.6+ps*0.3})` }));
        }

        // 铁电态极化箭头
        if (ps < 0.6) {
            const arrowA = (this._latticePhase * 0.05) % (Math.PI * 2);
            this._latticeGroup.add(new Konva.Arrow({
                points: [cx2, dy+dRY, cx2+dRX*0.35*Math.cos(arrowA), dy+dRY+dRY*0.5*Math.sin(arrowA)],
                stroke: `rgba(255,213,79,${0.4*(1-ps)})`, fill: `rgba(255,213,79,${0.3*(1-ps)})`,
                strokeWidth: 1.5, pointerLength: 4, pointerWidth: 4,
            }));
            this._latticeGroup.add(new Konva.Text({ x: cx2-14, y: dy+dRY*2+2, width: 28, text: '铁电极化', fontSize: 7, fill: `rgba(255,213,79,${0.5*(1-ps)})`, align: 'center' }));
        } else {
            this._latticeGroup.add(new Konva.Text({ x: cx2-16, y: dy+dRY*2+2, width: 32, text: '顺电相变↑R', fontSize: 7, fill: `rgba(239,83,80,${ps*0.7})`, align: 'center' }));
        }
    }

    _hexToRgb(hex) {
        hex = hex.replace('#','');
        if (hex.length===3) hex=hex.split('').map(h=>h+h).join('');
        return `${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)}`;
    }

    // ── 波形 ─────────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH4) return;
        this._wavAcc += 1.2*dt*this._wavLen;
        const steps = Math.floor(this._wavAcc); this._wavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._wavT = new Float32Array([...this._wavT.slice(1), this.temperature]);
            this._wavR = new Float32Array([...this._wavR.slice(1), this.currentResistance]);
            this._wavI = new Float32Array([...this._wavI.slice(1), this.current]);
            this._wavP = new Float32Array([...this._wavP.slice(1), this.power]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww/n, h4 = this._wavH4;
        const [mT,mR,mI,mP] = this._wavMids;
        const tMax = this.Tcurie+60, rMax = Math.log10(this.Rmax*1.5), rMin2 = Math.log10(this.Rmin*0.2);
        const iMax = Math.max(0.01, this.Vsupply/this.Rload), pMax = Math.max(0.01, (this.Vsupply*this.Vsupply)/(this.Rload*2));
        const aT=h4*0.40, aR=h4*0.38, aI=h4*0.38, aP=h4*0.36;

        const tPts=[],rPts=[],iPts=[],pPts=[];
        for (let i = 0; i < n; i++) {
            const x=wx+i*dx;
            const tN=this._wavT[i]/tMax;
            const rN=(Math.log10(Math.max(0.01,this._wavR[i]))-rMin2)/(rMax-rMin2);
            const iN=this._wavI[i]/iMax, pN=Math.min(1,this._wavP[i]/pMax);
            tPts.push(x, mT-(tN*2-1)*aT);
            rPts.push(x, mR-(rN*2-1)*aR);
            iPts.push(x, mI-(iN*2-1)*aI);
            pPts.push(x, mP-(pN*2-1)*aP);
        }
        if (this._wLineT) this._wLineT.points(tPts);
        if (this._wLineR) this._wLineR.points(rPts);
        if (this._wLineI) this._wLineI.points(iPts);
        if (this._wLineP) this._wLineP.points(pPts);
        if (this._wTLbl) this._wTLbl.text(`${this.temperature.toFixed(2)}°C`);
        if (this._wRLbl) this._wRLbl.text(this._fmtR(this.currentResistance));
        if (this._wILbl) this._wILbl.text(`${this.current.toFixed(4)}A`);
        if (this._wPLbl) this._wPLbl.text(`${this.power.toFixed(3)}W`);
    }

    // ── LCD 刷新 ─────────────────────────────
    _tickDisplay() {
        const T  = this.temperature;
        const mc = T>=this.Tcurie?'#ef5350':T>=this.Tswitch?'#ffa726':'#f57f17';
        if (this._lcdBg)    this._lcdBg.fill('#020c14');
        if (this._lcdMain)  { this._lcdMain.text(T.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdR2)    this._lcdR2.text(this._fmtR(this.currentResistance));
        if (this._lcdI)     this._lcdI.text(`${this.current.toFixed(4)}A`);
        if (this._lcdState2){ const sc={normal:'#66bb6a',limiting:'#ffa726',protected:'#ef5350',recovering:'#42a5f5'}; this._lcdState2.text(this.state); this._lcdState2.fill(sc[this.state]||'#66bb6a'); }
    }

    // ═══════════════════════════════════════════
    update(temp) {
        if (typeof temp === 'number') { this._manualTemp = Math.max(-50, Math.min(200, temp)); this._useManual = true; this._autoMode = false; }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'id',       type: 'text'   },
            { label: 'R_min (Ω 常温)',        key: 'Rmin',     type: 'number' },
            { label: 'R_max (Ω 居里点)',      key: 'Rmax',     type: 'number' },
            { label: '切换温度 Ts (°C)',       key: 'Tswitch',  type: 'number' },
            { label: '居里温度 Tc (°C)',       key: 'Tcurie',   type: 'number' },
            { label: '供电电压 Vs (V)',        key: 'Vsupply',  type: 'number' },
            { label: '负载电阻 Rl (Ω)',        key: 'Rload',    type: 'number' },
            { label: '限流阈值 (A)',           key: 'Ilimit',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id      = cfg.id      || this.id;
        this.Rmin    = parseFloat(cfg.Rmin)    || this.Rmin;
        this.Rmax    = parseFloat(cfg.Rmax)    || this.Rmax;
        this.Tswitch = parseFloat(cfg.Tswitch) || this.Tswitch;
        this.Tcurie  = parseFloat(cfg.Tcurie)  || this.Tcurie;
        this.Vsupply = parseFloat(cfg.Vsupply) || this.Vsupply;
        this.Rload   = parseFloat(cfg.Rload)   || this.Rload;
        this.Ilimit  = parseFloat(cfg.Ilimit)  || this.Ilimit;
        this.config  = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}