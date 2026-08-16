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
 *  ③ 电阻-温度分度表（显示关键温度点）
 *  ④ 分压器测量电路可视化
 *  ⑤ 自热效应指示
 *  ⑥ 4-20mA 变送器输出
 *  ⑦ ADC 输出（模拟数字量）
 *  ⑧ 实时波形（T、R、V_out）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_p    — 正极（+ 或 高电位端）
 *  wire_n    — 负极（− 或 低电位端）
 *  wire_ma_p — 4-20mA 正极
 *  wire_ma_n — 4-20mA 负极
 */
export class NTCThermistor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(380, config.width  || 460);
        this.height = Math.max(340, config.height || 400);

        this.type    = 'ntc_thermistor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── NTC 参数 ──
        this.Rref    = config.Rref    || 10000;    // 参考电阻 Ω（25°C 标称值）
        this.Tref    = config.Tref    || 298.15;   // 参考温度 K（25°C）
        this.B       = config.B       || 3950;     // B 参数 K（材料常数）
        this.Vcc     = config.Vcc     || 3.3;      // 激励电压 V
        this.Rseries = config.Rseries || 10000;    // 串联电阻 Ω（分压器）
        this.excI    = config.excI    || 0.1;      // 激励电流 mA（恒流激励时）
        this.delta   = config.delta   || 1.5;      // 耗散系数 mW/°C（自热）
        this.useConst= config.useConst|| false;    // false=分压器模式，true=恒流模式

        // Steinhart-Hart 系数（从 B 参数推导）
        this._calcSH();

        // ── 量程 ──
        this.tempRangeLo = config.tempRangeLo || -20;   // °C
        this.tempRangeHi = config.tempRangeHi || 120;   // °C
        this.hiAlarm     = config.hiAlarm     || 100;   // °C
        this.loAlarm     = config.loAlarm     || 0;     // °C

        // ── NTC 型号预设 ──
        this._presets = {
            'NTC-1K':   { Rref: 1000,  B: 3380, label: '1kΩ  B=3380' },
            'NTC-10K':  { Rref: 10000, B: 3950, label: '10kΩ B=3950' },
            'NTC-47K':  { Rref: 47000, B: 4050, label: '47kΩ B=4050' },
            'NTC-100K': { Rref: 100000,B: 4150, label: '100kΩ B=4150' },
        };
        this.presetKey = config.presetKey || 'NTC-10K';

        // ── 状态 ──
        this.temperature  = config.initTemp   || 25;    // °C
        this._manualTemp  = config.initTemp   || 25;
        this.resistance   = 0;    // 实际阻值 Ω
        this.vOut         = 0;    // 分压输出电压 V
        this.adcValue     = 0;    // ADC 值（12位，0~4095）
        this.selfHeatDT   = 0;    // 自热温升 °C
        this.outputMA     = 4;    // 4-20mA 输出
        this.alpha        = 0;    // 温度系数 %/°C
        this.isBreak      = false;
        this.alarmHi      = false;
        this.alarmLo      = false;

        // ── 动画 ──
        this._phase       = 0;
        this._glowPhase   = 0;
        this._heatGlow    = 0;

        // ── 波形缓冲（三路）──
        this._wavLen      = 240;
        this._wavT        = new Float32Array(this._wavLen).fill(25);
        this._wavR        = new Float32Array(this._wavLen).fill(10000);
        this._wavV        = new Float32Array(this._wavLen).fill(1.65);
        this._wavAcc      = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartT  = 0;

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
        this._curveH   = Math.round(this.height * 0.52);

        // 测量电路图（曲线下方）
        this._circX    = this._curveX;
        this._circY    = this._curveY + this._curveH + 6;
        this._circW    = this._curveW;
        this._circH    = Math.round(this.height * 0.20);

        // LCD 仪表（右侧）
        this._lcdX     = this._curveX + this._curveW + 10;
        this._lcdY     = this._probeY;
        this._lcdW     = this.width - this._lcdX - 6;
        this._lcdH     = Math.round(this.height * 0.60);

        // 波形区（最底部）
        this._wavX     = this._probeX;
        this._wavY     = this._probeY + this._probeH + 8;
        this._wavW     = this.width - this._probeX * 2;
        this._wavH     = this.height - this._wavY - 6;

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, Rref: this.Rref, B: this.B,
            tempRangeLo: this.tempRangeLo, tempRangeHi: this.tempRangeHi,
        };

        this._init();

        const px = this._probeX + this._probeW + 6;
        this.addPort(this._probeCX - 12, this.height - 4, 'p',    'wire', 'R+');
        this.addPort(this._probeCX + 12, this.height - 4, 'n',    'wire', 'R−');
        this.addPort(this.width,         this._lcdY + 14, 'ma_p', 'wire', 'mA+');
        this.addPort(this.width,         this._lcdY + 34, 'ma_n', 'wire', 'mA−');
    }

    // ── Steinhart-Hart 系数推导 ──────────────
    _calcSH() {
        // 从 B 参数推导简化 SH 系数
        const Tref = this.Tref;
        const lnR  = Math.log(this.Rref);
        this._A = 1/Tref - Math.log(this.Rref)/this.B;
        this._B_SH = 1/this.B;
        this._C_SH = 0;  // 简化三阶为零
    }

    // ── NTC 阻值计算（B 参数方程）────────────
    _calcR(T_celsius) {
        const T = T_celsius + 273.15;
        return this.Rref * Math.exp(this.B * (1/T - 1/this.Tref));
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawProbeHousing();
        this._drawNTCElement();
        this._drawLeads();
        this._drawRTCurve();
        this._drawMeasCircuit();
        this._drawPresetSelector();
        this._drawInstrHead();
        this._drawLCD();
        this._drawAlarmPanel();
        this._drawParamTable();
        this._drawWaveform();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: 'NTC 热敏电阻（Negative Temperature Coefficient Thermistor）',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 探头外壳（轴向/珠形封装）────────────
    _drawProbeHousing() {
        const cx2 = this._probeCX;
        const py  = this._probeY, ph = this._probeH;
        const pw  = this._probeW;

        // 接线头/接线盒（顶部）
        const headH = Math.round(ph * 0.25);
        const headW = pw - 4;
        const head  = new Konva.Rect({ x: this._probeX+2, y: py, width: headW, height: headH, fill: '#37474f', stroke: '#263238', strokeWidth: 2, cornerRadius: [4,4,0,0] });
        // 接线盒铭牌
        this.group.add(new Konva.Rect({ x: this._probeX+6, y: py+headH/2-10, width: headW-8, height: 20, fill: '#1e2a36', cornerRadius: 2 }));
        this._typeLbl = new Konva.Text({ x: this._probeX+6, y: py+headH/2-8, width: headW-8, text: `NTC\n${this.presetKey}`, fontSize: 8.5, fontStyle: 'bold', fill: '#00bcd4', align: 'center', lineHeight: 1.3 });
        // 固定螺钉
        [[this._probeX+10, py+8],[this._probeX+pw-12, py+8],[this._probeX+10, py+headH-8],[this._probeX+pw-12, py+headH-8]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 3.5, fill: '#263238' }));
        });

        // 保护管（螺纹/密封，中段）
        const tubeY  = py + headH;
        const tubeH  = Math.round(ph * 0.45);
        const tubeW  = Math.round(pw * 0.32);
        const tube   = new Konva.Rect({ x: cx2-tubeW/2, y: tubeY, width: tubeW, height: tubeH, fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5, cornerRadius: [0,0,2,2] });
        // 管体纹理（螺纹）
        for (let i = 4; i < tubeH; i += 5) {
            this.group.add(new Konva.Line({ points: [cx2-tubeW/2+1, tubeY+i, cx2+tubeW/2-1, tubeY+i], stroke: 'rgba(0,0,0,0.15)', strokeWidth: 0.6 }));
        }
        // 管体高光
        this.group.add(new Konva.Rect({ x: cx2-tubeW/2+2, y: tubeY, width: 4, height: tubeH, fill: 'rgba(255,255,255,0.18)' }));

        // NTC 珠体（末端椭圆珠形，陶瓷外观）
        const beadY = tubeY + tubeH;
        const beadRX= Math.round(tubeW * 0.65), beadRY = Math.round(ph * 0.12);
        this._beadEllipse = new Konva.Ellipse({ x: cx2, y: beadY + beadRY, radiusX: beadRX, radiusY: beadRY, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1.5 });
        // 珠体颜色随温度变化（动态）
        // 珠体高光
        this.group.add(new Konva.Ellipse({ x: cx2-beadRX*0.28, y: beadY + beadRY*0.5, radiusX: beadRX*0.30, radiusY: beadRY*0.28, fill: 'rgba(255,255,255,0.35)' }));
        // 热辉光（底部散发）
        this._beadGlow = new Konva.Ellipse({ x: cx2, y: beadY+beadRY+6, radiusX: beadRX*1.6, radiusY: beadRY*1.4, fill: 'rgba(0,188,212,0)' });

        // 量程刻度
        const scaleX = this._probeX + pw + 4;
        for (let i = 0; i <= 5; i++) {
            const T  = this.tempRangeLo + i * (this.tempRangeHi - this.tempRangeLo) / 5;
            const fy = tubeY + (1-i/5) * tubeH;
            this.group.add(new Konva.Line({ points: [scaleX, fy, scaleX+7, fy], stroke: '#546e7a', strokeWidth: i%5===0?1.2:0.7 }));
            if (i % 2 === 0) this.group.add(new Konva.Text({ x: scaleX+9, y: fy-5, text: `${Math.round(T)}°`, fontSize: 7.5, fill: '#607d8b' }));
        }
        // 高低报警线
        const hiY = tubeY + (1-(this.hiAlarm-this.tempRangeLo)/(this.tempRangeHi-this.tempRangeLo)) * tubeH;
        const loY = tubeY + (1-(this.loAlarm-this.tempRangeLo)/(this.tempRangeHi-this.tempRangeLo)) * tubeH;
        this.group.add(new Konva.Line({ points: [scaleX-4, hiY, scaleX+20, hiY], stroke: 'rgba(239,83,80,0.5)', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Line({ points: [scaleX-4, loY, scaleX+20, loY], stroke: 'rgba(66,165,245,0.5)', strokeWidth: 1, dash: [3,2] }));

        this._probeTubeY   = tubeY;
        this._probeTubeH   = tubeH;
        this._probeTubeW   = tubeW;
        this._probeBeadY   = beadY;
        this._probeBeadRX  = beadRX;
        this._probeBeadRY  = beadRY;
        this._probeHeadH   = headH;

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
            const a  = (i / crystalN) * Math.PI * 2;
            const cr = bRX * 0.5, r2 = Math.round(bRX * 0.12);
            const crystal = new Konva.Circle({ x: cr*Math.cos(a), y: cr*Math.sin(a)*0.5, radius: r2, fill: '#455a64', stroke: '#37474f', strokeWidth: 0.5, opacity: 0.6 });
            this._crystalGroup.add(crystal);
        }
        this._crystalGroup.add(new Konva.Circle({ radius: bRX*0.15, fill: '#546e7a', opacity: 0.7 }));
        this.group.add(this._crystalGroup);

        // 温度指示器（管内滑动点）
        this._tempIndicator = new Konva.Circle({ x: cx2, y: this._probeTubeY + this._probeTubeH/2, radius: 5.5, fill: '#00bcd4', stroke: '#00838f', strokeWidth: 1.5 });
        this.group.add(this._tempIndicator);
    }

    // ── 引线 ─────────────────────────────────
    _drawLeads() {
        const cx2 = this._probeCX;
        const beadY = this._probeBeadY + this._probeBeadRY * 2;

        // 两根引线（向下延伸到端子）
        this._lead1 = new Konva.Line({ points: [cx2-8, beadY, cx2-8, this.height-6], stroke: '#ef9a9a', strokeWidth: 2.5, lineCap: 'round' });
        this._lead2 = new Konva.Line({ points: [cx2+8, beadY, cx2+8, this.height-6], stroke: '#b0bec5', strokeWidth: 2.5, lineCap: 'round' });
        this.group.add(new Konva.Text({ x: cx2-22, y: this.height-18, text: 'R+', fontSize: 7.5, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: cx2+12, y: this.height-18, text: 'R−', fontSize: 7.5, fill: '#b0bec5' }));

        this.group.add(this._lead1, this._lead2);
    }

    // ── R-T 特性曲线（对数纵坐标）───────────
    _drawRTCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'R-T 特性曲线（指数下降，负温系数）', fontSize: 8, fontStyle: 'bold', fill: '#00bcd4', align: 'center' }));

        // 坐标系
        const ox = cx2+18, oy = cy2+ch-12, aw = cw-24, ah = ch-26;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ox-16, y: cy2+14, text: 'R(Ω)', fontSize: 7, fill: '#00bcd4' }));
        this.group.add(new Konva.Text({ x: cx2+cw-14, y: oy+2, text: 'T(°C)', fontSize: 7, fill: '#00bcd4' }));

        // 温度轴刻度
        const tMin = -20, tMax = 120;
        [-20, 0, 25, 50, 80, 100, 120].forEach(T => {
            const tx = ox + (T-tMin)/(tMax-tMin) * (aw-2);
            this.group.add(new Konva.Line({ points: [tx, oy, tx, oy+3], stroke: '#37474f', strokeWidth: 0.8 }));
            if (T % 50 === 0 || T === 25) this.group.add(new Konva.Text({ x: tx-8, y: oy+4, width: 16, text: T.toString(), fontSize: 6, fill: '#37474f', align: 'center' }));
        });

        // R轴（对数刻度）
        const rMax = this._calcR(tMin) * 1.2;
        const rMin = this._calcR(tMax) * 0.5;
        const logRMax = Math.log10(rMax), logRMin = Math.log10(rMin);
        [10, 100, 1000, 10000, 100000, 1000000].forEach(R => {
            if (R < rMin * 0.5 || R > rMax * 2) return;
            const logR = Math.log10(R);
            const ry = oy - (logR - logRMin) / (logRMax - logRMin) * (ah-4);
            this.group.add(new Konva.Line({ points: [ox-3, ry, ox, ry], stroke: '#37474f', strokeWidth: 0.8 }));
            const rStr = R >= 1000 ? (R/1000) + 'k' : R.toString();
            this.group.add(new Konva.Text({ x: ox-20, y: ry-4, width: 18, text: rStr, fontSize: 6, fill: '#37474f', align: 'right' }));
        });

        // R-T 曲线（当前 B 参数）
        const curvePts = [];
        for (let T = tMin; T <= tMax; T += 2) {
            const R = this._calcR(T);
            const logR = Math.log10(R);
            const tx = ox + (T-tMin)/(tMax-tMin) * (aw-2);
            const ry = oy - (logR-logRMin)/(logRMax-logRMin) * (ah-4);
            curvePts.push(tx, ry);
        }
        this.group.add(new Konva.Line({ points: curvePts, stroke: '#00bcd4', strokeWidth: 2, lineJoin: 'round', opacity: 0.85 }));

        // 25°C 参考点标注
        const r25 = this.Rref;
        const tx25= ox + (25-tMin)/(tMax-tMin)*(aw-2);
        const ry25= oy - (Math.log10(r25)-logRMin)/(logRMax-logRMin)*(ah-4);
        this.group.add(new Konva.Circle({ x: tx25, y: ry25, radius: 3.5, fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: tx25+3, y: ry25-12, text: `25°C\n${r25>=1000?(r25/1000).toFixed(0)+'kΩ':r25+'Ω'}`, fontSize: 7, fill: '#ffd54f', lineHeight: 1.3 }));

        // 工作点
        this._rtPoint = new Konva.Circle({ x: ox, y: oy, radius: 5.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this._rtHLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._rtVLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._rtLabel = new Konva.Text({ x: 0, y: 0, text: '', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef5350' });

        this._rtOX = ox; this._rtOY = oy; this._rtAW = aw; this._rtAH = ah;
        this._rtTMin = tMin; this._rtTMax = tMax;
        this._rtLogRMin = logRMin; this._rtLogRMax = logRMax;
        this._rtRMax = rMax; this._rtRMin = rMin;

        this.group.add(bg, titleBg, this._rtPoint, this._rtHLine, this._rtVLine, this._rtLabel);
    }

    // ── 测量电路图（分压器）──────────────────
    _drawMeasCircuit() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: '分压器测量电路', fontSize: 8, fontStyle: 'bold', fill: '#00bcd4', align: 'center' }));

        const mx = cx2 + cw/2, my = cy2 + ch/2 + 2;

        // Vcc → Rs → NTC → GND 电路
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+16, text: `Vcc=${this.Vcc}V`, fontSize: 8, fill: '#ef9a9a' }));
        this.group.add(new Konva.Line({ points: [cx2+40, cy2+18, cx2+60, cy2+18], stroke: '#ef9a9a', strokeWidth: 1.5 }));

        // Rs 电阻符号
        const rsX = cx2+60, rsY = cy2+14;
        this.group.add(new Konva.Rect({ x: rsX, y: rsY, width: 32, height: 10, fill: 'none', stroke: '#ffd54f', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: rsX+2, y: rsY+1, text: `Rs=${this.Rseries/1000}k`, fontSize: 7, fill: '#ffd54f' }));
        this.group.add(new Konva.Line({ points: [rsX+32, cy2+18, rsX+50, cy2+18, rsX+50, cy2+28], stroke: '#ffd54f', strokeWidth: 1.5 }));

        // V_out 引出
        this.group.add(new Konva.Text({ x: rsX+52, y: cy2+24, text: 'V_out', fontSize: 7, fill: '#66bb6a' }));
        this._circVoutLbl = new Konva.Text({ x: rsX+52, y: cy2+33, text: '0.00V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a' });
        this._circADCLbl  = new Konva.Text({ x: cx2+4, y: cy2+ch-20, text: 'ADC:0  R=--Ω', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4' });

        // NTC 符号（Z形）
        const ntcX = rsX+45, ntcY = cy2+28;
        const ntcPts = [ntcX+5, ntcY, ntcX+5, ntcY+8, ntcX+11, ntcY+4, ntcX+5, ntcY+8, ntcX+5, ntcY+14];
        this.group.add(new Konva.Line({ points: ntcPts, stroke: '#00bcd4', strokeWidth: 2, lineJoin: 'round' }));
        // NTC 箭头（负温度系数）
        this.group.add(new Konva.Arrow({ points: [ntcX+2, ntcY+14, ntcX+12, ntcY], stroke: '#00bcd4', fill: '#00bcd4', strokeWidth: 1, pointerLength: 3, pointerWidth: 3 }));
        this.group.add(new Konva.Text({ x: ntcX+14, y: ntcY+4, text: 'NTC', fontSize: 7, fill: '#00bcd4' }));
        this.group.add(new Konva.Line({ points: [ntcX+5, ntcY+14, ntcX+5, cy2+ch-8, cx2+8, cy2+ch-8], stroke: '#b0bec5', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+ch-10, text: '⏚ GND', fontSize: 8, fill: '#546e7a' }));

        // 自热效应
        this._selfHeatLbl = new Konva.Text({ x: cx2+4, y: cy2+ch-34, text: 'ΔT_self=0.0°C', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726' });

        this.group.add(bg, titleBg, this._circVoutLbl, this._circADCLbl, this._selfHeatLbl);
    }

    // ── 型号预设选择器 ───────────────────────
    _drawPresetSelector() {
        const { _curveX: cx2, _curveY: cy2 } = this;
        const selX = cx2, selY = this._circY + this._circH + 4;
        const selW = this._curveW;
        const selH = this.height - selY - this._wavH - this._wavY + this._probeY + this._probeH - 4;
        if (selH < 14) return;

        const bg = new Konva.Rect({ x: selX, y: selY, width: selW, height: Math.max(14, selH), fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: selX, y: selY, width: selW, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: selX+4, y: selY+2, width: selW-8, text: '型号预设 / α温度系数', fontSize: 8, fontStyle: 'bold', fill: '#00bcd4', align: 'center' }));

        // 型号按钮
        const keys = Object.keys(this._presets);
        const btnW = (selW-10) / keys.length;
        const btnY = selY + 17;
        this._presetBtns = [];
        keys.forEach((key, i) => {
            const pr = this._presets[key];
            const bx = selX + 5 + i*(btnW+2);
            const isAct = key === this.presetKey;
            const btn = new Konva.Rect({ x: bx, y: btnY, width: btnW, height: 14, fill: isAct?'#0d3a3a':'#0d2030', stroke: isAct?'#00bcd4':'#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: btnY+3, width: btnW, text: key.replace('NTC-',''), fontSize: 8, fill: isAct?'#00bcd4':'#37474f', align: 'center' });
            btn.on('click tap', () => {
                const p = this._presets[key];
                this.Rref = p.Rref; this.B = p.B; this.presetKey = key;
                this._calcSH();
                this._presetBtns.forEach((b, j) => {
                    const act = keys[j] === key;
                    b.btn.fill(act?'#0d3a3a':'#0d2030'); b.btn.stroke(act?'#00bcd4':'#1a3040');
                    b.lbl.fill(act?'#00bcd4':'#37474f');
                });
                if (this._typeLbl) this._typeLbl.text(`NTC\n${key}`);
                this._refreshCache();
            });
            this._presetBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });

        // α 系数显示
        this._alphaText = new Konva.Text({ x: selX+4, y: btnY+18, width: selW-8, text: 'α=--  %/°C', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'center' });
        this._bText     = new Konva.Text({ x: selX+4, y: btnY+30, width: selW-8, text: `B=${this.B}K  R25=${this.Rref/1000}kΩ`, fontSize: 8, fill: '#546e7a', align: 'center' });

        this.group.add(bg, titleBg, this._alphaText, this._bText);
    }

    // ── 仪表头 ────────────────────────────────
    _drawInstrHead() {
        const hx = this._lcdX, hy = this._lcdY, hw = this._lcdW;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+7, y: hy+4, width: hw-14, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+7, y: hy+7, width: hw-14, text: this.id || 'TH-NTC-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+7, y: hy+17, width: hw-14, text: 'NTC THERMISTOR', fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+7, y: hy+27, width: hw-14, text: `${this.tempRangeLo}~${this.tempRangeHi}°C`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
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
        const lcy = this._lcdY + 44 + (this._lcdH-44)*0.47;
        const lcx = hx + hw/2;
        const R   = Math.min(hw*0.40, 40);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#001a1a', stroke: '#00838f', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._tempArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#00bcd4', rotation: -90 });

        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'25.0',   fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#00bcd4', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'°C',     fontSize:R*.18, fill:'#001a1a', align:'center' });
        this._lcdR     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'--kΩ',   fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdMA    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'--mA',   fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdAlpha = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'α=--',   fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._tempArc, this._lcdMain, this._lcdUnit, this._lcdR, this._lcdMA, this._lcdAlpha);
    }

    // ── 报警指示 ─────────────────────────────
    _drawAlarmPanel() {
        const hx = this._lcdX, hw = this._lcdW;
        const panY = this._lcCY + this._lcR + 14;
        this._almLeds = [];
        [['NORM','#4caf50',hx+hw*0.22],['HI-T','#ef5350',hx+hw*0.57],['LO-T','#42a5f5',hx+hw*0.84]].forEach(([lbl,col,lx]) => {
            const led = new Konva.Circle({ x: lx, y: panY, radius: 6, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 });
            const txt = new Konva.Text({ x: lx-14, y: panY+9, width: 28, text: lbl, fontSize: 7, fill: '#37474f', align: 'center' });
            this._almLeds.push({ led, col });
            this.group.add(led, txt);
        });
    }

    // ── 参数分度表（关键温度点）──────────────
    _drawParamTable() {
        const hx = this._lcdX, hw = this._lcdW;
        const tabY = this._lcCY + this._lcR + 32;
        const tabH = this.height - tabY - this._wavH - 8;
        if (tabH < 10) return;

        const bg = new Konva.Rect({ x: hx, y: tabY, width: hw, height: Math.max(10, tabH), fill: '#020c14', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 3 });
        this.group.add(new Konva.Text({ x: hx+2, y: tabY+2, width: hw-4, text: '关键温度对照', fontSize: 7.5, fill: '#37474f', align: 'center' }));

        const keyTemps = [-10, 0, 25, 50, 85, 100];
        this._tableTexts = keyTemps.map((T, i) => {
            const R = this._calcR(T);
            const rStr = R >= 1000 ? (R/1000).toFixed(2)+'k' : R.toFixed(0);
            const t = new Konva.Text({ x: hx+3, y: tabY+13+i*9, text: `${T>0?'+':''}${T}°C  ${rStr}Ω`, fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#37474f' });
            return t;
        });
        this.group.add(bg, ...this._tableTexts);
    }

    // ── 波形区 ───────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'T(t)  R(t)  V_out(t)', fontSize: 8, fontStyle: 'bold', fill: '#00bcd4', align: 'center' }));

        const h3 = (wh-13)/3;
        this._wavMids = [wy+13+h3*0.5, wy+13+h3*1.5, wy+13+h3*2.5];
        this._wavMids.forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineT = new Konva.Line({ points: [], stroke: '#00bcd4', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineR = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineV = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.4, lineJoin: 'round' });

        ['T(°C)','R(kΩ)','V(V)'].forEach((lbl, i) => {
            const cols = ['#00bcd4','#ffd54f','#66bb6a'];
            this.group.add(new Konva.Text({ x: wx+4, y: wy+13+h3*i+4, text: lbl, fontSize: 8, fill: cols[i] }));
        });

        this._wTLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+4, width: 76, text: '--°C', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#00bcd4', align: 'right' });
        this._wRLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h3+4, width: 76, text: '--kΩ', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });
        this._wVLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h3*2+4, width: 76, text: '--V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });

        this.group.add(bg, titleBg, this._wLineT, this._wLineR, this._wLineV, this._wTLbl, this._wRLbl, this._wVLbl);
        this._wavH3 = h3;
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
        this.temperature = this._manualTemp;
        this.resistance  = this._calcR(this.temperature);

        // 温度系数 α = -B / T²
        const T_K = this.temperature + 273.15;
        this.alpha = -this.B / (T_K * T_K) * 100;  // %/°C

        // 分压器输出
        this.vOut    = this.Vcc * this.resistance / (this.Rseries + this.resistance);
        this.adcValue= Math.round(this.vOut / this.Vcc * 4095);

        // 自热效应：P = V²/R → ΔT = P/δ
        const P_mW  = (this.vOut * this.vOut / this.resistance) * 1000;
        this.selfHeatDT = P_mW / this.delta;

        // 4-20mA（温度线性映射）
        const range = this.tempRangeHi - this.tempRangeLo + 0.01;
        const norm  = Math.max(0, Math.min(1, (this.temperature - this.tempRangeLo) / range));
        this.outputMA = 4 + norm * 16;

        // 报警
        this.alarmHi = this.temperature > this.hiAlarm;
        this.alarmLo = this.temperature < this.loAlarm;

        // 温度弧
        if (this._tempArc) {
            this._tempArc.angle(norm * 360);
            this._tempArc.fill(this.alarmHi ? '#ef5350' : this.alarmLo ? '#42a5f5' : '#00bcd4');
        }

        // 热辉光（高温时青色辉光）
        this._heatGlow = Math.max(0, Math.min(0.45, (this.temperature - 60) / 80));
        this._phase   += dt * 3;
        this._glowPhase+=dt * 5;
    }

    // ── 探头可视化 ───────────────────────────
    _tickProbeViz() {
        const T = this.temperature;
        const tNorm = Math.max(0, Math.min(1, (T-this.tempRangeLo)/(this.tempRangeHi-this.tempRangeLo+0.01)));

        // 珠体颜色（冷=蓝灰，热=橙红）
        if (this._beadEllipse) {
            const r = Math.round(160 + tNorm*95), g = Math.round(180 - tNorm*100), b = Math.round(180 - tNorm*180);
            this._beadEllipse.fill(`rgb(${r},${Math.max(0,g)},${Math.max(0,b)})`);
        }
        // 珠体辉光
        if (this._beadGlow) {
            const glA = this._heatGlow + 0.08 * Math.abs(Math.sin(this._glowPhase));
            const r = Math.round(0+tNorm*255), g2 = Math.round(188-tNorm*100);
            this._beadGlow.fill(`rgba(${r},${Math.max(0,g2)},${Math.round(212-tNorm*212)},${glA})`);
        }
        // 温度指示点
        if (this._tempIndicator) {
            const iy = this._probeTubeY + (1-tNorm) * this._probeTubeH;
            this._tempIndicator.y(iy);
            const r2 = Math.round(0+tNorm*255), g3 = Math.round(188-tNorm*100);
            this._tempIndicator.fill(`rgb(${r2},${Math.max(0,g3)},0)`);
        }
        // 报警 LED
        if (this._almLeds && this._almLeds.length === 3) {
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 3));
            this._almLeds[0].led.fill(!this.alarmHi && !this.alarmLo ? '#4caf50' : '#1a1a1a');
            this._almLeds[1].led.fill(this.alarmHi ? `rgba(239,83,80,${pulse})` : '#1a1a1a');
            this._almLeds[2].led.fill(this.alarmLo ? `rgba(66,165,245,${pulse})` : '#1a1a1a');
        }
        // 电路图更新
        if (this._circVoutLbl) this._circVoutLbl.text(`${this.vOut.toFixed(4)}V`);
        if (this._circADCLbl)  this._circADCLbl.text(`ADC:${this.adcValue}  R=${this._fmtR(this.resistance)}`);
        if (this._selfHeatLbl) this._selfHeatLbl.text(`ΔT_self=${this.selfHeatDT.toFixed(3)}°C`);
        if (this._alphaText)   this._alphaText.text(`α = ${this.alpha.toFixed(2)} %/°C`);
        if (this._bText)       this._bText.text(`B=${this.B}K  R25=${this._fmtR(this.Rref)}`);
    }

    _fmtR(R) {
        if (R >= 1000000) return (R/1000000).toFixed(2)+'MΩ';
        if (R >= 1000)    return (R/1000).toFixed(2)+'kΩ';
        return R.toFixed(1)+'Ω';
    }

    // ── R-T 工作点 ───────────────────────────
    _tickRTPoint() {
        const T = this.temperature, R = this.resistance;
        const { _rtOX: ox, _rtOY: oy, _rtAW: aw, _rtAH: ah, _rtTMin: tMin, _rtTMax: tMax, _rtLogRMin: logRMin, _rtLogRMax: logRMax } = this;

        const logR = Math.log10(Math.max(1, R));
        const tClamp = Math.max(tMin, Math.min(tMax, T));
        const tx = ox + (tClamp-tMin)/(tMax-tMin)*(aw-2);
        const ry = oy - (logR-logRMin)/(logRMax-logRMin)*(ah-4);

        if (this._rtPoint) { this._rtPoint.x(tx); this._rtPoint.y(ry); }
        if (this._rtHLine) this._rtHLine.points([ox, ry, tx, ry]);
        if (this._rtVLine) this._rtVLine.points([tx, ry, tx, oy]);
        if (this._rtLabel) {
            this._rtLabel.x(tx+4);
            this._rtLabel.y(ry-15);
            this._rtLabel.text(`${T.toFixed(1)}°C\n${this._fmtR(R)}`);
        }

        // 更新分度表颜色（高亮接近当前温度的行）
        if (this._tableTexts) {
            const keyTemps = [-10, 0, 25, 50, 85, 100];
            this._tableTexts.forEach((t, i) => {
                const kT = keyTemps[i];
                const dist = Math.abs(T - kT);
                t.fill(dist < 5 ? '#00bcd4' : dist < 15 ? '#546e7a' : '#37474f');
            });
        }
    }

    // ── 波形 ─────────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH3) return;
        this._wavAcc += 1.2 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._wavT = new Float32Array([...this._wavT.slice(1), this.temperature]);
            this._wavR = new Float32Array([...this._wavR.slice(1), this.resistance]);
            this._wavV = new Float32Array([...this._wavV.slice(1), this.vOut]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww/n, h3 = this._wavH3;
        const [mT, mR, mV] = this._wavMids;
        const tRange = this.tempRangeHi - this.tempRangeLo + 0.01;
        const logRRange = this._rtLogRMax - this._rtLogRMin + 0.01;
        const aT = h3*0.42, aR = h3*0.40, aV = h3*0.40;

        const tPts=[], rPts=[], vPts=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i*dx;
            const tN = (this._wavT[i]-this.tempRangeLo)/tRange;
            const rN = (Math.log10(Math.max(1,this._wavR[i]))-this._rtLogRMin)/logRRange;
            const vN = this._wavV[i]/this.Vcc;
            tPts.push(x, mT-(tN*2-1)*aT);
            rPts.push(x, mR-(rN*2-1)*aR);
            vPts.push(x, mV-(vN*2-1)*aV);
        }
        if (this._wLineT) this._wLineT.points(tPts);
        if (this._wLineR) this._wLineR.points(rPts);
        if (this._wLineV) this._wLineV.points(vPts);
        if (this._wTLbl) this._wTLbl.text(`${this.temperature.toFixed(2)}°C`);
        if (this._wRLbl) this._wRLbl.text(this._fmtR(this.resistance));
        if (this._wVLbl) this._wVLbl.text(`${this.vOut.toFixed(4)}V`);
    }

    // ── LCD 刷新 ─────────────────────────────
    _tickDisplay() {
        const T  = this.temperature;
        const mc = this.alarmHi ? '#ef5350' : this.alarmLo ? '#42a5f5' : '#00bcd4';

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(T.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdR)    this._lcdR.text(this._fmtR(this.resistance));
        if (this._lcdMA)   this._lcdMA.text(`${this.outputMA.toFixed(2)}mA`);
        if (this._lcdAlpha) this._lcdAlpha.text(`α=${this.alpha.toFixed(2)}%/°C`);
    }

    // ═══════════════════════════════════════════
    update(temp) {
        if (typeof temp === 'number') this._manualTemp = Math.max(-50, Math.min(200, temp));
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'id',           type: 'text'   },
            { label: 'B 参数 (K)',             key: 'B',            type: 'number' },
            { label: '标称电阻 R25 (Ω)',       key: 'Rref',         type: 'number' },
            { label: '激励电压 Vcc (V)',        key: 'Vcc',          type: 'number' },
            { label: '串联电阻 Rs (Ω)',         key: 'Rseries',      type: 'number' },
            { label: '量程下限 (°C)',           key: 'tempRangeLo',  type: 'number' },
            { label: '量程上限 (°C)',           key: 'tempRangeHi',  type: 'number' },
            { label: '耗散系数 δ (mW/°C)',      key: 'delta',        type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.B           = parseFloat(cfg.B)           || this.B;
        this.Rref        = parseFloat(cfg.Rref)        || this.Rref;
        this.Vcc         = parseFloat(cfg.Vcc)         || this.Vcc;
        this.Rseries     = parseFloat(cfg.Rseries)     || this.Rseries;
        this.tempRangeLo = parseFloat(cfg.tempRangeLo) ?? this.tempRangeLo;
        this.tempRangeHi = parseFloat(cfg.tempRangeHi) || this.tempRangeHi;
        this.delta       = parseFloat(cfg.delta)       || this.delta;
        this._calcSH();
        this.config      = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}