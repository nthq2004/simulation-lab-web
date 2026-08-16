import { BaseComponent } from './BaseComponent.js';

/**
 * 热敏电阻（NTC）仿真组件
 * （NTC Thermistor — Negative Temperature Coefficient）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  NTC 热敏电阻由半导体陶瓷材料（锰、镍、钴等金属氧化物）烧结而成。
 *  其电阻值随温度升高而急剧下降（负温度系数），具有高灵敏度。
 *
 *  1. B 参数方程（简化 Steinhart-Hart）：
 *     R(T) = R_ref × exp[ B × (1/T - 1/T_ref) ]
 *     其中：
 *       T   — 绝对温度（K = °C + 273.15）
 *       T_ref — 参考温度（通常 25°C = 298.15 K）
 *       R_ref — 参考温度下的电阻（通常 25°C 时的标称电阻）
 *       B   — B 参数（典型值 2000~5000 K），材料特性常数
 *
 *  2. 完整 Steinhart-Hart 方程（三参数，精度更高）：
 *     1/T = A + B×ln(R) + C×[ln(R)]³
 *     解出 T：
 *       T = 1 / {A + B×ln(R) + C×[ln(R)]³}
 *     反解 R(T)：
 *       通过牛顿迭代或 B 参数方程近似
 *
 *  3. 温度系数 α（Sensitivity）：
 *     α = (1/R) × dR/dT = -B/T²    （%/K）
 *     在 25°C 时，α ≈ -B/T² ≈ -3~5 %/°C
 *
 *  4. 分压器电路（实际测量）：
 *     V_out = V_cc × R_ntc / (R_series + R_ntc)
 *     → ADC 测量 V_out → 计算 R_ntc → 查表得 T
 *
 *  5. 自热效应（Self-Heating）：
 *     P = V² / R → 热功率引起传感器自身升温
 *     ΔT_self = P / δ     （δ = 耗散系数，mW/°C）
 *     需使用小激励电流以减小自热误差
 *
 * ── 材料常数典型值 ──────────────────────────────────────────
 *  NTC 10kΩ（常用）：B=3950K，α≈-4.4%/°C @ 25°C
 *  NTC 100kΩ：       B=4150K，α≈-4.7%/°C @ 25°C
 *  NTC 1kΩ（快速）：  B=3380K，α≈-3.8%/°C @ 25°C
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 热敏电阻探头（珠形/轴向封装，环氧密封）
 *  ② 温度-电阻特性曲线（对数纵坐标，指数下降）
 *  ③ 分压器测量电路可视化
 *  ④ 自热效应指示
 *  ⑤ ADC 输出（模拟数字量）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_l    — 正极（+ 或 高电位端）
 *  wire_r    — 负极（− 或 低电位端）

 */
