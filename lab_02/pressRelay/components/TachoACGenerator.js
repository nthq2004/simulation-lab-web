import { BaseComponent } from './BaseComponent.js';

/**
 * 交流测速发电机仿真组件（AC Tachogenerator / AC Tacho）
 *
 * ── 工作原理 ─────────────────────────────────────────────────
 *  交流测速发电机本质是一台小型交流发电机（同步/感应型）：
 *
 *  励磁绕组（定子）通以固定频率/幅度的参考交流电（励磁电压）；
 *  输出绕组（转子）因转子旋转而产生感应电动势：
 *
 *    e(t) = E₀ · sin(2π·f·t + φ)
 *
 *  其中：
 *    E₀  — 感应 EMF 幅值 (V)，正比于转速 n
 *    f   — 输出频率 (Hz)，等于励磁频率（同步型）
 *          或正比于转速（感应型）
 *    φ   — 相位偏移，随转速变化
 *
 *  感应型（杯形转子）交流测速发电机：
 *    E₀ = K·n     (输出幅值正比于转速)
 *    f  = f_ref   (频率等于励磁频率，固定)
 *    φ  = arctan(n·Kφ)  (相位随转速变化)
 *
 *  同步型（永磁转子）交流测速发电机：
 *    E₀ = K·n
 *    f  = p·n/60  (p = 极对数)
 *    输出频率正比于转速
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 定子/转子截面动画（磁场旋转可视化）
 *  ② 转子线圈磁通变化动画
 *  ③ 多通道示波器：
 *     - 励磁电压 V_ref（参考正弦，固定频率幅度）
 *     - 输出 EMF  V_out（幅度/频率随转速变化）
 *     - 李萨如图（V_ref vs V_out，显示相位关系）
 *  ④ 仪表头：转速 + 输出幅值 + 输出频率 + 相位差
 *  ⑤ 内部等效电路（励磁绕组 + 输出绕组 + 等效阻抗）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_ref_p  — 励磁参考电压正极
 *  wire_ref_n  — 励磁参考电压负极
 *  wire_out_p  — 输出 EMF 正极
 *  wire_out_n  — 输出 EMF 负极
 *
 * ── 气路求解器集成 ───────────────────────────────────────────
 *  special = 'none'
 *  update(rpm) — 外部注入转速（rpm）
 *  targetId    — 自动绑定气动马达 rpm
 */
