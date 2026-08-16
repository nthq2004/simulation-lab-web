import { BaseComponent } from './BaseComponent.js';

/**
 * MT50 船用分油机水分传感器仿真组件
 * （MT50 Marine Purifier Water Content Sensor）
 *
 * ── 工作原理（同轴电容传感器）────────────────────────────────
 *  MT50 采用同轴圆柱电容结构，当燃油/润滑油流过传感腔时：
 *
 *  同轴电容基本公式：
 *    C = 2πε₀·εᵣ·L / ln(R₂/R₁)
 *
 *  其中：
 *    ε₀ = 8.854×10⁻¹² F/m （真空介电常数）
 *    εᵣ  — 混合介质有效相对介电常数
 *    L   — 电极有效长度 (m)
 *    R₂  — 外电极内径 (m)
 *    R₁  — 内电极外径 (m)
 *
 *  混合介质有效介电常数（串联模型近似）：
 *    εᵣ_mix = εᵣ_oil · (1 - α) + εᵣ_water · α
 *    α  — 含水率（体积分数，0~1）
 *    εᵣ_oil   ≈ 2.0~2.4（重燃油/润滑油，随温度变化）
 *    εᵣ_water ≈ 80（25°C 时纯水）
 *
 *  因此：
 *    C(α) = C_dry · [1 + (εᵣ_water/εᵣ_oil - 1) · α]
 *    C_dry — 纯油时的基准电容（约 20~50 pF，取决于几何尺寸）
 *
 *  传感器对水非常敏感：
 *    含水 1% → εᵣ 增加约 0.78 → C 增加约 33%（相对C_dry）
 *
 * ── 输出特性 ──────────────────────────────────────────────────
 *  两个电气端口直接输出电容值（通过振荡电路转换为频率或电压）：
 *    端口 A（内电极）+ 端口 B（外电极/地）
 *    C_output = C_dry · [1 + K_w · α]
 *    K_w = εᵣ_water/εᵣ_oil - 1 ≈ 38 （重油条件）
 *
 *  典型量程：
 *    含水率 0%  → C ≈ 22 pF
 *    含水率 5%  → C ≈ 42 pF
 *    含水率 10% → C ≈ 63 pF
 *    含水率 50% → C ≈ 237 pF（超量程报警）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 同轴探极截面图（横截面 + 纵截面）
 *  ② 探极内流体填充动画（油/水混合可视化）
 *  ③ 电容值实时测量显示
 *  ④ 介电常数变化动画（电场线密度随水分含量变化）
 *  ⑤ 振荡电路输出频率/电压示波器
 *  ⑥ 两个电气输出端口（A/B）+ 接线盒
 *  ⑦ 温度补偿显示
 *  ⑧ 报警状态（含水率超限）
 *
 * ── 端口 ──────────────────────────────────────────────────────
 *  pipe_in   — 燃油/润滑油进口
 *  pipe_out  — 出口
 *  wire_a    — 电容输出端 A（内电极，信号正端）
 *  wire_b    — 电容输出端 B（外电极，信号负端/地）
 *
 * ── 气路求解器集成 ────────────────────────────────────────────
 *  special = 'none'
 *  update(waterContent) — 外部注入含水率 %（0~100）
 */
