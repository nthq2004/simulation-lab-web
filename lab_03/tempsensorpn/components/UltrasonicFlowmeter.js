import { BaseComponent } from './BaseComponent.js';

/**
 * 超声波流量计仿真组件（时差法 Transit-Time Ultrasonic Flowmeter）
 *
 * ── 测量原理 ────────────────────────────────────────────────
 *  两个超声波换能器（T1、T2）斜向安装于管道两侧。
 *  顺流方向发射的超声波传播速度更快，逆流方向更慢。
 *  通过测量两个方向的传播时间差 Δt 来计算流速：
 *
 *    t_up   = L / (c − v·cosθ)    逆流时间
 *    t_down = L / (c + v·cosθ)    顺流时间
 *
 *    Δt = t_up − t_down = 2·L·v·cosθ / (c² − v²·cos²θ)
 *
 *  简化（v << c）：
 *    v ≈ c² · Δt / (2·L·cosθ)
 *
 *  体积流量：
 *    Q = v · A = v · π(D/2)²
 *
 *  输出：4-20mA 模拟量 + 脉冲 + HART
 *
 * ── 组件结构 ───────────────────────────────────────────────
 *  ① 管段剖面（透视/俯视），展示两个换能器及声路轨迹
 *  ② 超声波传播动画（往返脉冲，颜色区分顺/逆流）
 *  ③ 时差示波器显示（展示 t_up/t_down 波形及 Δt 标注）
 *  ④ 仪表头（LCD主显、接线盒、旋钮、状态面板）
 *
 * ── 端口 ───────────────────────────────────────────────────
 *  pipe_i   — 管道进口（左）
 *  pipe_o   — 管道出口（右）
 *  wire_p   — 24VDC
 *  wire_n   — 4-20mA / GND
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'diff'
 *  update(press, flow) — flow 优先，press 退化
 */
