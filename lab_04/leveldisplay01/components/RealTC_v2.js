import { BaseComponent } from './BaseComponent.js';

/**
 * 热电偶温度传感器仿真组件
 * （Thermocouple Temperature Sensor）
 *
 * ── 工作原理（Seebeck 效应）───────────────────────────────────
 *
 *  1. Seebeck 效应（热电效应）：
 *     两种不同金属在接合处形成热电偶。
 *     当测量端（热端）与参考端（冷端）存在温度差时，
 *     回路中会产生热电动势（EMF）：
 *
 *       E = α(T_hot - T_cold)      （线性近似）
 *       E = ∫[T_cold to T_hot] S(T) dT   （精确积分形式）
 *
 *     S(T) = Seebeck 系数（μV/°C），随温度非线性变化
 *
 *  2. 冷端补偿（Cold Junction Compensation, CJC）：
 *     实际测量时，冷端（接线端）温度不为 0°C，
 *     需要补偿冷端温度对 EMF 的影响：
 *
 *       E_corrected = E_measured + E(T_cold)
 *       T_hot = f_inverse(E_corrected)
 *
 *     其中 f_inverse 是热电偶分度表的反函数（逆变换）。
 *
 *  3. 标准分度号（IEC 60584）：
 *     K 型：Ni-Cr / Ni-Al     -200~1350°C  约 41 μV/°C
 *     J 型：Fe / Cu-Ni        -210~1200°C  约 52 μV/°C
 *     T 型：Cu / Cu-Ni         -270~400°C   约 43 μV/°C
 *     E 型：Ni-Cr / Cu-Ni     -270~1000°C  约 68 μV/°C
 *     S 型：Pt-10%Rh / Pt       -50~1767°C  约 10 μV/°C
 *     R 型：Pt-13%Rh / Pt       -50~1767°C  约 11 μV/°C
 *     B 型：Pt-30%Rh / Pt-6%Rh  0~1820°C    约 6 μV/°C
 *
 *  4. 非线性修正（多项式展开）：
 *     E(T) = c₀ + c₁T + c₂T² + ... + cₙTⁿ （分度表多项式）
 *     本组件采用简化二次多项式近似，足够工程精度。
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 热电偶探头外观（工业套管型，可选不锈钢/陶瓷保护管）
 *  ② 热接点（测量端）+ 热端发光动画
 *  ③ 冷接点（参考端）+ 冷端温度补偿模块
 *  ④ 两种金属导线（颜色编码，随温度流动动画）
 *  ⑤ E-T 特性曲线（EMF-温度特性，多型号叠加显示）
 *  ⑥ mV 输出显示（Seebeck 电压）
 *  ⑦ 冷端补偿计算可视化
 *  ⑧ 4-20mA 变送器输出
 *  ⑨ 实时波形（T(t) 和 mV(t)）
 *  ⑩ 多分度号切换按钮（K/J/T/E/S）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_mv_p  — mV 输出正极（+）
 *  wire_mv_n  — mV 输出负极（−）
 *  wire_ma_p  — 4-20mA 输出正极
 *  wire_ma_n  — 4-20mA 输出负极
 */