export class MT50WaterSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 400);
        this.height = Math.max(340, config.height || 380);

        this.type    = 'mt50_water_sensor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── MT50 技术参数 ──
        this.electrodeLength = config.electrodeLength || 0.08;   // 有效长度 m
        this.innerRadius     = config.innerRadius     || 0.006;  // 内电极外径 m
        this.outerRadius     = config.outerRadius     || 0.015;  // 外电极内径 m
        this.epsilonOil      = config.epsilonOil      || 2.2;    // 重油介电常数
        this.epsilonWater    = config.epsilonWater    || 80;     // 水的介电常数（25°C）
        this.tempC           = config.tempC           || 70;     // 工作温度 °C
        this.alarmThreshold  = config.alarmThreshold || 5;      // 报警阈值 %
        this.maxWater        = config.maxWater        || 20;     // 量程上限 %

        // 温度修正系数（油的介电常数随温度降低）
        this.tempCoeff       = -0.002; // Δεᵣ/°C

        // ── 真空介电常数 ──
        this._eps0 = 8.854e-12; // F/m

        // ── 基准电容计算 ──
        this._updateBaseCapacitance();

        // ── 状态 ──
        this.waterContent    = config.initWater || 0;   // 含水率 % (0~100)
        this._manualWater    = config.initWater || 0;
        this.capacitance     = 0;    // pF
        this.epsilonMix      = 0;    // 混合介电常数
        this.oscFreq         = 0;    // 振荡频率 kHz
        this.oscVoltage      = 0;    // 振荡幅值 V
        this.isBreak         = false;
        this.alarmActive     = false;

        // ── 振荡器动画 ──
        this._oscPhase       = 0;    // 振荡相位

        // ── 波形缓冲 ──
        this._wavLen         = 240;
        this._wavOsc         = new Float32Array(this._wavLen).fill(0);
        this._wavCap         = new Float32Array(this._wavLen).fill(0);
        this._wavAcc         = 0;

        // ── 拖拽 ──
        this._dragActive     = false;
        this._dragStartY     = 0;
        this._dragStartW     = 0;

        // ── 几何布局 ──
        // 探极纵截面区（左上主区）
        this._probeX  = 10;
        this._probeY  = 36;
        this._probeW  = Math.round(this.width * 0.46);
        this._probeH  = Math.round(this.height * 0.52);

        // 探极横截面区（左下）
        this._secX    = this._probeX;
        this._secY    = this._probeY + this._probeH + 10;
        this._secW    = Math.round(this._probeW * 0.44);
        this._secH    = this.height - this._secY - 8;

        // 等效电路 + 振荡器（中下）
        this._circX   = this._secX + this._secW + 8;
        this._circY   = this._secY;
        this._circW   = this._probeW - this._secW - 8;
        this._circH   = this._secH;

        // 仪表头（右上）
        this._headX   = this._probeX + this._probeW + 10;
        this._headY   = this._probeY;
        this._headW   = this.width - this._headX - 8;
        this._headH   = Math.round(this.height * 0.46);

        // 波形区（右下）
        this._wavX    = this._headX;
        this._wavY    = this._headY + this._headH + 10;
        this._wavW    = this._headW;
        this._wavH    = this.height - this._wavY - 8;

        // 纵截面几何中心
        this._longCX  = this._probeX + this._probeW / 2;
        this._longCY  = this._probeY + this._probeH / 2;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, epsilonOil: this.epsilonOil,
            maxWater: this.maxWater, alarmThreshold: this.alarmThreshold,
        };

        this._init();

        const midY = this._probeY + this._probeH / 2;
        this.addPort(0,            midY - 14,        'in',  'pipe', 'OIL IN');
        this.addPort(0,            midY + 14,        'out', 'pipe', 'OIL OUT');
        this.addPort(this.width,   this._headY + 20, 'a',   'wire', 'CAP-A');
        this.addPort(this.width,   this._headY + 44, 'b',   'wire', 'CAP-B');
    }

    // ── 更新基准电容 ────────────────────────
    _updateBaseCapacitance() {
        const eps0 = this._eps0;
        const L    = this.electrodeLength;
        const R1   = this.innerRadius;
        const R2   = this.outerRadius;
        const epsOilT = this.epsilonOil + this.tempCoeff * (this.tempC - 25);
        this._cDry = 2 * Math.PI * eps0 * epsOilT * L / Math.log(R2 / R1) * 1e12; // pF
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawProbeLongSection();
        this._drawFluidLayer();
        this._drawFieldLinesLayer();
        this._drawCrossSection();
        this._drawEquivCircuit();
        this._drawInstrHead();
        this._drawLCD();
        this._drawWaveformArea();
        this._drawBottomPanel();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: 'MT50 船用分油机水分传感器（同轴电容式）',
            fontSize: 12.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 探极纵截面（主要视图）───────────────
    _drawProbeLongSection() {
        const { _probeX: px, _probeY: py, _probeW: pw, _probeH: ph } = this;
        const cx = px + pw / 2;

        // ── 外壳（不锈钢，圆管外壁）──
        const wallT  = 12;   // 外壁厚度
        const coreT  = 8;    // 内电极半径（像素）
        const gapPx  = Math.round((ph - wallT*2) * 0.25); // 电容间隙像素

        // 外管（外电极，灰色不锈钢）
        const outer = new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: 5,
        });
        // 顶盖（接线盒侧）
        const topCap = new Konva.Rect({ x: px, y: py, width: pw, height: wallT, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 });
        const botCap = new Konva.Rect({ x: px, y: py+ph-wallT, width: pw, height: wallT, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 });

        // 内电极（中央杆，金色导体）
        const innerH  = ph - wallT*2 - 20;
        const innerY  = py + wallT + 10;
        this._innerRod = new Konva.Rect({
            x: cx - coreT, y: innerY,
            width: coreT*2, height: innerH,
            fill: '#c0a020', stroke: '#8a7010', strokeWidth: 1, cornerRadius: 2,
        });
        // 内电极顶部接线螺纹
        const connectorH = 18;
        const connector  = new Konva.Rect({
            x: cx - coreT - 4, y: py + wallT - 4,
            width: coreT*2 + 8, height: connectorH,
            fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 1, cornerRadius: 3,
        });
        // 绝缘套管（PTFE，白色）
        const insTop = new Konva.Rect({ x: cx - coreT - 2, y: innerY - 4, width: coreT*2+4, height: 6, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5 });
        const insBot = new Konva.Rect({ x: cx - coreT - 2, y: innerY+innerH-2, width: coreT*2+4, height: 6, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5 });

        // 测量腔区域（内外电极之间，可见范围）
        this._senseCavX  = px + wallT;
        this._senseCavY  = innerY;
        this._senseCavW1 = cx - coreT - (px + wallT);  // 左侧腔
        this._senseCavH  = innerH;

        // 端子引线（内电极→端口A）
        this.group.add(new Konva.Line({
            points: [cx + coreT + 4, py + wallT + connectorH/2, this._headX, py + wallT + connectorH/2, this._headX, this._headY + 20],
            stroke: '#ffd54f', strokeWidth: 1.5, dash: [3,2],
        }));
        // 外电极→端口B
        this.group.add(new Konva.Line({
            points: [px + pw, py + ph/2, this._headX, py + ph/2, this._headX, this._headY + 44],
            stroke: '#90a4ae', strokeWidth: 1.5, dash: [3,2],
        }));

        // 尺寸标注
        this.group.add(new Konva.Text({ x: px+pw+4, y: py+wallT, text: `R₂=${(this.outerRadius*1000).toFixed(1)}mm`, fontSize: 7.5, fill: '#546e7a' }));
        this.group.add(new Konva.Text({ x: cx+coreT+4, y: py+ph/2-6, text: `R₁=${(this.innerRadius*1000).toFixed(1)}mm`, fontSize: 7.5, fill: '#a0a020' }));

        // 法兰（左侧管口）
        [py + wallT + 14, py + ph - wallT - 30].forEach(fY => {
            this.group.add(new Konva.Rect({ x: px - 16, y: fY, width: 16, height: 20, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1, cornerRadius: [2,0,0,2] }));
            this.group.add(new Konva.Circle({ x: px-8, y: fY+6, radius: 3, fill: '#37474f' }));
            this.group.add(new Konva.Circle({ x: px-8, y: fY+14, radius: 3, fill: '#37474f' }));
        });

        this.group.add(new Konva.Text({ x: px-42, y: py+ph/2-28, text: '燃油\n进口', fontSize: 8, fill: '#ffa726', lineHeight: 1.4 }));
        this.group.add(new Konva.Text({ x: px-42, y: py+ph/2+10, text: '燃油\n出口', fontSize: 8, fill: '#a1887f', lineHeight: 1.4 }));

        // 流向箭头
        this.group.add(new Konva.Line({ points: [px-16, py+ph/2-18, px-1, py+ph/2-18], stroke: '#ffa726', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [px-4, py+ph/2-22, px-1, py+ph/2-18, px-4, py+ph/2-14], stroke: '#ffa726', strokeWidth: 1.5, lineJoin: 'round' }));
        this.group.add(new Konva.Line({ points: [px-1, py+ph/2+18, px-16, py+ph/2+18], stroke: '#795548', strokeWidth: 1.5 }));
        this.group.add(new Konva.Line({ points: [px-12, py+ph/2+14, px-16, py+ph/2+18, px-12, py+ph/2+22], stroke: '#795548', strokeWidth: 1.5, lineJoin: 'round' }));

        // 标注文字
        this.group.add(new Konva.Text({ x: cx-22, y: py+ph/2-6, text: '内电极 A', fontSize: 8, fontStyle: 'bold', fill: '#ffd54f', align: 'center', width: 44 }));
        this.group.add(new Konva.Text({ x: px+pw-44, y: py+8, text: '外电极 B', fontSize: 8, fontStyle: 'bold', fill: '#90a4ae' }));
        this.group.add(new Konva.Text({ x: px+wallT+2, y: py+ph/2-6, text: '测量腔', fontSize: 8, fill: '#4fc3f7' }));

        this.group.add(outer, topCap, botCap, this._innerRod, connector, insTop, insBot);

        // 保存几何参数供动画使用
        this._innerY = innerY; this._innerH = innerH;
        this._wallT  = wallT;  this._coreT  = coreT;
        this._probeCX = cx;
    }

    // ── 流体填充层（动态）────────────────────
    _drawFluidLayer() {
        this._fluidGroup = new Konva.Group();
        this._fieldGroup2 = new Konva.Group();
        this.group.add(this._fluidGroup, this._fieldGroup2);
    }

    // ── 电场线层（动态）─────────────────────
    _drawFieldLinesLayer() {
        this._fieldLayer = new Konva.Group();
        this.group.add(this._fieldLayer);
    }

    // ── 同轴横截面图（左下）─────────────────
    _drawCrossSection() {
        const { _secX: sx, _secY: sy, _secW: sw, _secH: sh } = this;
        const cx = sx + sw / 2, cy = sy + sh * 0.45;

        const bg = new Konva.Rect({ x: sx, y: sy, width: sw, height: sh, fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: sx, y: sy, width: sw, height: 14, fill: '#0c1e30', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: sx+2, y: sy+2, width: sw-4, text: '同轴截面', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));

        const R1px = sw * 0.14;  // 内电极外径
        const R2px = sw * 0.35;  // 外电极内径
        const R3px = sw * 0.43;  // 外壳外径

        // 外壳
        const shell = new Konva.Circle({ x: cx, y: cy, radius: R3px, fill: '#455a64', stroke: '#263238', strokeWidth: 1 });
        // 外电极
        this._secOuter = new Konva.Ring({ x: cx, y: cy, innerRadius: R2px, outerRadius: R3px-2, fill: '#546e7a' });
        // 测量腔（动态）
        this._secFluid = new Konva.Ring({ x: cx, y: cy, innerRadius: R1px+1, outerRadius: R2px-1, fill: '#2a1800' });
        // 内电极
        const inner = new Konva.Circle({ x: cx, y: cy, radius: R1px, fill: '#c0a020', stroke: '#8a7010', strokeWidth: 1 });
        // 电场线（动态，放射状）
        this._secFieldGroup = new Konva.Group();
        // 内电极高光
        this.group.add(new Konva.Circle({ x: cx-R1px*0.3, y: cy-R1px*0.3, radius: R1px*0.2, fill: 'rgba(255,230,100,0.4)' }));

        // 标注
        this.group.add(new Konva.Text({ x: cx-12, y: cy-R1px-12, text: 'A(+)', fontSize: 7, fill: '#ffd54f', align: 'center', width: 24 }));
        this.group.add(new Konva.Text({ x: cx+R2px+2, y: cy-5, text: 'B(−)', fontSize: 7, fill: '#90a4ae' }));

        // ε标注
        this._secEpsLabel = new Konva.Text({ x: cx+R1px+3, y: cy-4, text: 'ε=--', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#4fc3f7' });
        // C标注
        this._secCapLabel = new Konva.Text({ x: sx+4, y: sy+sh-20, width: sw-8, text: 'C=-- pF', fontSize: 8.5, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ffd54f', align: 'center' });

        this._secCX = cx; this._secCY = cy;
        this._secR1 = R1px; this._secR2 = R2px;

        this.group.add(bg, titleBg, shell, this._secOuter, this._secFluid, this._secFieldGroup, inner, this._secEpsLabel, this._secCapLabel);
    }

    // ── 等效电路 + 振荡器框图（中下）──────
    _drawEquivCircuit() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;
        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.2, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 14, fill: '#0d1a30', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+2, y: cy2+2, width: cw-4, text: '等效电路', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));

        const x1 = cx2+8, x2 = cx2+cw-8;
        const y1  = cy2+18, y2 = cy2+ch-10;
        const mx  = (x1+x2)/2, my = (y1+y2)/2;

        // 电容符号（中心）
        c2(mx, my-8, mx, my+8);
        function c2(x, y0, _, y1_) {
            // capacitor plates
        }
        // 上下导线
        this.group.add(new Konva.Line({ points: [x1, y1, mx, y1, mx, my-6], stroke: '#4fc3f7', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x1, y2, mx, y2, mx, my+6], stroke: '#4fc3f7', strokeWidth: 1 }));
        // 极板符号
        this.group.add(new Konva.Line({ points: [mx-10, my-6, mx+10, my-6], stroke: '#ffd54f', strokeWidth: 2.5 }));
        this.group.add(new Konva.Line({ points: [mx-10, my+6, mx+10, my+6], stroke: '#90a4ae', strokeWidth: 2.5 }));
        this.group.add(new Konva.Line({ points: [x2, y1, mx, y1], stroke: '#4fc3f7', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x2, y2, mx, y2], stroke: '#4fc3f7', strokeWidth: 1 }));

        // A、B 端子标注
        this.group.add(new Konva.Text({ x: x1-2, y: y1-10, text: 'A', fontSize: 9, fontStyle: 'bold', fill: '#ffd54f' }));
        this.group.add(new Konva.Text({ x: x1-2, y: y2, text: 'B', fontSize: 9, fontStyle: 'bold', fill: '#90a4ae' }));

        // Cx 电容标注（动态）
        this._circCxLabel = new Konva.Text({ x: mx+12, y: my-6, text: 'Cx\n--pF', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', lineHeight: 1.3 });
        // 振荡框
        this.group.add(new Konva.Rect({ x: cx2+4, y: cy2+ch-28, width: cw-8, height: 20, fill: '#0d1a30', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 }));
        this._circOscLabel = new Konva.Text({ x: cx2+4, y: cy2+ch-22, width: cw-8, text: 'OSC: -- kHz', fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'center' });

        this.group.add(bg, titleBg, this._circCxLabel, this._circOscLabel);
    }

    // ── 仪表头（右上）───────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 4; i++) this.group.add(new Konva.Line({ points: [hx, hy+6+i*10, hx+hw, hy+6+i*10], stroke: 'rgba(255,255,255,0.12)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 26, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'MT50-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+18, width: hw-16, text: 'WATER CONTENT SENSOR', fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+8, y: hy+27, width: hw-16, text: 'Coaxial Capacitive', fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 10, height: 40, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+3, width: 10, height: 40, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });

        // 端子标签
        [['CAP-A', '#ffd54f', 20], ['CAP-B', '#90a4ae', 44]].forEach(([lbl, col, ty]) => {
            this.group.add(new Konva.Rect({ x: hx+4, y: hy+ty-7, width: hw-8, height: 14, fill: 'rgba(255,255,255,0.025)', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: hx+7, y: hy+ty-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });

        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH - 44) * 0.48;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 44);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        // 深海蓝色外环（分油机工业感）
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#003366', stroke: '#004d99', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        // 含水率弧
        this._waterArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#4fc3f7', rotation: -90 });
        // 报警弧
        this._alarmArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ef5350', rotation: -90 + (this.alarmThreshold / this.maxWater) * 360, opacity: 0.5 });

        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'0.0',   fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#4fc3f7', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'%',     fontSize:R*.18, fill:'#003366', align:'center' });
        this._lcdCap    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.29, width:(R-4)*2, text:'C=-- pF', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdEps    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.60, width:(R-4)*2, text:'ε=--',  fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdTemp   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.48, width:(R-4)*2, text:'--°C',  fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._alarmArc, this._waterArc, this._lcdMain, this._lcdUnit, this._lcdCap, this._lcdEps, this._lcdTemp);
    }

    // ── 波形区（右下）────────────────────────
    _drawWaveformArea() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'C(t) 电容变化  振荡器输出', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center' }));

        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [wx, wy+wh*i/3, wx+ww, wy+wh*i/3], stroke: 'rgba(79,195,247,0.07)', strokeWidth: 0.5 }));
        for (let i = 1; i < 4; i++) this.group.add(new Konva.Line({ points: [wx+ww*i/4, wy, wx+ww*i/4, wy+wh], stroke: 'rgba(79,195,247,0.05)', strokeWidth: 0.5 }));

        this._wavMidCap = wy + wh * 0.28;
        this._wavMidOsc = wy + wh * 0.74;

        [this._wavMidCap, this._wavMidOsc].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineCap = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineOsc = new Konva.Line({ points: [], stroke: '#4fc3f7', strokeWidth: 1.5, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'C (pF)', fontSize: 8, fill: '#ffd54f' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+5, text: 'OSC', fontSize: 8, fill: '#4fc3f7' }));

        this._wCapLbl = new Konva.Text({ x: wx+ww-90, y: wy+16, width: 86, text: '-- pF', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });
        this._wOscLbl = new Konva.Text({ x: wx+ww-90, y: wy+wh/2+5, width: 86, text: '-- kHz', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#4fc3f7', align: 'right' });

        this.group.add(bg, titleBg, this._wLineCap, this._wLineOsc, this._wCapLbl, this._wOscLbl);
    }

    // ── 底部面板 ─────────────────────────────
    _drawBottomPanel() {
        // 简洁底栏，由 _tickDisplay 填充
    }

    // ── 拖拽（探极区调节含水率）────────────
    _setupDrag() {
        const hit = new Konva.Rect({
            x: this._probeX, y: this._probeY,
            width: this._probeW, height: this._probeH,
            fill: 'transparent', listening: true,
        });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartW = this._manualWater;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualWater = Math.max(0, Math.min(100, this._dragStartW + (this._dragStartY - cy) * 0.3));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickFluidViz();
                this._tickCrossSection();
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
        this.waterContent = this._manualWater;
        const alpha = this.waterContent / 100;

        // 温度修正的油介电常数
        const epsOilT = this.epsilonOil + this.tempCoeff * (this.tempC - 25);
        this._epsOilCurrent = Math.max(1.5, epsOilT);

        // 混合介质有效介电常数
        this.epsilonMix = this._epsOilCurrent * (1 - alpha) + this.epsilonWater * alpha;

        // 电容计算
        const L  = this.electrodeLength;
        const R1 = this.innerRadius, R2 = this.outerRadius;
        this.capacitance = 2 * Math.PI * this._eps0 * this.epsilonMix * L / Math.log(R2/R1) * 1e12;  // pF

        // 振荡器频率（反比电容）：f ≈ 1/(2π√(LC))，假设 L=1mH
        const L_osc = 1e-3;  // H
        const C_F   = this.capacitance * 1e-12;  // F
        this.oscFreq = 1 / (2 * Math.PI * Math.sqrt(L_osc * C_F)) / 1000;  // kHz

        // 振荡幅值（恒流激励，随C变化）
        this.oscVoltage = Math.min(5, 20 / (this.capacitance + 1e-6));

        // 报警
        this.alarmActive = this.waterContent > this.alarmThreshold;

        // 振荡相位
        this._oscPhase += this.oscFreq * 2 * Math.PI * dt * 0.01; // 视觉减速

        // 电容弧更新
        if (this._waterArc) {
            const ratio = Math.min(1, this.waterContent / this.maxWater);
            this._waterArc.angle(ratio * 360);
            this._waterArc.fill(this.alarmActive ? '#ef5350' : '#4fc3f7');
        }
    }

    // ── 流体可视化（纵截面内）────────────────
    _tickFluidViz() {
        this._fluidGroup.destroyChildren();
        this._fieldLayer.destroyChildren();

        const px = this._probeX + this._wallT;
        const py = this._innerY;
        const pw = this._probeCX - this._coreT - px;
        const ph = this._innerH;
        const alpha = this.waterContent / 100;

        // 左侧测量腔（内外电极之间）
        for (let side of [-1, 1]) {
            const cavX = side < 0 ? px : this._probeCX + this._coreT;
            const cavW = pw;

            // 油水混合颜色渐变
            const oilR = Math.round(42 + (1-alpha)*30);
            const oilG = Math.round(24 + (1-alpha)*20);
            const waterR = Math.round(20 + alpha*30);
            const waterG = Math.round(80 + alpha*100);
            const waterB = Math.round(150 + alpha*80);
            const mixR = Math.round(oilR*(1-alpha) + waterR*alpha);
            const mixG = Math.round(oilG*(1-alpha) + waterG*alpha);
            const mixB = Math.round(10*(1-alpha) + waterB*alpha);

            // 填充混合液体
            this._fluidGroup.add(new Konva.Rect({
                x: cavX, y: py, width: cavW, height: ph,
                fill: `rgb(${mixR},${mixG},${mixB})`, opacity: 0.85,
            }));

            // 水珠（随含水率显示）
            const numDrops = Math.floor(alpha * 12);
            for (let i = 0; i < numDrops; i++) {
                const dx2 = cavX + 4 + (i * 13) % (cavW - 8);
                const dy2 = py + 8 + (i * 17 + Math.sin(this._oscPhase * 0.5 + i) * 10) % (ph - 16);
                const dropR = 2.5 + (i % 3) * 1.5;
                this._fluidGroup.add(new Konva.Circle({
                    x: dx2, y: dy2, radius: dropR,
                    fill: `rgba(100,200,255,${0.5 + alpha*0.4})`,
                    stroke: 'rgba(80,160,220,0.6)', strokeWidth: 0.5,
                }));
            }

            // 电场线（水平，从内到外电极）
            const numLines = 8;
            for (let i = 0; i < numLines; i++) {
                const fy = py + 10 + i * (ph-20) / (numLines-1);
                const intensity = 0.15 + alpha * 0.45;
                const pulse = 0.5 + 0.5 * Math.sin(this._oscPhase + i * 0.8);
                const lineAlpha = intensity * (0.4 + 0.6 * pulse);
                // 电场线颜色：纯油=黄色，高含水=蓝色
                const fr = Math.round(255 * (1-alpha));
                const fg = Math.round(200 * (1-alpha));
                const fb = Math.round(255 * alpha);
                this._fieldLayer.add(new Konva.Line({
                    points: side < 0
                        ? [cavX + cavW - 2, fy, this._probeCX - this._coreT + 2, fy]
                        : [this._probeCX + this._coreT - 2, fy, cavX + 2, fy],
                    stroke: `rgba(${fr},${fg},${fb},${lineAlpha})`,
                    strokeWidth: 1 + alpha,
                    dash: [4, 3],
                }));
            }
        }

        // 内电极高光（充放电脉冲）
        const coreGlow = Math.abs(Math.sin(this._oscPhase)) * 0.4 * (this.waterContent / 100 + 0.1);
        this._fluidGroup.add(new Konva.Rect({
            x: this._probeCX - this._coreT - 2, y: this._innerY,
            width: this._coreT * 2 + 4, height: this._innerH,
            fill: `rgba(255,213,79,${coreGlow})`, cornerRadius: 2,
        }));
    }

    // ── 横截面动态更新 ────────────────────────
    _tickCrossSection() {
        const alpha = this.waterContent / 100;
        const cx = this._secCX, cy = this._secCY;
        const R1 = this._secR1, R2 = this._secR2;

        // 测量腔颜色
        if (this._secFluid) {
            const oilR = 42, oilG = 24;
            const waterR = 50, waterG = 150, waterB = 230;
            const mixR = Math.round(oilR*(1-alpha) + waterR*alpha);
            const mixG = Math.round(oilG*(1-alpha) + waterG*alpha);
            const mixB = Math.round(10*(1-alpha) + waterB*alpha);
            this._secFluid.fill(`rgb(${mixR},${mixG},${mixB})`);
        }

        // 截面电场线（放射状）
        this._secFieldGroup.destroyChildren();
        const numLines = 12;
        for (let i = 0; i < numLines; i++) {
            const angle = (i / numLines) * Math.PI * 2;
            const pulse  = 0.5 + 0.5 * Math.sin(this._oscPhase + i * 0.5);
            const intensity = (0.15 + alpha * 0.45) * (0.4 + 0.6 * pulse);
            const fr = Math.round(255 * (1-alpha));
            const fb = Math.round(255 * alpha);
            this._secFieldGroup.add(new Konva.Line({
                points: [
                    cx + (R1+2) * Math.cos(angle), cy + (R1+2) * Math.sin(angle),
                    cx + (R2-2) * Math.cos(angle), cy + (R2-2) * Math.sin(angle),
                ],
                stroke: `rgba(${fr},200,${fb},${intensity})`,
                strokeWidth: 1 + alpha, dash: [3, 3],
            }));
        }

        // 电容和ε标注
        if (this._secCapLabel) this._secCapLabel.text(`C=${this.capacitance.toFixed(1)} pF`);
        if (this._secEpsLabel) this._secEpsLabel.text(`ε=${this.epsilonMix.toFixed(1)}`);
    }

    // ── 波形缓冲 ──────────────────────────────
    _tickWaveform(dt) {
        const scrollSpeed = 1.5;
        this._wavAcc += scrollSpeed * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        const oscSignal = this.oscVoltage * Math.sin(this._oscPhase * 8);

        for (let i = 0; i < steps; i++) {
            this._wavOsc = new Float32Array([...this._wavOsc.slice(1), oscSignal]);
            this._wavCap = new Float32Array([...this._wavCap.slice(1), this.capacitance]);
        }

        const wx = this._wavX + 3, wy2 = this._wavY;
        const ww = this._wavW - 6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;
        const capAmp = wh * 0.22;
        const oscAmp = wh * 0.18;

        // 电容趋势线
        const maxCap = this._cDry * (1 + (this.epsilonWater / this._epsOilCurrent - 1));
        const capPts = [], oscPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            const cNorm = (this._wavCap[i] - this._cDry) / (maxCap - this._cDry + 0.01);
            capPts.push(x, this._wavMidCap - cNorm * capAmp);
            const oNorm = this._wavOsc[i] / (this.driveVoltage || 5 + 0.01);
            oscPts.push(x, this._wavMidOsc - this._wavOsc[i] / (Math.abs(this.oscVoltage)+0.01) * oscAmp);
        }
        if (this._wLineCap) this._wLineCap.points(capPts);
        if (this._wLineOsc) this._wLineOsc.points(oscPts);

        if (this._wCapLbl) this._wCapLbl.text(`${this.capacitance.toFixed(2)} pF`);
        if (this._wOscLbl) this._wOscLbl.text(`${this.oscFreq.toFixed(1)} kHz`);

        // 等效电路标注
        if (this._circCxLabel)  this._circCxLabel.text(`Cx\n${this.capacitance.toFixed(1)}pF`);
        if (this._circOscLabel) this._circOscLabel.text(`OSC: ${this.oscFreq.toFixed(1)} kHz`);
    }

    // ── 显示刷新 ──────────────────────────────
    _tickDisplay() {
        if (this.isBreak) {
            if (this._lcdMain) { this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350'); }
            return;
        }

        const w   = this.waterContent;
        const mc  = w > this.alarmThreshold ? '#ef5350' : w > 2 ? '#4fc3f7' : '#00bcd4';

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(w.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdUnit) this._lcdUnit.text('%H₂O');
        if (this._lcdCap)  this._lcdCap.text(`C=${this.capacitance.toFixed(2)} pF`);
        if (this._lcdCap)  this._lcdCap.fill(this.alarmActive ? '#ffa726' : '#37474f');
        if (this._lcdEps)  this._lcdEps.text(`ε=${this.epsilonMix.toFixed(2)}`);
        if (this._lcdTemp) this._lcdTemp.text(`${this.tempC}°C`);
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(waterContent) {
        if (typeof waterContent === 'number') {
            this._manualWater = Math.max(0, Math.min(100, waterContent));
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',             type: 'text'   },
            { label: '油介电常数 εᵣ_oil',   key: 'epsilonOil',     type: 'number' },
            { label: '报警阈值 (%)',         key: 'alarmThreshold', type: 'number' },
            { label: '量程上限 (%)',         key: 'maxWater',       type: 'number' },
            { label: '工作温度 (°C)',        key: 'tempC',          type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id             = cfg.id             || this.id;
        this.epsilonOil     = parseFloat(cfg.epsilonOil)     || this.epsilonOil;
        this.alarmThreshold = parseFloat(cfg.alarmThreshold) ?? this.alarmThreshold;
        this.maxWater       = parseFloat(cfg.maxWater)       || this.maxWater;
        this.tempC          = parseFloat(cfg.tempC)          ?? this.tempC;
        this._updateBaseCapacitance();
        this.config         = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}