import { BaseComponent } from './BaseComponent.js';

/**
 * 霍尔转速传感器仿真组件（Hall Effect Speed Sensor）
 *
 * ── 工作原理 ──────────────────────────────────────────────
 *  霍尔效应传感器检测穿过其感应面的磁场变化：
 *
 *  当铁磁齿轮齿顶（或磁钢 N 极）经过传感器时：
 *    B_field ↑  →  Hall 电压 V_H ↑  →  输出高电平 (V_cc)
 *
 *  当齿槽（或 S 极 / 无磁区）经过时：
 *    B_field ↓  →  Hall 电压 V_H ↓  →  输出低电平 (GND)
 *
 *  霍尔效应基本方程：
 *    V_H = (R_H × I × B) / d
 *    R_H — 霍尔系数（材料属性）
 *    I   — 偏置电流
 *    B   — 磁感应强度
 *    d   — 感应层厚度
 *
 *  转速计算：
 *    n (rpm) = (f × 60) / Z
 *    f  — 脉冲频率 (Hz)
 *    Z  — 齿数（或磁极对数）
 *
 * ── 输出模式（可配置）───────────────────────────────────
 *  ① 开关型（Digital Switch）：NPN 集电极开路，高/低电平
 *  ② 模拟型（Analog）：电压正比于磁场强度（线性霍尔）
 *  ③ PWM 型：占空比正比于位置/速度
 *
 * ── 组件结构 ─────────────────────────────────────────────
 *  ① 齿轮/磁环旋转动画（正面视图）
 *  ② 霍尔传感器 IC 外观（SOT-23 / 圆柱探头）
 *  ③ 磁场强度动画（B 场可视化）
 *  ④ 输出波形示波器（数字方波 + 模拟霍尔电压）
 *  ⑤ 仪表头（转速 + 频率 + 占空比显示）
 *  ⑥ NPN 集电极开路等效电路图
 *
 * ── 端口 ──────────────────────────────────────────────────
 *  wire_vcc — 电源 (5~24V)
 *  wire_gnd — 接地
 *  wire_out — 信号输出（NPN OC / 模拟电压）
 *
 * ── 气路求解器集成 ─────────────────────────────────────
 *  special = 'none'
 *  update(rpm, dir) — 外部注入转速（rpm），或绑定气动马达
 *  targetId — 自动从 sys.comps[targetId].rpm 读取
 */