export class UltrasonicFlowmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 360);
        this.height = Math.max(240, config.height || 280);

        this.type    = 'ultrasonic_flowmeter';
        this.special = 'diff';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.pipeDiam    = config.pipeDiam    || 0.1;     // 管道内径 m
        this.soundSpeed  = config.soundSpeed  || 343;     // 声速 m/s（空气 343，水 1480）
        this.pathAngle   = config.pathAngle   || 45;      // 声路安装角度 °
        this.pathLength  = config.pathLength  ||
            (this.pipeDiam / Math.sin(this.pathAngle * Math.PI / 180)); // 声路长度 m
        this.maxFlow     = config.maxFlow     || 100;     // 量程 m³/h
        this.maxPress    = config.maxPress    || 0.6;
        this.unit        = config.unit        || 'm³/h';
        this.fluidName   = config.fluidName   || '空气';
        this.kFactor     = config.kFactor     || 0.98;    // 修正系数（速度分布）

        // ── 零点/量程微调 ──
        this.zeroAdj     = 0;
        this.spanAdj     = 1.0;

        // ── 状态 ──
        this.press       = 0;
        this.flow        = 0;
        this.velocity    = 0;     // 流速 m/s
        this.deltaT      = 0;     // 时差 μs
        this.tUp         = 0;     // 逆流时间 μs
        this.tDown       = 0;     // 顺流时间 μs
        this.outCurrent  = 4;
        this.totalFlow   = 0;     // 累积 m³
        this.snr         = 0;     // 信噪比 dB（模拟）
        this.isBreak     = false;
        this.powered     = false;
        this.isLowFlow   = false;

        // ── 超声波脉冲动画 ──
        this._pulses      = [];   // {t, dir, alpha, progress}
        this._pulseTimer  = 0;
        this._pulsePeriod = 0.08; // 发射周期 s
        this._pulseDir    = 1;    // 交替方向

        // ── 时差示波器波形缓冲 ──
        this._oscBufLen   = 160;
        this._oscDeltaT   = new Array(this._oscBufLen).fill(0);
        this._oscPhaseAcc = 0;

        // ── 几何布局 ──
        // 管段区（上半部分，横向全宽）
        this._pipeX  = 14;
        this._pipeY  = 36;
        this._pipeW  = this.width  - 28;
        this._pipeH  = Math.round(this.height * 0.42);

        // 示波器区（中）
        this._oscX   = 14;
        this._oscY   = this._pipeY + this._pipeH + 8;
        this._oscW   = Math.round(this.width * 0.52);
        this._oscH   = Math.round(this.height * 0.26);

        // 仪表头（右侧，与示波器同高）
        this._headX  = this._oscX + this._oscW + 10;
        this._headW  = this.width - this._headX - 10;
        this._headY  = this._oscY;

        // 底部面板
        this._panelY = this._oscY + this._oscH + 8;

        this._lastTs = null;
        this._animId = null;
        this.knobs   = {};

        this.config = {
            id: this.id, pipeDiam: this.pipeDiam,
            soundSpeed: this.soundSpeed, pathAngle: this.pathAngle,
            maxFlow: this.maxFlow, unit: this.unit,
        };

        this._init();

        const midY = this._pipeY + this._pipeH / 2;
        this.addPort(0,           midY, 'i', 'pipe', 'IN');
        this.addPort(this.width,  midY, 'o', 'pipe', 'OUT');
        this.addPort(this.width,  this._headY + 14, 'p', 'wire', 'V+');
        this.addPort(this.width,  this._headY + 36, 'n', 'wire', 'SIG');
    }

    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawPipeSection();
        this._drawTransducers();
        this._drawSoundPath();
        this._drawPulseLayer();
        this._drawOscilloscope();
        this._drawInstrumentHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawBottomPanel();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '超声波流量计（时差法）',
            fontSize: 14, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 管段剖面 ──────────────────────────────
    _drawPipeSection() {
        const { _pipeX: px, _pipeY: py, _pipeW: pw, _pipeH: ph } = this;
        const wall = 12;

        // 管道外壁（深银色，高级金属感）
        const outer = new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: 3,
        });
        // 管内流体通道
        this._flowChanX = px + wall;
        this._flowChanY = py + wall;
        this._flowChanW = pw - wall * 2;
        this._flowChanH = ph - wall * 2;

        this._flowChannel = new Konva.Rect({
            x: this._flowChanX, y: this._flowChanY,
            width: this._flowChanW, height: this._flowChanH,
            fill: '#0a1a2a',
        });

        // 上下管壁质感线
        const topSheen = new Konva.Rect({
            x: px, y: py, width: pw, height: 5,
            fill: 'rgba(255,255,255,0.14)', cornerRadius: [3, 3, 0, 0],
        });
        const botSheen = new Konva.Rect({
            x: px, y: py + ph - 4, width: pw, height: 4,
            fill: 'rgba(0,0,0,0.22)', cornerRadius: [0, 0, 3, 3],
        });

        // 左右法兰盘
        [[px - 12, 0], [px + pw - 2, 1]].forEach(([fx, side]) => {
            const flange = new Konva.Rect({
                x: fx, y: py - 8, width: 14, height: ph + 16,
                fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
                cornerRadius: side === 0 ? [3, 0, 0, 3] : [0, 3, 3, 0],
            });
            [0.22, 0.5, 0.78].forEach(r => {
                this.group.add(new Konva.Circle({
                    x: fx + 7, y: py - 8 + (ph + 16) * r,
                    radius: 3, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5,
                }));
            });
            this.group.add(flange);
        });

        // 流向标签
        this.group.add(new Konva.Text({
            x: px + 8, y: py + ph / 2 - 6,
            text: '→ 流体流向', fontSize: 8.5, fill: 'rgba(79,195,247,0.5)',
        }));

        this.group.add(outer, this._flowChannel, topSheen, botSheen);
    }

    // ── 换能器（T1 上游、T2 下游，斜向安装）──
    _drawTransducers() {
        const fcx  = this._flowChanX;
        const fcy  = this._flowChanY;
        const fcw  = this._flowChanW;
        const fch  = this._flowChanH;
        const py   = this._pipeY;
        const ph   = this._pipeH;

        // T1 安装于上游上壁（发射方向斜向右下）
        this._t1X = fcx + fcw * 0.22;
        this._t1Y = py;          // 管道顶部
        // T2 安装于下游下壁（发射方向斜向左上）
        this._t2X = fcx + fcw * 0.72;
        this._t2Y = py + ph;     // 管道底部

        const drawTransducer = (tx, ty, isTop, label) => {
            const h = 22, w = 18;
            const transGroup = new Konva.Group();

            if (isTop) {
                // 顶部安装：探头向下伸出
                const body = new Konva.Rect({
                    x: tx - w/2, y: ty - h - 2,
                    width: w, height: h,
                    fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1.5,
                    cornerRadius: [4, 4, 0, 0],
                });
                const stem = new Konva.Rect({
                    x: tx - 4, y: ty - 6, width: 8, height: 10,
                    fill: '#1976d2', stroke: '#0d47a1', strokeWidth: 0.5,
                });
                const tip = new Konva.Ellipse({
                    x: tx, y: ty + 2, radiusX: 6, radiusY: 3,
                    fill: '#42a5f5', stroke: '#1976d2', strokeWidth: 1,
                });
                const lbl = new Konva.Text({
                    x: tx - 10, y: ty - h - 16, text: label,
                    fontSize: 9, fontStyle: 'bold', fill: '#42a5f5',
                });
                transGroup.add(body, stem, tip, lbl);

                // 电缆线
                transGroup.add(new Konva.Line({
                    points: [tx, ty - h - 2, tx, ty - h - 12],
                    stroke: '#1565c0', strokeWidth: 2, lineCap: 'round',
                }));
                transGroup.add(new Konva.Line({
                    points: [tx, ty - h - 12, tx + 25, ty - h - 12],
                    stroke: '#1565c0', strokeWidth: 2, lineCap: 'round', dash: [3, 2],
                }));
            } else {
                // 底部安装：探头向上伸出
                const body = new Konva.Rect({
                    x: tx - w/2, y: ty + 2,
                    width: w, height: h,
                    fill: '#00838f', stroke: '#006064', strokeWidth: 1.5,
                    cornerRadius: [0, 0, 4, 4],
                });
                const stem = new Konva.Rect({
                    x: tx - 4, y: ty - 4, width: 8, height: 8,
                    fill: '#00acc1', stroke: '#006064', strokeWidth: 0.5,
                });
                const tip = new Konva.Ellipse({
                    x: tx, y: ty - 2, radiusX: 6, radiusY: 3,
                    fill: '#26c6da', stroke: '#00838f', strokeWidth: 1,
                });
                const lbl = new Konva.Text({
                    x: tx - 10, y: ty + h + 8, text: label,
                    fontSize: 9, fontStyle: 'bold', fill: '#26c6da',
                });
                transGroup.add(body, stem, tip, lbl);

                transGroup.add(new Konva.Line({
                    points: [tx, ty + h + 2, tx, ty + h + 12],
                    stroke: '#00838f', strokeWidth: 2, lineCap: 'round',
                }));
                transGroup.add(new Konva.Line({
                    points: [tx, ty + h + 12, tx + 25, ty + h + 12],
                    stroke: '#00838f', strokeWidth: 2, lineCap: 'round', dash: [3, 2],
                }));
            }
            this.group.add(transGroup);
        };

        drawTransducer(this._t1X, this._t1Y, true,  'T1');
        drawTransducer(this._t2X, this._t2Y, false, 'T2');
    }

    // ── 声路示意线（静态，斜向）──────────────
    _drawSoundPath() {
        const fcy = this._flowChanY;
        const fch = this._flowChanH;

        // 声路：T1(上游顶) → T2(下游底)，斜线
        this._pathLine = new Konva.Line({
            points: [this._t1X, fcy, this._t2X, fcy + fch],
            stroke: 'rgba(100,150,220,0.18)', strokeWidth: 1.5, dash: [6, 4],
        });
        // 角度标注
        const midX = (this._t1X + this._t2X) / 2;
        const midY = fcy + fch / 2;
        this._angleLbl = new Konva.Text({
            x: midX + 4, y: midY - 10,
            text: `θ=${this.pathAngle}°`,
            fontSize: 8, fill: 'rgba(100,150,220,0.55)',
        });
        this.group.add(this._pathLine, this._angleLbl);
    }

    // ── 超声波脉冲动画层 ─────────────────────
    _drawPulseLayer() {
        this._pulseGroup = new Konva.Group();
        this.group.add(this._pulseGroup);
    }

    // ── 时差示波器 ───────────────────────────
    _drawOscilloscope() {
        const { _oscX: ox, _oscY: oy, _oscW: ow, _oscH: oh } = this;

        const scrBg = new Konva.Rect({
            x: ox, y: oy, width: ow, height: oh,
            fill: '#020d18', stroke: '#1a3a4a', strokeWidth: 1.5, cornerRadius: 4,
        });
        // 网格
        for (let i = 1; i < 4; i++) {
            this.group.add(new Konva.Line({
                points: [ox, oy + oh*i/4, ox+ow, oy + oh*i/4],
                stroke: 'rgba(0,150,200,0.1)', strokeWidth: 0.5,
            }));
        }
        for (let i = 1; i < 6; i++) {
            this.group.add(new Konva.Line({
                points: [ox + ow*i/6, oy, ox + ow*i/6, oy+oh],
                stroke: 'rgba(0,150,200,0.07)', strokeWidth: 0.5,
            }));
        }

        // Δt 滚动波形（橙色）
        this._oscDtLine = new Konva.Line({
            points: [], stroke: '#ff6d00', strokeWidth: 1.5, lineJoin: 'round',
        });
        // 零基准线
        this._oscZeroLine = new Konva.Line({
            points: [ox + 24, oy + oh/2, ox + ow - 4, oy + oh/2],
            stroke: 'rgba(255,255,255,0.1)', strokeWidth: 0.8, dash: [4, 4],
        });

        // 标签
        const lblDt = new Konva.Text({
            x: ox + 4, y: oy + 4, text: 'Δt (μs)',
            fontSize: 8, fontStyle: 'bold', fill: '#ff6d00',
        });
        this._oscTitle = new Konva.Text({
            x: ox + ow - 90, y: oy + 4, width: 86,
            text: 'Δt=-- μs', fontSize: 8,
            fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'right',
        });
        // t_up / t_down 值
        this._oscTUp = new Konva.Text({
            x: ox + 4, y: oy + oh - 22, text: 't↑=-- μs',
            fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#42a5f5',
        });
        this._oscTDown = new Konva.Text({
            x: ox + 4, y: oy + oh - 12, text: 't↓=-- μs',
            fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#26c6da',
        });

        this.group.add(scrBg, this._oscDtLine, this._oscZeroLine,
            lblDt, this._oscTitle, this._oscTUp, this._oscTDown);
    }

    // ── 仪表头（LCD + 接线盒）────────────────
    _drawInstrumentHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._oscH;

        // 接线盒（顶部条）
        const jH = 40;
        const jbox = new Konva.Rect({
            x: hx, y: hy, width: hw, height: jH,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0],
        });
        for (let i = 0; i < 3; i++) {
            this.group.add(new Konva.Line({
                points: [hx, hy+7+i*10, hx+hw, hy+7+i*10],
                stroke: 'rgba(255,255,255,0.16)', strokeWidth: 0.8,
            }));
        }
        const plate = new Konva.Rect({
            x: hx+12, y: hy+5, width: hw-24, height: 22,
            fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2,
        });
        this._idText = new Konva.Text({
            x: hx+12, y: hy+8, width: hw-24,
            text: this.id || 'FT-401',
            fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center',
        });
        this.group.add(new Konva.Text({
            x: hx+12, y: hy+18, width: hw-24,
            text: 'ULTRASONIC  HART', fontSize: 7, fill: '#78909c', align: 'center',
        }));
        const lcap = new Konva.Rect({ x: hx, y: hy+4, width: 12, height: 36, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-12, y: hy+4, width: 12, height: 36, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });

        // 仪表体
        const bodyY = hy + jH;
        const bodyH = hh - jH;
        const body  = new Konva.Rect({
            x: hx, y: bodyY, width: hw, height: bodyH,
            fill: '#1a2634', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4],
        });
        this._headBodyY = bodyY; this._headBodyH = bodyH;

        this.group.add(jbox, plate, lcap, rcap, this._idText, body);
    }

    // ── LCD 主显示 ──────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headBodyY + this._headBodyH / 2;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.42, this._headBodyH * 0.44);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        const outer  = new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 });
        // 青色工业风外环
        const midRing = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#004d40', stroke: '#00695c', strokeWidth: 2.5 });
        this._lcdBg   = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020e14' });

        // 声速/信号强度弧
        this._snrArc = new Konva.Arc({
            x: lcx, y: lcy,
            innerRadius: R-5, outerRadius: R-3,
            angle: 0, fill: '#00bcd4', rotation: -90,
        });

        this._lcdMain    = new Konva.Text({ x: lcx-R+5, y: lcy-R*.35, width: (R-5)*2, text: '--.-', fontSize: R*.37, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#00e5ff', align: 'center' });
        this._lcdUnit    = new Konva.Text({ x: lcx-R+5, y: lcy+R*.08,  width: (R-5)*2, text: this.unit, fontSize: R*.17, fill: '#00695c', align: 'center' });
        this._lcdVel     = new Konva.Text({ x: lcx-R+5, y: lcy+R*.3,   width: (R-5)*2, text: 'v=-- m/s', fontSize: R*.15, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'center' });
        this._lcdCurrent = new Konva.Text({ x: lcx-R+5, y: lcy-R*.57,  width: (R-5)*2, text: '4.00 mA', fontSize: R*.14, fontFamily: 'Courier New, monospace', fill: '#80cbc4', align: 'center' });
        this._lcdSnr     = new Konva.Text({ x: lcx-R+5, y: lcy+R*.47,  width: (R-5)*2, text: 'SNR=-- dB', fontSize: R*.13, fontFamily: 'Courier New, monospace', fill: '#263238', align: 'center' });

        this.group.add(outer, midRing, this._lcdBg, this._snrArc,
            this._lcdMain, this._lcdUnit, this._lcdVel, this._lcdCurrent, this._lcdSnr);
    }

    // ── 旋钮 ────────────────────────────────
    _drawKnobs() {
        const kY = this._headBodyY + this._headBodyH + 12;
        const hx = this._headX, hw = this._headW;
        [{ id: 'zero', x: hx + hw*.28, label: 'Z' },
         { id: 'span', x: hx + hw*.72, label: 'S' }].forEach(k => {
            const g = new Konva.Group({ x: k.x, y: kY });
            g.add(new Konva.Circle({ radius: 10, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 7.5, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1 }));
            rotor.add(new Konva.Line({ points: [0,-6.5,0,6.5], stroke: '#37474f', strokeWidth: 2.5, lineCap: 'round' }));
            g.add(rotor, new Konva.Text({ x: -5, y: 12, text: k.label, fontSize: 9, fontStyle: 'bold', fill: '#607d8b' }));
            this.knobs[k.id] = rotor;
            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                    rotor.rotation(startRot + (sy - cy) * 2);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.04;
                    else                 this.spanAdj = 1 + (rotor.rotation() / 360) * 0.3;
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
            this.group.add(g);
        });
    }

    // ── 底部面板 ───────────────────────────
    _drawBottomPanel() {
        const py = this._panelY;
        const pw = this.width - 8;

        const bg = new Konva.Rect({
            x: 4, y: py, width: pw, height: 40,
            fill: '#050d18', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4,
        });
        this._panelTotal  = new Konva.Text({ x: 10, y: py+5, width: pw*.45, text: 'Σ 0.000 m³', fontSize: 9, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#00cdd7' });
        this._panelDeltaT = new Konva.Text({ x: 10, y: py+20, width: pw*.45, text: 'Δt=0.000 μs', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#546e7a' });
        this._panelStatus = new Konva.Text({ x: pw*.48+4, y: py+5, width: pw*.5, text: '● 正常运行', fontSize: 9, fontStyle: 'bold', fill: '#66bb6a', align: 'right' });
        this._panelCs     = new Konva.Text({ x: pw*.48+4, y: py+20, width: pw*.5, text: `c=${this.soundSpeed} m/s`, fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'right' });

        this.group.add(bg, this._panelTotal, this._panelDeltaT, this._panelStatus, this._panelCs);
    }

    // ═══════════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════════
    _startAnimation() {
        const tick = (ts) => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickPulses(dt);
                this._tickOscilloscope(dt);
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
        const adjFlow = Math.max(0, (this.flow + this.zeroAdj * this.maxFlow) * this.spanAdj);
        const A = Math.PI * Math.pow(this.pipeDiam / 2, 2);
        this.velocity  = (adjFlow / 3600) / A * this.kFactor;

        const c    = this.soundSpeed;
        const L    = this.pathLength;
        const cosA = Math.cos(this.pathAngle * Math.PI / 180);
        const v    = this.velocity;

        // 时差（μs）
        this.tDown = (L / (c + v * cosA)) * 1e6;
        this.tUp   = (L / (c - v * cosA)) * 1e6;
        this.deltaT = this.tUp - this.tDown;

        // 信噪比（模拟，随流量变化）
        this.snr = 20 + Math.min(40, (adjFlow / this.maxFlow) * 30) - Math.random() * 2;

        this.isLowFlow   = adjFlow < this.maxFlow * 0.03;
        const dispFlow   = this.isLowFlow ? 0 : adjFlow;
        this.outCurrent  = 4 + Math.min(1, dispFlow / this.maxFlow) * 16;

        if (this.powered && !this.isBreak && !this.isLowFlow) {
            this.totalFlow += dispFlow * dt / 3600;
        }

        // SNR 弧角
        if (this._snrArc) {
            const snrRatio = Math.min(1, Math.max(0, (this.snr - 20) / 40));
            this._snrArc.angle(snrRatio * 360);
        }
    }

    // ── 超声波脉冲动画 ────────────────────────
    _tickPulses(dt) {
        const active = this.powered && !this.isBreak;

        if (active) {
            this._pulseTimer -= dt;
            if (this._pulseTimer <= 0) {
                this._pulseTimer = this._pulsePeriod;
                // 发射脉冲（顺流 T1→T2 和 逆流 T2→T1 交替）
                this._pulses.push({ dir: 1,  progress: 0, alpha: 0.9 });   // T1→T2（顺流，蓝）
                this._pulses.push({ dir: -1, progress: 0, alpha: 0.9 });   // T2→T1（逆流，青）
            }
        }

        const fcy  = this._flowChanY;
        const fch  = this._flowChanH;
        const fcxe = this._flowChanX + this._flowChanW;

        // 脉冲传播速度（视觉）
        const visualSpeed = active ? (0.7 + Math.min(0.5, this.velocity * 0.1)) : 0;

        this._pulses = this._pulses.filter(p => {
            p.progress += visualSpeed * dt / 0.12;
            p.alpha     = Math.max(0, 0.9 - p.progress * 0.8);
            return p.alpha > 0.04 && p.progress < 1.2;
        });

        // 重绘脉冲
        this._pulseGroup.destroyChildren();

        this._pulses.forEach(p => {
            let sx, sy, ex, ey;
            if (p.dir === 1) {
                // T1（上游顶）→ T2（下游底）：顺流方向，蓝色
                sx = this._t1X + (this._t2X - this._t1X) * p.progress;
                sy = fcy       + (fcy + fch - fcy)       * p.progress;
                const color = `rgba(66,165,245,${p.alpha})`;
                // 脉冲点
                this._pulseGroup.add(new Konva.Circle({ x: sx, y: sy, radius: 3.5, fill: color }));
                // 脉冲波纹
                if (p.progress < 0.95) {
                    this._pulseGroup.add(new Konva.Circle({ x: sx, y: sy, radius: 7 + p.progress*4, fill: 'none', stroke: color, strokeWidth: 1 }));
                }
            } else {
                // T2（下游底）→ T1（上游顶）：逆流方向，青色
                sx = this._t2X + (this._t1X - this._t2X) * p.progress;
                sy = fcy + fch - (fch)                    * p.progress;
                const color = `rgba(38,198,218,${p.alpha})`;
                this._pulseGroup.add(new Konva.Circle({ x: sx, y: sy, radius: 3.5, fill: color }));
                if (p.progress < 0.95) {
                    this._pulseGroup.add(new Konva.Circle({ x: sx, y: sy, radius: 7 + p.progress*4, fill: 'none', stroke: color, strokeWidth: 1 }));
                }
            }
        });
    }

    // ── 示波器 Δt 滚动波形 ───────────────────
    _tickOscilloscope(dt) {
        const active = this.powered && !this.isBreak;
        const scrollRate = active ? 1.5 : 0;

        this._oscPhaseAcc += scrollRate * dt * this._oscBufLen;
        const steps = Math.floor(this._oscPhaseAcc);
        this._oscPhaseAcc -= steps;

        for (let i = 0; i < steps; i++) {
            this._oscDeltaT.shift();
            const val = active ? (this.deltaT + (Math.random() - 0.5) * 0.01) : 0;
            this._oscDeltaT.push(val);
        }

        // 重建波形线
        const ox = this._oscX + 24, oy = this._oscY;
        const ow = this._oscW - 28, oh = this._oscH;
        const mid = oy + oh / 2;
        const n   = this._oscBufLen;
        const dx  = ow / n;
        // 找 Δt 范围用于归一化
        const maxDt = Math.max(0.001, Math.max(...this._oscDeltaT) * 1.2);

        const pts = [];
        for (let i = 0; i < n; i++) {
            const x = ox + i * dx;
            const v = this._oscDeltaT[i];
            const y = mid - (v / maxDt) * (oh * 0.38);
            pts.push(x, y);
        }
        if (this._oscDtLine) this._oscDtLine.points(pts);

        // 更新数值标签
        if (this._oscTitle) this._oscTitle.text(active ? `Δt=${this.deltaT.toFixed(4)} μs` : 'Δt=-- μs');
        if (this._oscTUp)   this._oscTUp.text(active   ? `t↑=${this.tUp.toFixed(2)} μs` : 't↑=-- μs');
        if (this._oscTDown) this._oscTDown.text(active  ? `t↓=${this.tDown.toFixed(2)} μs` : 't↓=-- μs');
    }

    // ── LCD + 面板刷新 ───────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;

        if (!pw) {
            this._lcdMain.text('----'); this._lcdMain.fill('#0d2030');
            this._lcdUnit.text(''); this._lcdVel.text(''); this._lcdSnr.text('');
            this._lcdCurrent.text('-- mA');
            this._lcdBg.fill('#020e14');
            this._panelStatus.text('○ 断电'); this._panelStatus.fill('#37474f');
            return;
        }
        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdUnit.text(''); this._lcdVel.text('ERR'); this._lcdSnr.text('');
            this._lcdCurrent.text('1.8 mA');
            this._lcdBg.fill('#1a0808');
            this._panelStatus.text('⚠ 断线故障'); this._panelStatus.fill('#ef5350');
            return;
        }

        const adjFlow  = Math.max(0, (this.flow + this.zeroAdj * this.maxFlow) * this.spanAdj);
        const dispFlow = this.isLowFlow ? 0 : adjFlow;
        const ratio    = dispFlow / this.maxFlow;
        const mc       = ratio > 0.9 ? '#00b8d4' : ratio > 0.1 ? '#00e5ff' : '#00acc1';

        const txt = this.outCurrent < 3.8 ? 'LLLL' :
                    this.outCurrent > 20.5 ? 'HHHH' :
                    dispFlow.toFixed(1);

        this._lcdBg.fill('#020e14');
        this._lcdMain.text(txt); this._lcdMain.fill(mc);
        this._lcdUnit.text(this.unit);
        this._lcdVel.text(`v=${this.velocity.toFixed(3)} m/s`);
        this._lcdVel.fill(this.velocity > 0 ? '#546e7a' : '#263238');
        this._lcdCurrent.text(`${this.outCurrent.toFixed(2)} mA`);
        this._lcdSnr.text(`SNR=${this.snr.toFixed(1)} dB`);
        this._lcdSnr.fill(this.snr > 40 ? '#26a69a' : this.snr > 25 ? '#546e7a' : '#ef5350');

        const stStr = this.isLowFlow ? '↓ 小流量切除' :
                      ratio > 0.9    ? '⬆ 高流量预警' :
                      dispFlow > 0   ? '● 正常运行'   : '○ 零流量';
        const stCol = this.isLowFlow ? '#ffa726' :
                      ratio > 0.9    ? '#ff7043' :
                      dispFlow > 0   ? '#66bb6a' : '#546e7a';
        this._panelStatus.text(stStr); this._panelStatus.fill(stCol);
        this._panelTotal.text(`Σ ${this.totalFlow.toFixed(3)} m³`);
        this._panelDeltaT.text(`Δt=${this.deltaT.toFixed(4)} μs`);
        this._panelCs.text(`c=${this.soundSpeed} m/s  θ=${this.pathAngle}°`);
    }

    // ═══════════════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════════════
    update(press, flow) {
        this.press = typeof press === 'number' ? press : 0;
        if (typeof flow === 'number' && flow >= 0) {
            this.flow = flow;
        } else {
            const A    = Math.PI * Math.pow(this.pipeDiam / 2, 2);
            const pNorm = Math.min(1, Math.max(0, this.press / this.maxPress));
            this.flow  = Math.sqrt(pNorm) * this.maxFlow;
        }
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════
    //  配置
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'id',          type: 'text'   },
            { label: '管道内径 (m)',       key: 'pipeDiam',    type: 'number' },
            { label: '声速 (m/s)',         key: 'soundSpeed',  type: 'number' },
            { label: '安装角度 θ (°)',     key: 'pathAngle',   type: 'number' },
            { label: '满量程流量',         key: 'maxFlow',     type: 'number' },
            { label: '修正系数 K',         key: 'kFactor',     type: 'number' },
            { label: '介质',              key: 'fluidName',   type: 'text'   },
            { label: '单位', key: 'unit', type: 'select',
              options: [
                  { label: 'm³/h', value: 'm³/h' },
                  { label: 'L/h',  value: 'L/h'  },
                  { label: 'kg/h', value: 'kg/h' },
              ] },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.pipeDiam   = parseFloat(cfg.pipeDiam)   || this.pipeDiam;
        this.soundSpeed = parseFloat(cfg.soundSpeed) || this.soundSpeed;
        this.pathAngle  = parseFloat(cfg.pathAngle)  || this.pathAngle;
        this.maxFlow    = parseFloat(cfg.maxFlow)    || this.maxFlow;
        this.kFactor    = parseFloat(cfg.kFactor)    || this.kFactor;
        this.fluidName  = cfg.fluidName  || this.fluidName;
        this.unit       = cfg.unit       || this.unit;
        this.pathLength = this.pipeDiam / Math.sin(this.pathAngle * Math.PI / 180);
        this.config     = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}