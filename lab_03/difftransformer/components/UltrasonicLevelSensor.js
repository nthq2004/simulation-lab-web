import { BaseComponent } from './BaseComponent.js';

/**
 * 超声波液位计仿真组件（Time-of-Flight Ultrasonic Level Transmitter）
 *
 * ── 测量原理（飞行时间法）──────────────────────────────────
 *  传感器向下发射超声波脉冲，声波到达液面后反射回来，
 *  测量从发射到接收的时间差 t（飞行时间）：
 *
 *    D = c · t / 2
 *
 *  液位：
 *    H = R − D − d_blind
 *
 *  其中：
 *    D       — 传感器到液面距离 (m)
 *    c       — 声速 (m/s)，默认空气 343 m/s
 *    t       — 飞行时间 (s)
 *    R       — 量程距离（传感器到罐底）(m)
 *    d_blind — 盲区距离 (m)（发射余震导致）
 *
 *  温度补偿声速：c = 331.4 + 0.6 × T(°C)
 *
 * ── 组件结构 ────────────────────────────────────────────────
 *  ① 传感器头（圆形超声波探头外观）
 *  ② 超声波波束动画（发射扇形 + 回波）
 *  ③ 被测储罐截面（可拖拽调节液位）
 *  ④ A-Scan 回波信号示波器（展示发射脉冲 + 回波信号）
 *  ⑤ 温度补偿指示（声速随温度变化）
 *  ⑥ 接线盒 + 圆形 OLED 显示
 *  ⑦ 底部综合数据面板
 *
 * ── 输出 ────────────────────────────────────────────────────
 *  4-20mA 模拟量（对应液位 0~100%）
 *  可选继电器报警输出（高/低报）
 *
 * ── 端口 ────────────────────────────────────────────────────
 *  wire_p  — 24VDC +
 *  wire_n  — 4-20mA / GND
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'none'（纯电气仪表）
 *  update(level) — 外部注入液位 % 或由内部拖拽设定
 */
