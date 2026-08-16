import { BaseComponent } from './BaseComponent.js';

/**
 * PT100 铂电阻温度传感器仿真组件
 * （PT100 Platinum Resistance Temperature Detector）
 *
 * ── 工作原理（Callendar-Van Dusen 方程）─────────────────────
 *
 *  铂电阻利用纯铂金属的电阻率随温度变化的特性：
 *
 *  Callendar-Van Dusen 方程（IEC 60751 标准）：
 *
 *  当 -200°C ≤ T < 0°C：
 *    R(T) = R₀ × [1 + A×T + B×T² + C×(T-100)×T³]
 *
 *  当 0°C ≤ T ≤ 850°C：
 *    R(T) = R₀ × [1 + A×T + B×T²]
 *
 *  标准系数（IEC 60751）：
 *    R₀ = 100 Ω（0°C 时的基准电阻）
 *    A  = 3.9083 × 10⁻³  °C⁻¹
 *    B  = -5.775 × 10⁻⁷  °C⁻²
 *    C  = -4.183 × 10⁻¹²  °C⁻⁴（仅 T < 0°C）
 *
 *  典型电阻值：
 *    -200°C → 18.52 Ω
 *       0°C → 100.00 Ω
 *     100°C → 138.51 Ω
 *     200°C → 175.86 Ω
 *     400°C → 247.09 Ω
 *     600°C → 313.71 Ω
 *     850°C → 390.48 Ω
 *
 * ── 接线方式 ──────────────────────────────────────────────────
 *  两线制（2-Wire）：
 *    测量精度低，引线电阻引入误差
 *    I→[Rl1]→[Rt]→[Rl2]→测量
 *
 *  三线制（3-Wire）：
 *    工业标准，补偿引线电阻
 *    通过桥路消除单侧引线影响
 *
 *  四线制（4-Wire）：
 *    最高精度，完全消除引线电阻影响
 *    I+ → [Rt] → I−（电流回路）
 *    V+ → [Rt] → V−（电压测量）
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 传感器探头外观（工业插入式，防护管）
 *  ② 铂电阻元件截面（铂丝绕制/薄膜型）
 *  ③ 接线头（不同接线方式示意）
 *  ④ 电阻-温度特性曲线（R-T 曲线，当前工作点）
 *  ⑤ 4-20mA 变送器输出（带温度量程）
 *  ⑥ 实时参数 LCD（T、R、mA、接线方式）
 *  ⑦ 引线电阻误差对比（2线/3线/4线精度对比）
 *  ⑧ 温度波形曲线
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_e1  — 激励电流正极（4线: I+）
 *  wire_e2  — 激励电流负极（4线: I−）
 *  wire_s1  — 信号电压正极（4线: V+）
 *  wire_s2  — 信号电压负极（4线: V−）
 *  wire_ma_p — 变送器输出 4-20mA 正极
 *  wire_ma_n — 变送器输出 4-20mA 负极
 */
