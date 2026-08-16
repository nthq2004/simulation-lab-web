import { BaseComponent } from './BaseComponent.js';

/**
 * 气动差压变送器仿真组件
 * （Pneumatic Differential Pressure Transmitter）
 *
 * ── 工作原理（力平衡式喷嘴挡板）────────────────────────────────
 *
 *  信号传递链路（五步）：
 *
 *  ① 差压膜片（Diaphragm Capsule）：
 *     高压腔 P1 与低压腔 P2 分别作用于膜片两侧。
 *     差压 ΔP = P1 - P2 → 膜片向低压侧偏移
 *     偏移量 δ = ΔP × A / k   (A=有效面积, k=弹性刚度)
 *
 *  ② 主杠杆（Main Lever）：
 *     铰接在固定支点上的刚性杆件。
 *     膜片位移通过连杆传递到杠杆短臂，
 *     杠杆以支点为轴旋转 → 长臂端（挡板侧）产生更大位移。
 *     放大比 = 长臂长度 / 短臂长度
 *
 *  ③ 喷嘴挡板（Nozzle-Flapper）：
 *     挡板固定在主杠杆端部，喷嘴固定在壳体上。
 *     节流方程（孔口流量近似）：
 *       Q = Cd × A_nozzle × √(2ΔP_back / ρ)
 *     挡板靠近喷嘴 → 背压升高
 *     挡板远离喷嘴 → 背压降低
 *     典型间隙：0.01 ~ 0.10 mm
 *
 *  ④ 气动功率放大器（Pneumatic Relay / Ball-Valve Relay）：
 *     将喷嘴背压（小流量、低功率）放大为：
 *       - 输出气压 P_out（可驱动执行机构）
 *       - 典型量程：20 ~ 100 kPa（3 ~ 15 psi）
 *     供气 140 kPa → 放大器 → 输出 20~100 kPa
 *     增益：G = ΔP_out / ΔP_back ≈ 10~50
 *
 *  ⑤ 反馈波纹管（Feedback Bellows）：
 *     放大器输出气压作用于反馈波纹管，
 *     产生反向力矩作用在主杠杆的反馈臂。
 *     平衡条件：
 *       F_input × L1 = F_feedback × L2
 *       ΔP × A_diaphragm × L1 = P_out × A_bellows × L2
 *     → P_out 与 ΔP 严格线性对应（力矩平衡）
 *
 *  量程：
 *    ΔP = 0       → P_out = 20 kPa（4 mA）
 *    ΔP = ΔP_max  → P_out = 100 kPa（20 mA）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 差压膜片盒（弯曲变形动画，P1/P2 腔颜色变化）
 *  ② 主杠杆（随膜片偏移旋转，角度动画）
 *  ③ 喷嘴挡板（间隙变化动画，颜色标注）
 *  ④ 气动功率放大器（背压增益可视化）
 *  ⑤ 反馈波纹管（伸缩动画，平衡指示）
 *  ⑥ 气路流动粒子（供气管路 + 输出管路）
 *  ⑦ 仪表 LCD（ΔP、输出气压、4-20mA）
 *  ⑧ 输出管路（接气动执行机构）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_p1       — 高压输入 P₁
 *  pipe_p2       — 低压输入 P₂
 *  pipe_supply   — 仪表风供气（140 kPa）
 *  pipe_output   — 气动输出（20~100 kPa）
 *  wire_ma_p     — 4-20mA 信号正极（可选，带 I/P 转换器时）
 *  wire_ma_n     — 4-20mA 信号负极
 *
 * ── 气路求解器集成 ────────────────────────────────────────────
 *  special = 'diff'
 *  update(press, flow) — press 为 ΔP (kPa)
 */
