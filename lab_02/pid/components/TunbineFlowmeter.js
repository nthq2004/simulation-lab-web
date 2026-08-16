import { BaseComponent } from './BaseComponent.js';

/**
 * 涡轮流量计仿真组件（Turbine Flowmeter）
 *
 * ── 测量原理 ────────────────────────────────────────────────
 *  流体冲击涡轮叶片使其旋转，转速正比于体积流速：
 *
 *    n  = Q · K_factor          (r/s)
 *    f  = n · Z                 脉冲频率 Hz，Z = 叶片数
 *    Q  = f / K                 体积流量 m³/s
 *
 *  K 系数（脉冲/L 或 脉冲/m³）由口径和叶片形状确定。
 *
 *  传感器：霍尔元件或磁感式，每片叶片经过产生一个脉冲。
 *
 * ── 输出形式 ────────────────────────────────────────────────
 *  ① 模拟量  4-20 mA  线性对应 0~Q_max
 *  ② 脉冲    频率输出  f = Q × K
 *  ③ Modbus RTU（RS-485）寄存器映射：
 *       0x0000  瞬时流量   FLOAT 高低字（2 寄存器）
 *       0x0002  累积总量   FLOAT 高低字
 *       0x0004  涡轮频率   UINT16  × 0.1 Hz
 *       0x0005  4-20mA    UINT16  × 0.01 mA
 *       0x0006  报警状态   UINT16  bit0=高报 bit1=低报 bit2=故障
 *       0x0007  设备状态   UINT16  0=正常 1=断电 2=故障
 *       0x0008  K 系数     FLOAT
 *       0x000A  量程上限   FLOAT
 *
 * ── 端口 ────────────────────────────────────────────────────
 *  pipe_i   进口（左）
 *  pipe_o   出口（右）
 *  wire_p   24VDC +
 *  wire_n   4-20mA / 脉冲 GND
 *  wire_a   RS-485 A（MODBUS）
 *  wire_b   RS-485 B
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'diff'
 *  update(press, flow) — flow 优先，press 退化估算
 */