export class HallSpeedSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 360);
        this.height = Math.max(300, config.height || 340);

        this.type    = 'hall_speed_sensor';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 传感器参数 ──
        this.toothCount  = config.toothCount  || 60;    // 齿数 Z
        this.maxRpm      = config.maxRpm      || 3000;  // 最大转速
        this.vcc         = config.vcc         || 12;    // 供电电压 V
        this.outputMode  = config.outputMode  || 'NPN'; // NPN / PNP / Analog
        this.magType     = config.magType     || 'gear';// gear / ring
        this.targetId    = config.targetId    || null;  // 绑定轴 ID

        // ── 运行状态 ──
        this.rpm         = 0;
        this.direction   = 1;   // 1=正转 -1=反转
        this._manualRpm  = 0;
        this.isBreak     = false;
        this.powered     = true;

        // ── 信号状态 ──
        this.outHigh      = 0;      // 当前输出电平 0/1
        this.hallVoltage  = 0;      // 模拟霍尔电压 V
        this.pulseFreq    = 0;      // 脉冲频率 Hz
        this.pulseCount   = 0;      // 累积脉冲数
        this.dutyCycle    = 50;     // 占空比 %

        // ── 磁场仿真 ──
        this._bField      = 0;      // 当前磁场强度（归一化 -1~1）
        this._threshold   = 0.3;    // 触发阈值

        // ── 动画状态 ──
        this._gearAngle   = 0;      // 齿轮角度 rad
        this._phase       = 0;      // 信号相位
        this._pulseTimer  = 0;
        this._lastTs      = null;
        this._animId      = null;
        this._knobAngle   = 0;      // 调速旋钮

        // ── 波形缓冲 ──
        this._wavLen      = 240;
        this._wavDigital  = new Uint8Array(this._wavLen).fill(0);
        this._wavAnalog   = new Float32Array(this._wavLen).fill(0);
        this._wavAcc      = 0;

        // ── 几何布局 ──
        // 齿轮区（左侧大圆）
        this._gearCX      = Math.round(this.width  * 0.28);
        this._gearCY      = Math.round(this.height * 0.38);
        this._gearR       = Math.round(Math.min(this.width, this.height) * 0.22);

        // 霍尔 IC 区（齿轮右侧）
        this._icX         = this._gearCX + this._gearR + 16;
        this._icY         = this._gearCY - 18;

        // 仪表显示头（右侧）
        this._headX       = this.width * 0.57;
        this._headY       = 28;
        this._headW       = this.width - this._headX - 6;
        this._headH       = this.height * 0.44;

        // 波形区（底部全宽）
        this._wavX        = 6;
        this._wavY        = this.height * 0.52;
        this._wavW        = this.width - 12;
        this._wavH        = this.height * 0.34;

        // 等效电路区（仪表头下方）
        this._circX       = this._headX;
        this._circY       = this._headY + this._headH + 8;
        this._circW       = this._headW;
        this._circH       = this._wavY - this._circY - 4;

        this.knobs        = {};

        this.config = {
            id: this.id, toothCount: this.toothCount,
            maxRpm: this.maxRpm, vcc: this.vcc,
            outputMode: this.outputMode, targetId: this.targetId,
        };

        this._init();

        this.addPort(this.width, this._headY + 14,  'vcc', 'wire', 'VCC');
        this.addPort(this.width, this._headY + 34,  'gnd', 'wire', 'GND');
        this.addPort(this.width, this._headY + 54,  'out', 'wire', 'OUT');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawGear();
        this._drawHallIC();
        this._drawBFieldViz();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawCircuit();
        this._drawWaveform();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '霍尔效应转速传感器',
            fontSize: 14, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 齿轮 ──────────────────────────────────
    _drawGear() {
        const cx = this._gearCX, cy = this._gearCY, R = this._gearR;
        const Z  = Math.min(this.toothCount, 24); // 显示用最多24齿

        // 齿轮旋转组
        this._gearGroup = new Konva.Group({ x: cx, y: cy });

        // 齿形路径（梯形齿）
        const tw = (2 * Math.PI / Z) * 0.38;
        const ri = R * 0.74;

        const gearPts = [];
        for (let i = 0; i < Z; i++) {
            const a = (i / Z) * Math.PI * 2;
            const a1 = a - tw;
            const a2 = a + tw;
            gearPts.push(
                ri * Math.cos(a - tw * 1.8), ri * Math.sin(a - tw * 1.8),
                R  * Math.cos(a1),            R  * Math.sin(a1),
                R  * Math.cos(a2),            R  * Math.sin(a2),
                ri * Math.cos(a + tw * 1.8), ri * Math.sin(a + tw * 1.8),
            );
        }
        const gearBody = new Konva.Line({
            points: gearPts, closed: true,
            fill: '#607d8b', stroke: '#37474f', strokeWidth: 1.2,
        });

        // 辐条（4条）
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            this._gearGroup.add(new Konva.Line({
                points: [
                    ri * 0.3 * Math.cos(a), ri * 0.3 * Math.sin(a),
                    ri * 0.88 * Math.cos(a + 0.25), ri * 0.88 * Math.sin(a + 0.25),
                ],
                stroke: '#455a64', strokeWidth: 3, lineCap: 'round',
            }));
        }

        // 轮毂
        const hub = new Konva.Circle({ radius: R * 0.18, fill: '#37474f', stroke: '#263238', strokeWidth: 1.5 });
        const hubHole = new Konva.Circle({ radius: R * 0.09, fill: '#1a252f' });

        // 齿轮高光弧
        const glowArc = new Konva.Arc({
            x: 0, y: 0, innerRadius: R - 6, outerRadius: R + 2,
            angle: 40, rotation: -160,
            fill: 'rgba(255,255,255,0.08)',
        });

        this._gearGroup.add(gearBody, glowArc, hub, hubHole);
        this.group.add(this._gearGroup);

        // 静态背景圆（承轴）
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 10,
            fill: 'none', stroke: '#263238', strokeWidth: 2,
        }));
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 10,
            fill: 'none', stroke: '#37474f', strokeWidth: 0.5,
            dash: [3, 3],
        }));

        // 标注
        this.group.add(new Konva.Text({
            x: cx - R, y: cy + R + 14,
            width: R * 2, text: `Z=${this.toothCount} 齿`,
            fontSize: 9, fill: '#607d8b', align: 'center',
        }));

        // 旋转方向箭头（静态装饰）
        this._dirArrow = new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R + 4, outerRadius: R + 8,
            angle: 270, rotation: -45,
            fill: 'rgba(100,200,100,0.4)',
        });
        this.group.add(this._dirArrow);
    }

    // ── 霍尔 IC 外观 ──────────────────────────
    _drawHallIC() {
        const ix = this._icX, iy = this._icY;
        const iw = 28, ih = 36;

        // 探头外壳（圆柱形，深色）
        const body = new Konva.Rect({
            x: ix, y: iy, width: iw, height: ih,
            fill: '#1a1a1a', stroke: '#333', strokeWidth: 1.5, cornerRadius: [3, 3, 2, 2],
        });
        // 感应面（底部，朝向齿轮）
        const sensorFace = new Konva.Rect({
            x: ix - 2, y: iy + ih - 6, width: iw + 4, height: 8,
            fill: '#ff8f00', stroke: '#e65100', strokeWidth: 1, cornerRadius: [0, 0, 3, 3],
        });
        // 高光
        const sheen = new Konva.Rect({
            x: ix + 2, y: iy + 2, width: 4, height: ih - 8,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: 2,
        });
        // 丝印标签
        const label = new Konva.Text({
            x: ix + 2, y: iy + 8, width: iw - 4,
            text: 'HALL\n IC', fontSize: 8, fill: '#888', align: 'center', lineHeight: 1.4,
        });
        // 引脚（3根）
        const pinColors = ['#e53935', '#607d8b', '#43a047'];
        const pinNames  = ['VCC', 'GND', 'OUT'];
        this._pinLeds   = [];
        pinColors.forEach((col, i) => {
            const px = ix + 4 + i * 9;
            const py = iy + ih + 2;
            this.group.add(new Konva.Rect({ x: px-2, y: py, width: 4, height: 12, fill: col, cornerRadius: 1 }));
            this.group.add(new Konva.Text({ x: px-6, y: py+14, text: pinNames[i], fontSize: 6.5, fill: col }));
            // 输出引脚 LED
            if (i === 2) {
                this._outLed = new Konva.Circle({ x: px, y: py - 4, radius: 3, fill: '#1a1a1a' });
                this.group.add(this._outLed);
            }
        });

        // 连接线：探头底面→齿轮
        this._fieldLine = new Konva.Line({
            points: [ix - 2, iy + ih - 2, this._gearCX + this._gearR, this._gearCY],
            stroke: 'rgba(255,143,0,0.25)', strokeWidth: 1, dash: [3, 3],
        });

        // 标注
        const hallLabel = new Konva.Text({
            x: ix, y: iy - 14, width: iw,
            text: 'Hall IC', fontSize: 9, fontStyle: 'bold', fill: '#ff8f00', align: 'center',
        });

        this.group.add(this._fieldLine, body, sheen, sensorFace, label, hallLabel);
    }

    // ── 磁场可视化层 ──────────────────────────
    _drawBFieldViz() {
        this._bFieldGroup = new Konva.Group();
        this.group.add(this._bFieldGroup);

        // 磁场强度条（传感器旁边）
        const bx = this._icX + 34;
        const by = this._icY;
        const bh = 36;

        // 背景槽
        this.group.add(new Konva.Rect({
            x: bx, y: by, width: 8, height: bh,
            fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2,
        }));
        this._bBar = new Konva.Rect({
            x: bx + 1, y: by + 1, width: 6, height: 0,
            fill: '#ff8f00', cornerRadius: 1,
        });
        this._bBarBg = new Konva.Rect({
            x: bx, y: by, width: 8, height: bh,
            fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 2,
        });
        this._bBarFill = new Konva.Rect({
            x: bx + 1, y: by + bh - 1, width: 6, height: 0,
            fill: '#ff8f00', cornerRadius: 1,
        });
        this.group.add(new Konva.Text({ x: bx - 2, y: by - 12, text: 'B', fontSize: 9, fontStyle: 'bold', fill: '#ff8f00' }));
        this.group.add(this._bBarBg, this._bBarFill);

        // 触发阈值线
        this._threshLine = new Konva.Line({
            points: [bx - 2, by + 36 * (1 - this._threshold), bx + 10, by + 36 * (1 - this._threshold)],
            stroke: '#ffd54f', strokeWidth: 1, dash: [2, 2],
        });
        this.group.add(this._threshLine);
    }

    // ── 仪表头 ─────────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        // 接线盒
        const jBox = new Konva.Rect({
            x: hx, y: hy, width: hw, height: 40,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0],
        });
        for (let i = 0; i < 3; i++) {
            this.group.add(new Konva.Line({ points: [hx, hy+6+i*10, hx+hw, hy+6+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        }
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 22, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'SS-H01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+17, width: hw-16, text: 'HALL  NPN-OC', fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 10, height: 36, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+3, width: 10, height: 36, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });

        // 主体
        const body = new Konva.Rect({ x: hx, y: hy+40, width: hw, height: hh-40, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── LCD 显示 ──────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 40 + (this._headH - 40) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        // 绿色霍尔传感器工业风外环
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1b5e20', stroke: '#2e7d32', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        // 转速比例弧
        this._rpmArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#66bb6a', rotation: -90 });

        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'0',    fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#66bb6a', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.10, width:(R-4)*2, text:'rpm',  fontSize:R*.17, fill:'#1b5e20', align:'center' });
        this._lcdFreq   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.31, width:(R-4)*2, text:'f=0 Hz',fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdVcc    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.58, width:(R-4)*2, text:'12V  NPN', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdPulse  = new Konva.Text({ x: lcx-R+4, y: lcy+R*.48, width:(R-4)*2, text:'Σ 0', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._rpmArc, this._lcdMain, this._lcdUnit, this._lcdFreq, this._lcdVcc, this._lcdPulse);
    }

    // ── 调速旋钮 ──────────────────────────────
    _drawKnobs() {
        const hx = this._headX, hw = this._headW;
        const ky  = this._lcCY + this._lcR + 14;
        const kx  = hx + hw / 2;

        const base  = new Konva.Circle({ x: kx, y: ky, radius: 18, fill: '#263238', stroke: '#1a252f', strokeWidth: 1.5 });
        this._knobRotor = new Konva.Group({ x: kx, y: ky });
        this._knobRotor.add(
            new Konva.Circle({ radius: 14, fill: '#37474f', stroke: '#263238', strokeWidth: 1 }),
            new Konva.Line({ points: [0, -12, 0, -4], stroke: '#66bb6a', strokeWidth: 3, lineCap: 'round' }),
        );
        const kLbl = new Konva.Text({ x: kx - 20, y: ky + 20, width: 40, text: '调速', fontSize: 9, fill: '#546e7a', align: 'center' });

        this._knobRotor.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            const startY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            const startAngle = this._knobAngle;
            const onMove = (me) => {
                const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                this._knobAngle = Math.max(-150, Math.min(150, startAngle + (startY - cy) * 1.8));
                this._knobRotor.rotation(this._knobAngle);
                this._manualRpm = Math.max(0, Math.min(this.maxRpm, ((this._knobAngle + 150) / 300) * this.maxRpm));
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchend', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('touchend', onUp);
        });

        this.group.add(base, this._knobRotor, kLbl);
    }

    // ── NPN 等效电路图 ─────────────────────────
    _drawCircuit() {
        const cx2 = this._circX, cy2 = this._circY;
        const cw = this._circW, ch = this._circH;

        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.2, cornerRadius: 3 });
        this.group.add(new Konva.Text({ x: cx2+2, y: cy2+3, width: cw-4, text: 'NPN OC 等效', fontSize: 7.5, fontStyle: 'bold', fill: '#546e7a', align: 'center' }));

        const x1 = cx2 + 8, x2 = cx2 + cw - 10;
        const midX = (x1 + x2) / 2;
        const yTop = cy2 + 14, yBot = cy2 + ch - 8;

        // VCC 线
        this.group.add(new Konva.Line({ points: [x1, yTop, x1, yTop + 4], stroke: '#e53935', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: x1 - 6, y: yTop - 2, text: 'VCC', fontSize: 7, fill: '#e53935' }));

        // 上拉电阻
        const rH = 10;
        for (let i = 0; i < 3; i++) {
            this.group.add(new Konva.Line({ points: [x1 + (i%2===0?-3:3), yTop+4+i*3, x1 + (i%2===0?3:-3), yTop+4+i*3+3], stroke: '#ffd54f', strokeWidth: 1 }));
        }
        this.group.add(new Konva.Text({ x: x1 + 4, y: yTop + 6, text: 'R', fontSize: 7, fill: '#ffd54f' }));

        // 集电极节点
        const yC = yTop + 14;
        this.group.add(new Konva.Line({ points: [x1, yTop+rH+4, x1, yC], stroke: '#e53935', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x1, yC, midX - 4, yC], stroke: '#e53935', strokeWidth: 1 }));

        // NPN 三极管（简化画法）
        const tx = midX, ty = yC + 2;
        // base
        this.group.add(new Konva.Line({ points: [tx - 6, ty, tx - 6, ty + 12], stroke: '#80cbc4', strokeWidth: 2 }));
        // emitter, collector
        this.group.add(new Konva.Line({ points: [tx - 6, ty + 3, tx + 4, ty - 3], stroke: '#80cbc4', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [tx - 6, ty + 9, tx + 4, ty + 15], stroke: '#80cbc4', strokeWidth: 1 }));
        // collector (to C node)
        this.group.add(new Konva.Line({ points: [tx + 4, ty - 3, tx + 4, yC], stroke: '#80cbc4', strokeWidth: 1 }));
        // Hall IC 驱动基极
        this.group.add(new Konva.Line({ points: [x2, ty + 6, tx - 6, ty + 6], stroke: '#43a047', strokeWidth: 1, dash: [2,2] }));
        this.group.add(new Konva.Text({ x: x2 - 8, y: ty + 2, text: 'OUT', fontSize: 6.5, fill: '#43a047' }));

        // 发射极到 GND
        this.group.add(new Konva.Line({ points: [tx + 4, ty + 15, tx + 4, yBot], stroke: '#607d8b', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [tx - 3, yBot, tx + 11, yBot], stroke: '#607d8b', strokeWidth: 1.5 }));
        this.group.add(new Konva.Text({ x: tx - 2, y: yBot + 2, text: 'GND', fontSize: 7, fill: '#607d8b' }));

        // 输出状态指示
        this._circOutDot = new Konva.Circle({ x: midX - 4, y: yC, radius: 3, fill: '#1a1a1a' });
        this.group.add(bg, this._circOutDot);
    }

    // ── 双通道波形区 ──────────────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: '输出波形  ── 数字方波  ── 霍尔模拟电压', fontSize: 8, fontStyle: 'bold', fill: '#66bb6a', align: 'center' }));

        // 网格
        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [wx, wy+wh*i/3, wx+ww, wy+wh*i/3], stroke: 'rgba(100,200,100,0.07)', strokeWidth: 0.5 }));
        for (let i = 1; i < 5; i++) this.group.add(new Konva.Line({ points: [wx+ww*i/5, wy, wx+ww*i/5, wy+wh], stroke: 'rgba(100,200,100,0.05)', strokeWidth: 0.5 }));

        this._wavMidDigital = wy + wh * 0.22;
        this._wavMidAnalog  = wy + wh * 0.72;

        // 基准线
        [this._wavMidDigital, this._wavMidAnalog].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineDigital = new Konva.Line({ points: [], stroke: '#66bb6a', strokeWidth: 1.8, lineJoin: 'miter', lineCap: 'square' });
        this._wLineAnalog  = new Konva.Line({ points: [], stroke: '#ff8f00', strokeWidth: 1.4, lineJoin: 'round' });

        // 通道标签
        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'CH1  数字', fontSize: 8, fontStyle: 'bold', fill: '#66bb6a' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+4, text: 'CH2  模拟', fontSize: 8, fontStyle: 'bold', fill: '#ff8f00' }));

        // 实时数值标签
        this._wFreqLbl = new Konva.Text({ x: wx+ww-90, y: wy+16, width: 86, text: '-- Hz', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#66bb6a', align: 'right' });
        this._wRpmLbl  = new Konva.Text({ x: wx+ww-90, y: wy+26, width: 86, text: '-- rpm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'right' });
        this._wBLbl    = new Konva.Text({ x: wx+ww-90, y: wy+wh-12, width: 86, text: 'B=--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ff8f00', align: 'right' });

        this.group.add(bg, titleBg, this._wLineDigital, this._wLineAnalog, this._wFreqLbl, this._wRpmLbl, this._wBLbl);
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickGear(dt);
                this._tickHallSignal(dt);
                this._tickBField();
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
        // 读取转速
        let targetRpm = this._manualRpm;
        if (this.targetId && this.sys?.comps?.[this.targetId]) {
            const tgt = this.sys.comps[this.targetId];
            if (typeof tgt.rpm === 'number') targetRpm = tgt.rpm;
        }
        if (!this.powered || this.isBreak) targetRpm = 0;
        this.rpm = targetRpm;

        // 脉冲频率
        this.pulseFreq = (this.rpm / 60) * this.toothCount;

        // 计算当前相位下的磁场（正弦近似，每齿一个周期）
        const teethVisible = Math.min(this.toothCount, 24);
        const phasePerTooth = (2 * Math.PI * teethVisible) / this.toothCount;
        this._bField = Math.sin(this._phase * phasePerTooth);

        // 霍尔输出电平（迟滞比较器）
        if (this._bField > this._threshold) {
            this.outHigh = 1;
        } else if (this._bField < -this._threshold) {
            this.outHigh = 0;
        }

        // 模拟霍尔电压（线性，无迟滞）
        this.hallVoltage = (this._bField + 1) / 2 * this.vcc;

        // 电流输出
        if (this.outCurrent !== undefined) {
            this.outCurrent = 4 + (this.rpm / this.maxRpm) * 16;
        }

        // 累积脉冲
        if (this.powered && !this.isBreak && this.pulseFreq > 0) {
            this._pulseTimer += dt;
            const period = 1 / this.pulseFreq;
            while (this._pulseTimer >= period) {
                this._pulseTimer -= period;
                this.pulseCount++;
            }
        }

        // 齿轮角速度
        const omega = (this.rpm / 60) * 2 * Math.PI * this.direction;
        this._gearAngle += omega * dt;
        this._phase      = (this._gearAngle * this.toothCount / (2 * Math.PI));

        // rpm 弧
        if (this._rpmArc) {
            const ratio = Math.min(1, this.rpm / this.maxRpm);
            this._rpmArc.angle(ratio * 360);
        }
    }

    // ── 齿轮旋转 ──────────────────────────────
    _tickGear(dt) {
        if (this._gearGroup) this._gearGroup.rotation(this._gearAngle * 180 / Math.PI);

        // 方向箭头颜色
        if (this._dirArrow) {
            this._dirArrow.fill(this.direction > 0
                ? 'rgba(100,187,106,0.45)'
                : 'rgba(239,83,80,0.45)');
        }
    }

    // ── 霍尔信号处理 ──────────────────────────
    _tickHallSignal(dt) {
        const active = this.powered && !this.isBreak;
        if (this._outLed) {
            this._outLed.fill(active && this.outHigh ? '#43a047' : '#1a1a1a');
        }
        if (this._circOutDot) {
            this._circOutDot.fill(active && this.outHigh ? '#43a047' : '#0d2a0d');
        }
    }

    // ── 磁场强度可视化 ────────────────────────
    _tickBField() {
        const bh = 36;
        const bNorm = (this._bField + 1) / 2; // 0~1
        const active = this.powered && !this.isBreak;

        if (this._bBarFill) {
            const fillH = bNorm * (bh - 2);
            this._bBarFill.y(this._icY + bh - 1 - fillH);
            this._bBarFill.height(fillH);
            const intensity = active ? 1 : 0.3;
            const r = Math.round(255 * bNorm * intensity);
            const g = Math.round(143 * (1 - bNorm) * intensity);
            this._bBarFill.fill(`rgb(${r},${Math.round(g)},0)`);
        }
    }

    // ── 波形缓冲 ──────────────────────────────
    _tickWaveform(dt) {
        const active = this.powered && !this.isBreak;
        const scrollSpeed = active ? Math.min(5, this.pulseFreq / 8 + 0.4) : 0;
        this._wavAcc += scrollSpeed * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        for (let i = 0; i < steps; i++) {
            this._wavDigital = new Uint8Array([...this._wavDigital.slice(1), active ? this.outHigh : 0]);
            this._wavAnalog  = new Float32Array([...this._wavAnalog.slice(1), active ? this.hallVoltage : 0]);
        }

        // 绘制数字方波
        const wx = this._wavX + 3, wy = this._wavY;
        const ww = this._wavW - 6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;
        const hiY = this._wavMidDigital - wh * 0.12;
        const loY = this._wavMidDigital + wh * 0.12;

        const digPts = [];
        let prev = this._wavDigital[0];
        digPts.push(wx, prev ? hiY : loY);
        for (let i = 1; i < n; i++) {
            const v = this._wavDigital[i];
            const x = wx + i * dx;
            const y = v ? hiY : loY;
            if (v !== prev) { digPts.push(x, prev ? hiY : loY); digPts.push(x, y); }
            else digPts.push(x, y);
            prev = v;
        }
        if (this._wLineDigital) this._wLineDigital.points(digPts);

        // 绘制模拟电压波形
        const anaAmp = wh * 0.11;
        const anaPts = [];
        for (let i = 0; i < n; i++) {
            const v   = this._wavAnalog[i];
            const norm = (v / this.vcc) * 2 - 1;
            anaPts.push(wx + i*dx, this._wavMidAnalog - norm * anaAmp);
        }
        if (this._wLineAnalog) this._wLineAnalog.points(anaPts);

        // 更新标签
        const active2 = this.powered && !this.isBreak;
        if (this._wFreqLbl) this._wFreqLbl.text(active2 ? `${this.pulseFreq.toFixed(1)} Hz` : '-- Hz');
        if (this._wRpmLbl)  this._wRpmLbl.text(active2  ? `${Math.round(this.rpm)} rpm` : '-- rpm');
        if (this._wBLbl)    this._wBLbl.text(active2    ? `B=${this._bField.toFixed(2)}` : 'B=--');
    }

    // ── LCD + 显示刷新 ────────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;
        const active = pw && !br;

        if (!pw) {
            this._lcdMain.text('----'); this._lcdMain.fill('#0d2030');
            this._lcdUnit.text(''); this._lcdFreq.text(''); this._lcdPulse.text('');
            this._lcdVcc.text('-- V');
            return;
        }
        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdUnit.text(''); this._lcdFreq.text('ERR');
            this._lcdVcc.text('断线');
            return;
        }

        const ratio = this.rpm / this.maxRpm;
        const mc    = ratio > 0.9 ? '#ff5722' : ratio > 0.1 ? '#66bb6a' : '#43a047';

        this._lcdBg.fill('#020c14');
        this._lcdMain.text(Math.round(this.rpm).toString()); this._lcdMain.fill(mc);
        this._lcdUnit.text('rpm');
        this._lcdFreq.text(`f=${this.pulseFreq.toFixed(1)} Hz`);
        this._lcdFreq.fill(this.pulseFreq > 0 ? '#546e7a' : '#263238');
        this._lcdVcc.text(`${this.vcc}V  ${this.outputMode}`);
        this._lcdPulse.text(`Σ ${this.pulseCount}`);
    }

    // ═══════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════
    update(rpm, dir) {
        if (typeof rpm === 'number') this._manualRpm = Math.max(0, rpm);
        if (dir === 1 || dir === -1) this.direction = dir;
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'id',          type: 'text'   },
            { label: '齿数 Z',                 key: 'toothCount',  type: 'number' },
            { label: '最大转速 (rpm)',          key: 'maxRpm',      type: 'number' },
            { label: '供电电压 (V)',            key: 'vcc',         type: 'number' },
            { label: '绑定轴组件 ID',           key: 'targetId',    type: 'text'   },
            { label: '输出模式',               key: 'outputMode',  type: 'select',
              options: [
                  { label: 'NPN 集电极开路', value: 'NPN' },
                  { label: 'PNP 集电极开路', value: 'PNP' },
                  { label: '模拟电压输出',   value: 'Analog' },
              ] },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.toothCount  = parseInt(cfg.toothCount)   || this.toothCount;
        this.maxRpm      = parseFloat(cfg.maxRpm)     || this.maxRpm;
        this.vcc         = parseFloat(cfg.vcc)        || this.vcc;
        this.targetId    = cfg.targetId    || null;
        this.outputMode  = cfg.outputMode  || this.outputMode;
        this.config      = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}