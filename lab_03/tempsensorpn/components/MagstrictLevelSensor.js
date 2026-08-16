import { BaseComponent } from './BaseComponent.js';

/**
 * 磁致伸缩液位传感器仿真组件
 * （Magnetostrictive Linear Position / Level Sensor）
 *
 * ── 工作原理（Wiedemann 效应 + 飞行时间法）───────────────────
 *
 *  磁致伸缩原理基于两种物理效应的叠加：
 *
 *  1. Wiedemann 效应（扭转波产生）：
 *     当沿磁致伸缩波导管轴向通过短暂电流脉冲时，
 *     产生环形磁场 H_circ；
 *     该环形磁场与浮子永磁铁的轴向偏置磁场 H_bias 叠加，
 *     在两者交汇区（浮子位置处）产生螺旋磁场，
 *     通过逆磁致伸缩效应激发扭转弹性波（超声波），
 *     扭转波沿波导管向两端传播。
 *
 *  2. 飞行时间（TOF）测量：
 *     发射电流脉冲 t₀（触发时刻）
 *     扭转波到达传感器端 t₁（接收时刻）
 *     传播时间 Δt = t₁ - t₀
 *
 *  位置计算：
 *     L = v_s × Δt / 2    （单程距离）
 *     v_s ≈ 2830 m/s       （磁致伸缩波导中的扭转波速，约为声速的8倍）
 *
 *  液位 H：
 *     H = L_total - L      （L_total = 波导管总长）
 *
 *  分辨率：
 *     ΔL = v_s × Δ(Δt) / 2
 *     典型分辨率 < 0.1 mm（依赖时钟精度）
 *
 * ── 核心优势 ─────────────────────────────────────────────────
 *  ✦ 非接触式——浮子磁铁不与波导管物理接触
 *  ✦ 绝对位置——每次上电即得绝对位置，无需归零
 *  ✦ 高精度——分辨率可达 0.001 mm（微米级）
 *  ✦ 多浮子——单根波导管可同时测量多个浮子位置（界面测量）
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 储罐截面（可拖拽液位）+ 波导管（竖向杆）
 *  ② 浮子（随液面浮动的永磁铁，环形）
 *  ③ 电流脉冲发射动画（沿波导管向下传播，黄色）
 *  ④ 扭转波传播动画（从浮子位置向上传播，青色）
 *  ⑤ 磁场可视化（浮子周围的磁场线 + 波导管磁场）
 *  ⑥ 电子头（顶端，信号处理电路 + 显示）
 *  ⑦ TOF 时序示波器（发射脉冲 + 回波信号）
 *  ⑧ 李萨如 / 相关图（精度可视化）
 *  ⑨ 仪表 LCD（液位值 + 温度 + 状态）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_vcc  — 电源 24VDC
 *  wire_gnd  — 地
 *  wire_out  — 模拟量输出（4-20mA / 0-10V）
 *  wire_rs   — RS-485 数字输出
 *
 * ── 气路求解器集成 ────────────────────────────────────────────
 *  special = 'none'
 *  update(level) — 外部注入液位 mm（0 ~ L_total×1000）
 */
export class MagnetoStrictiveLevelSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 380);
        this.height = Math.max(340, config.height || 380);

        this.type    = 'magneto_level';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 传感器技术参数 ──
        this.totalLength  = config.totalLength  || 2000;   // 波导管总长 mm
        this.waveSpeed    = config.waveSpeed    || 2830;   // 扭转波速 m/s
        this.outputMode   = config.outputMode   || '4-20'; // '4-20' | '0-10V' | 'RS485'
        this.resolution   = config.resolution   || 0.1;    // 分辨率 mm
        this.pulseInterval= config.pulseInterval|| 0.05;   // 脉冲发射周期 s
        this.hiAlarm      = config.hiAlarm      || 85;     // 高报 %
        this.loAlarm      = config.loAlarm      || 15;     // 低报 %
        this.multiFloat   = config.multiFloat   || false;  // 双浮子模式（界面测量）

        // ── 状态 ──
        this.liquidLevel  = config.initLevel    || 50;     // 液位 % (0~100)
        this._manualLevel = config.initLevel    || 50;
        this.levelMM      = 0;    // mm
        this.tof          = 0;    // μs（飞行时间）
        this.outCurrent   = 12;   // mA
        this.outVoltage   = 5;    // V
        this.isBreak      = false;
        this.powered      = true;
        this.alarmHi      = false;
        this.alarmLo      = false;

        // 界面浮子（双浮子模式）
        this.interface2   = config.initInterface || 30;    // 第二浮子位置 %

        // ── 动画状态 ──
        this._pulsePhase      = 0;     // 电流脉冲传播相位（0~1）
        this._tofPhase        = 0;     // 扭转波传播相位
        this._pulseTimer      = 0;     // 脉冲发射计时器
        this._pulseActive     = false; // 电流脉冲正在传播
        this._tofActive       = false; // 扭转波正在传播
        this._tofLaunched     = false; // 扭转波已发射
        this._receiveFlash    = 0;     // 接收时闪光计时
        this._floatBob        = 0;     // 浮子上下浮动相位（模拟波动）
        this._magRotPhase     = 0;     // 磁场旋转相位

        // ── TOF 波形缓冲 ──
        this._wavLen      = 260;
        this._wavPulse    = new Uint8Array(this._wavLen).fill(0);    // 发射脉冲
        this._wavEcho     = new Float32Array(this._wavLen).fill(0);  // 回波信号
        this._wavPos      = new Float32Array(this._wavLen).fill(0);  // 位置曲线
        this._wavAcc      = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartL  = 0;

        // ── 几何布局 ──
        // 储罐区（左侧主体）
        this._tankX   = 14;
        this._tankY   = 30;
        this._tankW   = Math.round(this.width  * 0.42);
        this._tankH   = Math.round(this.height * 0.62);

        // 电子头（储罐顶部）
        this._headCX  = this._tankX + this._tankW / 2;
        this._headY   = this._tankY - 30;

        // 波导管位置（储罐中央）
        this._rodX    = this._tankX + this._tankW / 2;
        this._rodTop  = this._tankY + 4;
        this._rodBot  = this._tankY + this._tankH - 6;

        // 液面动态区
        this._innerX  = this._tankX + 10;
        this._innerY  = this._tankY + 10;
        this._innerW  = this._tankW - 20;
        this._innerH  = this._tankH - 10;

        // TOF 示波器（右上）
        this._tofX    = this._tankX + this._tankW + 12;
        this._tofY    = this._tankY;
        this._tofW    = this.width - this._tofX - 8;
        this._tofH    = Math.round(this.height * 0.36);

        // 仪表 LCD（右中）
        this._lcdX    = this._tofX;
        this._lcdY    = this._tofY + this._tofH + 10;
        this._lcdW    = this._tofW;
        this._lcdH    = Math.round(this.height * 0.24);

        // 位置波形（右下）
        this._posX    = this._tofX;
        this._posY    = this._lcdY + this._lcdH + 8;
        this._posW    = this._tofW;
        this._posH    = this.height - this._posY - 6;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, totalLength: this.totalLength,
            waveSpeed: this.waveSpeed, outputMode: this.outputMode,
        };

        this._init();

        const hcx = this._headCX;
        this.addPort(this.width, this._lcdY + 14,  'vcc',  'wire', 'V+');
        this.addPort(this.width, this._lcdY + 34,  'gnd',  'wire', 'GND');
        this.addPort(this.width, this._lcdY + 58,  'out',  'wire', '4-20');
        this.addPort(this.width, this._lcdY + 78,  'rs',   'wire', 'RS485');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawTankBody();
        this._drawScaleTicks();
        this._drawElectronicsHead();
        this._drawWaveguideRod();
        this._drawLiquidLayer();
        this._drawFloatMagnet();
        this._drawPulseLayer();   // 动态层：电流脉冲
        this._drawTofWaveLayer(); // 动态层：扭转波
        this._drawMagFieldLayer();// 动态层：磁场
        this._drawTofOscilloscope();
        this._drawLCDPanel();
        this._drawPositionWave();
        this._drawBottomPanel();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '磁致伸缩液位传感器（TOF · Wiedemann效应）',
            fontSize: 12.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 储罐外壳 ────────────────────────────
    _drawTankBody() {
        const { _tankX: tx, _tankY: ty, _tankW: tw, _tankH: th } = this;
        const wall = 10;

        // 外壳
        const outer = new Konva.Rect({ x: tx, y: ty, width: tw, height: th, fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: [4,4,2,2] });
        // 顶盖
        const topCap = new Konva.Rect({ x: tx, y: ty, width: tw, height: wall, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1 });
        // 内腔
        this._innerCav = new Konva.Rect({ x: this._innerX, y: this._innerY, width: this._innerW, height: this._innerH, fill: '#0d1a2a' });
        // 底板
        const botCap = new Konva.Rect({ x: tx, y: ty+th, width: tw, height: 6, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1, cornerRadius: [0,0,3,3] });
        // 顶部高光
        this.group.add(new Konva.Rect({ x: tx, y: ty, width: tw, height: 4, fill: 'rgba(255,255,255,0.10)', cornerRadius: [4,4,0,0] }));

        // 螺孔
        [[tx+8,ty+8],[tx+tw-8,ty+8],[tx+8,ty+th-8],[tx+tw-8,ty+th-8]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4, fill: '#263238', stroke: '#1a252f', strokeWidth: 0.5 }));
        });

        // 量程刻度（右侧）
        for (let i = 0; i <= 10; i++) {
            const ly = ty + wall + (this._innerH * i) / 10;
            const isMajor = i % 5 === 0;
            this.group.add(new Konva.Line({ points: [tx+tw, ly, tx+tw+(isMajor?10:5), ly], stroke: '#78909c', strokeWidth: isMajor?1.2:0.7 }));
            if (isMajor) this.group.add(new Konva.Text({ x: tx+tw+12, y: ly-6, text: `${100-i*10}%`, fontSize: 8, fill: '#607d8b' }));
        }
        // 报警线
        const hiY = ty+wall + this._innerH*(1-this.hiAlarm/100);
        const loY = ty+wall + this._innerH*(1-this.loAlarm/100);
        this._hiLine = new Konva.Line({ points: [tx+wall, hiY, tx+tw-wall, hiY], stroke: 'rgba(239,83,80,0.45)', strokeWidth: 1, dash: [5,3] });
        this._loLine = new Konva.Line({ points: [tx+wall, loY, tx+tw-wall, loY], stroke: 'rgba(255,152,0,0.45)',  strokeWidth: 1, dash: [5,3] });

        this.group.add(outer, topCap, this._innerCav, botCap, this._hiLine, this._loLine);
    }

    // ── 刻度 ────────────────────────────────
    _drawScaleTicks() {
        // 已在 _drawTankBody 绘制，此处保留供子类扩展
    }

    // ── 电子头（顶端信号处理模块）───────────
    _drawElectronicsHead() {
        const cx = this._headCX;
        const hy = this._headY;
        const hw = this._tankW * 0.52, hh = 28;

        // 外壳
        const headBody = new Konva.Rect({ x: cx-hw/2, y: hy, width: hw, height: hh, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: 4 });
        // 铭牌
        const plate = new Konva.Rect({ x: cx-hw/2+6, y: hy+4, width: hw-12, height: 14, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._headIdText = new Konva.Text({ x: cx-hw/2+6, y: hy+7, width: hw-12, text: this.id || 'LT-MS01', fontSize: 8.5, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: cx-hw/2+6, y: hy+17, width: hw-12, text: 'MAGNETO LEVEL', fontSize: 7, fill: '#78909c', align: 'center' }));
        // LED 状态灯
        this._statusLed = new Konva.Circle({ x: cx+hw/2-10, y: hy+14, radius: 4, fill: '#1a1a1a' });
        // 电缆密封头（两侧）
        [[cx-hw/2-6, '#546e7a'], [cx+hw/2-2, '#546e7a']].forEach(([lx, col]) => {
            this.group.add(new Konva.Rect({ x: lx, y: hy+8, width: 8, height: 12, fill: col, stroke: '#37474f', strokeWidth: 1, cornerRadius: 2 }));
        });
        // 连接到仪表头的导线
        this.group.add(new Konva.Line({
            points: [cx+hw/2-2, hy+14, this._lcdX, hy+14, this._lcdX, this._lcdY+14],
            stroke: '#546e7a', strokeWidth: 1.5, dash: [3,2],
        }));
        this.group.add(headBody, plate, this._headIdText, this._statusLed);
    }

    // ── 波导管（中央金属杆）────────────────
    _drawWaveguideRod() {
        const rx = this._rodX;
        const rt = this._rodTop, rb = this._rodBot;

        // 波导管外套管（保护管，浅灰）
        this.group.add(new Konva.Rect({ x: rx-5, y: rt, width: 10, height: rb-rt, fill: '#b0bec5', stroke: '#90a4ae', strokeWidth: 0.5, cornerRadius: 2 }));
        // 磁致伸缩芯线（中央金色细线）
        this._waveguideWire = new Konva.Line({ points: [rx, rt, rx, rb], stroke: '#c0a020', strokeWidth: 2, lineCap: 'round' });
        // 端部吸波阻尼（底部黑块，防止回波反射）
        this.group.add(new Konva.Rect({ x: rx-6, y: rb-8, width: 12, height: 10, fill: '#1a1a1a', stroke: '#263238', strokeWidth: 0.5, cornerRadius: 2 }));
        this.group.add(new Konva.Text({ x: rx-18, y: rb+4, text: '阻尼端', fontSize: 7.5, fill: '#546e7a' }));
        // 顶端发射线圈
        this.group.add(new Konva.Rect({ x: rx-7, y: rt-2, width: 14, height: 14, fill: '#f57f17', stroke: '#e65100', strokeWidth: 1, cornerRadius: 3 }));
        this.group.add(new Konva.Text({ x: rx-16, y: rt-14, text: '发射线圈', fontSize: 7.5, fill: '#ff8f00' }));
        // 接收拾振器（波导管顶端，稍低于发射线圈）
        this._pickupCoil = new Konva.Rect({ x: rx-5, y: rt+15, width: 10, height: 8, fill: '#26c6da', stroke: '#0097a7', strokeWidth: 1, cornerRadius: 2 });
        this.group.add(new Konva.Text({ x: rx+8, y: rt+15, text: '拾振器', fontSize: 7.5, fill: '#4dd0e1' }));
        this.group.add(this._waveguideWire, this._pickupCoil);

        // 标注：波导管
        this.group.add(new Konva.Text({ x: rx-20, y: (rt+rb)/2-8, text: '波\n导\n管', fontSize: 7.5, fill: '#80cbc4', lineHeight: 1.4 }));
    }

    // ── 液体层（动态）──────────────────────
    _drawLiquidLayer() {
        this._liquidRect = new Konva.Rect({ x: this._innerX, y: this._innerY, width: this._innerW, height: 0, fill: '#1e88e5', opacity: 0.72 });
        this._liquidSurf = new Konva.Rect({ x: this._innerX, y: this._innerY, width: this._innerW, height: 4, fill: 'rgba(255,255,255,0.22)' });
        this._rippleGroup = new Konva.Group();
        this.group.add(this._liquidRect, this._liquidSurf, this._rippleGroup);
    }

    // ── 浮子（环形永磁铁）──────────────────
    _drawFloatMagnet() {
        const rx = this._rodX;
        const floatW = 24, floatH = 14;

        this._floatGroup = new Konva.Group();

        // 环形浮子壳（蓝色塑料外壳）
        const floatBody = new Konva.Rect({ x: -floatW/2, y: -floatH/2, width: floatW, height: floatH, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1.5, cornerRadius: [2,2,3,3] });
        // 中心孔（套在波导管上）
        const holeBg = new Konva.Rect({ x: -5, y: -floatH/2-1, width: 10, height: floatH+2, fill: '#0a1a2a', cornerRadius: 1 });
        // 永磁铁极性标注（N 上 S 下，产生轴向偏置磁场）
        const nPole = new Konva.Rect({ x: -floatW/2+2, y: -floatH/2+1, width: 8, height: 5, fill: '#ef5350', stroke: '#c62828', strokeWidth: 0.5, cornerRadius: 1 });
        const sPole = new Konva.Rect({ x: -floatW/2+2, y: floatH/2-6, width: 8, height: 5, fill: '#42a5f5', stroke: '#1565c0', strokeWidth: 0.5, cornerRadius: 1 });
        const nText = new Konva.Text({ x: -floatW/2+3, y: -floatH/2+2, text: 'N', fontSize: 8, fontStyle: 'bold', fill: '#fff' });
        const sText = new Konva.Text({ x: -floatW/2+3, y: floatH/2-5, text: 'S', fontSize: 8, fontStyle: 'bold', fill: '#fff' });
        // 高光
        this._floatGroup.add(floatBody, holeBg, nPole, sPole, nText, sText);
        this._floatGroup.add(new Konva.Circle({ x: -floatW/2+6, y: -4, radius: 2, fill: 'rgba(255,255,255,0.3)' }));
        this._floatGroup.x(rx); this._floatGroup.y(this._rodTop + 20);

        // 浮子标注
        this._floatLabel = new Konva.Text({ x: rx + 16, y: 0, text: '浮子(永磁铁)', fontSize: 8, fill: '#42a5f5' });

        this.group.add(this._floatGroup, this._floatLabel);

        // 双浮子（界面测量用）
        if (this.multiFloat) {
            this._floatGroup2 = this._floatGroup.clone();
            this._floatGroup2.y(this._rodTop + 60);
            this.group.add(this._floatGroup2);
        }
    }

    // ── 电流脉冲层（动态）────────────────
    _drawPulseLayer() {
        this._pulseGroup = new Konva.Group();
        this.group.add(this._pulseGroup);
    }

    // ── 扭转波层（动态）──────────────────
    _drawTofWaveLayer() {
        this._tofWaveGroup = new Konva.Group();
        this.group.add(this._tofWaveGroup);
    }

    // ── 磁场层（动态）────────────────────
    _drawMagFieldLayer() {
        this._magGroup = new Konva.Group();
        this.group.add(this._magGroup);
    }

    // ── TOF 时序示波器（右上）────────────
    _drawTofOscilloscope() {
        const { _tofX: ox, _tofY: oy, _tofW: ow, _tofH: oh } = this;

        const bg = new Konva.Rect({ x: ox, y: oy, width: ow, height: oh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: ox, y: oy, width: ow, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: ox+4, y: oy+2, width: ow-8, text: 'TOF 时序  发射脉冲 ── 扭转波回波', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center' }));

        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [ox, oy+oh*i/3, ox+ow, oy+oh*i/3], stroke: 'rgba(128,203,196,0.07)', strokeWidth: 0.5 }));
        for (let i = 1; i < 5; i++) this.group.add(new Konva.Line({ points: [ox+ow*i/5, oy, ox+ow*i/5, oy+oh], stroke: 'rgba(128,203,196,0.05)', strokeWidth: 0.5 }));

        this._tofMidPulse = oy + oh * 0.24;
        this._tofMidEcho  = oy + oh * 0.72;
        [this._tofMidPulse, this._tofMidEcho].forEach(my => {
            this.group.add(new Konva.Line({ points: [ox+2, my, ox+ow-2, my], stroke: 'rgba(200,200,200,0.10)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._tofLinePulse = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.8, lineJoin: 'miter', lineCap: 'square' });
        this._tofLineEcho  = new Konva.Line({ points: [], stroke: '#4dd0e1', strokeWidth: 1.6, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: ox+4, y: oy+16, text: '发射', fontSize: 8, fill: '#ffd54f' }));
        this.group.add(new Konva.Text({ x: ox+4, y: oy+oh/2+4, text: '回波', fontSize: 8, fill: '#4dd0e1' }));

        this._tofTofLabel = new Konva.Text({ x: ox+ow-100, y: oy+16, width: 96, text: 'Δt=-- μs', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'right' });
        this._tofPosLabel = new Konva.Text({ x: ox+ow-100, y: oy+26, width: 96, text: 'L=-- mm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'right' });
        this._tofDeltaMarker = new Konva.Line({ points: [], stroke: '#ef5350', strokeWidth: 1, dash: [2,2] });

        this.group.add(bg, titleBg, this._tofLinePulse, this._tofLineEcho, this._tofDeltaMarker, this._tofTofLabel, this._tofPosLabel);
    }

    // ── LCD 仪表面板（右中）────────────────
    _drawLCDPanel() {
        const hx = this._lcdX, hy = this._lcdY;
        const hw = this._lcdW, hh = this._lcdH;

        // 接线盒
        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 42, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 25, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'LT-MS01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+18, width: hw-16, text: 'MAGNETO  4-20mA', fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 10, height: 38, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+3, width: 10, height: 38, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+42, width: hw, height: hh-42, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });

        // 端子标签
        [['V+','#ef5350',14],['GND','#607d8b',34],['4-20','#ffd54f',58],['RS485','#26c6da',78]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Rect({ x: hx+4, y: hy+ty-7, width: hw-8, height: 13, fill: 'rgba(255,255,255,0.025)', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: hx+7, y: hy+ty-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });

        // 圆形 LCD
        const lcx = hx + hw/2, lcy = hy + 42 + (hh-42)*0.50;
        const R   = Math.min(hw * 0.38, 38);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1a3a2a', stroke: '#2e7d32', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        this._lvArc  = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#66bb6a', rotation: -90 });
        this._lcdMain  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'--',    fontSize:R*.42, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#66bb6a', align:'center' });
        this._lcdUnit  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'mm',   fontSize:R*.18, fill:'#1a3a2a', align:'center' });
        this._lcdPct   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.30, width:(R-4)*2, text:'0.0%', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdCurr  = new Konva.Text({ x: lcx-R+4, y: lcy-R*.60, width:(R-4)*2, text:'-- mA',fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdTof   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.48, width:(R-4)*2, text:'Δt=--',fontSize:R*.11, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(jBox, plate, lcap, rcap, this._idText, body, ring, this._lcdBg, this._lvArc, this._lcdMain, this._lcdUnit, this._lcdPct, this._lcdCurr, this._lcdTof);
    }

    // ── 位置曲线（右下）────────────────────
    _drawPositionWave() {
        const { _posX: px, _posY: py, _posW: pw, _posH: ph } = this;
        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '液位 L(t)  mm', fontSize: 8, fontStyle: 'bold', fill: '#66bb6a', align: 'center' }));
        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [px, py+ph*i/3, px+pw, py+ph*i/3], stroke: 'rgba(102,187,106,0.07)', strokeWidth: 0.5 }));

        const midY = py + ph * 0.55;
        this.group.add(new Konva.Line({ points: [px+2, midY, px+pw-2, midY], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5, dash: [4,3] }));

        this._posLine   = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.8, lineJoin: 'round' });
        this._posCurrLbl= new Konva.Text({ x: px+pw-90, y: py+16, width: 86, text: '-- mm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });
        this._posMidY   = midY;

        this.group.add(bg, titleBg, this._posLine, this._posCurrLbl);
    }

    // ── 底部面板 ────────────────────────────
    _drawBottomPanel() {
        // pass — 由 _tickDisplay 填充
    }

    // ── 拖拽（储罐区调节液位）──────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._tankX, y: this._tankY, width: this._tankW, height: this._tankH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartL = this._manualLevel;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualLevel = Math.max(0, Math.min(100, this._dragStartL + (this._dragStartY - cy) / this._tankH * 100));
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
                this._tickLiquidViz();
                this._tickFloat(dt);
                this._tickPulsePropagation(dt);
                this._tickMagField(dt);
                this._tickTofOsc(dt);
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

    // ── 物理计算 ────────────────────────────
    _tickPhysics(dt) {
        this.liquidLevel = this._manualLevel;
        this.levelMM     = (this.liquidLevel / 100) * this.totalLength;

        // TOF 计算
        this.tof = (this.levelMM / 1000) / this.waveSpeed * 2 * 1e6;  // μs（单程往返）

        // 电流输出
        this.outCurrent = 4 + (this.liquidLevel / 100) * 16;
        this.outVoltage = (this.liquidLevel / 100) * 10;
        if (this.isBreak) { this.outCurrent = 1.8; this.outVoltage = 0; }

        // 报警
        this.alarmHi = this.liquidLevel > this.hiAlarm;
        this.alarmLo = this.liquidLevel < this.loAlarm;

        // 液位弧
        if (this._lvArc) {
            const ratio = Math.min(1, this.liquidLevel / 100);
            this._lvArc.angle(ratio * 360);
            this._lvArc.fill(this.alarmHi ? '#ef5350' : this.alarmLo ? '#ffa726' : '#66bb6a');
        }

        // 浮动相位
        this._floatBob    += dt * 2.5;
        this._magRotPhase += dt * 3.0;

        // 状态 LED
        if (this._statusLed) {
            const blinkOn = Math.sin(this._floatBob * 2) > 0;
            this._statusLed.fill(this.powered && !this.isBreak ? (blinkOn ? '#66bb6a' : '#2e7d32') : '#1a1a1a');
        }
    }

    // ── 液面动画 ────────────────────────────
    _tickLiquidViz() {
        const ih = this._innerH;
        const liqH   = (this.liquidLevel / 100) * ih;
        const liqTop = this._innerY + ih - liqH;

        this._liquidRect.y(liqTop);
        this._liquidRect.height(liqH);
        this._liquidSurf.y(liqTop);

        // 液体颜色
        const fr = this.liquidLevel / 100;
        this._liquidRect.fill(`rgba(${Math.round(20+fr*15)},${Math.round(100+fr*50)},${Math.round(210+fr*20)},0.72)`);

        this._hiLine.stroke(this.alarmHi ? '#ef5350' : 'rgba(239,83,80,0.35)');
        this._loLine.stroke(this.alarmLo ? '#ff9800' : 'rgba(255,152,0,0.35)');
        this._innerCav.fill(`rgb(${Math.round(10+fr*5)},${Math.round(20+fr*20)},${Math.round(35+fr*25)})`);

        // 液面波纹
        this._rippleGroup.destroyChildren();
        const bob = Math.sin(this._floatBob) * 1.5;
        const wY  = liqTop + bob;
        for (let i = 0; i < 3; i++) {
            const rph = (this._floatBob + i * 1.2) % (Math.PI * 2);
            const rr  = 4 + i * 8 + Math.sin(rph) * 2;
            const ra  = Math.max(0, 0.4 - i * 0.12);
            this._rippleGroup.add(new Konva.Arc({
                x: this._rodX, y: wY, innerRadius: rr, outerRadius: rr+1.5,
                angle: 180, rotation: -90, fill: `rgba(100,200,255,${ra})`,
            }));
        }
    }

    // ── 浮子跟随液面 ───────────────────────
    _tickFloat(dt) {
        const liqH   = (this.liquidLevel / 100) * this._innerH;
        const liqTop = this._innerY + this._innerH - liqH;
        const bob    = Math.sin(this._floatBob) * 2;  // 浮子微小上下浮动
        const floatY = liqTop + bob;

        if (this._floatGroup) this._floatGroup.y(floatY);
        if (this._floatLabel) {
            this._floatLabel.x(this._rodX + 16);
            this._floatLabel.y(floatY - 4);
        }

        // 双浮子（界面测量）
        if (this.multiFloat && this._floatGroup2) {
            const if2H   = (this.interface2 / 100) * this._innerH;
            const if2Top = this._innerY + this._innerH - if2H;
            this._floatGroup2.y(if2Top + bob * 0.7);
        }
    }

    // ── 电流脉冲 + 扭转波传播动画 ──────────
    _tickPulsePropagation(dt) {
        this._pulseGroup.destroyChildren();
        this._tofWaveGroup.destroyChildren();

        if (!this.powered || this.isBreak) return;

        const rx   = this._rodX;
        const rt   = this._rodTop;
        const rb   = this._rodBot;
        const rodH = rb - rt;

        // 发射计时
        this._pulseTimer -= dt;
        if (this._pulseTimer <= 0) {
            this._pulseTimer = this.pulseInterval;
            this._pulseActive = true;
            this._pulsePhase  = 0;
            this._tofActive   = false;
            this._tofLaunched = false;
            this._tofPhase    = 0;
        }

        // 电流脉冲（从顶端向下传播，黄色点）
        if (this._pulseActive) {
            this._pulsePhase += dt / 0.06;  // 60ms 传完全管
            if (this._pulsePhase >= 1) {
                this._pulseActive = false;
                this._pulsePhase  = 1;
            }
            // 脉冲沿（黄色光晕）
            const pulseY = rt + this._pulsePhase * rodH;
            this._pulseGroup.add(new Konva.Circle({ x: rx, y: pulseY, radius: 5, fill: '#ffd54f' }));
            this._pulseGroup.add(new Konva.Circle({ x: rx, y: pulseY, radius: 10, fill: 'rgba(255,213,79,0.25)' }));
            // 拖尾
            for (let i = 1; i <= 5; i++) {
                const ty2 = pulseY - i * 6;
                if (ty2 > rt) {
                    this._pulseGroup.add(new Konva.Circle({ x: rx, y: ty2, radius: 3 - i*0.4, fill: `rgba(255,213,79,${0.4-i*0.07})` }));
                }
            }
            // 当脉冲到达浮子位置时，激发扭转波
            const floatFrac = 1 - this.liquidLevel / 100;
            if (!this._tofLaunched && this._pulsePhase >= floatFrac) {
                this._tofLaunched = true;
                this._tofActive   = true;
                this._tofPhase    = 0;
                this._receiveFlash = 0;
            }
        }

        // 扭转波（从浮子位置向上传播，青色环状波）
        if (this._tofActive) {
            this._tofPhase += dt / 0.045;  // 45ms 传到顶
            if (this._tofPhase >= 1) {
                this._tofActive   = false;
                this._tofPhase    = 1;
                this._receiveFlash = 0.8;
            }
            const floatY2 = this._floatGroup ? this._floatGroup.y() : (this._innerY + this._innerH * (1 - this.liquidLevel/100));
            const tofY    = floatY2 - this._tofPhase * (floatY2 - rt);

            // 扭转波（螺旋圆环，模拟旋转波）
            for (let ring = 0; ring < 3; ring++) {
                const rp = this._tofPhase + ring * 0.06;
                if (rp > 1) continue;
                const wy2   = floatY2 - rp * (floatY2 - rt);
                const rSize = 6 + ring * 3;
                const alpha = (1 - rp) * 0.7;
                this._tofWaveGroup.add(new Konva.Arc({ x: rx, y: wy2, innerRadius: rSize-1, outerRadius: rSize+1.5, angle: 300, rotation: rp*720, fill: `rgba(77,208,225,${alpha})` }));
            }
        }

        // 接收闪光（拾振器）
        if (this._receiveFlash > 0) {
            this._receiveFlash -= dt * 4;
            const fa = Math.max(0, this._receiveFlash);
            this._tofWaveGroup.add(new Konva.Circle({ x: rx, y: rt+20, radius: 12, fill: `rgba(77,208,225,${fa * 0.6})` }));
            if (this._pickupCoil) this._pickupCoil.fill(`rgba(38,198,218,${0.5 + fa * 0.5})`);
        } else {
            if (this._pickupCoil) this._pickupCoil.fill('#26c6da');
        }
    }

    // ── 磁场可视化（浮子周围）──────────────
    _tickMagField(dt) {
        this._magGroup.destroyChildren();
        if (!this._floatGroup) return;

        const rx  = this._rodX;
        const fy  = this._floatGroup.y();
        const rad = 30;

        // 轴向磁场线（N到S，上下方向）
        for (let i = -2; i <= 2; i++) {
            const alpha = (1 - Math.abs(i) / 3) * 0.35;
            this._magGroup.add(new Konva.Line({
                points: [rx + i*7, fy - rad, rx + i*7, fy + rad],
                stroke: `rgba(239,83,80,${alpha})`, strokeWidth: 1.5, dash: [3,3],
            }));
        }
        // 环形磁场（电流脉冲产生）
        if (this._pulseActive && Math.abs(this._pulsePhase - (1-this.liquidLevel/100)) < 0.12) {
            const intensity = 1 - Math.abs(this._pulsePhase - (1-this.liquidLevel/100)) / 0.12;
            for (let r = 8; r <= 24; r += 6) {
                this._magGroup.add(new Konva.Arc({
                    x: rx, y: fy, innerRadius: r, outerRadius: r+1.5,
                    angle: 360, fill: `rgba(255,213,79,${intensity * 0.4})`,
                }));
            }
        }
        // 螺旋磁场指示（Wiedemann叠加区）
        if (this._tofLaunched && this._tofPhase < 0.15) {
            const blend = 1 - this._tofPhase / 0.15;
            for (let i = 0; i < 6; i++) {
                const a = (i/6)*Math.PI*2 + this._magRotPhase;
                this._magGroup.add(new Konva.Line({
                    points: [rx, fy, rx + rad*0.7*Math.cos(a), fy + rad*0.35*Math.sin(a)],
                    stroke: `rgba(255,215,0,${blend * 0.5})`, strokeWidth: 1,
                }));
            }
        }
    }

    // ── TOF 示波器波形 ───────────────────────
    _tickTofOsc(dt) {
        // 滚动缓冲
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps  = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        const pulseVal = this._pulseActive && this._pulsePhase < 0.1 ? 1 : 0;
        const echoVal  = this._receiveFlash > 0.4 ? Math.abs(Math.sin((1-this._receiveFlash)*Math.PI)) * 0.85 : 0;
        const posVal   = this.levelMM;

        for (let i = 0; i < steps; i++) {
            this._wavPulse = new Uint8Array([...this._wavPulse.slice(1), pulseVal]);
            this._wavEcho  = new Float32Array([...this._wavEcho.slice(1),  echoVal]);
            this._wavPos   = new Float32Array([...this._wavPos.slice(1),   posVal]);
        }

        // 绘制 TOF 波形
        const ox = this._tofX+3, oy = this._tofY;
        const ow = this._tofW-6, oh = this._tofH;
        const n  = this._wavLen, dx = ow / n;
        const hiP = this._tofMidPulse - oh*0.12, loP = this._tofMidPulse + oh*0.12;
        const echoAmp = oh * 0.16;

        const pulPts = [], echPts = [];
        let prevP = this._wavPulse[0];
        pulPts.push(ox, prevP ? hiP : loP);
        for (let i = 1; i < n; i++) {
            const v = this._wavPulse[i], x2 = ox+i*dx, y2 = v ? hiP : loP;
            if (v !== prevP) { pulPts.push(x2, prevP ? hiP : loP); pulPts.push(x2, y2); }
            else pulPts.push(x2, y2);
            prevP = v;
        }
        for (let i = 0; i < n; i++) {
            echPts.push(ox+i*dx, this._tofMidEcho - this._wavEcho[i] * echoAmp);
        }
        if (this._tofLinePulse) this._tofLinePulse.points(pulPts);
        if (this._tofLineEcho)  this._tofLineEcho.points(echPts);

        // TOF 标注
        if (this._tofTofLabel) this._tofTofLabel.text(`Δt=${this.tof.toFixed(2)} μs`);
        if (this._tofPosLabel) this._tofPosLabel.text(`L=${this.levelMM.toFixed(1)} mm`);

        // 位置波形
        const px = this._posX+3, py2 = this._posY;
        const pw = this._posW-6, ph = this._posH;
        const posAmp = ph * 0.35;
        const posPts = [];
        for (let i = 0; i < n; i++) {
            const v = this._wavPos[i] / this.totalLength;
            posPts.push(px+i*dx, this._posMidY - (v*2-1) * posAmp);
        }
        if (this._posLine) this._posLine.points(posPts);
        if (this._posCurrLbl) this._posCurrLbl.text(`${this.levelMM.toFixed(2)} mm`);
    }

    // ── LCD + 面板刷新 ───────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;

        if (!pw || br) {
            if (this._lcdMain) { this._lcdMain.text(br ? 'FAIL' : '----'); this._lcdMain.fill(br ? '#ef5350' : '#0d2030'); }
            return;
        }

        const ratio = this.liquidLevel / 100;
        const mc    = this.alarmHi ? '#ff5722' : this.alarmLo ? '#ffa726' : '#66bb6a';

        if (this._lcdBg)   this._lcdBg.fill('#020c14');
        if (this._lcdMain) { this._lcdMain.text(Math.round(this.levelMM).toString()); this._lcdMain.fill(mc); }
        if (this._lcdUnit) this._lcdUnit.text('mm');
        if (this._lcdPct)  this._lcdPct.text(`${this.liquidLevel.toFixed(1)}%`);
        if (this._lcdCurr) this._lcdCurr.text(`${this.outCurrent.toFixed(2)} mA`);
        if (this._lcdTof)  this._lcdTof.text(`Δt=${this.tof.toFixed(2)}μs`);
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(level) {
        if (typeof level === 'number') {
            // level 可以是 mm 或 %，自动判断
            if (level <= 100) {
                this._manualLevel = Math.max(0, Math.min(100, level));
            } else {
                this._manualLevel = Math.max(0, Math.min(100, level / this.totalLength * 100));
            }
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',            type: 'text'   },
            { label: '波导管总长 (mm)',     key: 'totalLength',   type: 'number' },
            { label: '扭转波速 (m/s)',      key: 'waveSpeed',     type: 'number' },
            { label: '高报阈值 (%)',        key: 'hiAlarm',       type: 'number' },
            { label: '低报阈值 (%)',        key: 'loAlarm',       type: 'number' },
            { label: '双浮子模式',          key: 'multiFloat',    type: 'select',
              options: [{label:'关',value:'false'},{label:'开（界面）',value:'true'}] },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.totalLength = parseFloat(cfg.totalLength) || this.totalLength;
        this.waveSpeed   = parseFloat(cfg.waveSpeed)   || this.waveSpeed;
        this.hiAlarm     = parseFloat(cfg.hiAlarm)     ?? this.hiAlarm;
        this.loAlarm     = parseFloat(cfg.loAlarm)     ?? this.loAlarm;
        this.config      = { ...this.config, ...cfg };
        if (this._idText)     this._idText.text(this.id);
        if (this._headIdText) this._headIdText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}