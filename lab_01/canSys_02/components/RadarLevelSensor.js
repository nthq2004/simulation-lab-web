import { BaseComponent } from './BaseComponent.js';

/**
 * 雷达式液位传感器仿真组件（FMCW 调频连续波雷达液位计）
 *
 * ── 测量原理 ────────────────────────────────────────────────
 *  调频连续波（FMCW）雷达：
 *    发射频率随时间线性扫描（chirp 信号），
 *    电磁波到达液面后反射，返回时已经过 Δt 时间延迟。
 *    混频器将发射与接收信号混合，得到差频 Δf（Beat 频率）：
 *
 *    Δf = (2 × D × B) / (c × T)
 *
 *  其中：
 *    D — 天线到液面距离 (m)
 *    B — 扫频带宽 (Hz)，通常 ~1 GHz
 *    c — 光速 3×10⁸ m/s
 *    T — 调频周期 (s)
 *
 *  液位计算：
 *    D = c × Δf × T / (2B)
 *    H = tankHeight − D     （液位 = 量程高度 − 距离）
 *
 *  输出：4-20 mA  ↔  H_min ~ H_max
 *
 * ── 视觉组成 ───────────────────────────────────────────────
 *  ① 天线喇叭（Horn Antenna）外壳 — 仪表主体
 *  ② 圆形 OLED 显示头 — 液位 % + 距离数值 + 雷达扫描动画
 *  ③ 零点/量程旋钮（Z / S）
 *  ④ 接线盒（顶部，电源 + 4-20mA）
 *  ⑤ 集成水箱截面 — 直观展示雷达波来回路径
 *  ⑥ 雷达发射/回波动画 — 扩散环模拟电磁波传播
 *
 * ── 端口 ───────────────────────────────────────────────────
 *  wire_p    — 24VDC 电源正
 *  wire_n    — 4-20mA 信号 / GND
 *
 * ── 气路求解器集成 ──────────────────────────────────────────
 *  special = 'none'（纯电气仪表，不参与气路）
 *  update(level)  — 外部注入液位 % (0~100)
 *  this.liquidLevel — 内部液位状态，可由水箱拖拽或外部注入
 */