export class ACTachogenerator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 400);
        this.height = Math.max(320, config.height || 360);

        this.type    = 'ac_tachogenerator';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 发电机参数 ──
        this.tachoType    = config.tachoType    || 'induction';  // 'induction' | 'synchronous'
        this.polePairs    = config.polePairs    || 2;    // 极对数 p
        this.kEMF         = config.kEMF         || 0.05; // 感应系数 K (V/rpm)
        this.refFreq      = config.refFreq      || 400;  // 励磁频率 Hz（感应型固定）
        this.refAmplitude = config.refAmplitude || 10;   // 励磁幅值 V
        this.maxRpm       = config.maxRpm        || 3000; // 最大转速 rpm
        this.rCoil        = config.rCoil         || 50;   // 绕组电阻 Ω
        this.lCoil        = config.lCoil         || 0.1;  // 绕组电感 H
        this.targetId     = config.targetId      || null;

        // ── 状态 ──
        this.rpm          = 0;
        this.direction    = 1;      // 1=正转 -1=反转
        this._manualRpm   = 0;
        this.isBreak      = false;
        this.powered      = true;   // 无源发电机，始终"有电"

        // ── 电气量 ──
        this.outAmplitude = 0;  // V（峰值）
        this.outFrequency = 0;  // Hz
        this.phaseShift   = 0;  // rad（相位差）
        this.outRMS       = 0;  // V rms

        // ── 动画 ──
        this._rotorAngle  = 0;  // rad
        this._refPhase    = 0;  // 参考相位
        this._outPhase    = 0;  // 输出相位
        this._knobAngle   = 0;

        // ── 波形缓冲 ──
        this._wavLen      = 300;
        this._wavRef      = new Float32Array(this._wavLen).fill(0);
        this._wavOut      = new Float32Array(this._wavLen).fill(0);
        this._wavAcc      = 0;

        // ── 李萨如缓冲 ──
        this._lissLen     = 300;
        this._lissRef     = new Float32Array(this._lissLen).fill(0);
        this._lissOut     = new Float32Array(this._lissLen).fill(0);
        this._lissPtr     = 0;

        this._lastTs      = null;
        this._animId      = null;
        this.knobs        = {};

        // ── 几何布局 ──
        // 发电机截面（左上）
        this._genCX   = Math.round(this.width  * 0.22);
        this._genCY   = Math.round(this.height * 0.30);
        this._genR    = Math.round(Math.min(this.width, this.height) * 0.16);

        // 等效电路（左下）
        this._circX   = 6;
        this._circY   = this._genCY + this._genR + 24;
        this._circW   = Math.round(this.width * 0.44);
        this._circH   = Math.round(this.height * 0.22);

        // 仪表头（右上）
        this._headX   = Math.round(this.width * 0.48);
        this._headY   = 28;
        this._headW   = this.width - this._headX - 8;
        this._headH   = Math.round(this.height * 0.38);

        // 波形区（中下）
        this._wavX    = 6;
        this._wavY    = Math.round(this.height * 0.56);
        this._wavW    = Math.round(this.width * 0.64);
        this._wavH    = Math.round(this.height * 0.38);

        // 李萨如图（右下）
        this._lissX   = this._wavX + this._wavW + 8;
        this._lissY   = this._wavY;
        this._lissW   = this.width - this._lissX - 6;
        this._lissH   = this._wavH;

        this.config = {
            id: this.id, tachoType: this.tachoType,
            polePairs: this.polePairs, kEMF: this.kEMF,
            refFreq: this.refFreq, maxRpm: this.maxRpm,
        };

        this._init();

        const py = this._headY;
        this.addPort(0,           this._genCY - 8, 'ref_p', 'wire', 'REF+');
        this.addPort(0,           this._genCY + 8, 'ref_n', 'wire', 'REF−');
        this.addPort(this.width,  py + 14,         'out_p', 'wire', 'OUT+');
        this.addPort(this.width,  py + 34,         'out_n', 'wire', 'OUT−');
    }

    // ═════════════════════════════════════════════
    //  初始化
    // ═════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawGeneratorShell();
        this._drawStaticCoils();
        this._drawRotorGroup();
        this._drawMagFieldLayer();
        this._drawEquivCircuit();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnob();
        this._drawWaveformArea();
        this._drawLissajous();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '交流测速发电机（AC Tachogenerator）',
            fontSize: 13, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 发电机外壳（定子圆环）────────────────
    _drawGeneratorShell() {
        const cx = this._genCX, cy = this._genCY, R = this._genR;

        // 铸铁外壳
        const outerShell = new Konva.Circle({ x: cx, y: cy, radius: R + 12, fill: '#546e7a', stroke: '#263238', strokeWidth: 2.5 });
        const outerRing  = new Konva.Ring({   x: cx, y: cy, innerRadius: R + 2, outerRadius: R + 12, fill: '#455a64' });
        // 安装螺孔
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const bx = cx + (R + 8) * Math.cos(a), by = cy + (R + 8) * Math.sin(a);
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4, fill: '#263238', stroke: '#1a252f', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: bx - 1, y: by - 1, radius: 1.2, fill: 'rgba(255,255,255,0.25)' }));
        }
        // 定子铁芯（带槽）
        const statorRing = new Konva.Ring({ x: cx, y: cy, innerRadius: R * 0.62, outerRadius: R, fill: '#607d8b', stroke: '#455a64', strokeWidth: 0.8 });
        // 定子槽（12个）
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            this.group.add(new Konva.Line({
                points: [cx + R * 0.64 * Math.cos(a), cy + R * 0.64 * Math.sin(a), cx + R * 0.96 * Math.cos(a), cy + R * 0.96 * Math.sin(a)],
                stroke: '#37474f', strokeWidth: 2,
            }));
        }
        // 气隙
        this.group.add(new Konva.Ring({ x: cx, y: cy, innerRadius: R * 0.58, outerRadius: R * 0.62, fill: 'rgba(100,150,200,0.08)' }));

        this.group.add(outerShell, outerRing, statorRing);
    }

    // ── 定子线圈（静止，励磁绕组+输出绕组）──
    _drawStaticCoils() {
        const cx = this._genCX, cy = this._genCY, R = this._genR;

        // 励磁绕组（红色，水平方向）
        const excCoilPts = [];
        const excCoil = new Konva.Rect({ x: cx - R * 0.55, y: cy - 8, width: R * 1.1, height: 16, fill: 'none' });
        for (let side of [-1, 1]) {
            this.group.add(new Konva.Rect({
                x: cx + side * R * 0.85 - 5, y: cy - 10,
                width: 10, height: 20,
                fill: '#c62828', stroke: '#b71c1c', strokeWidth: 1, cornerRadius: 2,
            }));
        }
        this.group.add(new Konva.Text({ x: cx - 10, y: cy - R * 0.95, text: '励磁', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a' }));

        // 输出绕组（蓝色，垂直方向）
        for (let side of [-1, 1]) {
            this.group.add(new Konva.Rect({
                x: cx - 10, y: cy + side * R * 0.85 - 5,
                width: 20, height: 10,
                fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1, cornerRadius: 2,
            }));
        }
        this.group.add(new Konva.Text({ x: cx + R * 0.62, y: cy + 4, text: '输出', fontSize: 8, fontStyle: 'bold', fill: '#90caf9' }));
    }

    // ── 转子组（动画）─────────────────────────
    _drawRotorGroup() {
        const cx = this._genCX, cy = this._genCY, R = this._genR;
        this._rotorGroup = new Konva.Group({ x: cx, y: cy });

        // 转子铁芯
        const rotorCore = new Konva.Circle({ radius: R * 0.56, fill: '#78909c', stroke: '#546e7a', strokeWidth: 1 });
        // 杯形转子（空心铝杯，浅色）—— 感应型
        const rotorCup = new Konva.Ring({ innerRadius: R * 0.35, outerRadius: R * 0.56, fill: 'rgba(200,220,235,0.25)', stroke: '#90a4ae', strokeWidth: 0.5 });
        // 转子绕组（线圈）
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            this._rotorGroup.add(new Konva.Line({
                points: [R * 0.12 * Math.cos(a), R * 0.12 * Math.sin(a), R * 0.5 * Math.cos(a + 0.3), R * 0.5 * Math.sin(a + 0.3)],
                stroke: '#c0a020', strokeWidth: 2.5, lineCap: 'round',
            }));
        }
        // 轮毂
        const hub   = new Konva.Circle({ radius: R * 0.12, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 });
        const shaft = new Konva.Circle({ radius: R * 0.05, fill: '#1a252f' });
        // 高光
        const glint = new Konva.Circle({ x: -R * 0.06, y: -R * 0.06, radius: R * 0.025, fill: 'rgba(255,255,255,0.35)' });

        this._rotorGroup.add(rotorCore, rotorCup, hub, shaft, glint);
        this.group.add(this._rotorGroup);
    }

    // ── 磁场线动画层 ──────────────────────────
    _drawMagFieldLayer() {
        this._magFieldGroup = new Konva.Group();
        this.group.add(this._magFieldGroup);
    }

    // ── 等效电路图 ────────────────────────────
    _drawEquivCircuit() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.2, cornerRadius: 3 });
        this.group.add(new Konva.Text({ x: cx2+2, y: cy2+3, width: cw-4, text: '等效电路', fontSize: 8, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));

        const y1 = cy2 + 16, y2 = cy2 + ch - 8;
        const x1 = cx2 + 8, x2 = cx2 + cw * 0.48, x3 = cx2 + cw - 10;

        // 励磁回路（顶部）
        this.group.add(new Konva.Line({ points: [x1, y1, x3, y1], stroke: '#c62828', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: x1+2, y: y1-8, text: 'V_ref', fontSize: 7, fill: '#ef9a9a' }));
        // 励磁电感线圈
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Arc({ x: x1 + 20 + i * 9, y: y1, innerRadius: 3, outerRadius: 5, angle: 180, rotation: 90, fill: 'none', stroke: '#c62828', strokeWidth: 1 }));
        }
        this.group.add(new Konva.Text({ x: x1+18, y: y1+5, text: 'Lf', fontSize: 7, fill: '#c62828' }));

        // 互感（中间虚线）
        this.group.add(new Konva.Line({ points: [x2, y1+6, x2, y2-6], stroke: '#ffd54f', strokeWidth: 1, dash: [3,2] }));
        this.group.add(new Konva.Text({ x: x2+2, y: (y1+y2)/2-4, text: 'M', fontSize: 8, fill: '#ffd54f' }));

        // 输出回路（底部）
        this.group.add(new Konva.Line({ points: [x1, y2, x3, y2], stroke: '#1565c0', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: x1+2, y: y2+2, text: 'V_out', fontSize: 7, fill: '#90caf9' }));
        // 输出阻抗
        for (let i = 0; i < 3; i++) {
            this.group.add(new Konva.Line({ points: [x1+30+i*7, y2-3, x1+30+i*7+4, y2, x1+30+i*7+8, y2-3, x1+30+i*7+8, y2+3], stroke: '#1565c0', strokeWidth: 1 }));
        }
        this.group.add(new Konva.Text({ x: x1+28, y: y2-10, text: 'Ro', fontSize: 7, fill: '#1565c0' }));

        // EMF 源（右侧）
        this._circEMFLabel = new Konva.Text({ x: x3-20, y: (y1+y2)/2-4, text: 'E₀\n=0V', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center', lineHeight: 1.3, width: 24 });
        this.group.add(bg, this._circEMFLabel);
    }

    // ── 仪表头 ─────────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 40, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 24, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'TG-001', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+18, width: hw-16, text: 'AC TACHO  400Hz', fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 10, height: 36, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+3, width: 10, height: 36, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+40, width: hw, height: hh-40, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 40 + (this._headH - 40) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 44);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#7f0000', stroke: '#c62828', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        // 幅值弧
        this._ampArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ef9a9a', rotation: -90 });

        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'0',    fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#ef9a9a', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'rpm',  fontSize:R*.17, fill:'#7f0000', align:'center' });
        this._lcdAmp    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.31, width:(R-4)*2, text:'E=0V', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdFreq   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.58, width:(R-4)*2, text:'400Hz',fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdPhase  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.49, width:(R-4)*2, text:'φ=0°', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._ampArc, this._lcdMain, this._lcdUnit, this._lcdAmp, this._lcdFreq, this._lcdPhase);
    }

    // ── 调速旋钮 ──────────────────────────────
    _drawKnob() {
        const hx = this._headX, hw = this._headW;
        const kx = hx + hw / 2, ky = this._lcCY + this._lcR + 16;

        const base = new Konva.Circle({ x: kx, y: ky, radius: 18, fill: '#263238', stroke: '#1a252f', strokeWidth: 1.5 });
        this._knobRotor = new Konva.Group({ x: kx, y: ky });
        this._knobRotor.add(
            new Konva.Circle({ radius: 14, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }),
            new Konva.Line({ points: [0, -12, 0, -4], stroke: '#ef9a9a', strokeWidth: 3, lineCap: 'round' }),
        );
        const kLbl = new Konva.Text({ x: kx-18, y: ky+20, width: 36, text: '调速', fontSize: 9, fill: '#546e7a', align: 'center' });

        this._knobRotor.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const sY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            const sA = this._knobAngle;
            const mv = me => {
                const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                this._knobAngle = Math.max(-150, Math.min(150, sA + (sY - cy) * 1.8));
                this._knobRotor.rotation(this._knobAngle);
                this._manualRpm = Math.max(0, Math.min(this.maxRpm, ((this._knobAngle + 150) / 300) * this.maxRpm));
            };
            const up = () => {
                window.removeEventListener('mousemove', mv);
                window.removeEventListener('touchmove', mv);
                window.removeEventListener('mouseup', up);
                window.removeEventListener('touchend', up);
            };
            window.addEventListener('mousemove', mv);
            window.addEventListener('touchmove', mv);
            window.addEventListener('mouseup', up);
            window.addEventListener('touchend', up);
        });
        this.group.add(base, this._knobRotor, kLbl);
    }

    // ── 三通道波形区 ──────────────────────────
    _drawWaveformArea() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '电压波形  ── 励磁 V_ref  ── 输出 V_out', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a', align: 'center' }));

        for (let i = 1; i < 4; i++) this.group.add(new Konva.Line({ points: [wx, wy+wh*i/4, wx+ww, wy+wh*i/4], stroke: 'rgba(239,154,154,0.07)', strokeWidth: 0.5 }));
        for (let i = 1; i < 5; i++) this.group.add(new Konva.Line({ points: [wx+ww*i/5, wy, wx+ww*i/5, wy+wh], stroke: 'rgba(239,154,154,0.05)', strokeWidth: 0.5 }));

        // 双通道中线
        this._wavMidRef = wy + wh * 0.25;
        this._wavMidOut = wy + wh * 0.75;
        [this._wavMidRef, this._wavMidOut].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.12)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineRef = new Konva.Line({ points: [], stroke: '#c62828', strokeWidth: 1.5, lineJoin: 'round' });
        this._wLineOut = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.8, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'V_ref (励磁)', fontSize: 8, fill: '#c62828' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+4, text: 'V_out (输出)', fontSize: 8, fill: '#ef9a9a' }));

        this._wRefLbl  = new Konva.Text({ x: wx+ww-80, y: wy+16, width: 76, text: '-- V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#c62828', align: 'right' });
        this._wOutLbl  = new Konva.Text({ x: wx+ww-80, y: wy+wh/2+4, width: 76, text: '-- V', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'right' });
        this._wFreqLbl = new Konva.Text({ x: wx+ww-80, y: wy+wh-12, width: 76, text: '-- Hz', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'right' });

        this.group.add(bg, titleBg, this._wLineRef, this._wLineOut, this._wRefLbl, this._wOutLbl, this._wFreqLbl);
    }

    // ── 李萨如图 ──────────────────────────────
    _drawLissajous() {
        const { _lissX: lx, _lissY: ly, _lissW: lw, _lissH: lh } = this;

        const bg = new Konva.Rect({ x: lx, y: ly, width: lw, height: lh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: lx+2, y: ly+2, width: lw-4, text: 'V_ref vs V_out', fontSize: 8, fontStyle: 'bold', fill: '#ffd54f', align: 'center' }));

        // 十字基准
        const lmx = lx + lw/2, lmy = ly + lh/2;
        this.group.add(new Konva.Line({ points: [lx+2, lmy, lx+lw-2, lmy], stroke: 'rgba(200,200,200,0.10)', strokeWidth: 0.5 }));
        this.group.add(new Konva.Line({ points: [lmx, ly+14, lmx, ly+lh-2], stroke: 'rgba(200,200,200,0.10)', strokeWidth: 0.5 }));
        this.group.add(new Konva.Text({ x: lx+2, y: lmy+2, text: 'X:V_ref', fontSize: 7, fill: '#546e7a' }));
        this.group.add(new Konva.Text({ x: lmx+2, y: ly+16, text: 'Y:V_out', fontSize: 7, fill: '#546e7a' }));

        this._lissLine   = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.2, lineJoin: 'round', opacity: 0.8 });
        this._lissPhiLbl = new Konva.Text({ x: lx+2, y: ly+lh-14, text: 'φ=0°', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f' });

        this.group.add(bg, titleBg, this._lissLine, this._lissPhiLbl);
    }

    // ═════════════════════════════════════════════
    //  动画主循环
    // ═════════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickRotor(dt);
                this._tickMagField();
                this._tickWaveforms(dt);
                this._tickLissajous();
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
        // 读取转速
        let target = this._manualRpm;
        if (this.targetId && this.sys?.comps?.[this.targetId]) {
            const tgt = this.sys.comps[this.targetId];
            if (typeof tgt.rpm === 'number') target = tgt.rpm;
        }
        if (this.isBreak) target = 0;
        this.rpm = target;

        // ── 感应型 AC 测速发电机 ──
        // E₀ = K × n  (幅值正比于转速)
        // f_out = f_ref  (频率固定 = 励磁频率)
        // φ = arctan(n × K_phase)  (相位随转速变化)
        this.outAmplitude = this.kEMF * this.rpm;
        this.outFrequency = this.refFreq;  // 感应型频率固定
        this.phaseShift   = Math.atan2(this.rpm * 0.002, 1); // 简化相位模型

        // RMS
        this.outRMS = this.outAmplitude / Math.SQRT2;

        // 累积相位
        const refOmega = 2 * Math.PI * this.refFreq;
        this._refPhase += refOmega * dt;
        this._outPhase  = this._refPhase + this.phaseShift * this.direction;

        // 齿轮角速度
        const mechOmega = (this.rpm / 60) * 2 * Math.PI * this.direction;
        this._rotorAngle += mechOmega * dt;

        // 幅值弧
        if (this._ampArc) {
            const ratio = Math.min(1, this.outAmplitude / (this.kEMF * this.maxRpm));
            this._ampArc.angle(ratio * 360);
        }

        // 等效电路 EMF 标签
        if (this._circEMFLabel) {
            this._circEMFLabel.text(`E₀\n=${this.outAmplitude.toFixed(1)}V`);
        }
    }

    // ── 转子旋转 ──────────────────────────────
    _tickRotor(dt) {
        if (this._rotorGroup) this._rotorGroup.rotation(this._rotorAngle * 180 / Math.PI);
    }

    // ── 磁场线动画 ────────────────────────────
    _tickMagField() {
        const cx = this._genCX, cy = this._genCY, R = this._genR;
        this._magFieldGroup.destroyChildren();

        // 励磁磁场（垂直方向，红色）
        const excAmp = Math.sin(this._refPhase);
        for (let i = -2; i <= 2; i++) {
            const alpha = Math.max(0, (1 - Math.abs(i) * 0.3) * Math.abs(excAmp) * 0.5);
            this._magFieldGroup.add(new Konva.Line({
                points: [cx + i * 8, cy - R * 0.55, cx + i * 8, cy + R * 0.55],
                stroke: `rgba(198,40,40,${alpha})`, strokeWidth: 1,
            }));
        }
        // 输出磁场（水平方向，蓝色，随转速旋转）
        const outAlpha = Math.min(0.5, this.outAmplitude / (this.kEMF * this.maxRpm + 1) * 0.5);
        if (outAlpha > 0.02) {
            for (let i = -1; i <= 1; i++) {
                const ang = this._rotorAngle + i * 0.2;
                this._magFieldGroup.add(new Konva.Line({
                    points: [cx + R * 0.3 * Math.cos(ang), cy + R * 0.3 * Math.sin(ang), cx - R * 0.3 * Math.cos(ang), cy - R * 0.3 * Math.sin(ang)],
                    stroke: `rgba(21,101,192,${outAlpha})`, strokeWidth: 1.5,
                }));
            }
        }
    }

    // ── 波形缓冲 ──────────────────────────────
    _tickWaveforms(dt) {
        // 滚动速度与励磁频率相关（保持波形可读性）
        const visFreq   = Math.min(4, this.refFreq / 100 + 0.3);
        const scrollSpd = 1.5;
        this._wavAcc += scrollSpd * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        const vRef = this.refAmplitude * Math.sin(this._refPhase);
        const vOut = this.isBreak ? 0 : this.outAmplitude * Math.sin(this._outPhase);

        for (let i = 0; i < steps; i++) {
            this._wavRef = new Float32Array([...this._wavRef.slice(1), vRef]);
            this._wavOut = new Float32Array([...this._wavOut.slice(1), vOut]);
        }

        // 构建波形折线点
        const wx = this._wavX + 3, wy2 = this._wavY;
        const ww = this._wavW - 6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;

        const refAmp = wh * 0.20;
        const outAmp = Math.min(wh * 0.22, (this.outAmplitude / (this.refAmplitude + 0.01)) * wh * 0.22);

        const refPts = [], outPts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            refPts.push(x, this._wavMidRef - (this._wavRef[i] / (this.refAmplitude + 0.01)) * refAmp);
            outPts.push(x, this._wavMidOut - (this.outAmplitude > 0 ? this._wavOut[i] / this.outAmplitude * outAmp : 0));
        }

        if (this._wLineRef) this._wLineRef.points(refPts);
        if (this._wLineOut) this._wLineOut.points(outPts);

        // 标签
        const vRefRMS = this.refAmplitude / Math.SQRT2;
        if (this._wRefLbl) this._wRefLbl.text(`${vRefRMS.toFixed(1)} Vrms`);
        if (this._wOutLbl) this._wOutLbl.text(this.isBreak ? '断线' : `${this.outRMS.toFixed(2)} Vrms`);
        if (this._wFreqLbl) this._wFreqLbl.text(`${this.outFrequency.toFixed(0)} Hz`);
    }

    // ── 李萨如图 ──────────────────────────────
    _tickLissajous() {
        const lx = this._lissX, ly = this._lissY;
        const lw = this._lissW, lh = this._lissH;
        const lmx = lx + lw / 2, lmy = ly + lh / 2;
        const scaleX = (lw * 0.42) / (this.refAmplitude + 0.01);
        const scaleY = (lh * 0.38) / (this.outAmplitude + 0.01);

        const vRef = this.refAmplitude * Math.sin(this._refPhase);
        const vOut = this.isBreak ? 0 : this.outAmplitude * Math.sin(this._outPhase);

        this._lissRef[this._lissPtr] = vRef;
        this._lissOut[this._lissPtr] = vOut;
        this._lissPtr = (this._lissPtr + 1) % this._lissLen;

        // 构建李萨如折线（带消隐，旧点逐渐淡出效果通过分段颜色体现）
        const pts = [];
        for (let i = 0; i < this._lissLen; i++) {
            const idx = (this._lissPtr + i) % this._lissLen;
            pts.push(lmx + this._lissRef[idx] * scaleX, lmy - this._lissOut[idx] * scaleY);
        }
        if (this._lissLine) this._lissLine.points(pts);

        const phiDeg = (this.phaseShift * 180 / Math.PI * this.direction).toFixed(1);
        if (this._lissPhiLbl) this._lissPhiLbl.text(`φ=${phiDeg}°`);
    }

    // ── 显示刷新 ──────────────────────────────
    _tickDisplay() {
        const br = this.isBreak;

        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdUnit.text(''); this._lcdAmp.text(''); this._lcdPhase.text('');
            this._lcdFreq.text('断线');
            return;
        }

        const ratio = this.rpm / this.maxRpm;
        const mc    = ratio > 0.9 ? '#ff5722' : ratio > 0.1 ? '#ef9a9a' : '#c62828';

        this._lcdBg.fill('#020c14');
        this._lcdMain.text(Math.round(this.rpm).toString()); this._lcdMain.fill(mc);
        this._lcdUnit.text('rpm');
        this._lcdAmp.text(`E=${this.outAmplitude.toFixed(2)}V`);
        this._lcdAmp.fill(this.outAmplitude > 0 ? '#80cbc4' : '#37474f');
        this._lcdFreq.text(`${this.outFrequency.toFixed(0)} Hz`);
        this._lcdPhase.text(`φ=${(this.phaseShift * 180 / Math.PI).toFixed(1)}°`);
    }

    // ═════════════════════════════════════════════
    //  外部接口
    // ═════════════════════════════════════════════
    update(rpm, dir) {
        if (typeof rpm === 'number') this._manualRpm = Math.max(0, rpm);
        if (dir === 1 || dir === -1) this.direction = dir;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',          type: 'text'   },
            { label: '感应系数 K (V/rpm)',   key: 'kEMF',        type: 'number' },
            { label: '励磁频率 (Hz)',        key: 'refFreq',     type: 'number' },
            { label: '励磁幅值 (V)',         key: 'refAmplitude',type: 'number' },
            { label: '极对数 p',            key: 'polePairs',   type: 'number' },
            { label: '最大转速 (rpm)',       key: 'maxRpm',      type: 'number' },
            { label: '绑定轴组件 ID',        key: 'targetId',    type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        this.id            = cfg.id            || this.id;
        this.kEMF          = parseFloat(cfg.kEMF)          || this.kEMF;
        this.refFreq       = parseFloat(cfg.refFreq)       || this.refFreq;
        this.refAmplitude  = parseFloat(cfg.refAmplitude)  || this.refAmplitude;
        this.polePairs     = parseInt(cfg.polePairs)       || this.polePairs;
        this.maxRpm        = parseFloat(cfg.maxRpm)        || this.maxRpm;
        this.targetId      = cfg.targetId      || null;
        this.config        = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}