export class UltrasonicLevelSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 340);
        this.height = Math.max(320, config.height || 370);

        this.type    = 'ultrasonic_level';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.rangeMax    = config.rangeMax    || 5.0;    // 量程距离 m（传感器→罐底）
        this.blindZone   = config.blindZone   || 0.3;    // 盲区 m
        this.tempC       = config.tempC       || 20;     // 环境温度 °C
        this.freqKHz     = config.freqKHz     || 40;     // 超声波频率 kHz（常见 40/200kHz）
        this.beamAngle   = config.beamAngle   || 8;      // 波束角 °（半角）
        this.hiAlarm     = config.hiAlarm     || 85;     // 高报 %
        this.loAlarm     = config.loAlarm     || 15;     // 低报 %

        // 动态声速（温度补偿）
        this.soundSpeed  = 331.4 + 0.6 * this.tempC;

        // ── 零点/量程 ──
        this.zeroAdj     = 0;
        this.spanAdj     = 1.0;

        // ── 状态 ──
        this.liquidLevel = config.initLevel   || 50;     // % (0~100)
        this.distance    = 0;     // 当前距离 m
        this.tof         = 0;     // 飞行时间 μs
        this.outCurrent  = 12;
        this.isBreak     = false;
        this.powered     = false;
        this.alarmHi     = false;
        this.alarmLo     = false;

        // ── 超声波波束动画 ──
        this._beamPulses  = [];    // 发射脉冲列表
        this._echoPulses  = [];    // 回波列表
        this._emitTimer   = 0;
        this._emitPeriod  = 0.4;   // 发射周期 s

        // ── A-Scan 示波器 ──
        this._ascanBuf    = new Float32Array(256).fill(0);  // A-scan 幅度缓冲
        this._ascanPhase  = 0;
        this._ascanUpdate = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartLv = 0;

        // ── 几何布局 ──
        //  传感器区（左上，探头 + 波束）
        this._sensorX   = 16;
        this._sensorY   = 28;
        this._sensorW   = Math.round(this.width * 0.46);
        this._sensorH   = Math.round(this.height * 0.52);

        //  储罐区（右侧）
        this._tankX     = this._sensorX + this._sensorW + 14;
        this._tankY     = this._sensorY;
        this._tankW     = this.width - this._tankX - 10;
        this._tankH     = Math.round(this.height * 0.58);

        //  A-scan 示波器（左下）
        this._oscX      = this._sensorX;
        this._oscY      = this._sensorY + this._sensorH + 10;
        this._oscW      = this._sensorW;
        this._oscH      = Math.round(this.height * 0.28);

        //  仪表头（右下）
        this._headX     = this._tankX;
        this._headY     = this._tankY + this._tankH + 10;
        this._headW     = this._tankW;
        this._headH     = this.height - this._headY - 8;

        this._panelY    = this.height - 44;

        this._lastTs    = null;
        this._animId    = null;
        this.knobs      = {};

        this.config = {
            id: this.id, rangeMax: this.rangeMax,
            blindZone: this.blindZone, tempC: this.tempC,
            freqKHz: this.freqKHz, beamAngle: this.beamAngle,
        };

        this._init();

        this.addPort(this.width, this._headY + 14, 'p', 'wire', 'V+');
        this.addPort(this.width, this._headY + 36, 'n', 'wire', '4-20');
    }

    _init() {
        this._drawLabel();
        this._drawSensorHead();
        this._drawBeamLayer();
        this._drawTank();
        this._drawTankDynamic();
        this._drawAScan();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawBottomPanel();
        this._setupDrag();
        this._startAnimation();
    }

    // ── 标签 ──────────────────────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '超声波液位计', fontSize: 14,
            fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 传感器头（顶部安装于储罐上方）────────
    _drawSensorHead() {
        const cx = this._sensorX + this._sensorW / 2;
        const sy = this._sensorY;

        // 安装法兰板
        const flangeW = this._sensorW * 0.68, flangeH = 12;
        this.group.add(new Konva.Rect({
            x: cx - flangeW/2, y: sy,
            width: flangeW, height: flangeH,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 1, cornerRadius: 2,
        }));
        // 法兰螺孔
        [-flangeW*0.38, flangeW*0.38].forEach(dx => {
            this.group.add(new Konva.Circle({ x: cx+dx, y: sy+6, radius: 3.5, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
        });

        // 主体外壳（深蓝灰色，圆柱）
        const bodyW = this._sensorW * 0.48, bodyH = 44;
        const bodyY = sy + flangeH;
        this.group.add(new Konva.Rect({
            x: cx - bodyW/2, y: bodyY,
            width: bodyW, height: bodyH,
            fill: '#2c3e50', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: [3,3,0,0],
        }));
        // 主体高光
        this.group.add(new Konva.Rect({
            x: cx - bodyW/2 + 2, y: bodyY+2,
            width: 6, height: bodyH-4,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: 2,
        }));

        // 压电晶片圆形探头面（朝下，发射超声波）
        const probeR = bodyW * 0.38;
        const probeY = bodyY + bodyH;
        const outerRing = new Konva.Circle({
            x: cx, y: probeY, radius: probeR + 5,
            fill: '#1a252f', stroke: '#0d1520', strokeWidth: 1,
        });
        const innerRing = new Konva.Circle({
            x: cx, y: probeY, radius: probeR + 3,
            fill: '#263238', stroke: '#1565c0', strokeWidth: 2,
        });
        this._probeFace = new Konva.Circle({
            x: cx, y: probeY, radius: probeR,
            fill: '#1565c0',
        });
        // 探头面同心圆纹（压电晶片感）
        for (let r = probeR * 0.3; r < probeR; r += probeR * 0.28) {
            this.group.add(new Konva.Circle({
                x: cx, y: probeY, radius: r,
                fill: 'none', stroke: 'rgba(100,181,246,0.25)', strokeWidth: 0.8,
            }));
        }
        // 探头发射指示 LED
        this._emitLed = new Konva.Circle({
            x: cx + bodyW/2 - 8, y: bodyY + 8,
            radius: 3.5, fill: '#1a1a1a',
        });
        // 接收指示 LED
        this._recvLed = new Konva.Circle({
            x: cx + bodyW/2 - 8, y: bodyY + 20,
            radius: 3.5, fill: '#1a1a1a',
        });
        this.group.add(new Konva.Text({ x: cx - bodyW/2 + 2, y: bodyY + 5, text: 'TX', fontSize: 8, fill: '#546e7a' }));
        this.group.add(new Konva.Text({ x: cx - bodyW/2 + 2, y: bodyY + 17, text: 'RX', fontSize: 8, fill: '#546e7a' }));

        this._probeCX = cx;
        this._probeY  = probeY;
        this._probeR  = probeR;

        this.group.add(outerRing, innerRing, this._probeFace, this._emitLed, this._recvLed);

        // 铭牌
        this.group.add(new Konva.Text({
            x: cx - bodyW/2, y: bodyY + bodyH - 14,
            width: bodyW, text: `${this.freqKHz}kHz`,
            fontSize: 8, fill: '#80cbc4', align: 'center',
        }));

        // 导线到仪表头
        const lineY = bodyY + 8;
        this.group.add(new Konva.Line({
            points: [cx + bodyW/2, lineY, this._headX, lineY, this._headX, this._headY + 14],
            stroke: '#546e7a', strokeWidth: 1.5, dash: [3,2], lineCap: 'round', lineJoin: 'round',
        }));
    }

    // ── 波束动画层 ─────────────────────────────
    _drawBeamLayer() {
        this._beamGroup = new Konva.Group();
        this.group.add(this._beamGroup);
    }

    // ── 储罐外壳（静态）──────────────────────
    _drawTank() {
        const tx = this._tankX, ty = this._tankY;
        const tw = this._tankW, th = this._tankH;

        // 罐体标签
        this.group.add(new Konva.Text({
            x: tx, y: ty - 16, width: tw,
            text: '被测储罐', fontSize: 10, fontStyle: 'bold', fill: '#37474f', align: 'center',
        }));

        // 外壁
        const outer = new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 2, cornerRadius: [4,4,0,0],
        });
        // 内壁底色
        this._tankInner = new Konva.Rect({
            x: tx+4, y: ty+4, width: tw-8, height: th-4,
            fill: '#e8eef2', stroke: '#b0bec5', strokeWidth: 0.5,
        });
        // 底板
        const bottom = new Konva.Rect({
            x: tx, y: ty+th, width: tw, height: 6,
            fill: '#90a4ae', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,0,3,3],
        });
        // 量程刻度（右侧）
        for (let i = 0; i <= 5; i++) {
            const ly = ty + (th * i) / 5;
            this.group.add(new Konva.Line({ points: [tx+tw, ly, tx+tw+8, ly], stroke: '#78909c', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: tx+tw+10, y: ly-5, text: `${100-i*20}%`, fontSize: 8, fill: '#607d8b' }));
        }
        // 盲区警示线（虚线）
        const blindY = ty + (this.blindZone / this.rangeMax) * th;
        this._blindLine = new Konva.Line({
            points: [tx+4, blindY, tx+tw-4, blindY],
            stroke: '#ff8f00', strokeWidth: 1, dash: [5,3],
        });
        this.group.add(new Konva.Text({
            x: tx+6, y: blindY+2,
            text: '盲区', fontSize: 7.5, fill: '#ff8f00',
        }));

        // 超声波发射器位置标记（罐顶中心小箭头）
        this.group.add(new Konva.Line({
            points: [tx+tw/2, ty-2, tx+tw/2, ty+8],
            stroke: '#1565c0', strokeWidth: 2, lineCap: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [tx+tw/2-5, ty+5, tx+tw/2, ty+10, tx+tw/2+5, ty+5],
            stroke: '#1565c0', strokeWidth: 1.5, lineJoin: 'round',
        }));

        this.group.add(outer, this._tankInner, bottom, this._blindLine);
    }

    // ── 动态层（液面 + 波束在罐内）──────────
    _drawTankDynamic() {
        // 液体矩形
        this._liquidRect = new Konva.Rect({
            x: this._tankX+4, y: this._tankY+4,
            width: this._tankW-8, height: 0,
            fill: '#29b6f6', opacity: 0.78,
        });
        // 液面反光
        this._liquidSurf = new Konva.Rect({
            x: this._tankX+4, y: this._tankY+4,
            width: this._tankW-8, height: 4,
            fill: 'rgba(255,255,255,0.25)',
        });
        // 距离标注线（传感器→液面）
        this._distArrow = new Konva.Group();
        // 波束在罐内（扇形）
        this._tankBeamGroup = new Konva.Group();
        // 液面波纹
        this._surfaceRipple = new Konva.Group();

        // 高低报警指示线
        const ty = this._tankY, th = this._tankH;
        const hiY = ty + th * (1 - this.hiAlarm/100);
        const loY = ty + th * (1 - this.loAlarm/100);
        this._hiAlarmLine = new Konva.Line({
            points: [this._tankX+4, hiY, this._tankX+this._tankW-4, hiY],
            stroke: '#ef5350', strokeWidth: 1, dash: [4,3], opacity: 0.5,
        });
        this._loAlarmLine = new Konva.Line({
            points: [this._tankX+4, loY, this._tankX+this._tankW-4, loY],
            stroke: '#ff9800', strokeWidth: 1, dash: [4,3], opacity: 0.5,
        });

        this.group.add(this._liquidRect, this._liquidSurf, this._hiAlarmLine, this._loAlarmLine, this._tankBeamGroup, this._surfaceRipple, this._distArrow);
    }

    // ── A-Scan 示波器 ─────────────────────────
    _drawAScan() {
        const { _oscX: ox, _oscY: oy, _oscW: ow, _oscH: oh } = this;

        const bg = new Konva.Rect({
            x: ox, y: oy, width: ow, height: oh,
            fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4,
        });
        // 标题条
        const titleBg = new Konva.Rect({ x: ox, y: oy, width: ow, height: 14, fill: '#0c1e30', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: ox+4, y: oy+2, width: ow-8, text: 'A-Scan  回波信号', fontSize: 8, fontStyle: 'bold', fill: '#00bcd4', align: 'center' }));

        // 网格线
        for (let i = 1; i < 4; i++) {
            this.group.add(new Konva.Line({ points: [ox, oy+oh*i/4, ox+ow, oy+oh*i/4], stroke: 'rgba(0,188,212,0.08)', strokeWidth: 0.5 }));
        }
        for (let i = 1; i < 5; i++) {
            this.group.add(new Konva.Line({ points: [ox+ow*i/5, oy, ox+ow*i/5, oy+oh], stroke: 'rgba(0,188,212,0.06)', strokeWidth: 0.5 }));
        }

        // 信号线（发射脉冲 + 回波）
        this._ascanLine = new Konva.Line({ points: [], stroke: '#00e5ff', strokeWidth: 1.5, lineJoin: 'round' });
        // 发射脉冲标注
        this._txMarker = new Konva.Rect({ x: ox+2, y: oy+14, width: 10, height: oh-18, fill: 'rgba(255,213,79,0.08)', cornerRadius: 1 });
        // 回波标注
        this._echoMarker = new Konva.Rect({ x: ox, y: oy+14, width: 10, height: oh-18, fill: 'rgba(0,229,255,0.08)', cornerRadius: 1 });
        // 时间轴标签
        this._oscTofLabel = new Konva.Text({ x: ox+4, y: oy+oh-12, text: 'TOF=-- ms', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#546e7a' });
        this._oscDistLabel = new Konva.Text({ x: ox+4, y: oy+16, text: 'D=-- m', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#00bcd4' });
        // 盲区阴影
        this._oscBlindRect = new Konva.Rect({ x: ox+2, y: oy+14, width: 0, height: oh-18, fill: 'rgba(255,152,0,0.12)', cornerRadius: 1 });

        this.group.add(bg, titleBg, this._txMarker, this._echoMarker, this._oscBlindRect, this._ascanLine, this._oscTofLabel, this._oscDistLabel);
    }

    // ── 仪表头 ─────────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        // 顶部接线盒
        const jBox = new Konva.Rect({
            x: hx, y: hy, width: hw, height: 44,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0],
        });
        for (let i = 0; i < 3; i++) {
            this.group.add(new Konva.Line({ points: [hx, hy+8+i*10, hx+hw, hy+8+i*10], stroke: 'rgba(255,255,255,0.16)', strokeWidth: 0.8 }));
        }
        const plate = new Konva.Rect({ x: hx+10, y: hy+5, width: hw-20, height: 24, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+10, y: hy+8, width: hw-20, text: this.id || 'LT-701', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+10, y: hy+19, width: hw-20, text: `${this.freqKHz}kHz ULTRASONIC`, fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+4, width: 10, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+4, width: 10, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });

        // 主体
        const body = new Konva.Rect({
            x: hx, y: hy+44, width: hw, height: hh-44,
            fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4],
        });

        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD 显示 ─────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH - 44) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 38);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const midRing = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#004d61', stroke: '#006064', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020e14' });

        // 液位比例弧
        this._lvArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#00bcd4', rotation: -90 });

        this._lcdMain    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'--.-', fontSize:R*.37, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#00e5ff', align:'center' });
        this._lcdUnit    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'%',   fontSize:R*.18, fill:'#006064', align:'center' });
        this._lcdDist    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.30, width:(R-4)*2, text:'D=-- m', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdCurrent = new Konva.Text({ x: lcx-R+4, y: lcy-R*.58, width:(R-4)*2, text:'4.00 mA', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdTemp    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.48, width:(R-4)*2, text:'T=-- °C', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(midRing, this._lcdBg, this._lvArc, this._lcdMain, this._lcdUnit, this._lcdDist, this._lcdCurrent, this._lcdTemp);
    }

    // ── 旋钮 ──────────────────────────────────
    _drawKnobs() {
        const hx = this._headX, hw = this._headW;
        const ky  = this._lcCY + this._lcR + 14;
        [{ id:'zero', x: hx + hw*.28, label:'Z' }, { id:'span', x: hx + hw*.72, label:'S' }].forEach(k => {
            const g = new Konva.Group({ x: k.x, y: ky });
            g.add(new Konva.Circle({ radius: 10, fill:'#cfd8dc', stroke:'#90a4ae', strokeWidth:1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius:7.5, fill:'#eceff1', stroke:'#37474f', strokeWidth:1 }));
            rotor.add(new Konva.Line({ points:[0,-6.5,0,6.5], stroke:'#37474f', strokeWidth:2.5, lineCap:'round' }));
            g.add(rotor, new Konva.Text({ x:-5, y:12, text:k.label, fontSize:9, fontStyle:'bold', fill:'#607d8b' }));
            this.knobs[k.id] = rotor;
            rotor.on('mousedown touchstart', e => {
                e.cancelBubble = true;
                const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const sr = rotor.rotation();
                const mv = me => { const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0; rotor.rotation(sr+(sy-cy)*2); if(k.id==='zero') this.zeroAdj=(rotor.rotation()/360)*0.05; else this.spanAdj=1+(rotor.rotation()/360)*0.3; };
                const up = () => { window.removeEventListener('mousemove',mv); window.removeEventListener('touchmove',mv); window.removeEventListener('mouseup',up); window.removeEventListener('touchend',up); };
                window.addEventListener('mousemove',mv); window.addEventListener('touchmove',mv);
                window.addEventListener('mouseup',up); window.addEventListener('touchend',up);
            });
            this.group.add(g);
        });
    }

    // ── 底部面板 ───────────────────────────────
    _drawBottomPanel() {
        const py = this._panelY;
        const pw = this.width - 8;
        const bg = new Konva.Rect({ x:4, y:py, width:pw, height:40, fill:'#050d18', stroke:'#1a3040', strokeWidth:1, cornerRadius:4 });
        this._panelLv    = new Konva.Text({ x:10, y:py+5,  width:pw*.45, text:'液位: -- %',   fontSize:9, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#00cdd7' });
        this._panelDist  = new Konva.Text({ x:10, y:py+20, width:pw*.45, text:'距离: -- m',   fontSize:8, fontFamily:'Courier New, monospace', fill:'#546e7a' });
        this._panelSt    = new Konva.Text({ x:pw*.48+4, y:py+5,  width:pw*.5, text:'● 正常', fontSize:9, fontStyle:'bold', fill:'#66bb6a', align:'right' });
        this._panelTof   = new Konva.Text({ x:pw*.48+4, y:py+20, width:pw*.5, text:'TOF=-- ms', fontSize:8, fontFamily:'Courier New, monospace', fill:'#37474f', align:'right' });
        this.group.add(bg, this._panelLv, this._panelDist, this._panelSt, this._panelTof);
    }

    // ── 拖拽 ───────────────────────────────────
    _setupDrag() {
        const tx = this._tankX, ty = this._tankY, th = this._tankH;
        const hit = new Konva.Rect({ x:tx, y:ty, width:this._tankW, height:th, fill:'transparent', listening:true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._dragStartY  = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartLv = this.liquidLevel;
            this._dragActive  = true;
        });
        const mv = e => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            this.liquidLevel = Math.max(0, Math.min(100, this._dragStartLv + (this._dragStartY - cy) / th * 100));
        };
        const up = () => { this._dragActive = false; };
        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive:true });
        window.addEventListener('mouseup',   up);
        window.addEventListener('touchend',  up);
        this.group.add(hit);
    }

    // ═══════════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickBeamAnimation(dt);
                this._tickTankVisual(dt);
                this._tickAScan(dt);
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

    // ── 物理计算 ───────────────────────────────
    _tickPhysics(dt) {
        // 温度补偿声速
        this.soundSpeed = 331.4 + 0.6 * this.tempC;

        // 距离 = (量程 - 液位对应高度) + 盲区
        const H = (this.liquidLevel / 100) * (this.rangeMax - this.blindZone);
        this.distance = Math.max(this.blindZone, this.rangeMax - H);

        // 飞行时间（ms）
        this.tof = (this.distance / this.soundSpeed) * 2 * 1000;

        // 调整后液位
        const adjLv  = Math.max(0, Math.min(100, (this.liquidLevel + this.zeroAdj * 100) * this.spanAdj));
        this.outCurrent = 4 + Math.min(1, adjLv/100) * 16;
        if (this.isBreak) this.outCurrent = 1.8;
        if (!this.powered) this.outCurrent = 0;

        // 报警
        this.alarmHi = this.liquidLevel > this.hiAlarm;
        this.alarmLo = this.liquidLevel < this.loAlarm;

        // 液位弧
        if (this._lvArc) this._lvArc.angle(Math.min(360, (adjLv/100) * 360));

        // 探头发射/接收 LED
        if (this._emitLed) this._emitLed.fill(this.powered && !this.isBreak && this._beamPulses.length > 0 ? '#ffee58' : '#1a1a1a');
        if (this._recvLed) this._recvLed.fill(this.powered && !this.isBreak && this._echoPulses.length > 0 ? '#00e5ff' : '#1a1a1a');

        // 定时发射
        if (this.powered && !this.isBreak) {
            this._emitTimer -= dt;
            if (this._emitTimer <= 0) {
                this._emitTimer = this._emitPeriod;
                this._emitBeam();
            }
        }
    }

    // ── 发射波束 ────────────────────────────────
    _emitBeam() {
        this._beamPulses.push({ progress: 0, alpha: 0.85 });
    }

    // ── 波束动画 ───────────────────────────────
    _tickBeamAnimation(dt) {
        const active = this.powered && !this.isBreak;

        // 传播速度（视觉，0~1 在 0.18s 内走完）
        const travelTime = 0.18;
        const speed      = 1 / travelTime;

        this._beamPulses = this._beamPulses.filter(p => {
            p.progress += speed * dt;
            p.alpha     = Math.max(0, 0.85 - p.progress * 0.7);
            // 到达液面时产生回波
            if (p.progress >= 1 && !p._echoed) {
                p._echoed = true;
                this._echoPulses.push({ progress: 0, alpha: 0.8 });
            }
            return p.alpha > 0.02;
        });
        this._echoPulses = this._echoPulses.filter(p => {
            p.progress += speed * dt;
            p.alpha     = Math.max(0, 0.8 - p.progress * 0.75);
            return p.alpha > 0.02;
        });

        // 重建波束节点
        this._beamGroup.destroyChildren();
        this._tankBeamGroup.destroyChildren();
        this._surfaceRipple.destroyChildren();

        if (!active) return;

        const cx = this._probeCX;
        const py = this._probeY;
        const beamAngle = this.beamAngle * Math.PI / 180;

        // ---- 传感器区波束（向下发射，扇形） ----
        const sensorRegionH = this._sensorY + this._sensorH - py;

        this._beamPulses.forEach(p => {
            // 扇形发射区（从探头面向下扩散）
            const maxDist = sensorRegionH * 1.4;
            const waveDist = p.progress * maxDist * 0.8;
            const beamW    = waveDist * Math.tan(beamAngle);

            // 发射波弧
            const color = `rgba(255,213,79,${p.alpha * 0.6})`;
            this._beamGroup.add(new Konva.Arc({
                x: cx, y: py,
                innerRadius: waveDist,
                outerRadius: waveDist + 4,
                angle: this.beamAngle * 2,
                rotation: 90 - this.beamAngle,
                fill: color,
            }));
            // 波束边界线
            this._beamGroup.add(new Konva.Line({
                points: [cx, py, cx - beamW, py + waveDist, cx + beamW, py + waveDist],
                stroke: `rgba(255,213,79,${p.alpha * 0.25})`,
                strokeWidth: 0.8, lineCap: 'round',
            }));
        });

        // ---- 储罐内波束 ----
        const tx = this._tankX + this._tankW / 2;
        const th = this._tankH;
        const liquidTop = this._tankY + 4 + (th-8) * (1 - this.liquidLevel/100);

        this._beamPulses.forEach(p => {
            const waveDist = p.progress * (liquidTop - this._tankY);
            const bw = Math.min(this._tankW/2 - 5, waveDist * Math.tan(beamAngle));
            const color = `rgba(255,213,79,${p.alpha * 0.55})`;
            this._tankBeamGroup.add(new Konva.Arc({
                x: tx, y: this._tankY,
                innerRadius: waveDist,
                outerRadius: waveDist + 3,
                angle: this.beamAngle * 2,
                rotation: 90 - this.beamAngle,
                fill: color,
            }));
        });

        // 回波（从液面向上）
        this._echoPulses.forEach(p => {
            const distFromSurf = p.progress * (liquidTop - this._tankY) * 0.9;
            const surfaceY = liquidTop - distFromSurf;
            const bw = Math.min(this._tankW/2 - 5, distFromSurf * Math.tan(beamAngle) + 4);
            this._tankBeamGroup.add(new Konva.Arc({
                x: tx, y: liquidTop,
                innerRadius: distFromSurf,
                outerRadius: distFromSurf + 3,
                angle: this.beamAngle * 2,
                rotation: 270 - this.beamAngle,  // 向上
                fill: `rgba(0,229,255,${p.alpha * 0.55})`,
            }));
        });

        // 液面波纹（回波到达时）
        if (this._echoPulses.length > 0 || this._beamPulses.some(p => p.progress > 0.9)) {
            for (let i = 0; i < 3; i++) {
                const phase = (Date.now() / 180 + i * 1.2) % (Math.PI * 2);
                const ripR  = 4 + i * 6 + Math.sin(phase) * 2;
                const ripA  = Math.max(0, 0.5 - i * 0.15) * (this.liquidLevel > 0 ? 1 : 0);
                if (ripA > 0) {
                    this._surfaceRipple.add(new Konva.Arc({
                        x: tx, y: liquidTop,
                        innerRadius: ripR, outerRadius: ripR + 1.5,
                        angle: 180, rotation: -90,
                        fill: `rgba(0,229,255,${ripA})`,
                    }));
                }
            }
        }

        // 距离标注（储罐内虚线）
        this._distArrow.destroyChildren();
        if (this.liquidLevel > 2) {
            const ax = this._tankX + this._tankW * 0.80;
            this._distArrow.add(new Konva.Line({
                points: [ax, this._tankY+4, ax, liquidTop],
                stroke: 'rgba(255,213,79,0.6)', strokeWidth: 1, dash:[4,3],
            }));
            // 箭头
            [[this._tankY+4, 5], [liquidTop, -5]].forEach(([ay, yd]) => {
                this._distArrow.add(new Konva.Line({
                    points: [ax-3, ay+yd, ax, ay, ax+3, ay+yd],
                    stroke: 'rgba(255,213,79,0.7)', strokeWidth: 1.2, lineJoin:'round',
                }));
            });
            this._distArrow.add(new Konva.Text({
                x: ax+4, y: this._tankY + (liquidTop-this._tankY)/2 - 5,
                text: `D=${this.distance.toFixed(2)}m`,
                fontSize: 8, fontFamily:'Courier New, monospace', fill:'rgba(255,213,79,0.7)',
            }));
        }
    }

    // ── 储罐液面视觉更新 ──────────────────────
    _tickTankVisual(dt) {
        const th = this._tankH - 8;
        const liquidH = Math.max(0, (this.liquidLevel/100) * th);
        const liquidTop = this._tankY + 4 + th - liquidH;

        this._liquidRect.y(liquidTop);
        this._liquidRect.height(liquidH);
        this._liquidSurf.y(liquidTop);

        // 液体颜色随液位
        const fr = this.liquidLevel / 100;
        this._liquidRect.fill(`rgb(${Math.round(20+fr*25)},${Math.round(140+fr*46)},${Math.round(210+fr*35)})`);

        // 报警线动态
        const tY = this._tankY, tH = this._tankH;
        const hiY = tY + tH * (1 - this.hiAlarm/100);
        const loY = tY + tH * (1 - this.loAlarm/100);
        this._hiAlarmLine.points([this._tankX+4, hiY, this._tankX+this._tankW-4, hiY]);
        this._loAlarmLine.points([this._tankX+4, loY, this._tankX+this._tankW-4, loY]);
        this._hiAlarmLine.stroke(this.alarmHi ? '#ef5350' : 'rgba(239,83,80,0.35)');
        this._loAlarmLine.stroke(this.alarmLo ? '#ff9800' : 'rgba(255,152,0,0.35)');
    }

    // ── A-Scan 示波器 ─────────────────────────
    _tickAScan(dt) {
        if (!this.powered || this.isBreak) {
            this._ascanLine.points([]);
            this._oscTofLabel.text('TOF=-- ms');
            this._oscDistLabel.text('D=-- m');
            return;
        }

        const ox = this._oscX + 2, oy = this._oscY;
        const ow = this._oscW - 4, oh = this._oscH;

        // 构建 A-scan 波形：发射脉冲（左侧）+ 回波（位置=飞行时间比例）
        const pts = [];
        const n   = 200;
        const mid = oy + oh * 0.55;    // 基线
        const amp = oh * 0.30;

        // 计算回波在时间轴上的位置比例
        const maxTof    = (this.rangeMax * 2 / this.soundSpeed) * 1000;  // ms
        const echoPos   = this.tof / maxTof;  // 0~1
        const blindPos  = (this.blindZone * 2 / this.soundSpeed) * 1000 / maxTof;

        // 更新盲区阴影
        this._oscBlindRect.x(ox + 2);
        this._oscBlindRect.width(Math.max(2, blindPos * ow * 0.92));

        // 发射脉冲标注位置
        this._txMarker.x(ox + 2);
        this._txMarker.width(ow * 0.04);

        // 回波标注
        this._echoMarker.x(ox + echoPos * ow * 0.92 - 4);
        this._echoMarker.width(8);

        for (let i = 0; i < n; i++) {
            const t  = i / n;
            const x  = ox + t * ow * 0.95;
            let   y  = mid;

            // 发射脉冲（0~3% 时间段）
            if (t < 0.03) {
                const phase = t / 0.03 * Math.PI * 4;
                y = mid - Math.sin(phase) * amp * 0.85 * Math.exp(-t * 30);
            }
            // 回波包络（以 echoPos 为中心的高斯包络 * 正弦）
            const dist = t - echoPos;
            if (Math.abs(dist) < 0.04 && t > blindPos) {
                const envelope = Math.exp(-dist*dist / 0.0004);
                const freq     = 40;
                y = mid - Math.sin(t * freq * Math.PI * 2) * amp * envelope * 0.75;
            }

            // 噪声底
            y += (Math.random() - 0.5) * oh * 0.02;
            pts.push(x, y);
        }

        this._ascanLine.points(pts);
        this._oscTofLabel.text(`TOF=${this.tof.toFixed(3)} ms`);
        this._oscDistLabel.text(`D=${this.distance.toFixed(3)} m`);
    }

    // ── 显示刷新 ───────────────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;
        const lv = this.liquidLevel;

        if (!pw) {
            this._lcdMain.text('----'); this._lcdMain.fill('#0d2030');
            this._lcdUnit.text(''); this._lcdDist.text(''); this._lcdTemp.text('');
            this._lcdCurrent.text('-- mA');
            this._panelSt.text('○ 断电'); this._panelSt.fill('#37474f');
            return;
        }
        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdUnit.text(''); this._lcdDist.text('ERR');
            this._lcdCurrent.text('1.8 mA');
            this._panelSt.text('⚠ 断线'); this._panelSt.fill('#ef5350');
            return;
        }

        const lvColor = this.alarmHi ? '#ff5722' : this.alarmLo ? '#ffa726' : '#00e5ff';
        const adjLv   = Math.max(0, Math.min(100, (lv + this.zeroAdj*100) * this.spanAdj));

        this._lcdBg.fill('#020e14');
        this._lcdMain.text(adjLv.toFixed(1)); this._lcdMain.fill(lvColor);
        this._lcdUnit.text('%');
        this._lcdDist.text(`D=${this.distance.toFixed(2)}m`);
        this._lcdCurrent.text(`${this.outCurrent.toFixed(2)} mA`);
        this._lcdTemp.text(`T=${this.tempC}°C`);

        const stStr = this.alarmHi ? '⬆ 高液位报警' : this.alarmLo ? '⬇ 低液位报警' : '● 正常运行';
        const stCol = this.alarmHi ? '#ff5722' : this.alarmLo ? '#ffa726' : '#66bb6a';
        this._panelSt.text(stStr); this._panelSt.fill(stCol);
        this._panelLv.text(`液位: ${adjLv.toFixed(1)} %`);
        this._panelDist.text(`距离: ${this.distance.toFixed(3)} m`);
        this._panelTof.text(`TOF=${this.tof.toFixed(3)} ms`);
    }

    // ═══════════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════════
    update(level) {
        if (typeof level === 'number') {
            this.liquidLevel = Math.max(0, Math.min(100, level));
        }
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════
    //  配置
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',        key: 'id',        type: 'text'   },
            { label: '量程距离 (m)',      key: 'rangeMax',  type: 'number' },
            { label: '盲区 (m)',          key: 'blindZone', type: 'number' },
            { label: '环境温度 (°C)',     key: 'tempC',     type: 'number' },
            { label: '频率 (kHz)',        key: 'freqKHz',   type: 'number' },
            { label: '波束角 (°)',        key: 'beamAngle', type: 'number' },
            { label: '高报阈值 (%)',      key: 'hiAlarm',   type: 'number' },
            { label: '低报阈值 (%)',      key: 'loAlarm',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id        || this.id;
        this.rangeMax   = parseFloat(cfg.rangeMax)   || this.rangeMax;
        this.blindZone  = parseFloat(cfg.blindZone)  || this.blindZone;
        this.tempC      = parseFloat(cfg.tempC)      ?? this.tempC;
        this.freqKHz    = parseFloat(cfg.freqKHz)    || this.freqKHz;
        this.beamAngle  = parseFloat(cfg.beamAngle)  || this.beamAngle;
        this.hiAlarm    = parseFloat(cfg.hiAlarm)    ?? this.hiAlarm;
        this.loAlarm    = parseFloat(cfg.loAlarm)    ?? this.loAlarm;
        this.soundSpeed = 331.4 + 0.6 * this.tempC;
        this.config     = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}