export class RadarLevelSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(260, config.width  || 300);
        this.height = Math.max(300, config.height || 340);

        this.type    = 'radar_level';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 量程参数 ──
        this.tankHeight   = config.tankHeight   || 4.0;    // 水箱满量程高度 m
        this.antennaGap   = config.antennaGap   || 0.3;    // 天线到满液面距离 m（盲区）
        this.minLevel     = 0;
        this.maxLevel     = 100;
        this.unit         = config.unit         || 'm';
        this.freqBand     = config.freqBand     || 26;     // GHz，常见 26GHz / 80GHz

        // ── 状态 ──
        this.liquidLevel  = config.initLevel    || 50;     // % (0~100)
        this.distance     = 0;                              // 当前天线到液面距离 m
        this.outCurrent   = 12;                             // 4-20mA
        this.isBreak      = false;
        this.powered      = false;

        // ── 零点/量程微调 ──
        this.zeroAdj      = 0;
        this.spanAdj      = 1.0;

        // ── FMCW 参数（仿真用，决定动画速度感）──
        this._chirpBW     = 1e9;                            // 扫频带宽 1 GHz
        this._chirpPeriod = 0.001;                          // 1 ms 调频周期
        this._beatFreq    = 0;

        // ── 动画状态 ──
        this._radarRings   = [];    // 扩散环 [{r, alpha, speed}]
        this._echoRings    = [];    // 回波环
        this._scanAngle    = 0;     // OLED 扫描线角度
        this._chirpPhase   = 0;     // chirp 波形相位
        this._lastTs       = null;
        this._animId       = null;
        this._emitTimer    = 0;     // 下一次发射计时

        // ── 水箱拖拽 ──
        this._dragActive   = false;
        this._dragStartY   = null;
        this._dragStartLv  = null;

        // ── 旋钮 ──
        this.knobs        = {};
        this._knobAngle   = { zero: 0, span: 0 };

        // 几何常数
        this._antCX       = this.width * 0.38;
        this._antY        = this.height * 0.10;  // 天线顶部 Y
        this._antH        = this.height * 0.24;  // 天线区域高度（含 OLED）
        this._tankX       = this.width * 0.52;
        this._tankY       = this.height * 0.10;
        this._tankW       = this.width * 0.44;
        this._tankH       = this.height * 0.68;

        this.config = {
            id: this.id, tankHeight: this.tankHeight,
            antennaGap: this.antennaGap, freqBand: this.freqBand,
        };

        this._init();

        this.addPort(this.width, 22, 'p', 'wire', 'V+');
        this.addPort(this.width, 48, 'n', 'wire', '4-20');
    }

    // ═══════════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawJunctionBox();
        this._drawAntennaBody();
        this._drawOledDisplay();
        this._drawKnobs();
        this._drawTank();
        this._drawTankDynamic();   // 动态层（液面 + 雷达波）
        this._drawBottomPanel();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '雷达液位传感器',
            fontSize: 14, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 顶部接线盒 ──────────────────────────────
    _drawJunctionBox() {
        const W = this.width, jH = 56;
        const jbox = new Konva.Rect({
            x: 0, y: 0, width: W, height: jH,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0],
        });
        // 顶部金属感条纹
        for (let i = 0; i < 5; i++) {
            this.group.add(new Konva.Line({
                points: [0, 8 + i*9, W, 8 + i*9],
                stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1,
            }));
        }
        const plate = new Konva.Rect({
            x: W*0.22, y: 8, width: W*0.56, height: 30,
            fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 3,
        });
        this._idText = new Konva.Text({
            x: W*0.22, y: 11, width: W*0.56,
            text: this.id || 'LT-201',
            fontSize: 10, fontStyle: 'bold', fill: '#263238', align: 'center',
        });
        this.group.add(new Konva.Text({
            x: W*0.22, y: 22, width: W*0.56,
            text: `${this.freqBand} GHz  FMCW  4~20mA`,
            fontSize: 7.5, fill: '#78909c', align: 'center',
        }));
        const lcap = new Konva.Rect({ x: 0, y: 6, width: 16, height: 44, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: W-16, y: 6, width: 16, height: 44, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });
        this.group.add(jbox, plate, lcap, rcap, this._idText);
    }

    // ── 天线主体（喇叭天线外壳）────────────────
    _drawAntennaBody() {
        const cx = this._antCX;
        const topY = 56;          // 接线盒底部
        const bodyH = 55;
        const bodyW = 62;

        // 主体圆柱壳（深蓝灰色工业感）
        const body = new Konva.Rect({
            x: cx - bodyW/2, y: topY,
            width: bodyW, height: bodyH,
            fill: '#2c3e50', stroke: '#1a252f', strokeWidth: 1.5, cornerRadius: [3,3,0,0],
        });
        // 金属质感高光
        const sheen = new Konva.Rect({
            x: cx - bodyW/2 + 2, y: topY + 2,
            width: 8, height: bodyH - 4,
            fill: 'rgba(255,255,255,0.06)', cornerRadius: 2,
        });
        // 工艺槽线
        for (let i = 0; i < 4; i++) {
            this.group.add(new Konva.Line({
                points: [cx - bodyW/2 + 4, topY + 12 + i*10, cx + bodyW/2 - 4, topY + 12 + i*10],
                stroke: 'rgba(255,255,255,0.07)', strokeWidth: 1,
            }));
        }

        // 喇叭天线口（梯形扩口，朝下）
        const hornTopY = topY + bodyH;
        const hornBotY = hornTopY + 28;
        const hornTopW = bodyW - 10;
        const hornBotW = bodyW + 22;
        const horn = new Konva.Line({
            points: [
                cx - hornTopW/2, hornTopY,
                cx + hornTopW/2, hornTopY,
                cx + hornBotW/2, hornBotY,
                cx - hornBotW/2, hornBotY,
            ],
            closed: true,
            fill: '#37474f', stroke: '#263238', strokeWidth: 1.5,
        });
        // 喇叭口内壁（深色）
        const hornInner = new Konva.Line({
            points: [
                cx - hornTopW/2 + 4, hornTopY + 2,
                cx + hornTopW/2 - 4, hornTopY + 2,
                cx + hornBotW/2 - 6, hornBotY - 2,
                cx - hornBotW/2 + 6, hornBotY - 2,
            ],
            closed: true,
            fill: '#1a252f',
        });
        // 天线口中心波导（小圆，模拟馈源）
        const feed = new Konva.Circle({
            x: cx, y: hornTopY + 6,
            radius: 6, fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
        });
        const feedDot = new Konva.Circle({
            x: cx, y: hornTopY + 6,
            radius: 2.5, fill: '#80cbc4',
        });

        this._hornBotY = hornBotY;
        this._hornBotW = hornBotW;
        this.group.add(body, sheen, horn, hornInner, feed, feedDot);
    }

    // ── OLED 圆形显示屏（嵌入天线体侧）────────
    _drawOledDisplay() {
        const cx = this._antCX;
        const oy  = 56 + 26;     // 天线体纵向中部
        this._oledCX = cx;
        this._oledCY = oy;
        this._oledR  = 24;

        const outerRing = new Konva.Circle({
            x: cx, y: oy, radius: 28,
            fill: '#1a252f', stroke: '#0d1520', strokeWidth: 1,
        });
        const midRing = new Konva.Circle({
            x: cx, y: oy, radius: 26,
            fill: '#0d4f7a', stroke: '#1565c0', strokeWidth: 2,
        });
        this._oledBg = new Konva.Circle({
            x: cx, y: oy, radius: 24, fill: '#020c14',
        });

        // ── OLED 内容层 ──
        // 扫描线（旋转）
        this._scanLine = new Konva.Line({
            points: [cx, oy, cx + 22, oy],
            stroke: 'rgba(0,230,118,0.6)', strokeWidth: 1.2,
        });
        // 同心弧（雷达图案）
        this._radarArc1 = new Konva.Arc({
            x: cx, y: oy, innerRadius: 8, outerRadius: 9,
            angle: 360, fill: 'rgba(0,200,100,0.15)',
        });
        this._radarArc2 = new Konva.Arc({
            x: cx, y: oy, innerRadius: 15, outerRadius: 16,
            angle: 360, fill: 'rgba(0,200,100,0.10)',
        });
        // 主数值文字
        this._oledMain = new Konva.Text({
            x: cx - 22, y: oy - 10, width: 44,
            text: '--.-', fontSize: 11,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#00e676', align: 'center',
        });
        // 单位
        this._oledUnit = new Konva.Text({
            x: cx - 18, y: oy + 4, width: 36,
            text: 'm', fontSize: 8, fill: '#00897b', align: 'center',
        });

        this.group.add(outerRing, midRing, this._oledBg,
            this._radarArc1, this._radarArc2,
            this._scanLine, this._oledMain, this._oledUnit);
    }

    // ── 零点/量程旋钮 ────────────────────────
    _drawKnobs() {
        const defs = [
            { id: 'zero', x: this._antCX - 34, label: 'Z' },
            { id: 'span', x: this._antCX + 34, label: 'S' },
        ];
        const ky = 56 + 46;   // 旋钮 Y

        defs.forEach(k => {
            const g = new Konva.Group({ x: k.x, y: ky });
            g.add(new Konva.Circle({ radius: 10, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius: 7.5, fill: '#eceff1', stroke: '#37474f', strokeWidth: 1 }));
            rotor.add(new Konva.Line({ points: [0, -6.5, 0, 6.5], stroke: '#37474f', strokeWidth: 2, lineCap: 'round' }));
            g.add(rotor);
            g.add(new Konva.Text({ x: -5, y: 12, text: k.label, fontSize: 9, fontStyle: 'bold', fill: '#607d8b' }));
            this.knobs[k.id] = rotor;

            rotor.on('mousedown touchstart', (e) => {
                e.cancelBubble = true;
                const sy2 = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const startRot = rotor.rotation();
                const onMove = (me) => {
                    const cy2 = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                    rotor.rotation(startRot + (sy2 - cy2) * 2);
                    if (k.id === 'zero') this.zeroAdj = (rotor.rotation() / 360) * 0.05;
                    else                 this.spanAdj = 1 + (rotor.rotation() / 360) * 0.3;
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('mouseup',   onUp);
                    window.removeEventListener('touchend',  onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('mouseup',   onUp);
                window.addEventListener('touchend',  onUp);
            });
            this.group.add(g);
        });
    }

    // ── 水箱截面（静态结构）────────────────────
    _drawTank() {
        const tx = this._tankX, ty = this._tankY;
        const tw = this._tankW, th = this._tankH;

        // 外壳
        const outer = new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 2, cornerRadius: [4,4,0,0],
        });
        // 内壁
        this._tankInner = new Konva.Rect({
            x: tx+4, y: ty+4, width: tw-8, height: th-4,
            fill: '#e8eef2', stroke: '#b0bec5', strokeWidth: 0.5,
        });
        // 底板
        const bottom = new Konva.Rect({
            x: tx, y: ty+th, width: tw, height: 6,
            fill: '#90a4ae', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,0,3,3],
        });
        // 刻度线（右侧，5等分）
        for (let i = 0; i <= 5; i++) {
            const ly = ty + (th * i) / 5;
            this.group.add(new Konva.Line({
                points: [tx+tw, ly, tx+tw+8, ly],
                stroke: '#78909c', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({
                x: tx+tw+10, y: ly-5,
                text: `${100 - i*20}%`, fontSize: 8, fill: '#607d8b',
            }));
        }
        // 水箱标签
        this.group.add(new Konva.Text({
            x: tx, y: ty-16, width: tw,
            text: '被测储罐', fontSize: 10, fontStyle: 'bold', fill: '#37474f', align: 'center',
        }));
        // 连接天线底部到水箱顶部的导管虚线
        this._connLine = new Konva.Line({
            points: [this._antCX, this._hornBotY, this._antCX, ty],
            stroke: '#546e7a', strokeWidth: 1, dash: [3, 3],
        });

        this.group.add(outer, this._tankInner, bottom, this._connLine);
    }

    // ── 动态层（液面、雷达波动画节点）──────────
    _drawTankDynamic() {
        // 液体填充矩形
        this._liquidRect = new Konva.Rect({
            x: this._tankX+4, y: this._tankY+4,
            width: this._tankW-8, height: 0,
            fill: '#29b6f6', opacity: 0.75,
        });
        // 液面反光
        this._liquidSurf = new Konva.Rect({
            x: this._tankX+4, y: this._tankY+4,
            width: this._tankW-8, height: 4,
            fill: 'rgba(255,255,255,0.28)',
        });
        // 雷达波扩散圆组
        this._waveGroup = new Konva.Group();
        // 距离标注线（天线→液面）
        this._distLine = new Konva.Line({
            points: [], stroke: '#ffd54f', strokeWidth: 1, dash: [4,3],
        });
        this._distLabel = new Konva.Text({
            x: 0, y: 0, text: '', fontSize: 8,
            fontFamily: 'Courier New, monospace', fill: '#ffd54f',
        });

        this.group.add(this._liquidRect, this._liquidSurf,
            this._waveGroup, this._distLine, this._distLabel);
    }

    // ── 底部综合显示面板 ────────────────────────
    _drawBottomPanel() {
        const py = this._tankY + this._tankH + 12;
        const pw = this.width - 8;
        this._panelY = py;

        const panelBg = new Konva.Rect({
            x: 4, y: py, width: pw, height: 62,
            fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 5,
        });
        // 三列：液位 | 距离 | 电流
        this._dispLevel = new Konva.Text({
            x: 10, y: py+6, width: pw/3 - 10,
            text: '--', fontSize: 20,
            fontFamily: 'Courier New, monospace', fontStyle: 'bold',
            fill: '#29b6f6', align: 'center',
        });
        this.group.add(new Konva.Text({ x: 10, y: py+29, width: pw/3-10, text: '液位 %', fontSize: 8, fill: '#546e7a', align: 'center' }));

        this._dispDist = new Konva.Text({
            x: pw/3 + 4, y: py+6, width: pw/3 - 8,
            text: '--', fontSize: 20,
            fontFamily: 'Courier New, monospace', fontStyle: 'bold',
            fill: '#80cbc4', align: 'center',
        });
        this.group.add(new Konva.Text({ x: pw/3+4, y: py+29, width: pw/3-8, text: '距离 m', fontSize: 8, fill: '#546e7a', align: 'center' }));

        this._dispCurrent = new Konva.Text({
            x: pw*2/3 + 4, y: py+6, width: pw/3 - 8,
            text: '--', fontSize: 20,
            fontFamily: 'Courier New, monospace', fontStyle: 'bold',
            fill: '#ffd54f', align: 'center',
        });
        this.group.add(new Konva.Text({ x: pw*2/3+4, y: py+29, width: pw/3-8, text: '电流 mA', fontSize: 8, fill: '#546e7a', align: 'center' }));

        // 故障/状态条
        this._statusBar = new Konva.Text({
            x: 10, y: py+40, width: pw-16,
            text: '● 正常', fontSize: 9, fill: '#66bb6a', align: 'center',
        });
        this._maBar = new Konva.Text({
            x: 10, y: py+52, width: pw-16,
            text: 'Beat Freq: -- kHz', fontSize: 8,
            fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'center',
        });

        this.group.add(panelBg, this._dispLevel, this._dispDist,
            this._dispCurrent, this._statusBar, this._maBar);
    }

    // ── 水箱拖拽 ────────────────────────────────
    _setupDrag() {
        const tx = this._tankX, ty = this._tankY, th = this._tankH;
        const hitArea = new Konva.Rect({
            x: tx, y: ty, width: this._tankW, height: th,
            fill: 'transparent', listening: true,
        });
        hitArea.on('mousedown touchstart', (e) => {
            e.cancelBubble = true;
            this._dragStartY = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
            this._dragStartLv = this.liquidLevel;
            this._dragActive = true;
        });
        const onMove = (e) => {
            if (!this._dragActive) return;
            const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
            const dy = this._dragStartY - cy;
            this.liquidLevel = Math.max(0, Math.min(100, this._dragStartLv + dy / th * 100));
        };
        const onUp = () => { this._dragActive = false; };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('mouseup',   onUp);
        window.addEventListener('touchend',  onUp);
        this.group.add(hitArea);
    }

    // ═══════════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════════
    _startAnimation() {
        const tick = (ts) => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickVisual(dt);
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

    // ── 物理计算 ─────────────────────────────────
    _tickPhysics(dt) {
        // 距离 = 从天线喇叭口到液面
        const H = (this.liquidLevel / 100) * this.tankHeight;
        this.distance = Math.max(0, (this.tankHeight - H) + this.antennaGap);

        // Beat 频率（FMCW）
        const c = 3e8;
        this._beatFreq = (2 * this.distance * this._chirpBW) / (c * this._chirpPeriod);

        // 4-20mA 输出
        const ratio = Math.max(0, Math.min(1, this.liquidLevel / 100));
        const adjLevel = (this.liquidLevel + this.zeroAdj * 100) * this.spanAdj;
        const adjRatio = Math.max(0, Math.min(1, adjLevel / 100));
        this.outCurrent = 4 + adjRatio * 16;

        // chirp 相位（纯动画用）
        this._chirpPhase += dt * 1000 / this._chirpPeriod;

        // 定时发射雷达波
        this._emitTimer -= dt;
        if (this._emitTimer <= 0 && this.powered && !this.isBreak) {
            this._emitTimer = 0.35 + (this.distance / this.tankHeight) * 0.2;
            this._emitRadarWave();
        }
    }

    // ── 发射雷达波（在水箱截面内扩散）──────────
    _emitRadarWave() {
        const tx = this._tankX + this._tankW / 2;
        const ty = this._tankY;   // 发射点：水箱顶部（天线位置映射）

        // 入射波（从顶向下）
        for (let i = 0; i < 3; i++) {
            this._radarRings.push({
                cx: tx, cy: ty,
                r: 4 + i * 4, maxR: 38,
                alpha: 0.8 - i * 0.2, speed: 55 + i * 5,
                type: 'emit',
            });
        }
    }

    // ── 视觉更新 ─────────────────────────────────
    _tickVisual(dt) {
        // 更新液体矩形
        const th = this._tankH - 8;
        const liquidH = Math.max(0, (this.liquidLevel / 100) * th);
        const liquidTop = this._tankY + 4 + th - liquidH;

        this._liquidRect.y(liquidTop);
        this._liquidRect.height(liquidH);
        this._liquidSurf.y(liquidTop);

        const fr = this.liquidLevel / 100;
        const r = Math.round(30 + fr * 20);
        const g = Math.round(150 + fr * 36);
        const b = Math.round(220 + fr * 25);
        this._liquidRect.fill(`rgb(${r},${Math.min(255,g)},${Math.min(255,b)})`);

        // 雷达波扩散圆（水箱内）
        const surfY = liquidTop;  // 液面 Y
        this._radarRings = this._radarRings.filter(ring => {
            ring.r += ring.speed * dt;
            ring.alpha -= dt * 1.2;
            return ring.alpha > 0.02 && ring.r < ring.maxR;
        });
        // 当圆到达液面时产生回波圆
        this._radarRings.forEach(ring => {
            if (ring.type === 'emit' && ring.r > this._tankH * (1 - this.liquidLevel/100) * 0.45) {
                if (!ring._echoed) {
                    ring._echoed = true;
                    this._echoRings.push({
                        cx: this._tankX + this._tankW/2, cy: surfY,
                        r: 4, maxR: 35, alpha: 0.7, speed: 48, type: 'echo',
                    });
                }
            }
        });
        this._echoRings = this._echoRings.filter(ring => {
            ring.r += ring.speed * dt;
            ring.alpha -= dt * 1.4;
            return ring.alpha > 0.02;
        });

        // 重建波形节点
        this._waveGroup.destroyChildren();
        const allRings = [...this._radarRings, ...this._echoRings];
        allRings.forEach(ring => {
            if (!this.powered || this.isBreak) return;
            const color = ring.type === 'emit'
                ? `rgba(29,233,182,${ring.alpha})`
                : `rgba(255,213,79,${ring.alpha})`;
            this._waveGroup.add(new Konva.Arc({
                x: ring.cx, y: ring.cy,
                innerRadius: ring.r, outerRadius: ring.r + 1.5,
                angle: 180, rotation: 90,
                fill: color,
            }));
        });

        // 距离标注线（天线口下方→液面）
        const antX = this._antCX;
        const antBottom = this._hornBotY + 6;
        const distX = this._tankX + this._tankW * 0.75;
        if (this.powered && !this.isBreak && liquidH > 10) {
            this._distLine.points([distX, antBottom, distX, surfY]);
            this._distLabel.x(distX + 4);
            this._distLabel.y(antBottom + (surfY - antBottom) / 2 - 5);
            this._distLabel.text(`D=${this.distance.toFixed(2)}m`);
        } else {
            this._distLine.points([]);
            this._distLabel.text('');
        }

        // OLED 扫描线旋转
        if (this.powered && !this.isBreak) {
            const omega = 120 + (this.liquidLevel / 100) * 180; // deg/s
            this._scanAngle = (this._scanAngle + omega * dt) % 360;
            const rad = this._scanAngle * Math.PI / 180;
            const cx2 = this._oledCX, cy2 = this._oledCY;
            const R = this._oledR - 2;
            this._scanLine.points([cx2, cy2, cx2 + R * Math.cos(rad), cy2 + R * Math.sin(rad)]);

            const lvStr = this.liquidLevel.toFixed(1);
            this._oledMain.text(lvStr);
            this._oledUnit.text('%');
            this._oledBg.fill('#020c14');
        } else {
            this._oledMain.text('----');
            this._oledUnit.text('');
            this._oledBg.fill('#010609');
        }

        // 底部面板
        this._updatePanel();
    }

    _updatePanel() {
        const powered = this.powered, broken = this.isBreak;

        if (!powered) {
            this._dispLevel.text('--'); this._dispLevel.fill('#1a3040');
            this._dispDist.text('--'); this._dispDist.fill('#1a3040');
            this._dispCurrent.text('--'); this._dispCurrent.fill('#1a3040');
            this._statusBar.text('○ 断电'); this._statusBar.fill('#37474f');
            this._maBar.text('Beat Freq: -- kHz');
            return;
        }
        if (broken) {
            this._dispLevel.text('FAIL'); this._dispLevel.fill('#ef5350');
            this._dispDist.text('ERR');  this._dispDist.fill('#ef5350');
            this._dispCurrent.text('1.8'); this._dispCurrent.fill('#ef5350');
            this._statusBar.text('⚠ 断线故障'); this._statusBar.fill('#ef5350');
            this._maBar.text('Signal lost');
            return;
        }

        const lv = this.liquidLevel;
        const lvCol = lv > 85 ? '#ff7043' : lv < 15 ? '#ffa726' : '#29b6f6';
        this._dispLevel.text(lv.toFixed(1)); this._dispLevel.fill(lvCol);
        this._dispDist.text(this.distance.toFixed(2)); this._dispDist.fill('#80cbc4');
        this._dispCurrent.text(this.outCurrent.toFixed(2)); this._dispCurrent.fill('#ffd54f');

        const stateStr = lv > 85 ? '⬆ 高液位报警' : lv < 15 ? '⬇ 低液位报警' : '● 正常运行';
        const stateCol = lv > 85 ? '#ff7043' : lv < 15 ? '#ffa726' : '#66bb6a';
        this._statusBar.text(stateStr); this._statusBar.fill(stateCol);
        this._maBar.text(`Beat Freq: ${(this._beatFreq/1000).toFixed(1)} kHz`);
    }

    // ═══════════════════════════════════════════════
    //  外部接口
    // ═══════════════════════════════════════════════
    /**
     * 外部注入液位百分比（如来自水箱仿真系统）
     * @param {number} level  液位 0~100 %
     */
    update(level) {
        if (typeof level === 'number') {
            this.liquidLevel = Math.max(0, Math.min(100, level));
        }
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════
    //  配置面板
    // ═══════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',          type: 'text'   },
            { label: '储罐高度 (m)',         key: 'tankHeight',  type: 'number' },
            { label: '天线盲区 (m)',         key: 'antennaGap',  type: 'number' },
            { label: '工作频率 (GHz)',       key: 'freqBand',    type: 'number' },
            {
                label: '显示单位', key: 'unit', type: 'select',
                options: [{ label: 'm', value: 'm' }, { label: '%', value: '%' }],
            },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id          || this.id;
        this.tankHeight = parseFloat(cfg.tankHeight)  || this.tankHeight;
        this.antennaGap = parseFloat(cfg.antennaGap)  || this.antennaGap;
        this.freqBand   = parseFloat(cfg.freqBand)    || this.freqBand;
        this.unit       = cfg.unit        || this.unit;
        this.config     = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() {
        this._stopAnimation();
        super.destroy?.();
    }
}