export class PneumaticDPTransmitter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(440, config.width  || 500);
        this.height = Math.max(360, config.height || 400);

        this.type    = 'pneumatic_dp_transmitter';
        this.special = 'diff';
        this.cache   = 'fixed';

        // ── 技术参数 ──
        this.supplyPressure  = config.supplyPressure  || 140;   // 供气压力 kPa
        this.outputLow       = config.outputLow       || 20;    // 输出下限 kPa
        this.outputHigh      = config.outputHigh      || 100;   // 输出上限 kPa
        this.rangeLow        = config.rangeLow        || 0;     // 量程下限 kPa
        this.rangeHigh       = config.rangeHigh       || 100;   // 量程上限 kPa
        this.leverRatio      = config.leverRatio      || 5;     // 杠杆放大比
        this.nozzleDia       = config.nozzleDia       || 0.8;   // 喷嘴直径 mm
        this.gapNominal      = config.gapNominal      || 0.10;  // 额定间隙 mm
        this.bellowsArea     = config.bellowsArea     || 3.5;   // 波纹管有效面积 cm²

        // ── 零点/量程调整 ──
        this.zeroAdj         = 0;   // 零点偏置（kPa）
        this.spanAdj         = 1.0; // 量程系数

        // ── 状态 ──
        this.deltaP          = config.initDP || 0;   // 差压 kPa
        this._manualDP       = config.initDP || 0;
        this._smoothDP       = config.initDP || 0;   // 平滑动画值

        this.outputPressure  = this.outputLow;   // 输出气压 kPa
        this.outputMA        = 4.0;              // 4-20mA 输出
        this.backPressure    = 20;               // 喷嘴背压 kPa

        this.leverAngle      = 0;   // 主杠杆偏转角 °
        this.flapperGap      = this.gapNominal;  // 挡板间隙 mm
        this.bellowsLen      = 0;   // 波纹管伸长量（归一化 0~1）
        this.diaphragmDisp   = 0;   // 膜片位移（归一化 0~1）

        this.isBreak         = false;
        this.powered         = true;
        this.alarmHigh       = false;
        this.alarmLow        = false;

        // ── 动画 ──
        this._phase          = 0;
        this._flowPhase      = 0;       // 气流粒子相位
        this._outFlowPhase   = 0;       // 输出气流相位
        this._settleTimer    = 0;       // 平衡指示计时器
        this._prevDP         = 0;       // 上一帧 DP，用于检测变化

        // ── 波形缓冲（输出历史）──
        this._wavLen         = 200;
        this._wavDP          = new Float32Array(this._wavLen).fill(0);
        this._wavOut         = new Float32Array(this._wavLen).fill(this.outputLow);
        this._wavAcc         = 0;

        // ── 拖拽 ──
        this._dragActive     = false;
        this._dragStartY     = 0;
        this._dragStartDP    = 0;

        // ── 几何布局 ──
        // 膜片盒（左侧）
        this._capX    = 12;
        this._capY    = Math.round(this.height * 0.26);
        this._capW    = Math.round(this.width  * 0.16);
        this._capH    = Math.round(this.height * 0.50);
        this._capCX   = this._capX + this._capW / 2;
        this._capCY   = this._capY + this._capH / 2;

        // 主杠杆支点
        this._pivotX  = this._capX + this._capW + 28;
        this._pivotY  = this._capCY;

        // 喷嘴挡板
        this._nozzleX = this._pivotX + 52;
        this._nozzleY = this._capCY;

        // 功率放大器
        this._ampX    = this._nozzleX + 36;
        this._ampY    = this._capY;
        this._ampW    = Math.round(this.width  * 0.18);
        this._ampH    = Math.round(this.height * 0.44);

        // 反馈波纹管
        this._fbX     = this._ampX + this._ampW + 18;
        this._fbY     = this._capCY - 22;
        this._fbW0    = 54;   // 基础宽度（无压）
        this._fbH     = 44;

        // 仪表 LCD（右侧）
        this._lcdX    = this._fbX + this._fbW0 + 22;
        this._lcdY    = this._capY;
        this._lcdW    = this.width - this._lcdX - 8;
        this._lcdH    = Math.round(this.height * 0.68);

        // 波形区（底部）
        this._wavX    = 8;
        this._wavY    = this._capY + this._capH + 14;
        this._wavW    = this.width - 16;
        this._wavH    = this.height - this._wavY - 8;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, rangeHigh: this.rangeHigh, rangeLow: this.rangeLow,
            supplyPressure: this.supplyPressure,
            outputLow: this.outputLow, outputHigh: this.outputHigh,
        };

        this._init();

        this.addPort(0,           this._capCY - 18, 'p1',     'pipe', 'P₁');
        this.addPort(0,           this._capCY + 18, 'p2',     'pipe', 'P₂');
        this.addPort(this._ampX + this._ampW/2, this._capY - 2, 'supply', 'pipe', '仪表风');
        this.addPort(this.width,  this._lcdY + 18,  'output', 'pipe', '气动输出');
        this.addPort(this.width,  this._lcdY + 42,  'ma_p',   'wire', 'mA+');
        this.addPort(this.width,  this._lcdY + 62,  'ma_n',   'wire', 'mA−');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCapsuleBody();
        this._drawPressureChambers();
        this._drawDiaphragmLayer();
        this._drawConnectingRod();
        this._drawLeverAssembly();
        this._drawNozzleFlapper();
        this._drawAmplifier();
        this._drawFeedbackBellows();
        this._drawInstrumentLines();
        this._drawLCDPanel();
        this._drawWaveform();
        this._drawStepLabels();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '气动差压变送器（喷嘴挡板 · 力矩平衡型）',
            fontSize: 12.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 差压膜片盒外壳 ───────────────────────
    _drawCapsuleBody() {
        const { _capX: cx, _capY: cy, _capW: cw, _capH: ch } = this;

        // 外壳
        const body = new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: 5 });
        // 铆钉
        [[cx+5,cy+5],[cx+cw-5,cy+5],[cx+5,cy+ch-5],[cx+cw-5,cy+ch-5]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 3.5, fill: '#263238' }));
        });
        // 铭牌
        this.group.add(new Konva.Rect({ x: cx+4, y: cy+ch/2-12, width: cw-8, height: 24, fill: '#1e2a36', cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: cx+4, y: cy+ch/2-10, width: cw-8, text: 'DP\nCAP', fontSize: 8, fontStyle: 'bold', fill: 'rgba(255,255,255,0.28)', align: 'center', lineHeight: 1.4 }));

        // 压力接口法兰
        [[cy+ch*0.28, '#ef9a9a', 'P₁'], [cy+ch*0.72, '#90caf9', 'P₂']].forEach(([fy, col, lbl]) => {
            this.group.add(new Konva.Rect({ x: cx-12, y: fy-10, width: 14, height: 20, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1, cornerRadius: [2,0,0,2] }));
            this.group.add(new Konva.Text({ x: cx-24, y: fy-5, text: lbl, fontSize: 8.5, fontStyle: 'bold', fill: col }));
        });

        this.group.add(body);
    }

    // ── 压力腔（颜色随差压变化）──────────────
    _drawPressureChambers() {
        const { _capX: cx, _capY: cy, _capW: cw, _capH: ch } = this;
        const wall = 6;
        const midY = cy + ch/2;

        // P1 腔（上，红色系）
        this._p1Cav = new Konva.Rect({ x: cx+wall, y: cy+wall, width: cw-wall*2, height: ch/2-wall-3, fill: '#1a0808', cornerRadius: 1 });
        // P2 腔（下，蓝色系）
        this._p2Cav = new Konva.Rect({ x: cx+wall, y: midY+3, width: cw-wall*2, height: ch/2-wall-3, fill: '#080818', cornerRadius: 1 });
        this.group.add(this._p1Cav, this._p2Cav);
    }

    // ── 膜片（动态弯曲）─────────────────────
    _drawDiaphragmLayer() {
        this._diaphragmLayer = new Konva.Group();
        // 膜片基础（水平线，初始位置在 capCY）
        this._diaphragmLine = new Konva.Line({ points: [], stroke: '#80cbc4', strokeWidth: 3.5, lineCap: 'round', lineJoin: 'round' });
        // 膜片中心连杆接头
        this._diaphragmNode = new Konva.Circle({ x: 0, y: 0, radius: 4, fill: '#4dd0e1', stroke: '#0097a7', strokeWidth: 1 });
        this._diaphragmLayer.add(this._diaphragmLine, this._diaphragmNode);
        this.group.add(this._diaphragmLayer);
    }

    // ── 连杆（膜片→杠杆短臂）────────────────
    _drawConnectingRod() {
        this._connectRod  = new Konva.Line({ points: [], stroke: '#90a4ae', strokeWidth: 2.5, lineCap: 'round' });
        this._rodArrow    = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.2, dash: [3,2], opacity: 0.7 });
        this.group.add(this._connectRod, this._rodArrow);
    }

    // ── 主杠杆（铰链 + 杠杆臂）──────────────
    _drawLeverAssembly() {
        const px = this._pivotX, py = this._pivotY;

        // 支点三角（静态）
        this.group.add(new Konva.Line({
            points: [px-8, py+12, px+8, py+12, px, py],
            closed: true, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
        }));
        this.group.add(new Konva.Rect({ x: px-12, y: py+12, width: 24, height: 4, fill: '#37474f' }));

        // 杠杆臂（动态旋转）
        this._leverArm  = new Konva.Line({ points: [], stroke: '#b0bec5', strokeWidth: 3.5, lineCap: 'round' });
        // 支点轴
        this._pivotDot  = new Konva.Circle({ x: px, y: py, radius: 5.5, fill: '#263238', stroke: '#78909c', strokeWidth: 1.5 });
        // 杠杆标注文字
        this._leverAngleLbl = new Konva.Text({ x: px-20, y: py-28, width: 40, text: '0°', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center' });

        this.group.add(this._leverArm, this._pivotDot, this._leverAngleLbl);
        this.group.add(new Konva.Text({ x: px-14, y: py+18, text: '杠杆支点', fontSize: 7.5, fill: '#546e7a' }));
    }

    // ── 喷嘴挡板 ─────────────────────────────
    _drawNozzleFlapper() {
        const nx = this._nozzleX, ny = this._nozzleY;

        // 喷嘴体（固定在壳体）
        const nozzleBody = new Konva.Rect({ x: nx, y: ny-16, width: 20, height: 32, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5, cornerRadius: 2 });
        // 喷嘴孔
        this._nozzleHole = new Konva.Circle({ x: nx, y: ny, radius: 3.5, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 0.8 });
        // 喷嘴供气管（从上方供气）
        this.group.add(new Konva.Rect({ x: nx+5, y: ny-36, width: 8, height: 20, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: nx+2, y: ny-48, text: '供气', fontSize: 7.5, fill: '#80cbc4' }));

        // 挡板（动态位置，固定在杠杆端部）
        this._flapperRect = new Konva.Rect({ x: nx-12, y: ny-12, width: 8, height: 24, fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1.5, cornerRadius: 1 });

        // 间隙可视化
        this._gapGroup = new Konva.Group();
        this._gapLine  = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 2, lineCap: 'round' });
        this._gapLbl   = new Konva.Text({ x: nx-16, y: ny-30, text: 'δ=0.10mm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f' });
        this._gapGroup.add(this._gapLine, this._gapLbl);

        // 背压引出管（喷嘴→放大器）
        this._backPressLine = new Konva.Line({ points: [], stroke: '#90caf9', strokeWidth: 2, dash: [4,3] });
        this._backPressLbl  = new Konva.Text({ x: 0, y: 0, text: 'b.p.', fontSize: 7.5, fill: '#64b5f6' });

        this.group.add(nozzleBody, this._nozzleHole, this._flapperRect, this._gapGroup, this._backPressLine, this._backPressLbl);
        this.group.add(new Konva.Text({ x: nx+2, y: ny+20, text: '喷嘴', fontSize: 7.5, fill: '#78909c' }));
        this.group.add(new Konva.Text({ x: nx-14, y: ny+20, text: '挡板', fontSize: 7.5, fill: '#90a4ae' }));
    }

    // ── 气动功率放大器 ───────────────────────
    _drawAmplifier() {
        const { _ampX: ax, _ampY: ay, _ampW: aw, _ampH: ah } = this;

        // 主体
        const body = new Konva.Rect({ x: ax, y: ay, width: aw, height: ah, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: 5 });
        const nameBar = new Konva.Rect({ x: ax, y: ay, width: aw, height: 18, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 0.5, cornerRadius: [5,5,0,0] });
        this.group.add(new Konva.Text({ x: ax+2, y: ay+4, width: aw-4, text: '气动放大器', fontSize: 8.5, fontStyle: 'bold', fill: '#e3f2fd', align: 'center' }));

        // 内部放大腔可视化
        this._ampChamber = new Konva.Rect({ x: ax+6, y: ay+22, width: aw-12, height: ah-30, fill: '#0d2040', stroke: '#1a3060', strokeWidth: 0.8, cornerRadius: 2 });
        // 放大率指示条
        this._ampGainBar = new Konva.Rect({ x: ax+8, y: ay+22+ah-36, width: 0, height: 10, fill: '#4fc3f7', cornerRadius: 1 });
        this._ampGainLbl = new Konva.Text({ x: ax+2, y: ay+ah-22, width: aw-4, text: 'G×1.0', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#4fc3f7', align: 'center' });

        // 供气管（顶部）
        this.group.add(new Konva.Rect({ x: ax+aw/2-5, y: ay-14, width: 10, height: 14, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 }));
        this.group.add(new Konva.Text({ x: ax+aw/2-18, y: ay-22, text: '140kPa仪表风', fontSize: 7.5, fill: '#80cbc4' }));

        // 供气流动粒子
        this._supplyFlowGroup = new Konva.Group();

        // 输出管（右侧）
        this.group.add(new Konva.Rect({ x: ax+aw, y: ay+ah/2-5, width: 18, height: 10, fill: '#607d8b', stroke: '#37474f', strokeWidth: 0.8 }));
        this._ampOutLbl = new Konva.Text({ x: ax+2, y: ay+ah/2-20, width: aw-4, text: '输出 20kPa', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'center' });

        this.group.add(body, nameBar, this._ampChamber, this._ampGainBar, this._ampGainLbl, this._supplyFlowGroup, this._ampOutLbl);
    }

    // ── 反馈波纹管 ─────────────────────────
    _drawFeedbackBellows() {
        const fx = this._fbX, fy = this._fbY;
        const fh = this._fbH;

        // 波纹管外框（动态宽度）
        this._fbBody = new Konva.Rect({ x: fx, y: fy, width: this._fbW0, height: fh, fill: '#0a1520', stroke: '#66bb6a', strokeWidth: 1.5, cornerRadius: 3 });
        // 波纹折叠线（4条）
        this._fbFolds = [];
        for (let i = 0; i < 4; i++) {
            const fl = new Konva.Line({ points: [fx + 10*(i+1), fy, fx + 10*(i+1), fy+fh], stroke: '#66bb6a', strokeWidth: 1, opacity: 0.5 });
            this._fbFolds.push(fl);
            this.group.add(fl);
        }
        this.group.add(this._fbBody);

        // 反馈力箭头（波纹管→杠杆）
        this._fbArrow = new Konva.Arrow({ points: [], stroke: '#66bb6a', fill: '#66bb6a', strokeWidth: 1.8, pointerLength: 5, pointerWidth: 5, dash: [5,3], opacity: 0.75 });
        this.group.add(this._fbArrow);

        // 标注
        this._fbLbl = new Konva.Text({ x: fx, y: fy + fh + 6, width: this._fbW0+20, text: '反馈波纹管', fontSize: 8.5, fontStyle: 'bold', fill: '#66bb6a' });
        this._fbForceLbl = new Konva.Text({ x: fx, y: fy + fh + 18, text: 'F_fb=0.0 N', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#4db6ac' });
        this.group.add(this._fbLbl, this._fbForceLbl);
    }

    // ── 仪表管线（供气 + 输出管路）──────────
    _drawInstrumentLines() {
        const ampMidY = this._ampY + this._ampH / 2;
        const fbCX    = this._fbX + this._fbW0 / 2;
        const fbCY    = this._fbY + this._fbH / 2;
        const lcdMidY = this._lcdY + 20;

        // 放大器 → 波纹管（气管）
        this._ampToFbLine = new Konva.Line({
            points: [this._ampX + this._ampW, ampMidY, this._fbX, ampMidY, this._fbX, this._fbY + this._fbH/2],
            stroke: '#66bb6a', strokeWidth: 3, lineCap: 'round', lineJoin: 'round',
        });
        // 输出气流粒子（放大器→输出管）
        this._outFlowGroup = new Konva.Group();
        this.group.add(this._ampToFbLine, this._outFlowGroup);
    }

    // ── LCD 仪表显示（右侧）─────────────────
    _drawLCDPanel() {
        const lx = this._lcdX, ly = this._lcdY;
        const lw = this._lcdW, lh = this._lcdH;

        // 接线盒
        const jBox = new Konva.Rect({ x: lx, y: ly, width: lw, height: 42, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [lx, ly+7+i*10, lx+lw, ly+7+i*10], stroke: 'rgba(255,255,255,0.12)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: lx+7, y: ly+4, width: lw-14, height: 26, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: lx+7, y: ly+7, width: lw-14, text: this.id || 'DPT-P01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: lx+7, y: ly+17, width: lw-14, text: 'PNEUMATIC  DP', fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: lx, y: ly+3, width: 9, height: 38, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: lx+lw-9, y: ly+3, width: 9, height: 38, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: lx, y: ly+42, width: lw, height: lh-42, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });

        // 端子标签
        [['气动输出','#a5d6a7',18],['mA+','#ffd54f',42],['mA−','#90a4ae',62]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Text({ x: lx+6, y: ly+ty-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });

        // 圆形 LCD
        const lcx = lx + lw/2, lcy = ly + 42 + (lh-42)*0.50;
        const R   = Math.min(lw * 0.38, 38);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1a2800', stroke: '#33691e', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        // 输出弧
        this._outArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#66bb6a', rotation: -90 });

        this._lcdDP    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'ΔP=0.0', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.38, width:(R-4)*2, text:'20.0',  fontSize:R*.42, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#66bb6a', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'kPa',   fontSize:R*.17, fill:'#1a2800', align:'center' });
        this._lcdMA    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'4.0mA', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdGap   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'δ=0.10', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        // 旋钮（零点/量程）
        const ky = lcy + R + 16;
        [{ id:'zero', x: lx+lw*.28, label:'Z' }, { id:'span', x: lx+lw*.72, label:'S' }].forEach(k => {
            const g = new Konva.Group({ x: k.x, y: ky });
            g.add(new Konva.Circle({ radius: 9, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 7, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1 }));
            rotor.add(new Konva.Line({ points: [0,-5.5,0,5.5], stroke: '#37474f', strokeWidth: 2.5, lineCap: 'round' }));
            g.add(rotor, new Konva.Text({ x: -4, y: 11, text: k.label, fontSize: 9, fontStyle: 'bold', fill: '#607d8b' }));
            this.knobs[k.id] = rotor;
            rotor.on('mousedown touchstart', e => {
                e.cancelBubble = true;
                const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const sr = rotor.rotation();
                const mv = me => {
                    const cy2 = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                    rotor.rotation(sr + (sy - cy2) * 2);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 5;
                    else this.spanAdj = 1 + (rotor.rotation() / 360) * 0.3;
                };
                const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('touchmove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
                window.addEventListener('mousemove', mv); window.addEventListener('touchmove', mv);
                window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
            });
            this.group.add(g);
        });

        this.group.add(jBox, plate, lcap, rcap, this._idText, body, ring, this._lcdBg, this._outArc, this._lcdDP, this._lcdMain, this._lcdUnit, this._lcdMA, this._lcdGap);
    }

    // ── 波形示波器（底部）────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 20) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '输出气压(t)  ── kPa 与差压 ΔP 线性关系', fontSize: 8, fontStyle: 'bold', fill: '#66bb6a', align: 'center' }));

        this._wavMidDP  = wy + wh * 0.35;
        this._wavMidOut = wy + wh * 0.78;
        [this._wavMidDP, this._wavMidOut].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineDP  = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineOut = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.8, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'ΔP', fontSize: 8, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+5, text: 'P_out', fontSize: 8, fill: '#66bb6a' }));
        this._wDPLbl  = new Konva.Text({ x: wx+ww-80, y: wy+16, width: 76, text: '--kPa', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'right' });
        this._wOutLbl = new Konva.Text({ x: wx+ww-80, y: wy+wh/2+5, width: 76, text: '--kPa', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });

        this.group.add(bg, titleBg, this._wLineDP, this._wLineOut, this._wDPLbl, this._wOutLbl);
    }

    // ── 步骤标注（顶部流程标）───────────────
    _drawStepLabels() {
        const steps = [
            { x: this._capCX,          y: this._capY - 14, text: '① 膜片偏移' },
            { x: this._pivotX,         y: this._capY - 14, text: '② 杠杆转动' },
            { x: this._nozzleX,        y: this._capY - 14, text: '③ 间隙变化' },
            { x: this._ampX+this._ampW/2, y: this._capY - 14, text: '④ 气动放大' },
            { x: this._fbX + 28,       y: this._capY - 14, text: '⑤ 波纹管平衡' },
        ];
        steps.forEach(({ x, y, text }) => {
            this.group.add(new Konva.Text({ x: x-24, y: y, width: 48, text, fontSize: 8, fill: '#546e7a', align: 'center' }));
        });
        // 连接箭头
        for (let i = 0; i < steps.length-1; i++) {
            this.group.add(new Konva.Line({
                points: [steps[i].x+18, steps[i].y+5, steps[i+1].x-18, steps[i+1].y+5],
                stroke: '#37474f', strokeWidth: 0.8, dash: [3,2],
            }));
        }
    }

    // ── 拖拽（膜片盒区域）───────────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._capX, y: this._capY, width: this._capW, height: this._capH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY  = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartDP = this._manualDP;
            this._dragActive  = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualDP = Math.max(0, Math.min(this.rangeHigh, this._dragStartDP + (this._dragStartY - cy) * 0.5));
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
                this._tickDiaphragm();
                this._tickLever();
                this._tickNozzleFlapper();
                this._tickAmplifier(dt);
                this._tickFeedbackBellows();
                this._tickOutputFlow(dt);
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

    // ── 物理计算 ──────────────────────────────
    _tickPhysics(dt) {
        this.deltaP = this._manualDP;

        // 平滑追踪（一阶滤波，模拟系统响应）
        this._smoothDP += (this.deltaP - this._smoothDP) * Math.min(1, dt * 8);

        // 归一化（0~1）
        const norm = Math.max(0, Math.min(1, (this._smoothDP - this.rangeLow) / (this.rangeHigh - this.rangeLow)));

        // 膜片位移（mm）
        this.diaphragmDisp = norm * 1.5;   // 最大 1.5 mm

        // 杠杆偏角（°）
        this.leverAngle = norm * 15;        // 最大 15°

        // 挡板间隙（mm）：差压增大→挡板靠近→间隙减小
        this.flapperGap = this.gapNominal - norm * (this.gapNominal - 0.008);

        // 喷嘴背压（kPa）：间隙小→背压大
        this.backPressure = 20 + norm * 70;

        // 输出气压（kPa）：经放大器和波纹管平衡后，严格线性
        const adjNorm = Math.max(0, Math.min(1, (norm + this.zeroAdj / this.rangeHigh) * this.spanAdj));
        this.outputPressure = this.outputLow + adjNorm * (this.outputHigh - this.outputLow);
        this.outputMA = 4 + adjNorm * 16;

        // 波纹管伸长（mm，正比于输出气压）
        this.bellowsLen = (this.outputPressure - this.outputLow) / (this.outputHigh - this.outputLow);

        // 报警
        this.alarmHigh = this._smoothDP > this.rangeHigh * 0.95;
        this.alarmLow  = this._smoothDP < this.rangeLow  + 1;

        // 输出弧更新
        if (this._outArc) {
            this._outArc.angle(adjNorm * 360);
            this._outArc.fill(this.alarmHigh ? '#ef5350' : '#66bb6a');
        }

        // 腔体颜色
        if (this._p1Cav) {
            const r1 = Math.round(42 + norm * 80);
            this._p1Cav.fill(`rgb(${r1},${Math.round(10+norm*10)},${Math.round(10+norm*10)})`);
        }
        if (this._p2Cav) this._p2Cav.fill(`rgb(8,${Math.round(14+norm*8)},${Math.round(30+norm*20)})`);

        this._phase   += dt * 4;
        this._flowPhase  += dt * (1 + norm * 3);
        this._outFlowPhase += dt * (0.5 + norm * 2);
    }

    // ── 膜片弯曲动画 ──────────────────────────
    _tickDiaphragm() {
        const cx = this._capCX, cy = this._capCY;
        const hw = this._capW / 2 - 8;
        // 膜片向低压侧（P2 腔，下方）弯曲
        const sagY = cy + this.diaphragmDisp / 1.5 * 14;

        const N = 8;
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const t  = i / N;
            const x  = cx - hw + t * hw * 2;
            const y  = cy + (sagY - cy) * Math.sin(t * Math.PI);
            pts.push(x, y);
        }
        if (this._diaphragmLine) this._diaphragmLine.points(pts);
        if (this._diaphragmNode) {
            this._diaphragmNode.x(cx);
            this._diaphragmNode.y(sagY);
        }
    }

    // ── 主杠杆旋转 ────────────────────────────
    _tickLever() {
        const px = this._pivotX, py = this._pivotY;
        const rad = this.leverAngle * Math.PI / 180;
        const L = 56;

        // 杠杆短臂（向左，连接膜片连杆）
        const shortX = px - L * 0.42 * Math.cos(rad);
        const shortY = py + L * 0.42 * Math.sin(rad);
        // 杠杆长臂（向右，连接挡板）
        const longX  = px + L * Math.cos(rad);
        const longY  = py - L * Math.sin(rad);

        if (this._leverArm) this._leverArm.points([shortX, shortY, longX, longY]);
        if (this._leverAngleLbl) this._leverAngleLbl.text(`${this.leverAngle.toFixed(1)}°`);

        // 连杆（膜片中心 → 杠杆短臂端）
        const sagY = this._capCY + this.diaphragmDisp / 1.5 * 14;
        if (this._connectRod) this._connectRod.points([this._capCX, sagY, shortX, shortY]);

        // 挡板随长臂端移动
        if (this._flapperRect) {
            this._flapperRect.x(longX - 10);
            this._flapperRect.y(longY - 12);
        }

        // 连杆导向箭头
        if (this._rodArrow) {
            const midX = (this._capCX + shortX) / 2, midY = (sagY + shortY) / 2;
            this._rodArrow.points([this._capCX, sagY, midX, midY]);
        }
    }

    // ── 喷嘴挡板间隙动画 ─────────────────────
    _tickNozzleFlapper() {
        const nx = this._nozzleX, ny = this._nozzleY;
        const rad = this.leverAngle * Math.PI / 180;
        const L = 56;
        const flapperY = ny - L * Math.sin(rad);
        const flapperX = this._pivotX + L * Math.cos(rad);

        // 间隙线（挡板右面 → 喷嘴左面）
        const gapPx = Math.max(1.5, this.flapperGap * 60);
        if (this._gapLine) {
            this._gapLine.points([flapperX + 4, flapperY, nx, ny]);
            const gapColor = this.flapperGap < 0.03 ? '#ef5350' : this.flapperGap < 0.06 ? '#ffa726' : '#ffd54f';
            this._gapLine.stroke(gapColor);
        }
        if (this._gapLbl) {
            this._gapLbl.x(flapperX - 4);
            this._gapLbl.y(flapperY - 24);
            this._gapLbl.text(`δ=${this.flapperGap.toFixed(3)}mm`);
            this._gapLbl.fill(this.flapperGap < 0.03 ? '#ef5350' : this.flapperGap < 0.06 ? '#ffa726' : '#ffd54f');
        }

        // 背压引管
        if (this._backPressLine) {
            this._backPressLine.points([nx+20, ny, this._ampX, this._ampY + this._ampH/2]);
        }
        if (this._backPressLbl) {
            this._backPressLbl.x(nx + 22);
            this._backPressLbl.y(ny - 10);
            this._backPressLbl.text(`${this.backPressure.toFixed(0)}kPa`);
            const bpNorm = (this.backPressure - 20) / 70;
            this._backPressLbl.fill(`rgb(${Math.round(100+bpNorm*140)},${Math.round(180-bpNorm*80)},${Math.round(250-bpNorm*120)})`);
        }
    }

    // ── 气动功率放大器动画 ──────────────────
    _tickAmplifier(dt) {
        const norm = (this.outputPressure - this.outputLow) / (this.outputHigh - this.outputLow);
        const gain = 1 + norm * 2.5;

        // 增益条
        if (this._ampGainBar) {
            const barW = (this._ampW - 16) * norm;
            this._ampGainBar.width(barW);
            this._ampGainBar.y(this._ampY + this._ampH - 20);
            this._ampGainBar.fill(norm > 0.8 ? '#ef5350' : norm > 0.5 ? '#ffa726' : '#4fc3f7');
        }
        if (this._ampGainLbl) this._ampGainLbl.text(`G×${gain.toFixed(1)}`);
        if (this._ampOutLbl)  this._ampOutLbl.text(`输出 ${this.outputPressure.toFixed(1)}kPa`);

        // 腔体亮度
        if (this._ampChamber) {
            const r = Math.round(13 + norm*30), g = Math.round(32 + norm*40), b = Math.round(64 + norm*50);
            this._ampChamber.fill(`rgb(${r},${g},${b})`);
        }

        // 供气流动粒子
        this._supplyFlowGroup.destroyChildren();
        for (let i = 0; i < 3; i++) {
            const t = ((this._flowPhase * 0.1 + i/3) % 1 + 1) % 1;
            const sx = this._ampX + this._ampW/2;
            const sy = this._ampY - 14 + t * 16;
            this._supplyFlowGroup.add(new Konva.Circle({ x: sx, y: sy, radius: 2.5, fill: `rgba(144,164,174,${0.4 + norm*0.4})` }));
        }
    }

    // ── 反馈波纹管伸缩 ──────────────────────
    _tickFeedbackBellows() {
        const fbW = this._fbW0 + this.bellowsLen * 26;  // 最大伸长 26px

        if (this._fbBody) {
            this._fbBody.width(fbW);
            const greenAlpha = 0.4 + this.bellowsLen * 0.55;
            this._fbBody.stroke(`rgba(102,187,106,${greenAlpha})`);
        }

        // 更新折叠线间距
        if (this._fbFolds) {
            this._fbFolds.forEach((fl, i) => {
                const foldX = this._fbX + fbW * (i+1) / 5;
                fl.points([foldX, this._fbY, foldX, this._fbY + this._fbH]);
                fl.opacity(0.3 + this.bellowsLen * 0.45);
            });
        }

        // 反馈力箭头（从波纹管左边 → 杠杆短臂方向）
        const rad = this.leverAngle * Math.PI / 180;
        const fbCY = this._fbY + this._fbH/2;
        const targetX = this._pivotX + 30, targetY = this._pivotY - 20;
        if (this._fbArrow) {
            this._fbArrow.points([this._fbX, fbCY, this._ampX + this._ampW + 6, fbCY, targetX, targetY]);
        }

        // 波纹管力
        const fbForce = this.bellowsLen * this.bellowsArea * (this.outputHigh - this.outputLow) * 0.01;
        if (this._fbForceLbl) this._fbForceLbl.text(`F_fb=${fbForce.toFixed(2)} N`);
        if (this._fbLbl) {
            this._fbLbl.x(this._fbX);
        }
    }

    // ── 输出气流粒子 ──────────────────────────
    _tickOutputFlow(dt) {
        if (!this._outFlowGroup) return;
        this._outFlowGroup.destroyChildren();
        const norm = (this.outputPressure - this.outputLow) / (this.outputHigh - this.outputLow);
        if (norm < 0.02) return;

        // 放大器 → 波纹管
        const ampMidY = this._ampY + this._ampH/2;
        for (let i = 0; i < 4; i++) {
            const t = ((this._outFlowPhase * 0.12 + i/4) % 1 + 1) % 1;
            const x = this._ampX + this._ampW + t * (this._fbX - this._ampX - this._ampW);
            this._outFlowGroup.add(new Konva.Circle({ x, y: ampMidY, radius: 2.5, fill: `rgba(102,187,106,${norm * 0.7})` }));
        }
    }

    // ── 波形缓冲 ──────────────────────────────
    _tickWaveform(dt) {
        if (this._wavH < 20) return;
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._wavDP  = new Float32Array([...this._wavDP.slice(1),  this._smoothDP]);
            this._wavOut = new Float32Array([...this._wavOut.slice(1), this.outputPressure]);
        }

        const wx = this._wavX+3, wy2 = this._wavY;
        const ww = this._wavW-6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;
        const dpAmp  = wh * 0.25;
        const outAmp = wh * 0.20;

        const dpPts = [], outPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            dpPts.push(x,  this._wavMidDP  - (this._wavDP[i]  / this.rangeHigh) * dpAmp);
            outPts.push(x, this._wavMidOut - ((this._wavOut[i] - this.outputLow) / (this.outputHigh - this.outputLow)) * outAmp);
        }
        if (this._wLineDP)  this._wLineDP.points(dpPts);
        if (this._wLineOut) this._wLineOut.points(outPts);

        if (this._wDPLbl)  this._wDPLbl.text(`${this._smoothDP.toFixed(1)}kPa`);
        if (this._wOutLbl) this._wOutLbl.text(`${this.outputPressure.toFixed(1)}kPa`);
    }

    // ── LCD + 面板刷新 ────────────────────────
    _tickDisplay() {
        const mc = this.alarmHigh ? '#ef5350' : this.alarmLow ? '#ffa726' : '#66bb6a';
        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(this.outputPressure.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdDP)   this._lcdDP.text(`ΔP=${this._smoothDP.toFixed(1)}kPa`);
        if (this._lcdMA)   this._lcdMA.text(`${this.outputMA.toFixed(2)}mA`);
        if (this._lcdGap)  this._lcdGap.text(`δ=${this.flapperGap.toFixed(3)}mm`);
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(press, flow) {
        // 接受 ΔP (kPa)
        if (typeof press === 'number') {
            this._manualDP = Math.max(0, Math.min(this.rangeHigh, press));
        }
        this._refreshCache();
    }

    setDP(dp) { this.update(dp); }

    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'id',            type: 'text'   },
            { label: '量程上限 ΔP (kPa)',     key: 'rangeHigh',     type: 'number' },
            { label: '量程下限 ΔP (kPa)',     key: 'rangeLow',      type: 'number' },
            { label: '供气压力 (kPa)',         key: 'supplyPressure',type: 'number' },
            { label: '输出下限 (kPa)',         key: 'outputLow',     type: 'number' },
            { label: '输出上限 (kPa)',         key: 'outputHigh',    type: 'number' },
            { label: '杠杆放大比',             key: 'leverRatio',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id             = cfg.id             || this.id;
        this.rangeHigh      = parseFloat(cfg.rangeHigh)       || this.rangeHigh;
        this.rangeLow       = parseFloat(cfg.rangeLow)        ?? this.rangeLow;
        this.supplyPressure = parseFloat(cfg.supplyPressure)  || this.supplyPressure;
        this.outputLow      = parseFloat(cfg.outputLow)       || this.outputLow;
        this.outputHigh     = parseFloat(cfg.outputHigh)      || this.outputHigh;
        this.leverRatio     = parseFloat(cfg.leverRatio)      || this.leverRatio;
        this.config         = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}