export class TurbineFlowmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 360);
        this.height = Math.max(280, config.height || 320);

        this.type    = 'turbine_flowmeter';
        this.special = 'diff';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.pipeDiam    = config.pipeDiam    || 0.05;    // m  DN50
        this.bladeCount  = config.bladeCount  || 6;       // 叶片数
        this.kFactor     = config.kFactor     || 400;     // 脉冲/L（1 L = 0.001 m³）
        this.maxFlow     = config.maxFlow     || 40;      // m³/h
        this.maxPress    = config.maxPress    || 0.6;
        this.unit        = config.unit        || 'm³/h';
        this.fluidName   = config.fluidName   || '空气';
        this.hiAlarm     = config.hiAlarm     || 90;      // % 高报
        this.loAlarm     = config.loAlarm     || 10;      // % 低报

        // Modbus 配置
        this.modbusAddr  = config.modbusAddr  || 1;       // 从站地址 1~247
        this.baudRate    = config.baudRate    || 9600;

        // ── 零点/量程旋钮 ──
        this.zeroAdj     = 0;
        this.spanAdj     = 1.0;

        // ── 运行状态 ──
        this.press       = 0;
        this.flow        = 0;          // 外部注入
        this.dispFlow    = 0;          // 显示流量（小流量切除后）
        this.turbineRpm  = 0;          // 涡轮实际转速 r/min
        this.targetRpm   = 0;
        this.pulseFreq   = 0;          // 脉冲频率 Hz
        this.outCurrent  = 4;
        this.pulseState  = 0;
        this.pulseCount  = 0;
        this.totalFlow   = 0;          // m³
        this.isBreak     = false;
        this.powered     = false;
        this.isLowFlow   = false;
        this.alarmHi     = false;
        this.alarmLo     = false;

        // ── 涡轮动画 ──
        this._bladeAngle = 0;
        this._inertia    = 0.18;       // 惯量系数
        this._pulseTimer = 0;

        // ── Modbus 模拟 ──
        this._modbusRegs    = new Uint16Array(32).fill(0);
        this._modbusLog     = [];      // 最近 N 条事务记录
        this._modbusLogMax  = 6;
        this._modbusTimer   = 0;
        this._modbusPeriod  = 1.0;     // 自动轮询周期 s
        this._modbusRequest = null;    // 当前正在处理的请求
        this._modbusTxAnim  = 0;       // 传输动画进度 0~1
        this._autoQuery     = true;    // 自动查询开关

        // ── 几何 ──
        this._pipeX    = 10;
        this._pipeY    = 36;
        this._pipeW    = Math.round(this.width * 0.50);
        this._pipeH    = Math.round(this.height * 0.36);
        this._turbCX   = this._pipeX + this._pipeW * 0.5;
        this._turbCY   = this._pipeY + this._pipeH / 2;
        this._turbR    = Math.round(this._pipeH * 0.34);

        const headX    = this._pipeX + this._pipeW + 12;
        this._headX    = headX;
        this._headW    = this.width - headX - 8;
        this._headH    = this._pipeH + 20;
        this._headY    = this._pipeY - 10;

        this._mbX      = 6;
        this._mbY      = this._pipeY + this._pipeH + 12;
        this._mbW      = this.width - 12;
        this._mbH      = this.height - this._mbY - 6;

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, pipeDiam: this.pipeDiam, bladeCount: this.bladeCount,
            kFactor: this.kFactor, maxFlow: this.maxFlow,
            modbusAddr: this.modbusAddr, baudRate: this.baudRate,
        };

        this._init();

        const midY = this._pipeY + this._pipeH / 2;
        this.addPort(0,           midY,              'i', 'pipe', 'IN');
        this.addPort(this.width,  midY,              'o', 'pipe', 'OUT');
        this.addPort(this.width,  this._headY + 16,  'p', 'wire', 'V+');
        this.addPort(this.width,  this._headY + 36,  'n', 'wire', 'OUT');
        this.addPort(this.width,  this._headY + 58,  'a', 'wire', '485A');
        this.addPort(this.width,  this._headY + 76,  'b', 'wire', '485B');
    }

    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawPipe();
        this._drawTurbineGroup();
        this._drawSensorProbe();
        this._drawFlowArrows();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawModbusPanel();
        this._startAnim();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '涡轮流量计（4-20mA + 脉冲 + Modbus RTU）',
            fontSize: 13, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 管段 ──────────────────────────────────
    _drawPipe() {
        const { _pipeX: px, _pipeY: py, _pipeW: pw, _pipeH: ph } = this;
        const wall = 11;

        const outer = new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: 3,
        });
        this._fcX = px + wall; this._fcY = py + wall;
        this._fcW = pw - wall*2; this._fcH = ph - wall*2;

        this._flowChan = new Konva.Rect({
            x: this._fcX, y: this._fcY,
            width: this._fcW, height: this._fcH, fill: '#0a1a2a',
        });
        this.group.add(new Konva.Rect({
            x: px, y: py, width: pw, height: 5,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [3,3,0,0],
        }));

        // 法兰
        [[px-11, 0], [px+pw-3, 1]].forEach(([fx, s]) => {
            const fl = new Konva.Rect({
                x: fx, y: py-8, width: 14, height: ph+16,
                fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
                cornerRadius: s === 0 ? [3,0,0,3] : [0,3,3,0],
            });
            [0.2, 0.5, 0.8].forEach(r => this.group.add(new Konva.Circle({
                x: fx+7, y: py-8+(ph+16)*r, radius: 3,
                fill: '#37474f', stroke: '#263238', strokeWidth: 0.5,
            })));
            this.group.add(fl);
        });

        this.group.add(outer, this._flowChan);
    }

    // ── 涡轮（动态组）────────────────────────
    _drawTurbineGroup() {
        const cx = this._turbCX, cy = this._turbCY, R = this._turbR;

        // 支撑架（静止）
        const support = new Konva.Line({
            points: [cx, this._fcY, cx, this._fcY + this._fcH],
            stroke: '#546e7a', strokeWidth: 3, lineCap: 'round', opacity: 0.5,
        });

        // 中心轴承座（静止）
        const hub = new Konva.Circle({
            x: cx, y: cy, radius: R*0.22,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.5,
        });

        // 旋转组（叶片 + 轮毂）
        this._turbGroup = new Konva.Group({ x: cx, y: cy });

        for (let i = 0; i < this.bladeCount; i++) {
            const angle = (i / this.bladeCount) * Math.PI * 2;
            // 叶片（斜切矩形，模拟扭转叶片）
            const bladeG = new Konva.Group({ rotation: (angle * 180 / Math.PI) });

            bladeG.add(new Konva.Rect({
                x: -3, y: -R,
                width: 6, height: R * 0.72,
                fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 0.8,
                cornerRadius: [2, 2, 0, 0], skewX: 0.18,
            }));
            bladeG.add(new Konva.Rect({
                x: -1.5, y: -R,
                width: 3, height: R * 0.72,
                fill: 'rgba(100,181,246,0.3)',
            }));
            this._turbGroup.add(bladeG);
        }

        // 中心圆盘
        this._turbGroup.add(new Konva.Circle({ radius: R*0.22, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1 }));
        this._turbGroup.add(new Konva.Circle({ radius: R*0.10, fill: '#0d1520' }));
        this._turbGroup.add(new Konva.Circle({ x: -R*.06, y: -R*.06, radius: R*.04, fill: 'rgba(255,255,255,0.3)' }));

        this.group.add(support, this._turbGroup, hub);
    }

    // ── 霍尔传感器探头 ────────────────────────
    _drawSensorProbe() {
        const cx = this._turbCX + this._turbR * 0.5;
        const topY = this._pipeY;

        const body = new Konva.Rect({ x: cx-6, y: topY-16, width: 12, height: 18, fill: '#f57f17', stroke: '#e65100', strokeWidth: 1, cornerRadius: [3,3,0,0] });
        const stem = new Konva.Rect({ x: cx-3, y: topY+2, width: 6, height: this._fcH*0.3, fill: '#ffa000', stroke: '#e65100', strokeWidth: 0.5, cornerRadius: 1 });
        this._hallLed = new Konva.Circle({ x: cx, y: topY-4, radius: 3.5, fill: '#1a1a1a' });

        // 信号线到仪表头
        this.group.add(new Konva.Line({
            points: [cx, topY-16, cx, topY-28, this._headX, topY-28, this._headX, this._headY + 16],
            stroke: '#f57f17', strokeWidth: 1.5, dash: [3,2], lineCap: 'round',
        }));
        this.group.add(new Konva.Text({ x: cx-16, y: topY-30, text: '霍尔探头', fontSize: 8, fill: '#f57f17' }));
        this.group.add(body, stem, this._hallLed);
    }

    // ── 流向箭头 ──────────────────────────────
    _drawFlowArrows() {
        const cy = this._fcY + this._fcH / 2;
        [[this._fcX + 10, 0.35], [this._fcX + this._fcW * 0.72, 0.2]].forEach(([ax, op]) => {
            this.group.add(new Konva.Line({ points: [ax, cy, ax+16, cy], stroke: `rgba(79,195,247,${op+0.2})`, strokeWidth: 1.8 }));
            this.group.add(new Konva.Line({ points: [ax+10, cy-4, ax+16, cy, ax+10, cy+4], stroke: `rgba(79,195,247,${op+0.2})`, strokeWidth: 1.8, lineJoin: 'round' }));
        });
    }

    // ── 仪表头（右侧）────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        // 接线盒
        const jbox = new Konva.Rect({ x: hx, y: hy, width: hw, height: hh, fill: '#2c3e50', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: 5 });
        const sheen = new Konva.Rect({ x: hx+2, y: hy+2, width: 6, height: hh-4, fill: 'rgba(255,255,255,0.05)', cornerRadius: 2 });

        // 铭牌
        const plate = new Konva.Rect({ x: hx+8, y: hy+5, width: hw-16, height: 26, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+8, width: hw-16, text: this.id || 'FT-501', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+18, width: hw-16, text: 'TURBINE  RS-485', fontSize: 7.5, fill: '#78909c', align: 'center' }));

        // 端子标签
        [['V+', '#e53935', 44], ['OUT', '#ff8f00', 62], ['485A', '#26c6da', 82], ['485B', '#00838f', 98]].forEach(([lbl, col, ty]) => {
            this.group.add(new Konva.Rect({ x: hx+5, y: hy+ty-8, width: hw-10, height: 13, fill: 'rgba(255,255,255,0.03)', cornerRadius: 2 }));
            this.group.add(new Konva.Text({ x: hx+8, y: hy+ty-5, text: lbl, fontSize: 9, fontStyle: 'bold', fill: col }));
        });

        // 脉冲/电流状态指示灯
        this._ledPulse   = new Konva.Circle({ x: hx+hw-14, y: hy+56, radius: 4, fill: '#333' });
        this._led485     = new Konva.Circle({ x: hx+hw-14, y: hy+80, radius: 4, fill: '#333' });
        const lblPulse   = new Konva.Text({ x: hx+hw-30, y: hy+53, text: '●', fontSize: 9, fill: '#546e7a' });
        const lbl485     = new Konva.Text({ x: hx+hw-30, y: hy+77, text: '●', fontSize: 9, fill: '#546e7a' });

        this.group.add(jbox, sheen, plate, this._idText, this._ledPulse, this._led485, lblPulse, lbl485);
    }

    // ── 圆形 LCD ────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const hy = this._headY + this._headH + 6;
        const cx = hx + hw / 2;
        const R  = Math.min(hw * 0.42, 46);
        this._lcdCX = cx; this._lcdCY = hy + R + 4; this._lcdR = R;

        this.group.add(new Konva.Circle({ x: cx, y: this._lcdCY, radius: R+4, fill: '#1a252f', stroke: '#0d1520', strokeWidth: 1 }));
        // 橙色外环（涡轮工业感）
        this.group.add(new Konva.Circle({ x: cx, y: this._lcdCY, radius: R+2, fill: '#e65100', stroke: '#ff6d00', strokeWidth: 2.5 }));
        this._lcdBg = new Konva.Circle({ x: cx, y: this._lcdCY, radius: R, fill: '#020c14' });

        // 转速弧
        this._rpmArc = new Konva.Arc({ x: cx, y: this._lcdCY, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ff6d00', rotation: -90 });

        this._lcdMain    = new Konva.Text({ x: cx-R+4, y: this._lcdCY-R*.37, width: (R-4)*2, text: '--.-', fontSize: R*.37, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#ff6d00', align: 'center' });
        this._lcdUnit    = new Konva.Text({ x: cx-R+4, y: this._lcdCY+R*.07,  width: (R-4)*2, text: 'm³/h', fontSize: R*.17, fill: '#bf360c', align: 'center' });
        this._lcdFreq    = new Konva.Text({ x: cx-R+4, y: this._lcdCY+R*.29,  width: (R-4)*2, text: 'f=-- Hz', fontSize: R*.15, fontFamily: 'Courier New, monospace', fill: '#546e7a', align: 'center' });
        this._lcdCurr    = new Konva.Text({ x: cx-R+4, y: this._lcdCY-R*.58,  width: (R-4)*2, text: '4.00 mA', fontSize: R*.14, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center' });
        this._lcdRpm     = new Konva.Text({ x: cx-R+4, y: this._lcdCY+R*.47,  width: (R-4)*2, text: '0 rpm', fontSize: R*.13, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'center' });

        this.group.add(this._lcdBg, this._rpmArc, this._lcdMain, this._lcdUnit, this._lcdFreq, this._lcdCurr, this._lcdRpm);
    }

    // ── 旋钮 ────────────────────────────────
    _drawKnobs() {
        const hx = this._headX, hw = this._headW;
        const ky  = this._lcdCY + this._lcdR + 16;
        [{ id: 'zero', x: hx + hw*.28, label: 'Z' },
         { id: 'span', x: hx + hw*.72, label: 'S' }].forEach(k => {
            const g = new Konva.Group({ x: k.x, y: ky });
            g.add(new Konva.Circle({ radius: 11, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 8, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1 }));
            rotor.add(new Konva.Line({ points: [0,-7,0,7], stroke: '#37474f', strokeWidth: 2.5, lineCap: 'round' }));
            g.add(rotor, new Konva.Text({ x:-5, y:13, text: k.label, fontSize:9, fontStyle:'bold', fill:'#607d8b' }));
            this.knobs[k.id] = rotor;
            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const sr = rotor.rotation();
                const mv = (me) => { const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0; rotor.rotation(sr+(sy-cy)*2); if(k.id==='zero') this.zeroAdj=(rotor.rotation()/360)*0.04; else this.spanAdj=1+(rotor.rotation()/360)*0.3; };
                const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('touchmove', mv); window.removeEventListener('mouseup', up); window.removeEventListener('touchend', up); };
                window.addEventListener('mousemove', mv); window.addEventListener('touchmove', mv);
                window.addEventListener('mouseup', up); window.addEventListener('touchend', up);
            });
            this.group.add(g);
        });
    }

    // ── Modbus 显示面板 ──────────────────────
    _drawModbusPanel() {
        const { _mbX: mx, _mbY: my, _mbW: mw, _mbH: mh } = this;

        const bg = new Konva.Rect({ x: mx, y: my, width: mw, height: mh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 5 });

        // 标题条
        const titleBg = new Konva.Rect({ x: mx, y: my, width: mw, height: 18, fill: '#00838f', cornerRadius: [5,5,0,0] });
        const title   = new Konva.Text({ x: mx+4, y: my+3, width: mw-8, text: `Modbus RTU  ADDR:${this.modbusAddr}  ${this.baudRate}bps  RS-485`, fontSize: 8.5, fontStyle: 'bold', fill: '#e0f7fa', align: 'center' });
        this._mbTitleNode = title;

        // 寄存器表格（左侧）
        const colW = mw * 0.46;
        this._regRows = [];
        const regs = [
            ['0x0000', '瞬时流量', '#ff6d00'],
            ['0x0002', '累积总量', '#00e5ff'],
            ['0x0004', '脉冲频率', '#80cbc4'],
            ['0x0005', '4-20mA', '#ffd54f'],
            ['0x0006', '报警状态', '#ef5350'],
            ['0x0007', '设备状态', '#66bb6a'],
        ];
        regs.forEach(([addr, name, col], i) => {
            const ry = my + 22 + i * 14;
            const addrTxt = new Konva.Text({ x: mx+4, y: ry, text: addr, fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#37474f' });
            const nameTxt = new Konva.Text({ x: mx+44, y: ry, text: name, fontSize: 8, fill: '#546e7a' });
            const valTxt  = new Konva.Text({ x: mx+colW-52, y: ry, width: 50, text: '---', fontSize: 8, fontFamily: 'Courier New, monospace', fill: col, align: 'right' });
            this._regRows.push({ val: valTxt, col });
            this.group.add(addrTxt, nameTxt, valTxt);
        });

        // 分隔线
        this.group.add(new Konva.Line({ points: [mx+colW, my+18, mx+colW, my+mh], stroke: '#0d2030', strokeWidth: 1 }));

        // 事务日志（右侧）
        this._logEntries = [];
        const logX = mx + colW + 4;
        const logTitle = new Konva.Text({ x: logX, y: my+3, text: '事务日志', fontSize: 8, fontStyle: 'bold', fill: '#80cbc4' });
        for (let i = 0; i < this._modbusLogMax; i++) {
            const lt = new Konva.Text({ x: logX, y: my + 22 + i * 14, width: mw - colW - 8, text: '', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#263238', opacity: 0 });
            this._logEntries.push(lt);
            this.group.add(lt);
        }

        // RS-485 总线动画（底部细条）
        this._busLine = new Konva.Rect({ x: mx+4, y: my+mh-8, width: mw-8, height: 4, fill: '#0d2030', cornerRadius: 2 });
        this._busActivity = new Konva.Rect({ x: mx+4, y: my+mh-8, width: 0, height: 4, fill: '#00e5ff', cornerRadius: 2 });

        this.group.add(bg, titleBg, title, logTitle, this._busLine, this._busActivity);
    }

    // ═══════════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════════
    _startAnim() {
        const tick = (ts) => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickTurbineAnim(dt);
                this._tickPulse(dt);
                this._tickModbus(dt);
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnim() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    // ── 物理 ──────────────────────────────────
    _tickPhysics(dt) {
        const adj = Math.max(0, (this.flow + this.zeroAdj * this.maxFlow) * this.spanAdj);
        this.isLowFlow  = adj < this.maxFlow * 0.03;
        this.dispFlow   = this.isLowFlow ? 0 : adj;

        // 目标转速（rpm）：流量正比于转速
        const maxRpm = (this.maxFlow / 3600) * this.kFactor * 1000 / this.bladeCount * 60;
        this.targetRpm = (this.dispFlow / this.maxFlow) * maxRpm;
        if (!this.powered || this.isBreak) this.targetRpm = 0;

        // 惯量平滑
        const alpha = 1 - Math.pow(this._inertia, dt * 10);
        this.turbineRpm += (this.targetRpm - this.turbineRpm) * alpha;
        if (this.turbineRpm < 0.5 && this.targetRpm === 0) this.turbineRpm = 0;

        // 脉冲频率
        this.pulseFreq = (this.turbineRpm / 60) * this.bladeCount;

        // 电流输出
        this.outCurrent = 4 + Math.min(1, this.dispFlow / this.maxFlow) * 16;
        if (this.isBreak) this.outCurrent = 1.8;
        if (!this.powered) this.outCurrent = 0;

        // 报警
        const pct = this.dispFlow / this.maxFlow * 100;
        this.alarmHi = pct > this.hiAlarm;
        this.alarmLo = pct < this.loAlarm && pct > 0;

        // 累积
        if (this.powered && !this.isBreak) {
            this.totalFlow += this.dispFlow * dt / 3600;
        }

        // SNR 弧
        if (this._rpmArc) {
            this._rpmArc.angle(Math.min(360, (this.turbineRpm / Math.max(1, this.targetRpm + 1)) * 360));
        }

        // 霍尔探头 LED
        if (this._hallLed) {
            this._hallLed.fill(this.powered && !this.isBreak && this.pulseState ? '#ffee58' : '#1a1a1a');
        }

        // 脉冲 LED
        if (this._ledPulse) {
            this._ledPulse.fill(this.powered && !this.isBreak && this.pulseState ? '#ff8f00' : '#1a2634');
        }

        // 485 LED
        if (this._led485) {
            this._led485.fill(this._modbusTxAnim > 0 ? '#00e5ff' : '#0d2030');
        }

        // 流体颜色
        if (this._flowChan) {
            const fr = this.dispFlow / this.maxFlow;
            const r = Math.round(10 + fr * 12), g = Math.round(26 + fr * 38), b = Math.round(42 + fr * 55);
            this._flowChan.fill(`rgb(${r},${g},${b})`);
        }

        // 更新 Modbus 寄存器
        this._updateModbusRegs();
    }

    // ── 涡轮叶片旋转 ──────────────────────────
    _tickTurbineAnim(dt) {
        const dps = (this.turbineRpm / 60) * 360;
        this._bladeAngle = (this._bladeAngle + dps * dt) % 360;
        if (this._turbGroup) this._turbGroup.rotation(this._bladeAngle);
    }

    // ── 脉冲输出 ──────────────────────────────
    _tickPulse(dt) {
        if (!this.powered || this.isBreak || this.pulseFreq <= 0) {
            this._pulseTimer = 0; return;
        }
        this._pulseTimer += dt;
        const period = 1 / this.pulseFreq;
        while (this._pulseTimer >= period) {
            this._pulseTimer -= period;
            this.pulseCount++;
            this.pulseState ^= 1;
        }
    }

    // ── Modbus 寄存器更新 ────────────────────
    _updateModbusRegs() {
        const regs = this._modbusRegs;
        // 0x0000-0x0001: 瞬时流量 FLOAT
        const fBuf = new Float32Array([this.dispFlow]);
        const fU16 = new Uint16Array(fBuf.buffer);
        regs[0] = fU16[1]; regs[1] = fU16[0];  // 大端序

        // 0x0002-0x0003: 累积总量 FLOAT
        const tBuf = new Float32Array([this.totalFlow]);
        const tU16 = new Uint16Array(tBuf.buffer);
        regs[2] = tU16[1]; regs[3] = tU16[0];

        // 0x0004: 频率 ×0.1
        regs[4] = Math.round(this.pulseFreq * 10);
        // 0x0005: 电流 ×0.01
        regs[5] = Math.round(this.outCurrent * 100);
        // 0x0006: 报警状态 bits
        regs[6] = (this.alarmHi ? 1 : 0) | (this.alarmLo ? 2 : 0) | (this.isBreak ? 4 : 0);
        // 0x0007: 设备状态
        regs[7] = !this.powered ? 1 : this.isBreak ? 2 : 0;
        // 0x0008-0x0009: K 系数 FLOAT
        const kBuf = new Float32Array([this.kFactor]);
        const kU16 = new Uint16Array(kBuf.buffer);
        regs[8] = kU16[1]; regs[9] = kU16[0];
        // 0x000A-0x000B: 量程 FLOAT
        const mBuf = new Float32Array([this.maxFlow]);
        const mU16 = new Uint16Array(mBuf.buffer);
        regs[10] = mU16[1]; regs[11] = mU16[0];
    }

    // ── Modbus 自动轮询模拟 ──────────────────
    _tickModbus(dt) {
        this._modbusTxAnim = Math.max(0, this._modbusTxAnim - dt * 4);

        if (!this._autoQuery) return;
        this._modbusTimer -= dt;
        if (this._modbusTimer > 0) return;

        this._modbusTimer = this._modbusPeriod;

        // 构造 FC03 读保持寄存器请求
        const addr  = this.modbusAddr;
        const start = 0x0000;
        const count = 8;
        const req   = this._buildFC03(addr, start, count);
        const resp  = this._handleFC03(addr, start, count);

        // 格式化日志条目
        const now    = new Date();
        const ts     = `${now.getSeconds().toString().padStart(2,'0')}.${Math.floor(now.getMilliseconds()/10).toString().padStart(2,'0')}`;
        const reqHex = Array.from(req).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ');
        const respHex= Array.from(resp.slice(0, 7)).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' ') + '…';

        this._addModbusLog(`[${ts}] REQ: ${reqHex}`, '#546e7a');
        this._addModbusLog(`[${ts}] RSP: ${respHex}`, '#26c6da');

        this._modbusTxAnim = 1.0;
        this._updateModbusDisplayRegs();
    }

    _buildFC03(addr, start, count) {
        const buf = new Uint8Array(8);
        buf[0] = addr;
        buf[1] = 0x03;
        buf[2] = (start >> 8) & 0xFF;
        buf[3] = start & 0xFF;
        buf[4] = (count >> 8) & 0xFF;
        buf[5] = count & 0xFF;
        const crc = this._crc16(buf.slice(0, 6));
        buf[6] = crc & 0xFF;
        buf[7] = (crc >> 8) & 0xFF;
        return buf;
    }

    _handleFC03(addr, start, count) {
        const byteCount = count * 2;
        const resp = new Uint8Array(3 + byteCount + 2);
        resp[0] = addr;
        resp[1] = 0x03;
        resp[2] = byteCount;
        for (let i = 0; i < count; i++) {
            const val = this._modbusRegs[start + i] || 0;
            resp[3 + i*2]   = (val >> 8) & 0xFF;
            resp[3 + i*2+1] = val & 0xFF;
        }
        const crc = this._crc16(resp.slice(0, 3 + byteCount));
        resp[3 + byteCount]     = crc & 0xFF;
        resp[3 + byteCount + 1] = (crc >> 8) & 0xFF;
        return resp;
    }

    _crc16(buf) {
        let crc = 0xFFFF;
        for (const b of buf) {
            crc ^= b;
            for (let j = 0; j < 8; j++) {
                if (crc & 1) { crc = (crc >> 1) ^ 0xA001; }
                else           { crc >>= 1; }
            }
        }
        return crc;
    }

    _addModbusLog(text, color) {
        this._modbusLog.unshift({ text, color });
        if (this._modbusLog.length > this._modbusLogMax) this._modbusLog.pop();
        this._logEntries.forEach((entry, i) => {
            const item = this._modbusLog[i];
            if (item) {
                entry.text(item.text); entry.fill(item.color);
                entry.opacity(Math.max(0.3, 1 - i * 0.15));
            } else {
                entry.text(''); entry.opacity(0);
            }
        });
    }

    _updateModbusDisplayRegs() {
        if (!this._regRows) return;
        const fv = (h, l) => {
            const buf = new Uint16Array([l, h]);
            return new Float32Array(buf.buffer)[0];
        };
        const vals = [
            `${fv(this._modbusRegs[0], this._modbusRegs[1]).toFixed(2)} m³/h`,
            `${fv(this._modbusRegs[2], this._modbusRegs[3]).toFixed(3)} m³`,
            `${(this._modbusRegs[4] * 0.1).toFixed(1)} Hz`,
            `${(this._modbusRegs[5] * 0.01).toFixed(2)} mA`,
            `0x${this._modbusRegs[6].toString(16).padStart(4,'0').toUpperCase()}`,
            `0x${this._modbusRegs[7].toString(16).padStart(4,'0').toUpperCase()}`,
        ];
        this._regRows.forEach((row, i) => {
            if (vals[i] !== undefined) row.val.text(vals[i]);
        });

        // 总线动画
        if (this._busActivity) {
            const w = Math.max(0, (this._mbW - 8) * this._modbusTxAnim);
            this._busActivity.width(w);
        }
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;

        if (!pw) {
            this._lcdMain.text('----'); this._lcdMain.fill('#0d2030');
            [this._lcdUnit, this._lcdFreq, this._lcdRpm].forEach(t => t.fill('#0d2030'));
            this._lcdCurr.text('-- mA'); this._lcdBg.fill('#020c14');
            return;
        }
        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdCurr.text('1.8 mA'); this._lcdBg.fill('#1a0808');
            return;
        }

        const ratio = this.dispFlow / this.maxFlow;
        const mc    = ratio > 0.9 ? '#ff5722' : ratio > 0.05 ? '#ff6d00' : '#ff8f00';
        const txt   = this.outCurrent < 3.8 ? 'LLLL' : this.outCurrent > 20.5 ? 'HHHH' : this.dispFlow.toFixed(1);

        this._lcdBg.fill('#020c14');
        this._lcdMain.text(txt); this._lcdMain.fill(mc);
        this._lcdUnit.text(this.unit); this._lcdUnit.fill('#bf360c');
        this._lcdFreq.text(`f=${this.pulseFreq.toFixed(1)} Hz`);
        this._lcdFreq.fill(this.pulseFreq > 0 ? '#546e7a' : '#263238');
        this._lcdCurr.text(`${this.outCurrent.toFixed(2)} mA`);
        this._lcdRpm.text(`${Math.round(this.turbineRpm)} rpm`);
        this._lcdRpm.fill(this.turbineRpm > 0 ? '#37474f' : '#263238');
    }

    // ═══════════════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════════════
    update(press, flow) {
        this.press = typeof press === 'number' ? press : 0;
        if (typeof flow === 'number' && flow >= 0) {
            this.flow = flow;
        } else {
            const pNorm = Math.min(1, Math.max(0, this.press / this.maxPress));
            this.flow   = Math.sqrt(pNorm) * this.maxFlow;
        }
        this._refreshCache();
    }

    // ── 外部触发单次 Modbus 查询 ──────────────
    queryModbus(startAddr = 0, count = 8) {
        const resp = this._handleFC03(this.modbusAddr, startAddr, count);
        this._addModbusLog(`MAN REQ 0x${startAddr.toString(16).padStart(4,'0')} ×${count}`, '#ffd54f');
        this._modbusTxAnim = 1.0;
        this._updateModbusDisplayRegs();
        return resp;
    }

    // ═══════════════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',          type: 'text'   },
            { label: '管道内径 DN (m)',      key: 'pipeDiam',    type: 'number' },
            { label: '叶片数 Z',            key: 'bladeCount',  type: 'number' },
            { label: 'K 系数 (p/L)',        key: 'kFactor',     type: 'number' },
            { label: '满量程流量',           key: 'maxFlow',     type: 'number' },
            { label: '高报阈值 (%)',         key: 'hiAlarm',     type: 'number' },
            { label: '低报阈值 (%)',         key: 'loAlarm',     type: 'number' },
            { label: 'Modbus 从站地址',      key: 'modbusAddr',  type: 'number' },
            { label: '波特率 (bps)',         key: 'baudRate',    type: 'number' },
            { label: '单位', key: 'unit', type: 'select',
              options: [{ label: 'm³/h', value: 'm³/h' }, { label: 'L/h', value: 'L/h' }, { label: 'kg/h', value: 'kg/h' }] },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.pipeDiam   = parseFloat(cfg.pipeDiam)   || this.pipeDiam;
        this.bladeCount = parseInt(cfg.bladeCount)   || this.bladeCount;
        this.kFactor    = parseFloat(cfg.kFactor)    || this.kFactor;
        this.maxFlow    = parseFloat(cfg.maxFlow)    || this.maxFlow;
        this.hiAlarm    = parseFloat(cfg.hiAlarm)    ?? this.hiAlarm;
        this.loAlarm    = parseFloat(cfg.loAlarm)    ?? this.loAlarm;
        this.modbusAddr = parseInt(cfg.modbusAddr)   || this.modbusAddr;
        this.baudRate   = parseInt(cfg.baudRate)     || this.baudRate;
        this.unit       = cfg.unit || this.unit;
        this.config     = { ...this.config, ...cfg };
        if (this._idText)     this._idText.text(this.id);
        if (this._mbTitleNode) this._mbTitleNode.text(`Modbus RTU  ADDR:${this.modbusAddr}  ${this.baudRate}bps  RS-485`);
        this._refreshCache();
    }

    destroy() { this._stopAnim(); super.destroy?.(); }
}