export class PT100Sensor3 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 420);
        this.height = Math.max(340, config.height || 400);

        this.type    = 'pt100_sensor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 标准参数（IEC 60751）──
        this.R0 = 100;                  // Ω（0°C 基准）
        this.A  = 3.9083e-3;            // °C⁻¹
        this.B  = -5.775e-7;            // °C⁻²
        this.C  = -4.183e-12;           // °C⁻⁴（T < 0°C）

        // ── 传感器参数 ──
        this.wireMode    = config.wireMode    || '4W';   // '2W' | '3W' | '4W'
        this.wireR       = config.wireR       || 0.5;   // 引线电阻 Ω（每根）
        this.excCurrent  = config.excCurrent  || 1.0;   // 激励电流 mA
        this.tempRangeLo = config.tempRangeLo || 0;     // 量程下限 °C
        this.tempRangeHi = config.tempRangeHi || 200;   // 量程上限 °C
        this.hiAlarm     = config.hiAlarm     || 180;   // 高温报警 °C
        this.loAlarm     = config.loAlarm     || 10;    // 低温报警 °C
        this.sensorType  = config.sensorType  || 'RTD'; // 'RTD' | 'Thin-Film'

        // ── 状态 ──
        this.temperature  = config.initTemp   || 25;    // °C（当前温度）
        this._manualTemp  = config.initTemp   || 25;
        this.resistance   = 0;    // Ω（PT100 实测阻值）
        this.measuredR    = 0;    // Ω（考虑接线方式后的测量值）
        this.errorR       = 0;    // Ω（引线误差）
        this.errorT       = 0;    // °C（引线引起的温度误差）
        this.outputMA     = 4;    // 4-20mA 输出
        this.excVoltage   = 0;    // 激励电压 V

        this.alarmHi      = false;
        this.alarmLo      = false;
        this.isBreak      = false;

        // ── 动画 ──
        this._phase       = 0;
        this._noisePhase  = 0;
        this._heatGlow    = 0;

        // ── 波形缓冲 ──
        this._wavLen      = 240;
        this._wavT        = new Float32Array(this._wavLen).fill(25);
        this._wavR        = new Float32Array(this._wavLen).fill(109.7);
        this._wavAcc      = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartT  = 0;

        // ── 几何布局 ──
        // 探头（左侧）
        this._probeX  = 10;
        this._probeY  = Math.round(this.height * 0.08);
        this._probeW  = Math.round(this.width  * 0.22);
        this._probeH  = Math.round(this.height * 0.72);

        // R-T 特性曲线（中部）
        this._curveX  = this._probeX + this._probeW + 12;
        this._curveY  = this._probeY;
        this._curveW  = Math.round(this.width  * 0.30);
        this._curveH  = Math.round(this.height * 0.52);

        // LCD 仪表（右侧）
        this._lcdX    = this._curveX + this._curveW + 10;
        this._lcdY    = this._probeY;
        this._lcdW    = this.width - this._lcdX - 8;
        this._lcdH    = Math.round(this.height * 0.58);

        // 接线方式面板（R-T曲线下方）
        this._wireX   = this._curveX;
        this._wireY   = this._curveY + this._curveH + 8;
        this._wireW   = this._curveW;
        this._wireH   = Math.round(this.height * 0.18);

        // 波形区（最底部）
        this._wavX    = this._probeX;
        this._wavY    = this._probeY + this._probeH + 10;
        this._wavW    = this.width - this._probeX * 2;
        this._wavH    = this.height - this._wavY - 6;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, wireMode: this.wireMode,
            tempRangeLo: this.tempRangeLo, tempRangeHi: this.tempRangeHi,
            hiAlarm: this.hiAlarm, loAlarm: this.loAlarm,
        };

        this._init();

        const px = this._probeX + this._probeW;
        this.addPort(px, this._probeY + this._probeH * 0.25, 'e1',   'wire', 'I+');
        this.addPort(px, this._probeY + this._probeH * 0.40, 'e2',   'wire', 'I−');
        this.addPort(px, this._probeY + this._probeH * 0.55, 's1',   'wire', 'V+');
        this.addPort(px, this._probeY + this._probeH * 0.70, 's2',   'wire', 'V−');
        this.addPort(this.width, this._lcdY + 14, 'ma_p', 'wire', 'mA+');
        this.addPort(this.width, this._lcdY + 34, 'ma_n', 'wire', 'mA−');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawProbeHousing();
        this._drawPlatinumElement();
        this._drawConnectionHead();
        this._drawRTCurve();
        this._drawWireModePanel();
        this._drawInstrHead();
        this._drawLCD();
        this._drawAlarmPanel();
        this._drawWaveform();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `PT100 铂电阻温度传感器（IEC 60751）— ${this.wireMode} 接线`,
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 探头外壳（工业插入式）────────────────
    _drawProbeHousing() {
        const px = this._probeX, py = this._probeY;
        const pw = this._probeW, ph = this._probeH;
        const cx2 = px + pw / 2;

        // 接线盒（顶部，方形）
        const headH = Math.round(ph * 0.32);
        const head  = new Konva.Rect({ x: px, y: py, width: pw, height: headH, fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: [4,4,0,0] });
        // 接线盒螺栓
        [[px+8,py+8],[px+pw-8,py+8],[px+8,py+headH-8],[px+pw-8,py+headH-8]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4, fill: '#263238' }));
            this.group.add(new Konva.Circle({ x: bx-1, y: by-1, radius: 1.3, fill: 'rgba(255,255,255,0.25)' }));
        });
        // 接线盒铭牌
        this.group.add(new Konva.Rect({ x: px+6, y: py+headH/2-10, width: pw-12, height: 20, fill: '#1e2a36', cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: px+6, y: py+headH/2-8, width: pw-12, text: 'PT100\nRTD', fontSize: 7.5, fontStyle: 'bold', fill: '#90caf9', align: 'center', lineHeight: 1.3 }));

        // 安装法兰（中部）
        const flangeY = py + headH;
        const flangeH = Math.round(ph * 0.10);
        const flange  = new Konva.Rect({ x: px-6, y: flangeY, width: pw+12, height: flangeH, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.5 });
        // 法兰螺栓孔
        for (let i = 0; i < 4; i++) {
            const fx = px - 4 + i * (pw+8) / 3;
            const fy = flangeY + flangeH/2;
            this.group.add(new Konva.Circle({ x: fx, y: fy, radius: 3.5, fill: '#37474f' }));
        }

        // 保护管（下半段，细金属管）
        const tubeY  = flangeY + flangeH;
        const tubeH  = ph - headH - flangeH;
        const tubeW  = Math.round(pw * 0.30);
        const tube   = new Konva.Rect({ x: cx2-tubeW/2, y: tubeY, width: tubeW, height: tubeH, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        // 保护管高光
        this.group.add(new Konva.Rect({ x: cx2-tubeW/2+2, y: tubeY, width: 4, height: tubeH, fill: 'rgba(255,255,255,0.18)', cornerRadius: [0,0,2,2] }));
        // 管端（测量端，圆头）
        const tipY  = tubeY + tubeH - 6;
        this.group.add(new Konva.Ellipse({ x: cx2, y: tipY+6, radiusX: tubeW/2, radiusY: 6, fill: '#607d8b', stroke: '#37474f', strokeWidth: 1 }));

        // 热辉光（随温度变化）
        this._heatGlowRect = new Konva.Rect({ x: cx2-tubeW/2-4, y: tubeY, width: tubeW+8, height: tubeH, fill: 'rgba(255,80,0,0)', cornerRadius: [0,0,6,6] });

        // 标注：量程
        this.group.add(new Konva.Text({ x: px+pw+4, y: py+headH+flangeH+4, text: `${this.tempRangeHi}°C`, fontSize: 7.5, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: px+pw+4, y: py+ph-14, text: `${this.tempRangeLo}°C`, fontSize: 7.5, fill: '#90caf9' }));
        // 量程线
        this.group.add(new Konva.Line({ points: [px+pw+2, py+headH+flangeH, px+pw+12, py+headH+flangeH], stroke: '#ef9a9a', strokeWidth: 0.8 }));
        this.group.add(new Konva.Line({ points: [px+pw+2, py+ph-6, px+pw+12, py+ph-6], stroke: '#90caf9', strokeWidth: 0.8 }));

        this._probeHeadH  = headH;
        this._probeFlangeH= flangeH;
        this._probeTubeY  = tubeY;
        this._probeTubeH  = tubeH;
        this._probeTubeW  = tubeW;
        this._probeCX     = cx2;

        this.group.add(head, flange, tube, this._heatGlowRect);
    }

    // ── 铂电阻元件（截面示意）────────────────
    _drawPlatinumElement() {
        const cx2 = this._probeCX;
        const elemY = this._probeTubeY + this._probeTubeH * 0.25;
        const elemH = this._probeTubeH * 0.55;
        const ew    = this._probeTubeW - 8;

        // 铝氧化物陶瓷基体
        this.group.add(new Konva.Rect({ x: cx2-ew/2, y: elemY, width: ew, height: elemH, fill: '#f5f5f5', stroke: '#e0e0e0', strokeWidth: 0.5, cornerRadius: 1 }));

        // 铂绕线（弯折绕制）
        const lineCount = 8;
        const lineStep  = elemH / (lineCount + 1);
        for (let i = 0; i < lineCount; i++) {
            const ly   = elemY + lineStep * (i + 1);
            const col  = i % 2 === 0 ? '#c0a020' : '#a08010';
            this._platLines = this._platLines || [];
            const platLine = new Konva.Line({ points: [cx2-ew/2+2, ly, cx2+ew/2-2, ly], stroke: col, strokeWidth: 1.5, opacity: 0.7 });
            this._platLines.push(platLine);
            this.group.add(platLine);
        }
        // 铂丝引出线
        this.group.add(new Konva.Line({ points: [cx2, elemY, cx2, this._probeTubeY + 8], stroke: '#c0a020', strokeWidth: 1.2, opacity: 0.5 }));

        // 当前温度指示点（动态）
        this._tempIndicator = new Konva.Circle({ x: cx2, y: elemY + elemH/2, radius: 5, fill: '#90caf9', stroke: '#1565c0', strokeWidth: 1.5 });
        this.group.add(this._tempIndicator);

        // 铂丝标注
        this.group.add(new Konva.Text({ x: cx2-12, y: elemY+elemH+3, width: 24, text: '铂丝\n绕制', fontSize: 7, fill: 'rgba(192,160,32,0.7)', align: 'center', lineHeight: 1.3 }));
    }

    // ── 接线头（引线端子）────────────────────
    _drawConnectionHead() {
        const px = this._probeX, py = this._probeY;
        const pw = this._probeW, headH = this._probeHeadH;
        const cx2 = px + pw / 2;

        // 4个接线端子（内部）
        const termColors = ['#ef9a9a', '#90caf9', '#a5d6a7', '#fff59d'];
        const termLabels = ['I+', 'I−', 'V+', 'V−'];
        for (let i = 0; i < 4; i++) {
            const tx = px + 8 + (i % 2) * (pw - 16) / 1;
            const ty = py + 12 + Math.floor(i / 2) * 16;
            // 简单用右侧引线代替端子
        }
    }

    // ── R-T 特性曲线 ─────────────────────────
    _drawRTCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'R-T 特性曲线（Callendar-Van Dusen）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 坐标轴
        const ox = cx2+14, oy = cy2+ch-12, aw = cw-22, ah = ch-26;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));

        // 轴标签
        const tMin = -200, tMax = 850;
        const rMin = this._calcR(tMin), rMax = this._calcR(tMax);
        this.group.add(new Konva.Text({ x: ox-10, y: cy2+14, text: 'R(Ω)', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: cx2+cw-12, y: oy+2, text: 'T(°C)', fontSize: 7, fill: '#80cbc4' }));
        // T轴刻度
        [-200, 0, 200, 400, 600, 850].forEach(T => {
            const tx = ox + (T - tMin) / (tMax - tMin) * (aw-2);
            this.group.add(new Konva.Line({ points: [tx, oy, tx, oy+3], stroke: '#37474f', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: tx-8, y: oy+4, width: 16, text: T.toString(), fontSize: 6, fill: '#37474f', align: 'center' }));
        });
        // R轴刻度
        [0, 100, 200, 300, 400].forEach(R => {
            const ry = oy - (R - rMin) / (rMax - rMin) * (ah-4);
            this.group.add(new Konva.Line({ points: [ox-3, ry, ox, ry], stroke: '#37474f', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: ox-20, y: ry-4, width: 18, text: R.toString(), fontSize: 6, fill: '#37474f', align: 'right' }));
        });

        // R-T 曲线（预绘）
        const curvePts = [];
        for (let T = tMin; T <= tMax; T += 10) {
            const R = this._calcR(T);
            const tx = ox + (T - tMin) / (tMax - tMin) * (aw-2);
            const ry = oy - (R - rMin) / (rMax - rMin) * (ah-4);
            curvePts.push(tx, ry);
        }
        this.group.add(new Konva.Line({ points: curvePts, stroke: '#4fc3f7', strokeWidth: 1.8, lineJoin: 'round', opacity: 0.8 }));

        // 工作点（动态）
        this._rtPoint = new Konva.Circle({ x: ox, y: oy, radius: 5.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        // 工作点坐标线
        this._rtHLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._rtVLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        // 工作点标注
        this._rtLabel = new Konva.Text({ x: 0, y: 0, text: '', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef5350' });

        this._rtOX = ox; this._rtOY = oy; this._rtAW = aw; this._rtAH = ah;
        this._rtTMin = tMin; this._rtTMax = tMax;
        this._rtRMin = rMin; this._rtRMax = rMax;

        this.group.add(bg, titleBg, this._rtPoint, this._rtHLine, this._rtVLine, this._rtLabel);
    }

    // ── 接线方式面板 ─────────────────────────
    _drawWireModePanel() {
        const { _wireX: wx, _wireY: wy, _wireW: ww, _wireH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '接线方式 / 误差分析', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 接线方式选择按钮（三个）
        const btnW = (ww - 18) / 3, btnY = wy + 18;
        const modes = ['2W', '3W', '4W'];
        const modeLabels = ['两线制', '三线制', '四线制'];
        this._wireBtns = [];
        modes.forEach((m, i) => {
            const bx = wx + 6 + i * (btnW + 3);
            const btn = new Konva.Rect({ x: bx, y: btnY, width: btnW, height: 14, fill: m === this.wireMode ? '#1a3a4a' : '#0d2030', stroke: m === this.wireMode ? '#4fc3f7' : '#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: btnY+2, width: btnW, text: modeLabels[i], fontSize: 8, fill: m === this.wireMode ? '#4fc3f7' : '#546e7a', align: 'center' });
            btn.on('click tap', () => {
                this.wireMode = m;
                this._wireBtns.forEach((b, j) => {
                    b.btn.fill(modes[j] === m ? '#1a3a4a' : '#0d2030');
                    b.btn.stroke(modes[j] === m ? '#4fc3f7' : '#1a3040');
                    b.lbl.fill(modes[j] === m ? '#4fc3f7' : '#546e7a');
                });
                this._refreshCache();
            });
            this._wireBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });

        // 引线电阻误差显示
        this._errorText  = new Konva.Text({ x: wx+4, y: wy+37, width: ww-8, text: 'ΔR_wire=-- Ω  ΔT=--°C', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffa726', align: 'center' });
        this._modeDesc   = new Konva.Text({ x: wx+4, y: wy+50, width: ww-8, text: '', fontSize: 7.5, fill: '#546e7a', align: 'center' });

        this.group.add(bg, titleBg, this._errorText, this._modeDesc);
    }

    // ── 仪表头 ────────────────────────────────
    _drawInstrHead() {
        const hx = this._lcdX, hy = this._lcdY, hw = this._lcdW;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+7, y: hy+4, width: hw-14, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+7, y: hy+7, width: hw-14, text: this.id || 'TE-PT-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+7, y: hy+17, width: hw-14, text: 'PT100  IEC 60751', fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+7, y: hy+27, width: hw-14, text: `${this.tempRangeLo}~${this.tempRangeHi}°C`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-9, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: this._lcdH-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        // 端子标签
        [['mA+','#ffd54f',14],['mA−','#90a4ae',34]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Text({ x: hx+6, y: hy+ty-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────────
    _drawLCD() {
        const hx = this._lcdX, hw = this._lcdW;
        const lcy = this._lcdY + 44 + (this._lcdH-44) * 0.48;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#100a00', stroke: '#ff6f00', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._tempArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ff8f00', rotation: -90 });

        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'25.0',   fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#ff8f00', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'°C',     fontSize:R*.18, fill:'#100a00', align:'center' });
        this._lcdR     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'R=--Ω',  fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdMA    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'--mA',   fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdWire  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:this.wireMode, fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._tempArc, this._lcdMain, this._lcdUnit, this._lcdR, this._lcdMA, this._lcdWire);
    }

    // ── 报警指示面板 ─────────────────────────
    _drawAlarmPanel() {
        const hx = this._lcdX, hw = this._lcdW;
        const panY = this._lcCY + this._lcR + 14;

        this._almLeds = [];
        [['NORM','#4caf50',hx+hw*0.22], ['HI','#ef5350',hx+hw*0.57], ['LO','#42a5f5',hx+hw*0.80]].forEach(([lbl,col,lx]) => {
            const led = new Konva.Circle({ x: lx, y: panY, radius: 6, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 });
            const txt = new Konva.Text({ x: lx-14, y: panY+9, width: 28, text: lbl, fontSize: 7, fill: '#37474f', align: 'center' });
            this._almLeds.push({ led, col });
            this.group.add(led, txt);
        });
    }

    // ── 波形区（底部）─────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'T(t)温度趋势  R(t)电阻趋势', fontSize: 8, fontStyle: 'bold', fill: '#ff8f00', align: 'center' }));

        const h2 = (wh-13)/2;
        this._wavMidT = wy + 13 + h2*0.5;
        this._wavMidR = wy + 13 + h2*1.5;
        [this._wavMidT, this._wavMidR].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineT = new Konva.Line({ points: [], stroke: '#ff8f00', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineR = new Konva.Line({ points: [], stroke: '#4fc3f7', strokeWidth: 1.5, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+13+4, text: 'T(°C)', fontSize: 8, fill: '#ff8f00' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+13+h2+4, text: 'R(Ω)', fontSize: 8, fill: '#4fc3f7' }));

        this._wTLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+4, width: 76, text: '-- °C', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ff8f00', align: 'right' });
        this._wRLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h2+4, width: 76, text: '-- Ω', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#4fc3f7', align: 'right' });

        this.group.add(bg, titleBg, this._wLineT, this._wLineR, this._wTLbl, this._wRLbl);
        this._wavH2 = h2;
    }

    // ── 拖拽调节温度 ─────────────────────────
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
            this._manualTemp = Math.max(this.tempRangeLo - 50, Math.min(this.tempRangeHi + 50, this._dragStartT + (this._dragStartY - cy2) * (range / this._probeH)));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ── Callendar-Van Dusen 计算 ──────────────
    _calcR(T) {
        if (T >= 0) {
            return this.R0 * (1 + this.A*T + this.B*T*T);
        } else {
            return this.R0 * (1 + this.A*T + this.B*T*T + this.C*(T-100)*T*T*T);
        }
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

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 物理计算 ──────────────────────────────
    _tickPhysics(dt) {
        this.temperature = this._manualTemp;
        this.resistance  = this._calcR(this.temperature);

        // 引线误差（根据接线方式）
        const Rl = this.wireR;
        let deltaR = 0;
        switch (this.wireMode) {
            case '2W': deltaR = 2 * Rl; break;       // 两根引线，全部引入误差
            case '3W': deltaR = Rl * 0.05; break;    // 三线制，理想补偿后残余约 5%
            case '4W': deltaR = 0; break;             // 四线制，完全消除
        }
        this.errorR    = deltaR;
        this.measuredR = this.resistance + deltaR;

        // 误差折算为温度偏差（近似：dT ≈ dR / (dR/dT)）
        const dRdT = this.R0 * this.A;  // 线性近似，约 0.39 Ω/°C
        this.errorT = deltaR / dRdT;

        // 激励电压（恒流激励）
        const I_mA = this.excCurrent;
        this.excVoltage = this.measuredR * I_mA / 1000;

        // 4-20mA 输出
        const range = this.tempRangeHi - this.tempRangeLo;
        const norm  = Math.max(0, Math.min(1, (this.temperature - this.tempRangeLo) / range));
        this.outputMA = 4 + norm * 16;

        // 报警
        this.alarmHi = this.temperature > this.hiAlarm;
        this.alarmLo = this.temperature < this.loAlarm;

        // 温度弧
        if (this._tempArc) {
            this._tempArc.angle(norm * 360);
            this._tempArc.fill(this.alarmHi ? '#ef5350' : this.alarmLo ? '#42a5f5' : '#ff8f00');
        }

        // 动画相位
        this._phase      += dt * 3;
        this._noisePhase += dt * 8;
        this._heatGlow    = Math.min(0.4, Math.max(0, (this.temperature - 100) / 300));
    }

    // ── 探头可视化 ────────────────────────────
    _tickProbeViz() {
        const T = this.temperature;
        const norm = Math.max(0, Math.min(1, (T - this.tempRangeLo) / (this.tempRangeHi - this.tempRangeLo)));

        // 保护管热辉光（高温时橙红色）
        if (this._heatGlowRect) {
            const r = Math.round(255), g = Math.round(100 - norm*80), b = Math.round(0);
            this._heatGlowRect.fill(`rgba(${r},${g},${b},${this._heatGlow})`);
        }

        // 铂丝颜色（随温度从蓝色→白色→橙红色）
        if (this._platLines) {
            const r = Math.round(100 + norm*155), g2 = Math.round(150 + norm*50), b2 = Math.round(200 - norm*200);
            this._platLines.forEach(l => l.stroke(`rgb(${r},${g2},${Math.max(0,b2)})`));
        }

        // 温度指示点位置（随温度在铂丝段上移动）
        if (this._tempIndicator) {
            const elemY = this._probeTubeY + this._probeTubeH * 0.25;
            const elemH = this._probeTubeH * 0.55;
            const tipY  = elemY + elemH * (1 - norm);
            this._tempIndicator.y(tipY);
            const r2 = Math.round(100+norm*155), g3 = Math.round(150+norm*50);
            this._tempIndicator.fill(`rgb(${r2},${g3},0)`);
            this._tempIndicator.stroke(norm > 0.7 ? '#c62828' : '#1565c0');
        }

        // 报警 LED
        if (this._almLeds && this._almLeds.length === 3) {
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 3));
            this._almLeds[0].led.fill(!this.alarmHi && !this.alarmLo ? '#4caf50' : '#1a1a1a');
            this._almLeds[1].led.fill(this.alarmHi ? `rgba(239,83,80,${pulse})` : '#1a1a1a');
            this._almLeds[2].led.fill(this.alarmLo ? `rgba(66,165,245,${pulse})` : '#1a1a1a');
        }
    }

    // ── R-T 曲线工作点 ───────────────────────
    _tickRTPoint() {
        const T = this.temperature;
        const R = this.resistance;
        const { _rtOX: ox, _rtOY: oy, _rtAW: aw, _rtAH: ah, _rtTMin: tMin, _rtTMax: tMax, _rtRMin: rMin, _rtRMax: rMax } = this;

        const tx = ox + (T - tMin) / (tMax - tMin) * (aw-2);
        const ry = oy - (R - rMin) / (rMax - rMin) * (ah-4);

        if (this._rtPoint) { this._rtPoint.x(tx); this._rtPoint.y(ry); }
        if (this._rtHLine) this._rtHLine.points([ox, ry, tx, ry]);
        if (this._rtVLine) this._rtVLine.points([tx, ry, tx, oy]);
        if (this._rtLabel) {
            this._rtLabel.x(tx + 4);
            this._rtLabel.y(ry - 12);
            this._rtLabel.text(`${T.toFixed(1)}°C\n${R.toFixed(2)}Ω`);
        }

        // 误差面板
        if (this._errorText) {
            this._errorText.text(`ΔR=${this.errorR.toFixed(3)}Ω  ΔT=${this.errorT.toFixed(3)}°C`);
            this._errorText.fill(this.errorR > 0.01 ? '#ffa726' : '#66bb6a');
        }
        if (this._modeDesc) {
            const desc = {
                '2W': '两线制：引线电阻全部引入误差',
                '3W': '三线制：补偿大部分引线电阻',
                '4W': '四线制：完全消除引线电阻误差',
            };
            this._modeDesc.text(desc[this.wireMode] || '');
        }
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH2) return;
        this._wavAcc += 1.2 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        const T   = this.temperature + (Math.random()-0.5) * 0.1;  // 微小噪声
        const R   = this.resistance;
        for (let i = 0; i < steps; i++) {
            this._wavT = new Float32Array([...this._wavT.slice(1), T]);
            this._wavR = new Float32Array([...this._wavR.slice(1), R]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww / n;
        const h2 = this._wavH2;
        const tRange = this.tempRangeHi - this.tempRangeLo + 0.01;
        const rRange = this._calcR(this.tempRangeHi) - this._calcR(this.tempRangeLo) + 0.01;
        const aT = h2 * 0.42, aR = h2 * 0.38;

        const tPts=[], rPts=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            const tNorm = (this._wavT[i] - this.tempRangeLo) / tRange;
            const rNorm = (this._wavR[i] - this._calcR(this.tempRangeLo)) / rRange;
            tPts.push(x, this._wavMidT - (tNorm*2-1) * aT);
            rPts.push(x, this._wavMidR - (rNorm*2-1) * aR);
        }
        if (this._wLineT) this._wLineT.points(tPts);
        if (this._wLineR) this._wLineR.points(rPts);
        if (this._wTLbl) this._wTLbl.text(`${this.temperature.toFixed(2)} °C`);
        if (this._wRLbl) this._wRLbl.text(`${this.resistance.toFixed(3)} Ω`);
    }

    // ── LCD 刷新 ──────────────────────────────
    _tickDisplay() {
        const T   = this.temperature;
        const mc  = this.alarmHi ? '#ef5350' : this.alarmLo ? '#42a5f5' : '#ff8f00';

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(T.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdR)    this._lcdR.text(`R=${this.resistance.toFixed(2)}Ω`);
        if (this._lcdMA)   this._lcdMA.text(`${this.outputMA.toFixed(2)}mA`);
        if (this._lcdWire) this._lcdWire.text(this.wireMode);
    }

    // ═══════════════════════════════════════════
    update(temp) {
        if (typeof temp === 'number') {
            this._manualTemp = Math.max(-200, Math.min(850, temp));
        }
        this._refreshCache();
    }

    getResistance(T) { return this._calcR(T ?? this.temperature); }

    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'id',           type: 'text'   },
            { label: '接线方式',              key: 'wireMode',     type: 'select',
              options: [{label:'两线制 2W',value:'2W'},{label:'三线制 3W',value:'3W'},{label:'四线制 4W',value:'4W'}] },
            { label: '量程下限 (°C)',          key: 'tempRangeLo',  type: 'number' },
            { label: '量程上限 (°C)',          key: 'tempRangeHi',  type: 'number' },
            { label: '高温报警 (°C)',          key: 'hiAlarm',      type: 'number' },
            { label: '低温报警 (°C)',          key: 'loAlarm',      type: 'number' },
            { label: '引线电阻 (Ω/根)',        key: 'wireR',        type: 'number' },
            { label: '激励电流 (mA)',          key: 'excCurrent',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.wireMode    = cfg.wireMode    || this.wireMode;
        this.tempRangeLo = parseFloat(cfg.tempRangeLo) ?? this.tempRangeLo;
        this.tempRangeHi = parseFloat(cfg.tempRangeHi) || this.tempRangeHi;
        this.hiAlarm     = parseFloat(cfg.hiAlarm)     || this.hiAlarm;
        this.loAlarm     = parseFloat(cfg.loAlarm)     ?? this.loAlarm;
        this.wireR       = parseFloat(cfg.wireR)       || this.wireR;
        this.excCurrent  = parseFloat(cfg.excCurrent)  || this.excCurrent;
        this.config      = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}