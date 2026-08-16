import { BaseComponent } from './BaseComponent.js';

/**
 * MARK 6 油雾浓度探测器仿真组件
 * （MARK 6 Oil Mist Detector with CAN Bus Interface）
 *
 * ── 工作原理（散射光原理 / Tyndall Effect）───────────────────
 *  MARK 6 采用双路光电散射检测原理：
 *
 *  ① 测量腔（Measuring Cell）：
 *     LED 光源发射红外光束穿过曲管采样通道
 *     油雾颗粒使光发生 Tyndall 散射
 *     前向散射光 + 参考光路共同计算油雾浓度
 *
 *  散射强度（Rayleigh 近似）：
 *     I_scatter ∝ N · d⁶ · I₀
 *     N   — 颗粒数密度
 *     d   — 油雾颗粒直径
 *     I₀  — 入射光强度
 *
 *  归一化油雾浓度（Obscuration 遮光法）：
 *     OMD = 1 - (I_trans / I₀)   （%LEL 爆炸下限百分比）
 *
 *  双路差分消除环境干扰：
 *     CH1 — 测量通道（带油雾采样）
 *     CH2 — 参考通道（清洁空气）
 *     ΔI  = I_CH1 - I_CH2  → 油雾浓度
 *
 * ── MARK 6 报警等级 ──────────────────────────────────────────
 *  PRE-ALARM   ≥ 2.5 % LEL  （预警，黄色）
 *  ALARM       ≥ 5.0 % LEL  （主报警，红色 → 联锁停机）
 *  FAULT       传感器故障    （橙色）
 *
 * ── CAN 总线接口 ─────────────────────────────────────────────
 *  标准 CAN 2.0B，波特率 250 kbps
 *  CAN ID 分配：
 *    0x100 + node_id  — 状态帧（每秒）
 *    0x200 + node_id  — 测量数据帧（500ms）
 *    0x300 + node_id  — 报警/故障帧（事件触发）
 *
 *  数据帧格式（8字节）：
 *    Byte 0   — 状态字节（bit0=PreAlarm, bit1=Alarm, bit2=Fault）
 *    Byte 1-2 — 通道1油雾浓度（uint16, ×0.1 %LEL）
 *    Byte 3-4 — 通道2油雾浓度（uint16, ×0.1 %LEL）
 *    Byte 5   — 光源强度（0-255）
 *    Byte 6   — 温度（int8, °C）
 *    Byte 7   — 校验字节（XOR）
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 双采样管路（曲管形状，油雾进出）
 *  ② 光学测量腔（LED + 光电探测器）
 *  ③ 散射光可视化（颗粒云 + 光束）
 *  ④ 双通道波形示波器
 *  ⑤ CAN 总线帧动画（数据帧发送）
 *  ⑥ 仪表 LCD（浓度 + 状态 + 报警等级）
 *  ⑦ 报警状态指示（多级颜色）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_in   — 油雾进气口（来自曲轴箱）
 *  pipe_out  — 气体出口
 *  wire_can_h — CAN-H
 *  wire_can_l — CAN-L
 *  wire_vcc   — 电源 24V
 *  wire_gnd   — 地
 *
 * ── 气路求解器集成 ────────────────────────────────────────────
 *  special = 'none'
 *  update(concentration) — 外部注入油雾浓度 %LEL
 */