export class Thermocouple extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || 480);
        this.height = Math.max(340, config.height || 400);

        this.type    = 'thermocouple';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 热电偶数据库 ──
        this._tcDB = {
            K: {
                name: 'K型 (Ni-Cr/Ni-Al)',
                tMin: -200, tMax: 1350,
                seebeck: 41,        // μV/°C 平均 Seebeck 系数
                // 简化多项式系数（mV = a0 + a1*T + a2*T²），在常用范围分段
                poly: { a0: 0, a1: 0.03946, a2: 2.74e-6 },  // mV vs °C (0~1200)
                posWire: '#90a4ae',  // 正极金属颜色（Ni-Cr，灰绿）
                negWire: '#bdbdbd',  // 负极金属颜色（Ni-Al，银灰）
                posLabel: 'Ni-Cr',
                negLabel: 'Ni-Al',
                color:   '#ff8f00',
            },
            J: {
                name: 'J型 (Fe/Cu-Ni)',
                tMin: -210, tMax: 1200,
                seebeck: 52,
                poly: { a0: 0, a1: 0.05038, a2: 3.05e-6 },
                posWire: '#9e9e9e', posLabel: 'Fe（铁）',
                negWire: '#bf8040', negLabel: 'Cu-Ni（铜镍）',
                color:   '#f57f17',
            },
            T: {
                name: 'T型 (Cu/Cu-Ni)',
                tMin: -270, tMax: 400,
                seebeck: 43,
                poly: { a0: 0, a1: 0.03875, a2: 4.42e-5 },
                posWire: '#b87333', posLabel: 'Cu（铜）',
                negWire: '#7986cb', negLabel: 'Cu-Ni（铜镍）',
                color:   '#e65100',
            },
            E: {
                name: 'E型 (Ni-Cr/Cu-Ni)',
                tMin: -270, tMax: 1000,
                seebeck: 68,
                poly: { a0: 0, a1: 0.05868, a2: 9.56e-6 },
                posWire: '#80cbc4', posLabel: 'Ni-Cr',
                negWire: '#7986cb', negLabel: 'Cu-Ni',
                color:   '#0097a7',
            },
            S: {
                name: 'S型 (Pt-10%Rh/Pt)',
                tMin: -50, tMax: 1767,
                seebeck: 10,
                poly: { a0: 0, a1: 0.00541, a2: 1.25e-6 },
                posWire: '#c0c0c0', posLabel: 'Pt-Rh',
                negWire: '#e8e8e8', negLabel: 'Pt（铂）',
                color:   '#78909c',
            },
        };

        // ── 参数 ──
        this.tcType      = config.tcType      || 'K';     // 分度号
        this.coldJunctT  = config.coldJunctT  || 25;     // 冷端温度 °C
        this.autoCJC     = config.autoCJC     !== false; // 自动冷端补偿
        this.tempRangeLo = config.tempRangeLo || 0;      // 量程下限 °C
        this.tempRangeHi = config.tempRangeHi || 600;    // 量程上限 °C
        this.hiAlarm     = config.hiAlarm     || 550;    // 高温报警
        this.loAlarm     = config.loAlarm     || 20;     // 低温报警
        this.protection  = config.protection  || 'SS';   // 'SS'=不锈钢 | 'Ceramic'=陶瓷

        // ── 状态 ──
        this.temperature  = config.initTemp   || 25;     // 热端温度 °C
        this._manualTemp  = config.initTemp   || 25;
        this.emfRaw       = 0;      // 原始 EMF（不含冷端补偿）mV
        this.emfCJC       = 0;      // 冷端补偿量 mV
        this.emfTotal     = 0;      // 总 EMF（补偿后）mV
        this.outputMA     = 4;      // 4-20mA 输出
        this.isBreak      = false;
        this.alarmHi      = false;
        this.alarmLo      = false;
        this.openCircuit  = false;  // 断路故障

        // ── 动画 ──
        this._phase       = 0;
        this._flowPhase   = 0;      // 热电流动画相位
        this._heatGlow    = 0;

        // ── 波形缓冲 ──
        this._wavLen      = 240;
        this._wavT        = new Float32Array(this._wavLen).fill(25);
        this._wavEmf      = new Float32Array(this._wavLen).fill(0);
        this._wavAcc      = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartT  = 0;

        // ── 几何布局 ──
        // 探头区（左侧）
        this._probeX   = 8;
        this._probeY   = Math.round(this.height * 0.06);
        this._probeW   = Math.round(this.width  * 0.24);
        this._probeH   = Math.round(this.height * 0.76);

        // 探头中心线
        this._probeCX  = this._probeX + this._probeW / 2;
        this._hotEndY  = this._probeY + this._probeH - 18;   // 热端位置
        this._coldEndY = this._probeY + Math.round(this._probeH * 0.26);  // 冷端（接线头）

        // E-T 特性曲线（中部）
        this._curveX   = this._probeX + this._probeW + 10;
        this._curveY   = this._probeY;
        this._curveW   = Math.round(this.width  * 0.32);
        this._curveH   = Math.round(this.height * 0.52);

        // LCD 仪表（右侧）
        this._lcdX     = this._curveX + this._curveW + 10;
        this._lcdY     = this._probeY;
        this._lcdW     = this.width - this._lcdX - 8;
        this._lcdH     = Math.round(this.height * 0.58);

        // 分度号选择面板（曲线下方）
        this._selectorX = this._curveX;
        this._selectorY = this._curveY + this._curveH + 6;
        this._selectorW = this._curveW;
        this._selectorH = Math.round(this.height * 0.16);

        // 波形区（底部）
        this._wavX     = this._probeX;
        this._wavY     = this._probeY + this._probeH + 8;
        this._wavW     = this.width - this._probeX * 2;
        this._wavH     = this.height - this._wavY - 6;

        this.knobs     = {};

        this.config = {
            id: this.id, tcType: this.tcType,
            tempRangeLo: this.tempRangeLo, tempRangeHi: this.tempRangeHi,
            hiAlarm: this.hiAlarm, loAlarm: this.loAlarm,
        };

        this._init();

        this.addPort(this._probeCX - 14, this.height - 4,  'mv_p',  'wire', 'mV+');
        this.addPort(this._probeCX + 14, this.height - 4,  'mv_n',  'wire', 'mV−');
        this.addPort(this.width,         this._lcdY + 14,  'ma_p',  'wire', 'mA+');
        this.addPort(this.width,         this._lcdY + 34,  'ma_n',  'wire', 'mA−');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawProtectionTube();
        this._drawWires();
        this._drawHotJunction();
        this._drawColdJunction();
        this._drawSeebeckArrow();
        this._drawFlowLayer();
        this._drawETCurve();
        this._drawTypeSelector();
        this._drawInstrHead();
        this._drawLCD();
        this._drawAlarmPanel();
        this._drawWaveform();
        this._setupDrag();
        
    }

    _drawLabel() {
        const tc = this._tcDB[this.tcType];
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `热电偶 Thermocouple（Seebeck效应）— ${tc?.name || this.tcType}`,
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 保护套管 ─────────────────────────────
    _drawProtectionTube() {
        const cx2 = this._probeCX, py = this._probeY, ph = this._probeH;

        // 接线盒（顶部）
        const headH = Math.round(ph * 0.28);
        const headW = this._probeW - 4;
        const headX = this._probeX + 2;
        const head  = new Konva.Rect({ x: headX, y: py, width: headW, height: headH, fill: '#37474f', stroke: '#263238', strokeWidth: 2, cornerRadius: [4,4,0,0] });
        // 接线盒螺丝
        [[headX+8, py+10],[headX+headW-8, py+10],[headX+8, py+headH-10],[headX+headW-8, py+headH-10]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4, fill: '#263238' }));
            this.group.add(new Konva.Circle({ x: bx-1, y: by-1, radius: 1.5, fill: 'rgba(255,255,255,0.22)' }));
        });
        // 接线盒铭牌
        this.group.add(new Konva.Rect({ x: headX+8, y: py+headH/2-10, width: headW-16, height: 20, fill: '#1e2a36', cornerRadius: 2 }));
        this._typeLbl = new Konva.Text({ x: headX+8, y: py+headH/2-8, width: headW-16, text: `TC  ${this.tcType}型`, fontSize: 9, fontStyle: 'bold', fill: '#ffa726', align: 'center', lineHeight: 1.3 });
        this.group.add(this._typeLbl);

        // 螺纹连接件（法兰）
        const flangeY = py + headH;
        const flangeH = Math.round(ph * 0.07);
        const flangeW = headW + 8;
        const flange  = new Konva.Rect({ x: headX-4, y: flangeY, width: flangeW, height: flangeH, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5 });
        // 螺纹纹理（细横线）
        for (let i = 2; i < flangeH-1; i += 3) {
            this.group.add(new Konva.Line({ points: [headX-4, flangeY+i, headX-4+flangeW, flangeY+i], stroke: '#37474f', strokeWidth: 0.5, opacity: 0.5 }));
        }

        // 保护管（套管，下段）
        const tubeY  = flangeY + flangeH;
        const tubeH  = ph - headH - flangeH;
        const tubeW  = Math.round(this._probeW * 0.28);
        const isSteel= this.protection === 'SS';
        const tubeCol= isSteel ? '#78909c' : '#d7ccc8';
        const tube   = new Konva.Rect({ x: cx2-tubeW/2, y: tubeY, width: tubeW, height: tubeH, fill: tubeCol, stroke: isSteel?'#546e7a':'#bcaaa4', strokeWidth: 1.5, cornerRadius: [0,0,3,3] });
        // 套管高光
        this.group.add(new Konva.Rect({ x: cx2-tubeW/2+2, y: tubeY, width: 4, height: tubeH, fill: 'rgba(255,255,255,0.18)', cornerRadius: [0,0,1,1] }));
        // 管端（半圆头）
        this.group.add(new Konva.Ellipse({ x: cx2, y: tubeY+tubeH, radiusX: tubeW/2, radiusY: 7, fill: isSteel?'#607d8b':'#bcaaa4', stroke: isSteel?'#37474f':'#a1887f', strokeWidth: 1 }));

        // 热辉光
        this._heatGlowEllipse = new Konva.Ellipse({ x: cx2, y: tubeY+tubeH, radiusX: tubeW, radiusY: 16, fill: 'rgba(255,60,0,0)' });

        this._probeHeadH   = headH;
        this._probeFlangeH = flangeH;
        this._probeTubeY   = tubeY;
        this._probeTubeH   = tubeH;
        this._probeTubeW   = tubeW;

        this.group.add(head, flange, tube, this._heatGlowEllipse);
    }

    // ── 两种金属导线 ──────────────────────────
    _drawWires() {
        const cx2 = this._probeCX, hotY = this._hotEndY;
        const tubeY = this._probeTubeY, tw = this._probeTubeW;
        const tc = this._tcDB[this.tcType];

        // 正极导线（套管内，左侧）
        this._wire1 = new Konva.Line({
            points: [cx2-tw/2+5, hotY-4, cx2-tw/2+5, tubeY],
            stroke: tc?.posWire || '#9e9e9e', strokeWidth: 2.5, lineCap: 'round',
        });
        this._wire1Label = new Konva.Text({ x: this._probeX, y: tubeY-14, text: tc?.posLabel || '+', fontSize: 7.5, fill: tc?.posWire || '#9e9e9e' });

        // 负极导线（套管内，右侧）
        this._wire2 = new Konva.Line({
            points: [cx2+tw/2-5, hotY-4, cx2+tw/2-5, tubeY],
            stroke: tc?.negWire || '#bdbdbd', strokeWidth: 2.5, lineCap: 'round',
        });
        this._wire2Label = new Konva.Text({ x: cx2+tw/2-2, y: tubeY-14, text: tc?.negLabel || '−', fontSize: 7.5, fill: tc?.negWire || '#bdbdbd' });

        // 引线（从接线盒到端子）
        const headBot = this._probeY + this._probeHeadH;
        this._extWire1 = new Konva.Line({ points: [cx2-14, headBot, cx2-14, this.height-6], stroke: tc?.posWire || '#9e9e9e', strokeWidth: 2, lineCap: 'round' });
        this._extWire2 = new Konva.Line({ points: [cx2+14, headBot, cx2+14, this.height-6], stroke: tc?.negWire || '#bdbdbd', strokeWidth: 2, lineCap: 'round' });
        this.group.add(new Konva.Text({ x: cx2-24, y: this.height-18, text: 'mV+', fontSize: 7.5, fill: tc?.posWire||'#9e9e9e', align: 'right', width: 20 }));
        this.group.add(new Konva.Text({ x: cx2+6,  y: this.height-18, text: 'mV−', fontSize: 7.5, fill: tc?.negWire||'#bdbdbd' }));

        this.group.add(this._wire1, this._wire1Label, this._wire2, this._wire2Label, this._extWire1, this._extWire2);
    }

    // ── 热接点（测量端）──────────────────────
    _drawHotJunction() {
        const cx2 = this._probeCX, hy = this._hotEndY;

        // 接合点（焊接点）
        this._hotJunction = new Konva.Circle({ x: cx2, y: hy, radius: 6, fill: '#ef5350', stroke: '#c62828', strokeWidth: 2 });
        // 接合点标注
        this.group.add(new Konva.Text({ x: cx2+10, y: hy-6, text: '热端\n测量端', fontSize: 7.5, fill: '#ef9a9a', lineHeight: 1.3 }));
        // 热辉光（动态）
        this._hotJunctionGlow = new Konva.Circle({ x: cx2, y: hy, radius: 12, fill: 'rgba(255,60,0,0.2)' });
        this.group.add(this._hotJunctionGlow, this._hotJunction);
    }

    // ── 冷接点（参考端/接线盒内）────────────
    _drawColdJunction() {
        const cx2 = this._probeCX, cy2 = this._coldEndY;

        // 冷端补偿模块（接线盒内）
        const modX = this._probeX + 6, modW = this._probeW - 12;
        const modY = cy2 - 18, modH = 36;
        const modBg = new Konva.Rect({ x: modX, y: modY, width: modW, height: modH, fill: '#0d2030', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2 });
        this.group.add(new Konva.Text({ x: modX+2, y: modY+2, width: modW-4, text: 'CJC\n冷端补偿', fontSize: 7, fill: '#80cbc4', align: 'center', lineHeight: 1.3 }));
        this._cjcTempText = new Konva.Text({ x: modX+2, y: modY+modH-12, width: modW-4, text: `Tc=${this.coldJunctT}°C`, fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#4fc3f7', align: 'center' });

        // 冷端接合点
        this._coldJunction = new Konva.Circle({ x: cx2-this._probeTubeW/2+5, y: cy2, radius: 4, fill: '#42a5f5', stroke: '#1565c0', strokeWidth: 1.5 });
        this._coldJunction2= new Konva.Circle({ x: cx2+this._probeTubeW/2-5, y: cy2, radius: 4, fill: '#1e88e5', stroke: '#0d47a1', strokeWidth: 1.5 });
        this.group.add(new Konva.Text({ x: this._probeX, y: cy2+6, text: '冷端', fontSize: 7.5, fill: '#90caf9' }));

        this.group.add(modBg, this._cjcTempText, this._coldJunction, this._coldJunction2);
    }

    // ── Seebeck 效应箭头标注 ──────────────────
    _drawSeebeckArrow() {
        const cx2 = this._probeCX;
        const midY = (this._hotEndY + this._coldEndY) / 2;

        // 热电流方向箭头（管内）
        this._seebeckArrow = new Konva.Arrow({
            points: [cx2, this._hotEndY - 10, cx2, this._coldEndY + 20],
            stroke: '#ffd54f', fill: '#ffd54f',
            strokeWidth: 1.5, pointerLength: 5, pointerWidth: 4,
            dash: [5,3], opacity: 0.6,
        });
        this._seebeckLabel = new Konva.Text({ x: cx2+6, y: midY, text: 'E=α·ΔT', fontSize: 8, fontStyle: 'bold', fill: '#ffd54f', opacity: 0.7 });
        this.group.add(this._seebeckArrow, this._seebeckLabel);
    }

    // ── 热电流流动动画层 ──────────────────────
    _drawFlowLayer() {
        this._flowGroup = new Konva.Group();
        this.group.add(this._flowGroup);
    }

    // ── E-T 特性曲线 ─────────────────────────
    _drawETCurve() {
        const { _curveX: cx2, _curveY: cy2, _curveW: cw, _curveH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: 'E-T 特性曲线（各型号对比）', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 坐标系
        const ox = cx2+18, oy = cy2+ch-12, aw = cw-24, ah = ch-26;
        this.group.add(new Konva.Line({ points: [ox, oy-ah, ox, oy, ox+aw, oy], stroke: '#37474f', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: ox-16, y: cy2+14, text: 'E(mV)', fontSize: 7, fill: '#80cbc4' }));
        this.group.add(new Konva.Text({ x: cx2+cw-14, y: oy+2, text: 'T(°C)', fontSize: 7, fill: '#80cbc4' }));

        // 坐标轴刻度
        const tPlotMax = 1400, emfMax = 70;
        [0, 200, 400, 600, 800, 1000, 1200].forEach(T => {
            const tx = ox + T/tPlotMax * (aw-2);
            this.group.add(new Konva.Line({ points: [tx, oy, tx, oy+3], stroke: '#37474f', strokeWidth: 0.8 }));
            if (T % 400 === 0) this.group.add(new Konva.Text({ x: tx-8, y: oy+4, width: 16, text: T.toString(), fontSize: 6, fill: '#37474f', align: 'center' }));
        });
        [0, 20, 40, 60].forEach(E => {
            const ry = oy - E/emfMax * (ah-4);
            this.group.add(new Konva.Line({ points: [ox-3, ry, ox, ry], stroke: '#37474f', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: ox-16, y: ry-4, width: 14, text: E.toString(), fontSize: 6, fill: '#37474f', align: 'right' }));
        });

        // 绘制各型号特性曲线（多条叠加）
        const typeOrder = ['K','J','T','E','S'];
        typeOrder.forEach(type => {
            const tc = this._tcDB[type];
            if (!tc) return;
            const tMax = Math.min(tc.tMax, tPlotMax);
            const pts  = [];
            for (let T = Math.max(0, tc.tMin); T <= tMax; T += 20) {
                const E = this._calcEMF(type, T);
                if (E < 0 || E > emfMax) continue;
                pts.push(ox + T/tPlotMax*(aw-2), oy - E/emfMax*(ah-4));
            }
            if (pts.length > 2) {
                this.group.add(new Konva.Line({ points: pts, stroke: tc.color, strokeWidth: this.tcType === type ? 2.2 : 1.2, lineJoin: 'round', opacity: this.tcType === type ? 0.9 : 0.4, listening: false }));
            }
            // 型号标签（末端）
            if (pts.length >= 2) {
                this.group.add(new Konva.Text({ x: pts[pts.length-2]+2, y: pts[pts.length-1]-6, text: type, fontSize: 7, fill: tc.color, opacity: 0.7 }));
            }
        });

        // 工作点
        this._etPoint = new Konva.Circle({ x: ox, y: oy, radius: 5.5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5 });
        this._etHLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._etVLine = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 0.8, dash: [3,2], opacity: 0.5 });
        this._etLabel = new Konva.Text({ x: 0, y: 0, text: '', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef5350' });

        this._etOX = ox; this._etOY = oy; this._etAW = aw; this._etAH = ah;
        this._etTMax = tPlotMax; this._etEmfMax = emfMax;

        this.group.add(bg, titleBg, this._etPoint, this._etHLine, this._etVLine, this._etLabel);
    }

    // ── 分度号选择面板 ───────────────────────
    _drawTypeSelector() {
        const { _selectorX: sx, _selectorY: sy, _selectorW: sw, _selectorH: sh } = this;

        const bg = new Konva.Rect({ x: sx, y: sy, width: sw, height: sh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: sx, y: sy, width: sw, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: sx+4, y: sy+2, width: sw-8, text: '分度号选择 / EMF 输出', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        // 型号按钮
        const types = ['K','J','T','E','S'];
        const btnW  = (sw-14) / types.length;
        const btnY  = sy + 18;
        this._typeBtns = [];
        types.forEach((t, i) => {
            const tc = this._tcDB[t];
            const bx = sx + 6 + i*(btnW+2);
            const isActive = t === this.tcType;
            const btn = new Konva.Rect({ x: bx, y: btnY, width: btnW, height: 16, fill: isActive ? `rgba(${this._hexToRgb(tc?.color||'#aaa')},0.3)` : '#0d2030', stroke: isActive ? tc?.color||'#80cbc4' : '#1a3040', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: btnY+3, width: btnW, text: t+'型', fontSize: 8, fill: isActive ? tc?.color||'#80cbc4' : '#546e7a', align: 'center' });
            btn.on('click tap', () => {
                this.tcType = t;
                this._updateWireColors();
                this._typeBtns.forEach((b, j) => {
                    const tc2 = this._tcDB[types[j]];
                    const act = types[j] === t;
                    b.btn.fill(act ? `rgba(${this._hexToRgb(tc2?.color||'#aaa')},0.3)` : '#0d2030');
                    b.btn.stroke(act ? tc2?.color||'#80cbc4' : '#1a3040');
                    b.lbl.fill(act ? tc2?.color||'#80cbc4' : '#546e7a');
                });
                if (this._typeLbl) this._typeLbl.text(`TC  ${t}型`);
                this._refreshCache();
            });
            this._typeBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });

        // EMF 数值显示
        this._emfText  = new Konva.Text({ x: sx+4, y: btnY+22, width: sw-8, text: 'EMF = 0.000 mV', fontSize: 9, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ffd54f', align: 'center' });
        this._cjcText  = new Konva.Text({ x: sx+4, y: btnY+34, width: sw-8, text: 'CJC = +0.000 mV', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#4fc3f7', align: 'center' });
        this._seebeckText = new Konva.Text({ x: sx+4, y: btnY+46, width: sw-8, text: 'α = 41 μV/°C', fontSize: 8, fill: '#80cbc4', align: 'center' });

        this.group.add(bg, titleBg, this._emfText, this._cjcText, this._seebeckText);
    }

    // ── 辅助：hex 颜色转 r,g,b 字符串 ────────
    _hexToRgb(hex) {
        hex = hex.replace('#','');
        if (hex.length === 3) hex = hex.split('').map(h=>h+h).join('');
        const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
        return `${r},${g},${b}`;
    }

    // ── 仪表头 ────────────────────────────────
    _drawInstrHead() {
        const hx = this._lcdX, hy = this._lcdY, hw = this._lcdW;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+7, y: hy+4, width: hw-14, height: 27, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+7, y: hy+7, width: hw-14, text: this.id || 'TE-TC-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+7, y: hy+17, width: hw-14, text: 'THERMOCOUPLE', fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+7, y: hy+27, width: hw-14, text: `${this.tempRangeLo}~${this.tempRangeHi}°C`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-9, y: hy+3, width: 9, height: 40, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: this._lcdH-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        [['mA+','#ffd54f',14],['mA−','#90a4ae',34]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Text({ x: hx+6, y: hy+ty-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ─────────────────────────────
    _drawLCD() {
        const hx = this._lcdX, hw = this._lcdW;
        const lcy = this._lcdY + 44 + (this._lcdH-44)*0.48;
        const lcx = hx + hw/2;
        const R   = Math.min(hw*0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1a0800', stroke: '#e65100', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });
        this._tempArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ff5722', rotation: -90 });

        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'25.0',   fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#ff5722', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'°C',     fontSize:R*.18, fill:'#1a0800', align:'center' });
        this._lcdEmf   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.28, width:(R-4)*2, text:'0.0mV',  fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdMA    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'--mA',   fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdType  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.46, width:(R-4)*2, text:'K型',   fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._tempArc, this._lcdMain, this._lcdUnit, this._lcdEmf, this._lcdMA, this._lcdType);
    }

    // ── 报警面板 ─────────────────────────────
    _drawAlarmPanel() {
        const hx = this._lcdX, hw = this._lcdW;
        const panY = this._lcCY + this._lcR + 14;

        this._almLeds = [];
        [['NORM','#4caf50',hx+hw*0.22],['HI-T','#ef5350',hx+hw*0.57],['OPEN','#ffa726',hx+hw*0.84]].forEach(([lbl,col,lx]) => {
            const led = new Konva.Circle({ x: lx, y: panY, radius: 6, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 });
            const txt = new Konva.Text({ x: lx-14, y: panY+9, width: 28, text: lbl, fontSize: 7, fill: '#37474f', align: 'center' });
            this._almLeds.push({ led, col });
            this.group.add(led, txt);
        });
    }

    // ── 波形区 ───────────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;
        if (wh < 16) return;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 13, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'T(t)  E(mV)', fontSize: 8, fontStyle: 'bold', fill: '#ff5722', align: 'center' }));

        const h2 = (wh-13)/2;
        this._wavMidT = wy+13+h2*0.5;
        this._wavMidE = wy+13+h2*1.5;
        [this._wavMidT, this._wavMidE].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.08)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineT = new Konva.Line({ points: [], stroke: '#ff5722', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineE = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.5, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+13+4, text: 'T(°C)', fontSize: 8, fill: '#ff5722' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+13+h2+4, text: 'E(mV)', fontSize: 8, fill: '#ffd54f' }));

        this._wTLbl = new Konva.Text({ x: wx+ww-80, y: wy+13+4, width: 76, text: '--°C', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ff5722', align: 'right' });
        this._wELbl = new Konva.Text({ x: wx+ww-80, y: wy+13+h2+4, width: 76, text: '--mV', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });

        this.group.add(bg, titleBg, this._wLineT, this._wLineE, this._wTLbl, this._wELbl);
        this._wavH2 = h2;
    }

    // ── 拖拽调温 ─────────────────────────────
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
            this._manualTemp = Math.max(this.tempRangeLo - 50, Math.min(this.tempRangeHi + 100, this._dragStartT + (this._dragStartY - cy2) * (range / this._probeH)));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hit);
    }

    // ── EMF 计算（简化多项式）────────────────
    _calcEMF(type, T) {
        const tc = this._tcDB[type];
        if (!tc) return 0;
        const { a0, a1, a2 } = tc.poly;
        return a0 + a1 * T + a2 * T * T;   // mV
    }

    // ── 更新导线颜色 ─────────────────────────
    _updateWireColors() {
        const tc = this._tcDB[this.tcType];
        if (!tc) return;
        if (this._wire1) { this._wire1.stroke(tc.posWire); this._wire1Label?.text(tc.posLabel); this._wire1Label?.fill(tc.posWire); }
        if (this._wire2) { this._wire2.stroke(tc.negWire); this._wire2Label?.text(tc.negLabel); this._wire2Label?.fill(tc.negWire); }
        if (this._extWire1) this._extWire1.stroke(tc.posWire);
        if (this._extWire2) this._extWire2.stroke(tc.negWire);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickPhysics(dt);
        this._tickProbeViz(dt);
        this._tickETPoint();
        this._tickFlow(dt);
        this._tickWaveform(dt);
        this._tickDisplay();
        this._refreshCache();
    }


    // ── 物理计算 ─────────────────────────────
    _tickPhysics(dt) {
        this.temperature = this._manualTemp;
        const T_hot  = this.temperature;
        const T_cold = this.coldJunctT;

        // 原始 EMF（热端相对 0°C 的 EMF）
        this.emfRaw = this._calcEMF(this.tcType, T_hot);

        // 冷端补偿（加上冷端相对 0°C 的 EMF）
        this.emfCJC   = this.autoCJC ? this._calcEMF(this.tcType, T_cold) : 0;
        this.emfTotal = this.emfRaw - this.emfCJC;  // 差值即为热端与冷端的温差对应的 EMF

        // 4-20mA 输出
        const emfRange = this._calcEMF(this.tcType, this.tempRangeHi) - this._calcEMF(this.tcType, this.tempRangeLo);
        const emfNorm  = emfRange > 0 ? Math.max(0, Math.min(1, this.emfTotal / emfRange)) : 0;
        this.outputMA  = 4 + emfNorm * 16;

        // 报警
        this.alarmHi   = T_hot > this.hiAlarm;
        this.alarmLo   = T_hot < this.loAlarm;

        // 温度弧
        const tNorm = Math.max(0, Math.min(1, (T_hot - this.tempRangeLo)/(this.tempRangeHi - this.tempRangeLo + 0.01)));
        if (this._tempArc) {
            this._tempArc.angle(tNorm*360);
            this._tempArc.fill(this.alarmHi ? '#ef5350' : this.alarmLo ? '#42a5f5' : '#ff5722');
        }

        // 热辉光
        this._heatGlow = Math.min(0.5, Math.max(0, (T_hot - 200) / 800));
        this._phase   += dt * 3;
        this._flowPhase+=dt * Math.max(1, T_hot/100);
    }

    // ── 探头可视化 ───────────────────────────
    _tickProbeViz(dt) {
        const tc = this._tcDB[this.tcType];
        const T  = this.temperature;
        const tNorm = Math.max(0, Math.min(1, (T - this.tempRangeLo) / (this.tempRangeHi - this.tempRangeLo + 0.01)));

        // 热接点颜色（低温蓝色→高温红色）
        if (this._hotJunction) {
            const r = Math.round(60 + tNorm * 195), g = Math.round(100 - tNorm * 100);
            this._hotJunction.fill(`rgb(${r},${Math.max(0,g)},0)`);
            this._hotJunction.stroke(tNorm > 0.7 ? '#c62828' : '#1565c0');
        }

        // 热接点辉光
        if (this._hotJunctionGlow) {
            const glowA = this._heatGlow + 0.1 * Math.abs(Math.sin(this._phase * 2));
            const r2 = Math.round(255), g2 = Math.round(100 - tNorm * 80);
            this._hotJunctionGlow.fill(`rgba(${r2},${Math.max(0,g2)},0,${glowA})`);
        }
        if (this._heatGlowEllipse) {
            this._heatGlowEllipse.fill(`rgba(255,${Math.round(100-tNorm*80)},0,${this._heatGlow * 0.5})`);
        }

        // CJC 温度更新
        if (this._cjcTempText) this._cjcTempText.text(`Tc=${this.coldJunctT.toFixed(1)}°C`);

        // 报警 LED
        if (this._almLeds && this._almLeds.length === 3) {
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 3));
            this._almLeds[0].led.fill(!this.alarmHi && !this.alarmLo ? '#4caf50' : '#1a1a1a');
            this._almLeds[1].led.fill(this.alarmHi ? `rgba(239,83,80,${pulse})` : '#1a1a1a');
            this._almLeds[2].led.fill(this.openCircuit ? `rgba(255,152,0,${pulse})` : '#1a1a1a');
        }

        // Seebeck 标注透明度（随温差变化）
        const deltaT = Math.abs(this.temperature - this.coldJunctT);
        if (this._seebeckArrow) this._seebeckArrow.opacity(Math.min(0.8, deltaT / 100 * 0.6 + 0.1));
        if (this._seebeckLabel) {
            const S = this._tcDB[this.tcType]?.seebeck || 41;
            this._seebeckLabel.text(`α=${S}μV/°C\nΔT=${deltaT.toFixed(1)}°C`);
            this._seebeckLabel.opacity(0.7);
        }
    }

    // ── E-T 工作点 ───────────────────────────
    _tickETPoint() {
        const T   = this.temperature;
        const emf = this.emfRaw;
        const { _etOX: ox, _etOY: oy, _etAW: aw, _etAH: ah, _etTMax: tMax, _etEmfMax: emfMax } = this;

        const tx = ox + (Math.min(T, tMax)) / tMax * (aw-2);
        const ey = oy - Math.min(emf, emfMax) / emfMax * (ah-4);

        if (this._etPoint) { this._etPoint.x(tx); this._etPoint.y(ey); const tc = this._tcDB[this.tcType]; this._etPoint.fill(tc?.color || '#ef5350'); }
        if (this._etHLine) this._etHLine.points([ox, ey, tx, ey]);
        if (this._etVLine) this._etVLine.points([tx, ey, tx, oy]);
        if (this._etLabel) {
            this._etLabel.x(tx + 4);
            this._etLabel.y(ey - 14);
            this._etLabel.text(`${T.toFixed(0)}°C\n${emf.toFixed(3)}mV`);
            const tc = this._tcDB[this.tcType];
            this._etLabel.fill(tc?.color || '#ef5350');
        }

        // 面板更新
        if (this._emfText) this._emfText.text(`EMF = ${this.emfTotal.toFixed(4)} mV`);
        if (this._cjcText) this._cjcText.text(`CJC = +${this.emfCJC.toFixed(4)} mV`);
        if (this._seebeckText) {
            const S = this._tcDB[this.tcType]?.seebeck || 41;
            this._seebeckText.text(`α ≈ ${S} μV/°C  ${this.tcType}型`);
        }
    }

    // ── 热电流流动动画 ───────────────────────
    _tickFlow(dt) {
        this._flowGroup.destroyChildren();
        const deltaT = Math.abs(this.temperature - this.coldJunctT);
        if (deltaT < 5) return;

        const tc  = this._tcDB[this.tcType];
        const cx2 = this._probeCX;
        const tw  = this._probeTubeW;

        // 正极导线粒子（从热端到冷端）
        for (let i = 0; i < 4; i++) {
            const t  = ((this._flowPhase * 0.12 + i * 0.25) % 1 + 1) % 1;
            const py = this._hotEndY - t * (this._hotEndY - this._coldEndY);
            const a  = Math.min(0.7, deltaT / 200) * (1-t);
            this._flowGroup.add(new Konva.Circle({ x: cx2-tw/2+5, y: py, radius: 2.5, fill: `rgba(${this._hexToRgb(tc?.posWire||'#9e9e9e')},${a})` }));
        }
        // 负极导线粒子（从冷端到热端，方向相反）
        for (let i = 0; i < 4; i++) {
            const t  = ((this._flowPhase * 0.12 + i * 0.25 + 0.5) % 1 + 1) % 1;
            const py = this._coldEndY + t * (this._hotEndY - this._coldEndY);
            const a  = Math.min(0.7, deltaT / 200) * (1-t);
            this._flowGroup.add(new Konva.Circle({ x: cx2+tw/2-5, y: py, radius: 2.5, fill: `rgba(${this._hexToRgb(tc?.negWire||'#bdbdbd')},${a})` }));
        }
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveform(dt) {
        if (!this._wavH2) return;
        this._wavAcc += 1.2 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;
        for (let i = 0; i < steps; i++) {
            this._wavT   = new Float32Array([...this._wavT.slice(1),   this.temperature]);
            this._wavEmf = new Float32Array([...this._wavEmf.slice(1), this.emfTotal]);
        }

        const wx = this._wavX+3, ww = this._wavW-6;
        const n  = this._wavLen, dx = ww/n, h2 = this._wavH2;
        const tRange = this.tempRangeHi - this.tempRangeLo + 0.01;
        const emfRange= Math.max(0.001, this._calcEMF(this.tcType, this.tempRangeHi) - this._calcEMF(this.tcType, this.tempRangeLo));
        const aT = h2*0.42, aE = h2*0.40;

        const tPts=[], ePts=[];
        for (let i = 0; i < n; i++) {
            const x = wx + i*dx;
            const tN = (this._wavT[i]-this.tempRangeLo)/tRange;
            const eN = this._wavEmf[i]/emfRange;
            tPts.push(x, this._wavMidT - (tN*2-1)*aT);
            ePts.push(x, this._wavMidE - (eN*2-1)*aE);
        }
        if (this._wLineT) this._wLineT.points(tPts);
        if (this._wLineE) this._wLineE.points(ePts);
        if (this._wTLbl) this._wTLbl.text(`${this.temperature.toFixed(1)}°C`);
        if (this._wELbl) this._wELbl.text(`${this.emfTotal.toFixed(4)}mV`);
    }

    // ── LCD 刷新 ─────────────────────────────
    _tickDisplay() {
        const T  = this.temperature;
        const mc = this.alarmHi ? '#ef5350' : this.alarmLo ? '#42a5f5' : '#ff5722';
        const tc = this._tcDB[this.tcType];

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(T.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdEmf)  this._lcdEmf.text(`${this.emfTotal.toFixed(3)}mV`);
        if (this._lcdMA)   this._lcdMA.text(`${this.outputMA.toFixed(2)}mA`);
        if (this._lcdType) this._lcdType.text(`${this.tcType}型`);
    }

    // ═══════════════════════════════════════════
    update(temp) {
        if (typeof temp === 'number') this._manualTemp = Math.max(-270, Math.min(1850, temp));
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'id',           type: 'text'   },
            { label: '分度号',                 key: 'tcType',       type: 'select',
              options: ['K','J','T','E','S'].map(t=>({label:`${t}型 (${this._tcDB[t]?.name||t})`,value:t})) },
            { label: '冷端温度 Tc (°C)',        key: 'coldJunctT',   type: 'number' },
            { label: '量程下限 (°C)',           key: 'tempRangeLo',  type: 'number' },
            { label: '量程上限 (°C)',           key: 'tempRangeHi',  type: 'number' },
            { label: '高温报警 (°C)',           key: 'hiAlarm',      type: 'number' },
            { label: '低温报警 (°C)',           key: 'loAlarm',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.tcType      = cfg.tcType      || this.tcType;
        this.coldJunctT  = parseFloat(cfg.coldJunctT)  ?? this.coldJunctT;
        this.tempRangeLo = parseFloat(cfg.tempRangeLo) ?? this.tempRangeLo;
        this.tempRangeHi = parseFloat(cfg.tempRangeHi) || this.tempRangeHi;
        this.hiAlarm     = parseFloat(cfg.hiAlarm)     || this.hiAlarm;
        this.loAlarm     = parseFloat(cfg.loAlarm)     ?? this.loAlarm;
        this.config      = { ...this.config, ...cfg };
        this._updateWireColors();
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}