export class NTCThermistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(380, config.width || 460);
        this.height = Math.max(340, config.height || 400);

        this.type = 'resistor';
        this.special = 'ntc';
        this.cache = 'fixed';

        // ── NTC 参数 ──

        this.Tref = config.Tref || 298.15;   // 参考温度 K（25°C）
        this.Vcc = config.Vcc || 3.3;      // 激励电压 V
        this.delta = config.delta || 1.5;      // 耗散系数 mW/°C（自热）

        // ── 自热模式（浪涌电流抑制用） ──
        this.selfHeatingMode = config.selfHeatingMode || false;
        this.T_ambient = config.T_ambient || 25;   // 环境温度 °C
        this.C_th = config.C_th || 1.0;            // 热容量 J/°C

        // ── 量程 ──
        this.tempRangeLo = config.tempRangeLo || -20;   // °C
        this.tempRangeHi = config.tempRangeHi || 120;   // °C

        // ── NTC 型号预设 ──
        this._presets = {
            'NTC-10': { Rref: 10, B: 3380, Rseries: 0.001, label: '10Ω  B=3380' },
            'NTC-1K': { Rref: 1000, B: 3380, Rseries: 1000, label: '1kΩ  B=3380' },
            'NTC-10K': { Rref: 10000, B: 3950, Rseries: 10000, label: '10kΩ B=3950' },
            'NTC-47K': { Rref: 47000, B: 4050, Rseries: 47000, label: '47kΩ B=4050' },
            'NTC-100K': { Rref: 100000, B: 4150, Rseries: 100000, label: '100kΩ B=4150' },
        };
        this.presetKey = config.presetKey || 'NTC-10K';
        this.Rref = this._presets[this.presetKey].Rref;    // 参考电阻 Ω（25°C 标称值）
        this.B = this._presets[this.presetKey].B;     // B 参数 K（材料常数）
        this.Rseries = this._presets[this.presetKey].Rseries;    // 串联电阻 Ω（分压器）

        // 支持从 config 覆盖 Rref / B（用于自定义 NTC 参数，如浪涌抑制用低阻值NTC）
        if (config.Rref !== undefined) this.Rref = config.Rref;
        if (config.B !== undefined) this.B = config.B;
        if (config.Rseries !== undefined) this.Rseries = config.Rseries;
        // Steinhart-Hart 系数（从 B 参数推导）
        this._calcSH();

        // ── 状态 ──
        this.temperature = config.initTemp || 25;    // °C
        this._manualTemp = config.initTemp || 25;
        this.currentResistance = 0;    // 实际阻值 Ω
        this.vOut = 0;    // 分压输出电压 V
        this.adcValue = 0;    // ADC 值（12位，0~4095）
        this.selfHeatDT = 0;    // 自热温升 °C

        this.alpha = 0;    // 温度系数 %/°C
        this.isBreak = false;

        // 自热模式（浪涌电流抑制）：从环境温度开始
        if (this.selfHeatingMode) {
            this.temperature = this.T_ambient;
            this._manualTemp = this.T_ambient;
            // 浪涌抑制模式下串联电阻置零（NTC直接串联于主回路中）
            this.Rseries = 0.001;
            // 增大温度显示范围
            this.tempRangeHi = 250;
        }

        // ── 动画 ──
        this._phase = 0;
        this._glowPhase = 0;
        this._heatGlow = 0;

        // ── 拖拽 ──
        this._dragActive = false;
        this._dragStartY = 0;
        this._dragStartT = 0;

        // ── 几何布局 ──
        // 探头区（左侧）
        this._probeX = 8;
        this._probeY = Math.round(this.height * 0.06);
        this._probeW = Math.round(this.width * 0.20);
        this._probeH = Math.round(this.height * 0.72);
        this._probeCX = this._probeX + this._probeW / 2;

        // R-T 特性曲线（中部）
        this._curveX = this._probeX + this._probeW + 10;
        this._curveY = this._probeY;
        this._curveW = Math.round(this.width * 0.32);
        this._curveH = Math.round(this.height * 0.52);

        // 测量电路图（曲线下方）
        this._circX = this._curveX;
        this._circY = this._curveY + this._curveH + 6;
        this._circW = this._curveW;
        this._circH = Math.round(this.height * 0.20);

        this._lastTs = null;
        this._animId = null;
        this.knobs = {};

        this.config = {
            id: this.id, Rref: this.Rref, B: this.B,
            tempRangeLo: this.tempRangeLo, tempRangeHi: this.tempRangeHi,
        };

        this._init();

        this.addPort(this._probeCX - 16, this.height - 60, 'l', 'wire', 'p');
        this.addPort(this._probeCX + 16, this.height - 24, 'r', 'wire');
    }

    // ── Steinhart-Hart 系数推导 ──────────────
    _calcSH() {
        // 从 B 参数推导简化 SH 系数
        const Tref = this.Tref;
        this._A = 1 / Tref - Math.log(this.Rref) / this.B;
        this._B_SH = 1 / this.B;
        this._C_SH = 0;  // 简化三阶为零
    }

    // ── NTC 阻值计算（B 参数方程）────────────
    _calcR(T_celsius) {
        const T = T_celsius + 273.15;
        return this.Rref * Math.exp(this.B * (1 / T - 1 / this.Tref));
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawProbeHousing();
        this._drawNTCElement();
        this._drawLeads();
        this._drawRTCurve();
        if (!this.selfHeatingMode){
            this._drawMeasCircuit();
            this._drawPresetSelector();
        }
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 10, y: 6, width: this.width,
            text: 'NTC 热敏电阻',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'left',
        }));
    }

    // ── 探头外壳（轴向/珠形封装）────────────
    _drawProbeHousing() {
        const cx2 = this._probeCX;
        const py = this._probeY, ph = this._probeH;
        const pw = this._probeW;

        // 接线头/接线盒（顶部）
        const headH = Math.round(ph * 0.25);
        const headW = pw - 4;
        const head = new Konva.Rect({ x: this._probeX + 2, y: py, width: headW, height: headH, fill: '#e7edf0', stroke: '#263238', strokeWidth: 2, cornerRadius: [4, 4, 0, 0] });
        this._typeLbl = new Konva.Text({ x: this._probeX + 6, y: py + headH / 2 - 20, width: headW - 8, text: `NTC\n${this.presetKey}`, fontSize: 15, fontStyle: 'bold', fill: '#0fa54b', align: 'center', lineHeight: 1.3 });
        // 保护管（螺纹/密封，中段）
        const tubeY = py + headH;
        const tubeH = Math.round(ph * 0.45);
        const tubeW = Math.round(pw * 0.32);
        const tube = new Konva.Rect({ x: cx2 - tubeW / 2, y: tubeY, width: tubeW, height: tubeH, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5, cornerRadius: [0, 0, 2, 2] });
        // 管体高光
        this.group.add(new Konva.Rect({ x: cx2 - tubeW / 2 + 2, y: tubeY, width: 4, height: tubeH, fill: 'rgba(255,255,255,0.18)' }));

        // NTC 珠体（末端椭圆珠形，陶瓷外观）
        const beadY = tubeY + tubeH;
        const beadRX = Math.round(tubeW * 0.65), beadRY = Math.round(ph * 0.12);
        this._beadEllipse = new Konva.Ellipse({ x: cx2, y: beadY + beadRY, radiusX: beadRX, radiusY: beadRY, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1.5 });
        // 珠体颜色随温度变化（动态）
        // 珠体高光
        this.group.add(new Konva.Ellipse({ x: cx2 - beadRX * 0.28, y: beadY + beadRY * 0.5, radiusX: beadRX * 0.30, radiusY: beadRY * 0.28, fill: 'rgba(255,255,255,0.35)' }));
        // 热辉光（底部散发）
        this._beadGlow = new Konva.Ellipse({ x: cx2, y: beadY + beadRY + 6, radiusX: beadRX * 1.6, radiusY: beadRY * 1.4, fill: 'rgba(0,188,212,0)' });

        this._probeTubeY = tubeY;
        this._probeTubeH = tubeH;
        this._probeTubeW = tubeW;
        this._probeBeadY = beadY;
        this._probeBeadRX = beadRX;
        this._probeBeadRY = beadRY;
        this._probeHeadH = headH;

        this.group.add(head, tube, this._beadGlow, this._beadEllipse, this._typeLbl);
    }

    // ── NTC 内部结构（半导体陶瓷）────────────
    _drawNTCElement() {
        const cx2 = this._probeCX;
        const beadY = this._probeBeadY, bRX = this._probeBeadRX, bRY = this._probeBeadRY;

        // 内部陶瓷截面示意（小圆表示半导体晶粒）
        this._crystalGroup = new Konva.Group({ x: cx2, y: beadY + bRY });
        const crystalN = 9;
        for (let i = 0; i < crystalN; i++) {
            const a = (i / crystalN) * Math.PI * 2;
            const cr = bRX * 0.5, r2 = Math.round(bRX * 0.12);
            const crystal = new Konva.Circle({ x: cr * Math.cos(a), y: cr * Math.sin(a) * 0.5, radius: r2, fill: '#08ef78', stroke: '#37474f', strokeWidth: 0.5, opacity: 0.6 });
            this._crystalGroup.add(crystal);
        }
        this._crystalGroup.add(new Konva.Circle({ radius: bRX * 0.15, fill: '#7a6b54', opacity: 0.7 }));
        this.group.add(this._crystalGroup);

        // 温度指示器（管内滑动点）
        this._tempIndicator = new Konva.Circle({ x: cx2, y: this._probeTubeY + this._probeTubeH / 2, radius: 5.5, fill: '#00bcd4', stroke: '#00838f', strokeWidth: 1.5 });
        this.group.add(this._tempIndicator);
    }

    // ── 引线 ─────────────────────────────────
    _drawLeads() {
        const cx2 = this._probeCX;
        const beadY = this._probeBeadY + this._probeBeadRY * 2;

        // 两根引线（向下延伸到端子）
        this._lead1 = new Konva.Line({ points: [cx2 - 16, beadY - 12, cx2 - 16, this.height - 62], stroke: '#ef9a9a', strokeWidth: 2.5, lineCap: 'round' });
        this._lead2 = new Konva.Line({ points: [cx2 + 16, beadY - 12, cx2 + 16, this.height - 22], stroke: '#b0bec5', strokeWidth: 2.5, lineCap: 'round' });
        this.group.add(new Konva.Text({ x: cx2 - 22, y: this.height - 18, text: 'R+', fontSize: 10, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: cx2 + 12, y: this.height - 18, text: 'R−', fontSize: 10, fill: '#b0bec5' }));

        this.group.add(this._lead1, this._lead2);
    }

    // ── R-T 特性曲线（对数纵坐标）───────────
    _drawRTCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        // 坐标系
        const ox = cx2 + 18, oy = cy2 + ch - 12, aw = cw - 24, ah = ch - 26;
        this.group.add(new Konva.Line({ points: [ox, oy - ah, ox, oy, ox + aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ox - 16, y: cy2 + 2, text: 'R(Ω)', fontSize: 10, fill: '#048b31' }));
        this.group.add(new Konva.Text({ x: cx2 + cw - 4, y: oy + 2, text: 'T(°C)', fontSize: 10, fill: '#00bcd4' }));

        // 温度轴刻度
        const tMin = -20, tMax = 120;
        [-20, 0, 25, 50, 80, 100, 120].forEach(T => {
            const tx = ox + (T - tMin) / (tMax - tMin) * (aw - 2);
            this.group.add(new Konva.Line({ points: [tx, oy, tx, oy + 3], stroke: '#37474f', strokeWidth: 0.8 }));
            if (T % 50 === 0 || T === 25) this.group.add(new Konva.Text({ x: tx - 8, y: oy + 4, width: 16, text: T.toString(), fontSize: 8, fill: '#37474f', align: 'center' }));
        });

        // R轴（对数刻度）
        const rMax = this._calcR(tMin) * 1.2;
        const rMin = this._calcR(tMax) * 0.5;
        const logRMax = Math.log10(rMax), logRMin = Math.log10(rMin);
        [10, 100, 1000, 10000, 100000, 1000000].forEach(R => {
            if (R < rMin * 0.5 || R > rMax * 2) return;
            const logR = Math.log10(R);
            const ry = oy - (logR - logRMin) / (logRMax - logRMin) * (ah - 4);
            this.group.add(new Konva.Line({ points: [ox - 3, ry, ox, ry], stroke: '#37474f', strokeWidth: 0.8 }));
            const rStr = R >= 1000 ? (R / 1000) + 'k' : R.toString();
            this.group.add(new Konva.Text({ x: ox - 28, y: ry - 4, width: 24, text: rStr, fontSize: 10, fill: '#217608', align: 'right' }));
        });

        // R-T 曲线（当前 B 参数）
        const curvePts = [];
        for (let T = tMin; T <= tMax; T += 2) {
            const R = this._calcR(T);
            const logR = Math.log10(R);
            const tx = ox + (T - tMin) / (tMax - tMin) * (aw - 2);
            const ry = oy - (logR - logRMin) / (logRMax - logRMin) * (ah - 4);
            curvePts.push(tx, ry);
        }
        this.group.add(new Konva.Line({ points: curvePts, stroke: '#086774', strokeWidth: 2, lineJoin: 'round', opacity: 0.85 }));

        // 25°C 参考点标注
        const r25 = this.Rref;
        const tx25 = ox + (25 - tMin) / (tMax - tMin) * (aw - 2);
        const ry25 = oy - (Math.log10(r25) - logRMin) / (logRMax - logRMin) * (ah - 4);
        this.group.add(new Konva.Circle({ x: tx25, y: ry25, radius: 3.5, fill: '#785d04', stroke: '#f9a825', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: tx25 - 30, y: ry25 - 12, text: `25°C\n${r25 >= 1000 ? (r25 / 1000).toFixed(0) + 'kΩ' : r25 + 'Ω'}`, fontSize: 10, fill: '#977508', lineHeight: 1.3 }));

        // 工作点
        this._rtPoint = new Konva.Circle({ x: ox, y: oy, radius: 4.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this._rtHLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3, 2], opacity: 0.5 });
        this._rtVLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3, 2], opacity: 0.5 });
        this._rtLabel = new Konva.Text({ x: 0, y: 0, text: '', fontSize: 14, fontFamily: 'Courier New, monospace', fill: '#ef5350', align: 'right' });

        this._rtOX = ox; this._rtOY = oy; this._rtAW = aw; this._rtAH = ah;
        this._rtTMin = tMin; this._rtTMax = tMax;
        this._rtLogRMin = logRMin; this._rtLogRMax = logRMax;
        this._rtRMax = rMax; this._rtRMin = rMin;

        this.group.add(this._rtPoint, this._rtHLine, this._rtVLine, this._rtLabel);
    }

    // ── 测量电路图（分压器）──────────────────
    _drawMeasCircuit() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;
        // Vcc → Rs → NTC → GND 电路
        this.group.add(new Konva.Text({ x: cx2 + 4, y: cy2 + 6, text: `Vcc=${this.Vcc}V`, fontSize: 10, fill: '#8b0707' }));
        this.group.add(new Konva.Line({ points: [cx2 + 40, cy2 + 18, cx2 + 60, cy2 + 18], stroke: '#ef9a9a', strokeWidth: 1.5 }));

        // Rs 电阻符号
        const rsX = cx2 + 60, rsY = cy2 + 14;
        this.group.add(new Konva.Rect({ x: rsX, y: rsY, width: 32, height: 10, fill: 'none', stroke: '#ffd54f', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: rsX + 2, y: rsY - 10, text: `Rs=${this.Rseries / 1000}k`, fontSize: 10, fill: '#775d06' }));
        this.group.add(new Konva.Line({ points: [rsX + 32, cy2 + 18, rsX + 50, cy2 + 18, rsX + 50, cy2 + 28], stroke: '#ffd54f', strokeWidth: 1.5 }));

        this._circVoutLbl = new Konva.Text({ x: rsX + 52, y: cy2 + 40, text: '0.00V', fontSize: 12, fontFamily: 'Courier New, monospace', fill: '#215123' });
        this._circADCLbl = new Konva.Text({ x: cx2 + 4, y: cy2 + ch - 20, text: 'ADC:0  R=--Ω', fontSize: 10, fontFamily: 'Courier New, monospace', fill: '#067469' });

        // NTC 符号（Z形）
        const ntcX = rsX + 45, ntcY = cy2 + 28;
        const ntcPts = [ntcX + 5, ntcY, ntcX + 5, ntcY + 8, ntcX + 11, ntcY + 4, ntcX + 5, ntcY + 8, ntcX + 5, ntcY + 14];
        this.group.add(new Konva.Line({ points: ntcPts, stroke: '#00bcd4', strokeWidth: 2, lineJoin: 'round' }));
        // NTC 箭头（负温度系数）
        this.group.add(new Konva.Arrow({ points: [ntcX + 2, ntcY + 14, ntcX + 12, ntcY], stroke: '#00bcd4', fill: '#00bcd4', strokeWidth: 1, pointerLength: 3, pointerWidth: 3 }));
        this.group.add(new Konva.Text({ x: ntcX + 14, y: ntcY + 4, text: 'NTC', fontSize: 7, fill: '#00bcd4' }));
        this.group.add(new Konva.Line({ points: [ntcX + 5, ntcY + 14, ntcX + 5, cy2 + ch - 8, cx2 + 8, cy2 + ch - 8], stroke: '#b0bec5', strokeWidth: 1.5 }));

        // 自热效应
        this._selfHeatLbl = new Konva.Text({ x: cx2 + 4, y: cy2 + ch - 44, text: 'ΔT_self=0.0°C', fontSize: 10, fontFamily: 'Courier New, monospace', fill: '#915c0c' });

        this.group.add(this._circVoutLbl, this._circADCLbl, this._selfHeatLbl);
    }

    // ── 型号预设选择器 ───────────────────────
    _drawPresetSelector() {
        const { _curveX: cx2, _curveY: cy2 } = this;
        const selX = cx2, selY = this._circY + this._circH + 4;
        const selW = this._curveW;
        const selH = this.height - selY - this._wavH - this._wavY + this._probeY + this._probeH - 4;
        if (selH < 14) return;

        this.group.add(new Konva.Text({ x: selX + 4, y: selY + 2, width: selW - 8, text: '型号预设 ', fontSize: 12, fontStyle: 'bold', fill: '#00bcd4', align: 'center' }));

        // 型号按钮
        const keys = Object.keys(this._presets);
        const btnW = (selW - 10) / keys.length;
        const btnY = selY + 17;
        this._presetBtns = [];
        keys.forEach((key, i) => {
            const pr = this._presets[key];
            const bx = selX + 5 + i * (btnW + 2);
            const isAct = key === this.presetKey;
            const btn = new Konva.Rect({ x: bx, y: btnY, width: btnW, height: 14, fill: isAct ? '#0d3a3a' : '#0d2030', stroke: isAct ? '#00bcd4' : '#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: btnY +1, width: btnW, text: key.replace('NTC-', ''), fontSize: 12, fill: isAct ? '#00bcd4' : '#37474f', align: 'center' });
            btn.on('click tap', () => {
                const p = this._presets[key];
                this.Rref = p.Rref; this.B = p.B; this.presetKey = key;
                this._calcSH();
                this._presetBtns.forEach((b, j) => {
                    const act = keys[j] === key;
                    b.btn.fill(act ? '#0d3a3a' : '#0d2030'); b.btn.stroke(act ? '#00bcd4' : '#1a3040');
                    b.lbl.fill(act ? '#00bcd4' : '#37474f');
                });
                if (this._typeLbl) this._typeLbl.text(`NTC\n${key}`);
                this._refreshCache();
            });
            this._presetBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });
    }

    // ── 拖拽 ─────────────────────────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._probeX, y: this._probeY, width: this._probeW, height: this._probeH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartT = this._manualTemp;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy2 = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            const range = this.tempRangeHi - this.tempRangeLo;
            this._manualTemp = Math.max(this.tempRangeLo - 20, Math.min(this.tempRangeHi + 30, this._dragStartT + (this._dragStartY - cy2) * (range / this._probeTubeH)));
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
                this._tickProbeViz();
                this._tickRTPoint();
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
        if (this.selfHeatingMode) {
            // ── 自热模式（浪涌电流抑制） ──
            // 通过 physCurrent 读取回路电流（由电路求解器在每一步计算得出）
            const I = this.physCurrent || 0;
            const P_W = I * I * this.currentResistance;     // 电功率 (W)
            const P_mW = P_W * 1000;                         // → mW
            // 热模型：dT/dt = (P - δ×ΔT) / C_th
            // C_th 单位 J/°C = 1000 mW·s/°C
            const dT = (P_mW - this.delta * (this.temperature - this.T_ambient))
                       * Math.min(dt, 0.05) / (this.C_th * 1000);
            this.temperature += dT;
            this.temperature = Math.max(this.T_ambient, Math.min(250, this.temperature));
            this._manualTemp = this.temperature;
            this.currentResistance = this._calcR(this.temperature);

            // 故障：NTC 开路
            if (this.isBreak) this.currentResistance = 1e9;

            // 温度系数 α = -B / T²
            const T_K = this.temperature + 273.15;
            this.alpha = -this.B / (T_K * T_K) * 100;

            // 显示用参数
            this.vOut = I * this.currentResistance;          // NTC 压降
            this.selfHeatDT = this.temperature - this.T_ambient;

            // 热辉光
            this._heatGlow = Math.max(0, Math.min(0.45, (this.temperature - 60) / 80));
        } else {
            this.temperature = this._manualTemp;
            this.currentResistance = this._calcR(this.temperature);

            // 温度系数 α = -B / T²
            const T_K = this.temperature + 273.15;
            this.alpha = -this.B / (T_K * T_K) * 100;  // %/°C

            // 分压器输出
            this.vOut = this.Vcc * this.currentResistance / (this.Rseries + this.currentResistance);
            this.adcValue = Math.round(this.vOut / this.Vcc * 4095);

            // 自热效应：P = V²/R → ΔT = P/δ
            const P_mW = (this.vOut * this.vOut / this.currentResistance) * 1000;
            this.selfHeatDT = P_mW / this.delta;

            // 热辉光（高温时青色辉光）
            this._heatGlow = Math.max(0, Math.min(0.45, (this.temperature - 60) / 80));
        }
        this._phase += dt * 3;
        this._glowPhase += dt * 5;
    }

    // ── 探头可视化 ───────────────────────────
    _tickProbeViz() {
        const T = this.temperature;
        const tNorm = Math.max(0, Math.min(1, (T - this.tempRangeLo) / (this.tempRangeHi - this.tempRangeLo + 0.01)));

        // 珠体颜色（冷=蓝灰，热=橙红）
        if (this._beadEllipse) {
            const r = Math.round(160 + tNorm * 95), g = Math.round(180 - tNorm * 100), b = Math.round(180 - tNorm * 180);
            this._beadEllipse.fill(`rgb(${r},${Math.max(0, g)},${Math.max(0, b)})`);
        }
        // 珠体辉光
        if (this._beadGlow) {
            const glA = this._heatGlow + 0.08 * Math.abs(Math.sin(this._glowPhase));
            const r = Math.round(0 + tNorm * 255), g2 = Math.round(188 - tNorm * 100);
            this._beadGlow.fill(`rgba(${r},${Math.max(0, g2)},${Math.round(212 - tNorm * 212)},${glA})`);
        }
        // 温度指示点
        if (this._tempIndicator) {
            const iy = this._probeTubeY + (1 - tNorm) * this._probeTubeH;
            this._tempIndicator.y(iy);
            const r2 = Math.round(0 + tNorm * 255), g3 = Math.round(188 - tNorm * 100);
            this._tempIndicator.fill(`rgb(${r2},${Math.max(0, g3)},0)`);
        }
        // 电路图更新
        if (this.selfHeatingMode) {
            if (this._circVoutLbl) this._circVoutLbl.text(`Vdrop=${this.vOut.toFixed(3)}V`);
            if (this._circADCLbl) this._circADCLbl.text(
                `I=${(this.physCurrent || 0).toFixed(3)}A  R=${this._fmtR(this.currentResistance)}`
            );
            if (this._selfHeatLbl) this._selfHeatLbl.text(
                `ΔT=${this.selfHeatDT.toFixed(1)}°C  P=${((this.physCurrent||0)**2 * this.currentResistance).toFixed(2)}W`
            );
        } else {
            if (this._circVoutLbl) this._circVoutLbl.text(`${this.vOut.toFixed(4)}V`);
            if (this._circADCLbl) this._circADCLbl.text(`ADC:${this.adcValue}  R=${this._fmtR(this.currentResistance)}`);
            if (this._selfHeatLbl) this._selfHeatLbl.text(`ΔT_self=${this.selfHeatDT.toFixed(3)}°C`);
        }
    }

    _fmtR(R) {
        if (R >= 1000000) return (R / 1000000).toFixed(2) + 'MΩ';
        if (R >= 1000) return (R / 1000).toFixed(2) + 'kΩ';
        return R.toFixed(1) + 'Ω';
    }

    // ── R-T 工作点 ───────────────────────────
    _tickRTPoint() {
        const T = this.temperature, R = this.currentResistance;
        const { _rtOX: ox, _rtOY: oy, _rtAW: aw, _rtAH: ah, _rtTMin: tMin, _rtTMax: tMax, _rtLogRMin: logRMin, _rtLogRMax: logRMax } = this;

        const logR = Math.log10(Math.max(1, R));
        const tClamp = Math.max(tMin, Math.min(tMax, T));
        const tx = ox + (tClamp - tMin) / (tMax - tMin) * (aw - 2);
        const ry = oy - (logR - logRMin) / (logRMax - logRMin) * (ah - 4);

        if (this._rtPoint) { this._rtPoint.x(tx); this._rtPoint.y(ry); }
        if (this._rtHLine) this._rtHLine.points([ox, ry, tx, ry]);
        if (this._rtVLine) this._rtVLine.points([tx, ry, tx, oy]);
        if (this._rtLabel) {
            this._rtLabel.x(tx + 10);
            this._rtLabel.y(ry - 15);
            this._rtLabel.text(`${T.toFixed(1)}°C\n${this._fmtR(R)}`);
        }
    }

    // ═══════════════════════════════════════════
    update(temp) {
        if (typeof temp === 'number') this._manualTemp = Math.max(-50, Math.min(200, temp));
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'id', type: 'text' },
            { label: 'B 参数 (K)', key: 'B', type: 'number' },
            { label: '标称电阻 R25 (Ω)', key: 'Rref', type: 'number' },
            { label: '量程下限 (°C)', key: 'tempRangeLo', type: 'number' },
            { label: '量程上限 (°C)', key: 'tempRangeHi', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id = cfg.id || this.id;
        this.B = parseFloat(cfg.B) || this.B;
        this.Rseries = parseFloat(cfg.Rseries) || this.Rseries;
        this.tempRangeLo = parseFloat(cfg.tempRangeLo) ?? this.tempRangeLo;
        this.tempRangeHi = parseFloat(cfg.tempRangeHi) || this.tempRangeHi;
        this._calcSH();
        this.config = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}