export class MARK6OilMistDetector extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(360, config.width  || 400);
        this.height = Math.max(360, config.height || 400);

        this.type    = 'mark6_oil_mist';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 设备参数 ──
        this.nodeId       = config.nodeId       || 1;      // CAN 节点 ID (1~8)
        this.canBaudrate  = config.canBaudrate  || 250;    // kbps
        this.preAlarmLEL  = config.preAlarmLEL  || 2.5;   // 预警阈值 %LEL
        this.alarmLEL     = config.alarmLEL     || 5.0;   // 主报警阈值 %LEL
        this.maxLEL       = config.maxLEL       || 10.0;  // 量程上限 %LEL
        this.tempC        = config.tempC        || 45;    // 工作温度
        this.samplingInt  = config.samplingInt  || 0.5;   // 采样周期 s

        // ── 状态 ──
        this.concentration= config.initConc     || 0;     // %LEL 当前油雾浓度
        this._manualConc  = config.initConc     || 0;
        this.ch1Value     = 0;    // 通道1 %LEL
        this.ch2Value     = 0;    // 通道2 %LEL（参考）
        this.ledIntensity = 255;  // LED 光强 0-255
        this.isPreAlarm   = false;
        this.isAlarm      = false;
        this.isFault      = false;
        this.isBreak      = false;
        this.powered      = true;

        // ── 光学仿真 ──
        this._lightPhase   = 0;   // LED 调制相位
        this._particles    = [];  // 油雾颗粒云
        this._scatterAlpha = 0;   // 散射辉光强度

        // ── CAN 总线 ──
        this._canTimer     = 0;
        this._canPeriod    = 0.5;  // 帧发送周期 s
        this._canFrameAnim = 0;    // 帧传输动画进度 0~1
        this._canLog       = [];   // 最近帧记录
        this._canLogMax    = 5;
        this._canTxAnim    = 0;    // 总线活动动画
        this._frameBuffer  = new Uint8Array(8).fill(0);

        // ── 波形缓冲 ──
        this._wavLen   = 220;
        this._wavCH1   = new Float32Array(this._wavLen).fill(0);
        this._wavCH2   = new Float32Array(this._wavLen).fill(0);
        this._wavAcc   = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartC  = 0;

        // ── 几何布局 ──
        // 主测量腔（左中央）
        this._cellX   = 8;
        this._cellY   = 36;
        this._cellW   = Math.round(this.width * 0.50);
        this._cellH   = Math.round(this.height * 0.48);

        // 光学通道中心
        this._optCX   = this._cellX + this._cellW / 2;
        this._optCY   = this._cellY + this._cellH / 2;

        // 仪表头（右侧）
        this._headX   = this._cellX + this._cellW + 10;
        this._headY   = this._cellY;
        this._headW   = this.width - this._headX - 6;
        this._headH   = Math.round(this.height * 0.42);

        // CAN 总线面板（左下）
        this._canX    = this._cellX;
        this._canY    = this._cellY + this._cellH + 10;
        this._canW    = this._cellW;
        this._canH    = Math.round(this.height * 0.30);

        // 波形区（右下）
        this._wavX    = this._headX;
        this._wavY    = this._headY + this._headH + 10;
        this._wavW    = this._headW;
        this._wavH    = this.height - this._wavY - 6;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, nodeId: this.nodeId,
            preAlarmLEL: this.preAlarmLEL, alarmLEL: this.alarmLEL,
            maxLEL: this.maxLEL, canBaudrate: this.canBaudrate,
        };

        this._init();

        this.addPort(0,           this._optCY - 18,       'in',    'pipe', 'IN');
        this.addPort(0,           this._optCY + 18,       'out',   'pipe', 'OUT');
        this.addPort(this.width,  this._headY + 14,       'canh',  'wire', 'CAN-H');
        this.addPort(this.width,  this._headY + 34,       'canl',  'wire', 'CAN-L');
        this.addPort(this.width,  this._headY + 58,       'vcc',   'wire', 'V+');
        this.addPort(this.width,  this._headY + 78,       'gnd',   'wire', 'GND');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawDetectorBody();
        this._drawOpticalPaths();
        this._drawSamplingTubes();
        this._drawOilMistLayer();     // 动态
        this._drawLightBeamLayer();   // 动态
        this._drawInstrHead();
        this._drawLCD();
        this._drawAlarmPanel();
        this._drawCANPanel();
        this._drawWaveforms();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: 'MARK 6 油雾浓度探测器（双通道 + CAN总线）',
            fontSize: 12.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 探测器主壳体 ────────────────────────
    _drawDetectorBody() {
        const { _cellX: cx, _cellY: cy, _cellW: cw, _cellH: ch } = this;

        // 主体外壳（工业黑色涂装）
        const body = new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fill: '#1a1f2e', stroke: '#0d1020', strokeWidth: 2, cornerRadius: 6,
        });
        // 内腔（深色测量腔）
        this._measCav = new Konva.Rect({
            x: cx+10, y: cy+10, width: cw-20, height: ch-20,
            fill: '#0a0e1a', stroke: '#1a2440', strokeWidth: 1, cornerRadius: 4,
        });
        // 顶部铭牌条
        const nameBar = new Konva.Rect({
            x: cx, y: cy, width: cw, height: 22,
            fill: '#c62828', stroke: '#8a0000', strokeWidth: 1, cornerRadius: [6,6,0,0],
        });
        this.group.add(new Konva.Text({
            x: cx+4, y: cy+5, width: cw-8,
            text: 'MARK 6  OIL MIST DETECTOR',
            fontSize: 9, fontStyle: 'bold', fill: '#fff', align: 'center',
        }));
        // 安装孔
        [[cx+8,cy+8],[cx+cw-8,cy+8],[cx+8,cy+ch-8],[cx+cw-8,cy+ch-8]].forEach(([bx,by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4, fill: '#0d1020', stroke: '#263238', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: bx-1, y: by-1, radius: 1.3, fill: 'rgba(255,255,255,0.18)' }));
        });
        // 高光条
        this.group.add(new Konva.Rect({
            x: cx, y: cy, width: cw, height: 3,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: [6,6,0,0],
        }));
        this.group.add(body, this._measCav, nameBar);
    }

    // ── 光学通道（测量腔 + LED + PD）────────
    _drawOpticalPaths() {
        const cx = this._optCX, cy = this._optCY;
        const cellX = this._cellX, cellY = this._cellY;
        const cw = this._cellW, ch = this._cellH;

        // ── 测量通道 CH1（上侧，弯管形状）──
        // 曲管外框
        const ch1Y = cy - 28;
        const tubeW = cw * 0.60, tubeH = 24;
        this._ch1Tube = new Konva.Rect({
            x: cx - tubeW/2, y: ch1Y - tubeH/2,
            width: tubeW, height: tubeH,
            fill: '#0d1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 3,
        });
        // CH1 LED 光源（左端）
        const led1 = new Konva.Circle({ x: cx-tubeW/2-6, y: ch1Y, radius: 7, fill: '#ff6d00', stroke: '#e65100', strokeWidth: 1.5 });
        this._led1Glow = new Konva.Circle({ x: cx-tubeW/2-6, y: ch1Y, radius: 12, fill: 'rgba(255,109,0,0.25)' });
        const led1Lbl = new Konva.Text({ x: cx-tubeW/2-18, y: ch1Y-16, text: 'LED₁', fontSize: 8, fill: '#ff8f00' });
        // CH1 光电探测器（右端）
        const pd1 = new Konva.Rect({ x: cx+tubeW/2+2, y: ch1Y-7, width: 12, height: 14, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1, cornerRadius: 2 });
        const pd1Lbl = new Konva.Text({ x: cx+tubeW/2+16, y: ch1Y-5, text: 'PD₁\n测量', fontSize: 7.5, fill: '#42a5f5', lineHeight: 1.3 });
        this.group.add(new Konva.Text({ x: cx-10, y: ch1Y-tubeH/2-14, text: 'CH1  测量通道', fontSize: 8.5, fontStyle: 'bold', fill: '#42a5f5' }));

        // ── 参考通道 CH2（下侧）──
        const ch2Y = cy + 28;
        this._ch2Tube = new Konva.Rect({
            x: cx - tubeW/2, y: ch2Y - tubeH/2,
            width: tubeW, height: tubeH,
            fill: '#0d1a0d', stroke: '#1a3a1a', strokeWidth: 1.5, cornerRadius: 3,
        });
        const led2 = new Konva.Circle({ x: cx-tubeW/2-6, y: ch2Y, radius: 7, fill: '#66bb6a', stroke: '#2e7d32', strokeWidth: 1.5 });
        this._led2Glow = new Konva.Circle({ x: cx-tubeW/2-6, y: ch2Y, radius: 12, fill: 'rgba(102,187,106,0.2)' });
        const led2Lbl = new Konva.Text({ x: cx-tubeW/2-18, y: ch2Y-16, text: 'LED₂', fontSize: 8, fill: '#66bb6a' });
        const pd2 = new Konva.Rect({ x: cx+tubeW/2+2, y: ch2Y-7, width: 12, height: 14, fill: '#1b5e20', stroke: '#2e7d32', strokeWidth: 1, cornerRadius: 2 });
        const pd2Lbl = new Konva.Text({ x: cx+tubeW/2+16, y: ch2Y-5, text: 'PD₂\n参考', fontSize: 7.5, fill: '#a5d6a7', lineHeight: 1.3 });
        this.group.add(new Konva.Text({ x: cx-10, y: ch2Y+tubeH/2+4, text: 'CH2  参考通道（清洁空气）', fontSize: 8.5, fontStyle: 'bold', fill: '#66bb6a' }));

        // 信号处理模块（中央）
        const procX = cx - 28, procY = cy - 12;
        const procBox = new Konva.Rect({ x: procX, y: procY, width: 56, height: 24, fill: '#162040', stroke: '#1a3060', strokeWidth: 1, cornerRadius: 3 });
        this.group.add(new Konva.Text({ x: procX+4, y: procY+3, width: 48, text: 'DSP\n信号处理', fontSize: 7, fill: '#80cbc4', align: 'center', lineHeight: 1.3 }));

        this._ch1TubeY  = ch1Y;
        this._ch2TubeY  = ch2Y;
        this._tubeW     = tubeW;
        this._tubeH     = tubeH;
        this._tubeLeftX = cx - tubeW/2;
        this._tubeRightX= cx + tubeW/2;

        this.group.add(this._ch1Tube, this._led1Glow, led1, led1Lbl, pd1, pd1Lbl);
        this.group.add(this._ch2Tube, this._led2Glow, led2, led2Lbl, pd2, pd2Lbl);
        this.group.add(procBox);
    }

    // ── 采样管路（进/出口）──────────────────
    _drawSamplingTubes() {
        const cx = this._optCX, cy = this._optCY;
        const tubeX = this._tubeLeftX;

        // 进气弯管（左侧，红色）
        const inPipe = new Konva.Line({
            points: [
                this._cellX - 20, cy - 18,
                this._cellX + 8,  cy - 18,
                this._cellX + 8,  this._ch1TubeY,
                tubeX,            this._ch1TubeY,
            ],
            stroke: '#ef5350', strokeWidth: 4, lineCap: 'round', lineJoin: 'round',
        });
        this.group.add(new Konva.Rect({ x: this._cellX-32, y: cy-26, width: 16, height: 16, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5, cornerRadius: [2,0,0,2] }));
        this.group.add(new Konva.Text({ x: this._cellX-48, y: cy-30, text: '油雾\n进口', fontSize: 7.5, fill: '#ef9a9a', lineHeight: 1.3 }));

        // 出气弯管（左侧，灰色）
        const outPipe = new Konva.Line({
            points: [
                tubeX,            this._ch1TubeY + 8,
                this._cellX + 8,  this._ch1TubeY + 8,
                this._cellX + 8,  cy + 18,
                this._cellX - 20, cy + 18,
            ],
            stroke: '#546e7a', strokeWidth: 4, lineCap: 'round', lineJoin: 'round',
        });
        this.group.add(new Konva.Rect({ x: this._cellX-32, y: cy+10, width: 16, height: 16, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: [2,0,0,2] }));
        this.group.add(new Konva.Text({ x: this._cellX-46, y: cy+10, text: '气体\n出口', fontSize: 7.5, fill: '#90a4ae', lineHeight: 1.3 }));

        this.group.add(inPipe, outPipe);
    }

    // ── 油雾颗粒层（动态）────────────────────
    _drawOilMistLayer() {
        this._oilMistGroup  = new Konva.Group();
        this._lightBeamGroup= new Konva.Group();
        this.group.add(this._oilMistGroup, this._lightBeamGroup);
    }

    _drawLightBeamLayer() { /* merged with _drawOilMistLayer */ }

    // ── 仪表头（右侧）────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 4; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.12)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 26, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'MD-M6-01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+18, width: hw-16, text: 'MARK 6  OIL MIST', fontSize: 7, fill: '#78909c', align: 'center' }));
        this.group.add(new Konva.Text({ x: hx+8, y: hy+27, width: hw-16, text: `CAN ${this.canBaudrate}kbps  NODE:${this.nodeId}`, fontSize: 7, fill: '#90a4ae', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 10, height: 40, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+3, width: 10, height: 40, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1a1f2e', stroke: '#0d1020', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        [['CAN-H','#ef9a9a',14],['CAN-L','#90caf9',34],['V+','#e53935',58],['GND','#546e7a',78]].forEach(([lbl,col,ty]) => {
            this.group.add(new Konva.Rect({ x: hx+4, y: hy+ty-7, width: hw-8, height: 13, fill: 'rgba(255,255,255,0.025)', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: hx+7, y: hy+ty-3, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH - 44) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1020', stroke: '#1a1f30', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#3e0000', stroke: '#c62828', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020408' });

        this._concArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#4dd0e1', rotation: -90 });
        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.40, width:(R-4)*2, text:'0.0',   fontSize:R*.42, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#4dd0e1', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'%LEL',  fontSize:R*.15, fill:'#3e0000', align:'center' });
        this._lcdCH12   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.29, width:(R-4)*2, text:'--/--', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdStatus = new Konva.Text({ x: lcx-R+4, y: lcy-R*.62, width:(R-4)*2, text:'NORMAL', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#66bb6a', align:'center' });
        this._lcdNode   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.47, width:(R-4)*2, text:`N:${this.nodeId}`, fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._concArc, this._lcdMain, this._lcdUnit, this._lcdCH12, this._lcdStatus, this._lcdNode);
    }

    // ── 报警状态面板 ─────────────────────────
    _drawAlarmPanel() {
        const hx = this._headX, hw = this._headW;
        const panY = this._lcCY + this._lcR + 12;

        // 三个报警指示灯（NORMAL / PRE-ALARM / ALARM）
        const leds = [
            { label: 'NORMAL', col: '#4caf50', cx: hx + hw*0.2 },
            { label: 'PRE-ALM', col: '#ffd54f', cx: hx + hw*0.5 },
            { label: 'ALARM!', col: '#f44336', cx: hx + hw*0.8 },
        ];
        this._alarmLeds = [];
        leds.forEach(({ label, col, cx }) => {
            const led = new Konva.Circle({ x: cx, y: panY, radius: 7, fill: '#1a1a1a', stroke: '#333', strokeWidth: 1 });
            const lbl = new Konva.Text({ x: cx-20, y: panY+10, width: 40, text: label, fontSize: 7, fill: '#37474f', align: 'center' });
            this._alarmLeds.push({ led, col, offCol: '#1a1a1a', lbl });
            this.group.add(led, lbl);
        });
    }

    // ── CAN 总线面板（左下）────────────────
    _drawCANPanel() {
        const { _canX: cx2, _canY: cy2, _canW: cw, _canH: ch } = this;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 16, fill: '#0c1e2a', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({
            x: cx2+4, y: cy2+3, width: cw-8,
            text: `CAN 2.0B  ${this.canBaudrate}kbps  NODE:${this.nodeId}  ── 总线帧`,
            fontSize: 8, fontStyle: 'bold', fill: '#80cbc4', align: 'center',
        }));

        // 帧日志条目
        this._canLogNodes = [];
        for (let i = 0; i < this._canLogMax; i++) {
            const t2 = new Konva.Text({ x: cx2+4, y: cy2+20+i*16, width: cw-8, text: '', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#263238', opacity: 0 });
            this._canLogNodes.push(t2);
            this.group.add(t2);
        }

        // CAN-H / CAN-L 总线活动条
        const busY = cy2 + ch - 12;
        this.group.add(new Konva.Rect({ x: cx2+4, y: busY-4, width: cw-8, height: 6, fill: '#0d2030', cornerRadius: 2 }));
        this._canHBus = new Konva.Rect({ x: cx2+4, y: busY-4, width: 0, height: 3, fill: '#ef9a9a', cornerRadius: 1 });
        this._canLBus = new Konva.Rect({ x: cx2+4, y: busY-1, width: 0, height: 3, fill: '#90caf9', cornerRadius: 1 });
        this.group.add(new Konva.Text({ x: cx2+4, y: busY+4, text: 'CAN-H', fontSize: 6.5, fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: cx2+35, y: busY+4, text: 'CAN-L', fontSize: 6.5, fill: '#90caf9' }));

        this.group.add(bg, titleBg, this._canHBus, this._canLBus);
    }

    // ── 双通道波形（右下）────────────────────
    _drawWaveforms() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '油雾浓度 %LEL  ── CH1  ── CH2', fontSize: 8, fontStyle: 'bold', fill: '#4dd0e1', align: 'center' }));

        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [wx, wy+wh*i/3, wx+ww, wy+wh*i/3], stroke: 'rgba(77,208,225,0.06)', strokeWidth: 0.5 }));
        for (let i = 1; i < 4; i++) this.group.add(new Konva.Line({ points: [wx+ww*i/4, wy, wx+ww*i/4, wy+wh], stroke: 'rgba(77,208,225,0.05)', strokeWidth: 0.5 }));

        this._wavMidCH1 = wy + wh * 0.26;
        this._wavMidCH2 = wy + wh * 0.74;
        [this._wavMidCH1, this._wavMidCH2].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.10)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineCH1 = new Konva.Line({ points: [], stroke: '#42a5f5', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineCH2 = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.5, lineJoin: 'round' });
        // 报警阈值线
        const preAlarmRatio = this.preAlarmLEL / this.maxLEL;
        const alarmRatio    = this.alarmLEL    / this.maxLEL;
        const wavAmp        = wh * 0.20;
        this.group.add(new Konva.Line({ points: [wx+2, this._wavMidCH1 - preAlarmRatio*wavAmp, wx+ww-2, this._wavMidCH1 - preAlarmRatio*wavAmp], stroke: 'rgba(255,213,79,0.35)', strokeWidth: 0.8, dash: [3,3] }));
        this.group.add(new Konva.Line({ points: [wx+2, this._wavMidCH1 - alarmRatio*wavAmp,    wx+ww-2, this._wavMidCH1 - alarmRatio*wavAmp],    stroke: 'rgba(239,83,80,0.35)',  strokeWidth: 0.8, dash: [3,3] }));
        this.group.add(new Konva.Text({ x: wx+ww-24, y: this._wavMidCH1 - preAlarmRatio*wavAmp - 9, text: 'PRE', fontSize: 7, fill: 'rgba(255,213,79,0.7)' }));
        this.group.add(new Konva.Text({ x: wx+ww-24, y: this._wavMidCH1 - alarmRatio*wavAmp - 9,    text: 'ALM', fontSize: 7, fill: 'rgba(239,83,80,0.7)' }));

        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'CH1 测量', fontSize: 8, fill: '#42a5f5' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+5, text: 'CH2 参考', fontSize: 8, fill: '#66bb6a' }));

        this._wCH1Lbl = new Konva.Text({ x: wx+ww-80, y: wy+16, width: 76, text: '--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#42a5f5', align: 'right' });
        this._wCH2Lbl = new Konva.Text({ x: wx+ww-80, y: wy+wh/2+5, width: 76, text: '--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });

        this.group.add(bg, titleBg, this._wLineCH1, this._wLineCH2, this._wCH1Lbl, this._wCH2Lbl);
    }

    // ── 拖拽设置 ─────────────────────────────
    _setupDrag() {
        const hit = new Konva.Rect({ x: this._cellX, y: this._cellY, width: this._cellW, height: this._cellH, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartC = this._manualConc;
            this._dragActive = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this._manualConc = Math.max(0, Math.min(this.maxLEL, this._dragStartC + (this._dragStartY - cy) * 0.06));
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
                this._tickOpticalViz(dt);
                this._tickCANBus(dt);
                this._tickWaveforms(dt);
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

    // ── 物理计算 ─────────────────────────────
    _tickPhysics(dt) {
        this.concentration = this._manualConc;
        // CH1 有油雾，CH2 参考（很低），加一点噪声
        this.ch1Value = this.concentration + (Math.random() - 0.5) * 0.05;
        this.ch2Value = 0.05 + (Math.random() - 0.5) * 0.02;

        this.isPreAlarm = this.concentration >= this.preAlarmLEL && this.concentration < this.alarmLEL;
        this.isAlarm    = this.concentration >= this.alarmLEL;
        this.isFault    = this.isBreak;

        this._lightPhase += dt * 8;

        // LED 辉光
        const glow = 0.25 + 0.25 * Math.abs(Math.sin(this._lightPhase));
        if (this._led1Glow) this._led1Glow.fill(`rgba(255,109,0,${glow})`);
        if (this._led2Glow) this._led2Glow.fill(`rgba(102,187,106,${glow * 0.7})`);

        // 浓度弧
        if (this._concArc) {
            const ratio = Math.min(1, this.concentration / this.maxLEL);
            this._concArc.angle(ratio * 360);
            this._concArc.fill(this.isAlarm ? '#ef5350' : this.isPreAlarm ? '#ffd54f' : '#4dd0e1');
        }

        // 报警 LED
        if (this._alarmLeds && this._alarmLeds.length === 3) {
            const [norm, pre, alm] = this._alarmLeds;
            const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this._lightPhase * 3));
            norm.led.fill(!this.isPreAlarm && !this.isAlarm && !this.isFault ? norm.col : '#1a1a1a');
            pre.led.fill(this.isPreAlarm ? `rgba(255,213,79,${pulse})` : '#1a1a1a');
            alm.led.fill(this.isAlarm ? `rgba(244,67,54,${pulse})` : '#1a1a1a');
        }
    }

    // ── 光学可视化（散射颗粒 + 光束）────────
    _tickOpticalViz(dt) {
        this._oilMistGroup.destroyChildren();
        this._lightBeamGroup.destroyChildren();

        const cx  = this._optCX;
        const conc= this.concentration;
        const alpha = conc / this.maxLEL;

        // ── CH1 光束（IR 光，橙色）──
        const ch1Y    = this._ch1TubeY;
        const beamLen = this._tubeW;
        const beamX0  = this._tubeLeftX;

        // 透射光（随浓度衰减）
        const transRatio = Math.max(0, 1 - alpha * 0.8);
        this._lightBeamGroup.add(new Konva.Rect({
            x: beamX0, y: ch1Y - 4,
            width: beamLen * transRatio, height: 8,
            fill: `rgba(255,140,0,${0.35 + 0.3 * Math.abs(Math.sin(this._lightPhase))})`,
        }));

        // 散射光辉光（随浓度增强）
        if (alpha > 0.05) {
            const scatterGlow = alpha * 0.6;
            for (let i = 0; i < 6; i++) {
                const px2 = beamX0 + (i+1) * beamLen / 7;
                const py2 = ch1Y + (Math.random() - 0.5) * 12;
                this._oilMistGroup.add(new Konva.Circle({
                    x: px2, y: py2,
                    radius: 3 + alpha * 4,
                    fill: `rgba(255,213,79,${scatterGlow * 0.6})`,
                }));
            }
        }

        // ── 油雾颗粒云（仅 CH1）──
        const numParticles = Math.floor(alpha * 20);
        for (let i = 0; i < numParticles; i++) {
            const px2 = beamX0 + 4 + (i * 17 + Math.sin(this._lightPhase * 0.5 + i) * 8) % (beamLen - 8);
            const py2 = ch1Y + (Math.random() - 0.5) * (this._tubeH - 4);
            const pr  = 1.5 + (i % 3) * 1.2;
            this._oilMistGroup.add(new Konva.Circle({
                x: px2, y: py2, radius: pr,
                fill: `rgba(255,${Math.round(180+Math.random()*60)},${Math.round(50+Math.random()*50)},${0.4+alpha*0.5})`,
            }));
        }

        // 测量腔颜色
        const r  = Math.round(10 + alpha*40), g = Math.round(15 + alpha*15), b = Math.round(25);
        if (this._ch1Tube) this._ch1Tube.fill(`rgb(${r},${g},${b})`);

        // ── CH2 光束（绿色参考，基本不衰减）──
        const ch2Y = this._ch2TubeY;
        this._lightBeamGroup.add(new Konva.Rect({
            x: beamX0, y: ch2Y - 4,
            width: beamLen, height: 8,
            fill: `rgba(100,200,100,${0.25 + 0.15 * Math.abs(Math.sin(this._lightPhase))})`,
        }));
    }

    // ── CAN 总线 ─────────────────────────────
    _tickCANBus(dt) {
        this._canTxAnim = Math.max(0, this._canTxAnim - dt * 3);

        this._canTimer -= dt;
        if (this._canTimer > 0) {
            if (this._canHBus) {
                const w = (this._canW-8) * Math.min(1, this._canTxAnim * 0.9);
                this._canHBus.width(w);
                this._canLBus.width(w);
            }
            return;
        }
        this._canTimer = this._canPeriod;
        this._canTxAnim = 1.0;

        // 构建 CAN 帧
        const ch1Int  = Math.round(this.ch1Value * 10);
        const ch2Int  = Math.round(this.ch2Value * 10);
        const status  = (this.isPreAlarm ? 1 : 0) | (this.isAlarm ? 2 : 0) | (this.isFault ? 4 : 0);
        this._frameBuffer[0] = status;
        this._frameBuffer[1] = (ch1Int >> 8) & 0xFF;
        this._frameBuffer[2] = ch1Int & 0xFF;
        this._frameBuffer[3] = (ch2Int >> 8) & 0xFF;
        this._frameBuffer[4] = ch2Int & 0xFF;
        this._frameBuffer[5] = this.ledIntensity;
        this._frameBuffer[6] = Math.round(this.tempC) & 0xFF;
        let xor = 0; for (let i = 0; i < 7; i++) xor ^= this._frameBuffer[i];
        this._frameBuffer[7] = xor;

        const canId  = 0x200 + this.nodeId;
        const now    = new Date();
        const ts2    = `${now.getSeconds().toString().padStart(2,'0')}.${Math.floor(now.getMilliseconds()/10).toString().padStart(2,'0')}`;
        const hexStr = Array.from(this._frameBuffer).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
        const entry  = { text: `[${ts2}] ID:0x${canId.toString(16).toUpperCase()} DLC:8  ${hexStr}`, col: this.isAlarm ? '#ef9a9a' : this.isPreAlarm ? '#ffd54f' : '#80cbc4' };

        this._canLog.unshift(entry);
        if (this._canLog.length > this._canLogMax) this._canLog.pop();

        this._canLogNodes.forEach((node, i) => {
            const item = this._canLog[i];
            if (item) {
                node.text(item.text);
                node.fill(item.col);
                node.opacity(Math.max(0.25, 1 - i * 0.18));
            } else {
                node.text('');
                node.opacity(0);
            }
        });
    }

    // ── 波形缓冲 ─────────────────────────────
    _tickWaveforms(dt) {
        this._wavAcc += 1.4 * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        for (let i = 0; i < steps; i++) {
            this._wavCH1 = new Float32Array([...this._wavCH1.slice(1), this.ch1Value]);
            this._wavCH2 = new Float32Array([...this._wavCH2.slice(1), this.ch2Value]);
        }

        const wx = this._wavX+3, wy2 = this._wavY;
        const ww = this._wavW-6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;
        const amp= wh * 0.20;

        const ch1Pts = [], ch2Pts = [];
        for (let i = 0; i < n; i++) {
            const x = wx + i * dx;
            ch1Pts.push(x, this._wavMidCH1 - (this._wavCH1[i]/this.maxLEL) * amp);
            ch2Pts.push(x, this._wavMidCH2 - (this._wavCH2[i]/this.maxLEL) * amp);
        }
        if (this._wLineCH1) this._wLineCH1.points(ch1Pts);
        if (this._wLineCH2) this._wLineCH2.points(ch2Pts);

        if (this._wCH1Lbl) this._wCH1Lbl.text(`${this.ch1Value.toFixed(2)} %LEL`);
        if (this._wCH2Lbl) this._wCH2Lbl.text(`${this.ch2Value.toFixed(3)} %LEL`);
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const br = this.isBreak;
        if (br) {
            if (this._lcdMain) { this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350'); }
            if (this._lcdStatus) this._lcdStatus.text('FAULT');
            return;
        }

        const c = this.concentration;
        const mc = this.isAlarm ? '#ef5350' : this.isPreAlarm ? '#ffd54f' : '#4dd0e1';

        if (this._lcdBg)    this._lcdBg.fill('#020408');
        if (this._lcdMain)  { this._lcdMain.text(c.toFixed(1)); this._lcdMain.fill(mc); }
        if (this._lcdUnit)  this._lcdUnit.text('%LEL');
        if (this._lcdCH12) this._lcdCH12.text(`${this.ch1Value.toFixed(2)}/${this.ch2Value.toFixed(3)}`);
        if (this._lcdStatus) {
            const stStr = this.isAlarm ? '⚠ ALARM' : this.isPreAlarm ? '! PRE-ALM' : 'NORMAL';
            const stCol = this.isAlarm ? '#ef5350' : this.isPreAlarm ? '#ffd54f' : '#66bb6a';
            this._lcdStatus.text(stStr); this._lcdStatus.fill(stCol);
        }
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(concentration) {
        if (typeof concentration === 'number') {
            this._manualConc = Math.max(0, Math.min(this.maxLEL, concentration));
        }
        this._refreshCache();
    }

    triggerCanQuery(canId, data) {
        this._canTxAnim = 1.0;
        const ts2 = new Date().getSeconds().toString().padStart(2,'0');
        this._canLog.unshift({ text: `[${ts2}] REQ ID:0x${canId.toString(16).toUpperCase()} ${data}`, col: '#b0bec5' });
        if (this._canLog.length > this._canLogMax) this._canLog.pop();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',           type: 'text'   },
            { label: 'CAN 节点 ID (1~8)',   key: 'nodeId',       type: 'number' },
            { label: 'CAN 波特率 (kbps)',   key: 'canBaudrate',  type: 'number' },
            { label: '预警阈值 (%LEL)',      key: 'preAlarmLEL',  type: 'number' },
            { label: '主报警阈值 (%LEL)',    key: 'alarmLEL',     type: 'number' },
            { label: '量程上限 (%LEL)',      key: 'maxLEL',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.nodeId      = parseInt(cfg.nodeId)      || this.nodeId;
        this.canBaudrate = parseInt(cfg.canBaudrate) || this.canBaudrate;
        this.preAlarmLEL = parseFloat(cfg.preAlarmLEL) || this.preAlarmLEL;
        this.alarmLEL    = parseFloat(cfg.alarmLEL)    || this.alarmLEL;
        this.maxLEL      = parseFloat(cfg.maxLEL)      || this.maxLEL;
        this.config      = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}