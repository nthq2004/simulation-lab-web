import { BaseComponent } from './BaseComponent.js';

/**
 * 电容式液位计仿真组件（Capacitive Level Transmitter）
 *
 * ── 测量原理 ─────────────────────────────────────────────────
 *  将探极（电极）插入被测容器，探极与容器壁（接地极）构成同轴电容器。
 *
 *  当介质（液体）浸没电极高度为 H 时：
 *
 *    C(H) = C_gas · (L - H)/L  +  C_liquid · H/L
 *         = (2πε₀εᵣ_gas · (L-H)) / ln(D/d)
 *         + (2πε₀εᵣ_liq  · H    ) / ln(D/d)
 *
 *  简化线性模型（忽略杂散电容）：
 *    C = C_min + (C_max - C_min) × (H / L)
 *
 *  其中：
 *    C_min — 电极全在气相中的电容（pF）
 *    C_max — 电极全浸入液相中的电容（pF）
 *    H     — 液位高度（m）
 *    L     — 有效电极长度（m）
 *    εᵣ    — 介质相对介电常数
 *
 *  信号链：C → 振荡频率 f → 鉴频 → 电压 → 4-20mA
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 传感器探极（细长圆柱，插入储罐）
 *  ② 同轴电容结构截面图（正面剖视）
 *  ③ 电容充放电动画（电场线 + 介质填充动画）
 *  ④ 振荡频率/电容值示波器
 *  ⑤ 仪表头（接线盒 + 圆形 OLED 显示）
 *  ⑥ 被测储罐（可拖拽调节液位）
 *  ⑦ 底部综合数据面板
 *
 * ── 输出 ─────────────────────────────────────────────────────
 *  4-20mA 模拟量线性对应液位 0~100%
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_p  — 24VDC +
 *  wire_n  — 4-20mA / GND
 *
 * ── 气路求解器集成 ───────────────────────────────────────────
 *  special = 'none'
 *  update(level) — 外部注入液位 %
 */
export class CapacitiveLevelSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 360);
        this.height = Math.max(340, config.height || 380);

        this.type    = 'capacitive_level';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.electrodeLen = config.electrodeLen || 2.0;    // 有效电极长度 m
        this.epsilonGas   = config.epsilonGas   || 1.0;    // 气相介电常数（空气=1）
        this.epsilonLiq   = config.epsilonLiq   || 80;     // 液相介电常数（水≈80）
        this.cMin         = config.cMin         || 20;     // 最小电容 pF（全气相）
        this.cMax         = config.cMax         || 200;    // 最大电容 pF（全液相）
        this.hiAlarm      = config.hiAlarm      || 85;     // 高报 %
        this.loAlarm      = config.loAlarm      || 15;     // 低报 %

        // ── 状态 ──
        this.liquidLevel  = config.initLevel    || 50;     // 0~100 %
        this.capacitance  = 0;     // 当前电容 pF
        this.oscFreq      = 0;     // 振荡频率 kHz
        this.outCurrent   = 12;    // 4-20mA
        this.isBreak      = false;
        this.powered      = false;
        this.alarmHi      = false;
        this.alarmLo      = false;

        // ── 零点/量程 ──
        this.zeroAdj  = 0;
        this.spanAdj  = 1.0;

        // ── 电容动画 ──
        this._fieldLines  = [];    // 电场线粒子
        this._fieldTimer  = 0;
        this._chargePhase = 0;     // 充放电相位

        // ── 振荡器波形缓冲 ──
        this._oscBufLen   = 180;
        this._oscBuf      = new Float32Array(this._oscBufLen).fill(0);
        this._oscPhase    = 0;
        this._oscScrollAcc = 0;

        // ── 拖拽 ──
        this._dragActive  = false;
        this._dragStartY  = 0;
        this._dragStartLv = 0;

        // ── 几何布局 ──
        // 探极+储罐区（主体，左侧偏大）
        this._tankX   = 12;
        this._tankY   = 36;
        this._tankW   = Math.round(this.width * 0.46);
        this._tankH   = Math.round(this.height * 0.60);

        // 截面示意图（中部）
        this._secX    = this._tankX + this._tankW + 10;
        this._secY    = this._tankY;
        this._secW    = Math.round(this.width * 0.22);
        this._secH    = this._tankH;

        // 仪表头（右侧）
        this._headX   = this._secX + this._secW + 8;
        this._headY   = this._tankY;
        this._headW   = this.width - this._headX - 8;
        this._headH   = Math.round(this.height * 0.46);

        // 示波器（下方）
        this._oscX    = 8;
        this._oscY    = this._tankY + this._tankH + 10;
        this._oscW    = this.width - 16;
        this._oscH    = Math.round(this.height * 0.26);

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, electrodeLen: this.electrodeLen,
            epsilonGas: this.epsilonGas, epsilonLiq: this.epsilonLiq,
            cMin: this.cMin, cMax: this.cMax,
        };

        this._init();

        this.addPort(this.width, this._headY + 14, 'p', 'wire', 'V+');
        this.addPort(this.width, this._headY + 36, 'n', 'wire', '4-20');
    }

    // ═════════════════════════════════════════════
    //  初始化
    // ═════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawTankBody();
        this._drawElectrodeProbe();
        this._drawLiquidLayer();
        this._drawFieldLayer();
        this._drawCrossSection();
        this._drawInstrumentHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawOscilloscope();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '电容式液位计',
            fontSize: 14, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 储罐外壳 ──────────────────────────────
    _drawTankBody() {
        const { _tankX: tx, _tankY: ty, _tankW: tw, _tankH: th } = this;
        const wall = 11;

        this.group.add(new Konva.Text({
            x: tx, y: ty - 16, width: tw,
            text: '被测储罐', fontSize: 10, fontStyle: 'bold', fill: '#37474f', align: 'center',
        }));

        // 外壁（金属罐体）
        const outer = new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: [4,4,2,2],
        });
        // 顶盖（带法兰孔）
        const topCap = new Konva.Rect({
            x: tx, y: ty, width: tw, height: wall,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
        });
        // 法兰螺孔
        [tw*0.2, tw*0.5, tw*0.8].forEach(dx => {
            this.group.add(new Konva.Circle({ x: tx+dx, y: ty+wall/2, radius: 3, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: tx+dx-0.8, y: ty+wall/2-0.8, radius: 1, fill: 'rgba(255,255,255,0.2)' }));
        });
        // 内腔
        this._innerX = tx + wall;
        this._innerY = ty + wall;
        this._innerW = tw - wall * 2;
        this._innerH = th - wall;
        this._innerCav = new Konva.Rect({
            x: this._innerX, y: this._innerY,
            width: this._innerW, height: this._innerH,
            fill: '#1a2f3f',
        });
        // 底板
        const bottom = new Konva.Rect({
            x: tx, y: ty+th, width: tw, height: 6,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1, cornerRadius: [0,0,3,3],
        });
        // 量程刻度
        for (let i = 0; i <= 4; i++) {
            const ly = ty + wall + (this._innerH * i) / 4;
            this.group.add(new Konva.Line({ points: [tx+tw, ly, tx+tw+7, ly], stroke: '#78909c', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: tx+tw+9, y: ly-5, text: `${100-i*25}%`, fontSize: 8, fill: '#607d8b' }));
        }
        // 报警线
        const hiY = ty + wall + this._innerH * (1 - this.hiAlarm/100);
        const loY = ty + wall + this._innerH * (1 - this.loAlarm/100);
        this._hiLine = new Konva.Line({ points: [tx+wall, hiY, tx+tw-wall, hiY], stroke: 'rgba(239,83,80,0.4)', strokeWidth: 1, dash: [5,3] });
        this._loLine = new Konva.Line({ points: [tx+wall, loY, tx+tw-wall, loY], stroke: 'rgba(255,152,0,0.4)',  strokeWidth: 1, dash: [5,3] });

        this.group.add(outer, topCap, this._innerCav, bottom, this._hiLine, this._loLine);
    }

    // ── 探极（插入储罐的同轴电极）───────────
    _drawElectrodeProbe() {
        const tw = this._tankW, ty = this._tankY;
        const probeX = this._tankX + tw / 2;

        // 探极从顶盖穿入，中心位置
        const probeW  = 8;
        const probeTopY = ty + 2;
        const probeBotY = ty + this._tankH - 14;

        // 绝缘套管（白色/米色）
        const insulate = new Konva.Rect({
            x: probeX - probeW/2 - 3, y: probeTopY,
            width: probeW + 6, height: probeBotY - probeTopY,
            fill: '#f5f0e0', stroke: '#d4c89a', strokeWidth: 1, cornerRadius: 2,
        });
        // 中心电极（金属棒）
        const electrode = new Konva.Rect({
            x: probeX - probeW/2, y: probeTopY + 2,
            width: probeW, height: probeBotY - probeTopY - 2,
            fill: '#c0a020', stroke: '#8a7010', strokeWidth: 1, cornerRadius: 2,
        });
        // 电极高光
        this.group.add(new Konva.Rect({
            x: probeX - probeW/2 + 1, y: probeTopY + 4,
            width: 2, height: probeBotY - probeTopY - 8,
            fill: 'rgba(255,230,100,0.35)', cornerRadius: 1,
        }));
        // 探极顶端接头
        const topConn = new Konva.Rect({
            x: probeX - probeW/2 - 6, y: probeTopY - 12,
            width: probeW + 12, height: 14,
            fill: '#ff8f00', stroke: '#e65100', strokeWidth: 1.5, cornerRadius: [3,3,0,0],
        });
        this.group.add(new Konva.Text({
            x: probeX - 18, y: probeTopY - 25,
            text: '中心电极', fontSize: 8, fill: '#ff8f00',
        }));
        // 容器壁标注（接地极）
        this.group.add(new Konva.Text({
            x: this._tankX + 2, y: this._tankY + this._tankH * 0.4,
            text: '↔\n容\n器\n壁\n(接\n地)', fontSize: 7.5, fill: '#90a4ae', lineHeight: 1.4,
        }));

        this._probeCX   = probeX;
        this._probeTopY = probeTopY;
        this._probeBotY = probeBotY;

        // 导线（从探极顶到仪表头）
        this.group.add(new Konva.Line({
            points: [probeX, probeTopY-12, probeX, probeTopY-30, this._headX, probeTopY-30, this._headX, this._headY+14],
            stroke: '#ff8f00', strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round', dash: [3,2],
        }));

        this.group.add(insulate, electrode, topConn);
    }

    // ── 液体 + 电场动态层 ──────────────────
    _drawLiquidLayer() {
        // 液体矩形
        this._liquidRect = new Konva.Rect({
            x: this._innerX, y: this._innerY,
            width: this._innerW, height: 0,
            fill: '#1e88e5', opacity: 0.7,
        });
        // 液面反光
        this._liquidSurf = new Konva.Rect({
            x: this._innerX, y: this._innerY,
            width: this._innerW, height: 4,
            fill: 'rgba(255,255,255,0.22)',
        });
        this.group.add(this._liquidRect, this._liquidSurf);
    }

    _drawFieldLayer() {
        this._fieldGroup = new Konva.Group();
        this.group.add(this._fieldGroup);
    }

    // ── 同轴截面示意图（右侧） ───────────────
    _drawCrossSection() {
        const { _secX: sx, _secY: sy, _secW: sw, _secH: sh } = this;

        // 背景
        const bg = new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4,
        });
        this.group.add(new Konva.Text({
            x: sx + 2, y: sy + 4, width: sw - 4,
            text: '截面示意', fontSize: 8, fontStyle: 'bold', fill: '#4fc3f7', align: 'center',
        }));

        // 同轴截面（横截面俯视图）
        const cx = sx + sw / 2;
        const cy = sy + sh * 0.35;
        const outerR = sw * 0.40;   // 容器壁内径
        const innerR = sw * 0.14;   // 中心电极外径

        // 容器壁（外圆，接地极）
        const outerRing = new Konva.Ring({
            x: cx, y: cy, innerRadius: outerR - 4, outerRadius: outerR + 4,
            fill: '#455a64', stroke: '#263238', strokeWidth: 1,
        });
        // 介质填充区（液/气，动态）
        this._secGasArc = new Konva.Ring({
            x: cx, y: cy, innerRadius: innerR + 2, outerRadius: outerR - 4,
            fill: '#0a1520',  // 气相
        });
        this._secLiqArc  = new Konva.Arc({
            x: cx, y: cy, innerRadius: innerR + 2, outerRadius: outerR - 4,
            angle: 0, fill: 'rgba(30,136,229,0.55)', rotation: -90,
        });
        // 中心电极（金色圆圈）
        const innerElec = new Konva.Circle({
            x: cx, y: cy, radius: innerR,
            fill: '#c0a020', stroke: '#8a7010', strokeWidth: 1,
        });

        // 电场线（放射状，动态颜色）
        this._secFieldLines = [];
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const line = new Konva.Line({
                points: [
                    cx + (innerR+2) * Math.cos(angle), cy + (innerR+2) * Math.sin(angle),
                    cx + (outerR-5) * Math.cos(angle), cy + (outerR-5) * Math.sin(angle),
                ],
                stroke: 'rgba(255,213,79,0.3)', strokeWidth: 0.8, dash: [2,2],
            });
            this._secFieldLines.push(line);
            this.group.add(line);
        }

        // 标注
        const lbls = [
            { x: cx - outerR - 22, y: cy - 6, text: '接地极\n(罐壁)', color: '#90a4ae' },
            { x: cx - 10,          y: cy + outerR + 6, text: '中心电极', color: '#ffd54f' },
        ];
        lbls.forEach(l => this.group.add(new Konva.Text({ x: l.x, y: l.y, text: l.text, fontSize: 7.5, fill: l.color, lineHeight: 1.4 })));

        // 介电常数标注
        this._secEpsLabel = new Konva.Text({
            x: cx - 16, y: cy - 8, width: 32,
            text: 'ε=1', fontSize: 8, fontFamily: 'Courier New, monospace',
            fill: '#4fc3f7', align: 'center',
        });

        // 电容值显示
        this._secCapLabel = new Konva.Text({
            x: sx + 4, y: sy + sh * 0.70,
            width: sw - 8, text: 'C=-- pF',
            fontSize: 8.5, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#ffd54f', align: 'center',
        });
        this._secFreqLabel = new Konva.Text({
            x: sx + 4, y: sy + sh * 0.80,
            width: sw - 8, text: 'f=-- kHz',
            fontSize: 8, fontFamily: 'Courier New, monospace',
            fill: '#80cbc4', align: 'center',
        });
        this._secLvLabel = new Konva.Text({
            x: sx + 4, y: sy + sh * 0.90,
            width: sw - 8, text: '-- %',
            fontSize: 9, fontFamily: 'Courier New, monospace',
            fontStyle: 'bold', fill: '#00e5ff', align: 'center',
        });

        this._secCX = cx; this._secCY = cy;
        this._secOuterR = outerR; this._secInnerR = innerR;

        this.group.add(bg, this._secGasArc, this._secLiqArc, outerRing, innerElec, this._secEpsLabel, this._secCapLabel, this._secFreqLabel, this._secLvLabel);
    }

    // ── 仪表头 ─────────────────────────────
    _drawInstrumentHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        // 接线盒（顶部）
        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.16)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+10, y: hy+5, width: hw-20, height: 24, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+10, y: hy+8, width: hw-20, text: this.id || 'LT-801', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+10, y: hy+19, width: hw-20, text: 'CAPACITIVE  4-20mA', fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+4, width: 10, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+4, width: 10, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });

        // 主体
        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });

        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH - 44) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.42, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1a237e', stroke: '#283593', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        // 电容弧（随液位变化）
        this._capArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#7986cb', rotation: -90 });

        this._lcdMain    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'--.-', fontSize:R*.37, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#7986cb', align:'center' });
        this._lcdUnit    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'%',    fontSize:R*.18, fill:'#283593', align:'center' });
        this._lcdCap     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.30, width:(R-4)*2, text:'C=-- pF', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdCurrent = new Konva.Text({ x: lcx-R+4, y: lcy-R*.58, width:(R-4)*2, text:'4.00 mA', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdEps     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.48, width:(R-4)*2, text:'ε=--', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._capArc, this._lcdMain, this._lcdUnit, this._lcdCap, this._lcdCurrent, this._lcdEps);
    }

    // ── 旋钮 ──────────────────────────────
    _drawKnobs() {
        const hx = this._headX, hw = this._headW;
        const ky  = this._lcCY + this._lcR + 14;
        [{ id:'zero', x: hx+hw*.28, label:'Z' }, { id:'span', x: hx+hw*.72, label:'S' }].forEach(k => {
            const g = new Konva.Group({ x: k.x, y: ky });
            g.add(new Konva.Circle({ radius: 10, fill:'#cfd8dc', stroke:'#90a4ae', strokeWidth:1 }));
            const rotor = new Konva.Group();
            rotor.add(new Konva.Circle({ radius:7.5, fill:'#eceff1', stroke:'#37474f', strokeWidth:1 }));
            rotor.add(new Konva.Line({ points:[0,-6.5,0,6.5], stroke:'#37474f', strokeWidth:2.5, lineCap:'round' }));
            g.add(rotor, new Konva.Text({ x:-5, y:12, text:k.label, fontSize:9, fontStyle:'bold', fill:'#607d8b' }));
            this.knobs[k.id] = rotor;
            rotor.on('mousedown touchstart', e => {
                e.cancelBubble = true;
                const sy2 = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const sr  = rotor.rotation();
                const mv  = me => { const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0; rotor.rotation(sr+(sy2-cy)*2); if(k.id==='zero') this.zeroAdj=(rotor.rotation()/360)*0.05; else this.spanAdj=1+(rotor.rotation()/360)*0.3; };
                const up  = () => { window.removeEventListener('mousemove',mv); window.removeEventListener('touchmove',mv); window.removeEventListener('mouseup',up); window.removeEventListener('touchend',up); };
                window.addEventListener('mousemove',mv); window.addEventListener('touchmove',mv);
                window.addEventListener('mouseup',up); window.addEventListener('touchend',up);
            });
            this.group.add(g);
        });
    }

    // ── 振荡器波形示波器 ─────────────────────
    _drawOscilloscope() {
        const { _oscX: ox, _oscY: oy, _oscW: ow, _oscH: oh } = this;

        const bg = new Konva.Rect({ x: ox, y: oy, width: ow, height: oh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: ox, y: oy, width: ow, height: 14, fill: '#0d1a30', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: ox+4, y: oy+2, width: ow-8, text: '振荡器输出  (C↑→f↓，C↓→f↑)', fontSize: 8, fontStyle: 'bold', fill: '#7986cb', align: 'center' }));

        // 网格
        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [ox, oy+oh*i/3, ox+ow, oy+oh*i/3], stroke: 'rgba(121,134,203,0.08)', strokeWidth: 0.5 }));
        for (let i = 1; i < 6; i++) this.group.add(new Konva.Line({ points: [ox+ow*i/6, oy, ox+ow*i/6, oy+oh], stroke: 'rgba(121,134,203,0.06)', strokeWidth: 0.5 }));

        // 基准线
        this._oscMidY = oy + oh * 0.54;
        this.group.add(new Konva.Line({ points: [ox+2, this._oscMidY, ox+ow-2, this._oscMidY], stroke: 'rgba(121,134,203,0.15)', strokeWidth: 0.5, dash: [4,4] }));

        this._oscLine     = new Konva.Line({ points: [], stroke: '#7986cb', strokeWidth: 1.6, lineJoin:'round' });
        this._oscCapLabel = new Konva.Text({ x: ox+4, y: oy+16, text: 'C=-- pF', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f' });
        this._oscFrqLabel = new Konva.Text({ x: ox+4, y: oy+oh-12, text: 'f=-- kHz', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#80cbc4' });
        this._oscMaLabel  = new Konva.Text({ x: ox+ow-70, y: oy+16, width: 66, text: '-- mA', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#7986cb', align: 'right' });

        this.group.add(bg, titleBg, this._oscLine, this._oscCapLabel, this._oscFrqLabel, this._oscMaLabel);
    }

    // ── 拖拽液位 ──────────────────────────
    _setupDrag() {
        const tx = this._tankX, ty = this._tankY;
        const tw = this._tankW, th = this._tankH;
        const hit = new Konva.Rect({ x:tx, y:ty, width:tw, height:th, fill:'transparent', listening:true });
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

    // ═════════════════════════════════════════════
    //  动画主循环
    // ═════════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickTankVisual();
                this._tickFieldAnimation(dt);
                this._tickCrossSection();
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
        // 电容随液位线性变化（简化模型）
        const lvRatio    = this.liquidLevel / 100;
        this.capacitance = this.cMin + (this.cMax - this.cMin) * lvRatio;

        // 振荡频率：C↑→f↓（反比关系，仿 RC 振荡器）
        const fMax = 200;   // kHz（C_min 时）
        const fMin = 20;    // kHz（C_max 时）
        this.oscFreq = fMax - (fMax - fMin) * lvRatio;

        // 调整后液位 → 电流
        const adjLv     = Math.max(0, Math.min(100, (this.liquidLevel + this.zeroAdj*100) * this.spanAdj));
        this.outCurrent = 4 + adjLv/100 * 16;
        if (this.isBreak)  this.outCurrent = 1.8;
        if (!this.powered) this.outCurrent = 0;

        // 报警
        this.alarmHi = this.liquidLevel > this.hiAlarm;
        this.alarmLo = this.liquidLevel < this.loAlarm;

        // 电容弧
        if (this._capArc) this._capArc.angle(Math.min(360, lvRatio * 360));

        // 充放电相位（频率越高振荡越快）
        this._chargePhase += this.oscFreq * dt * 2 * Math.PI;
    }

    // ── 储罐液面 ──────────────────────────
    _tickTankVisual() {
        const ih = this._innerH;
        const liquidH   = Math.max(0, (this.liquidLevel/100) * ih);
        const liquidTop = this._innerY + ih - liquidH;

        this._liquidRect.y(liquidTop);
        this._liquidRect.height(liquidH);
        this._liquidSurf.y(liquidTop);

        // 液体颜色
        const fr = this.liquidLevel / 100;
        this._liquidRect.fill(`rgba(${Math.round(20+fr*18)},${Math.round(100+fr*60)},${Math.round(210+fr*20)},0.72)`);

        // 报警线
        const ty = this._tankY; const wall = 11;
        const hiY = ty + wall + this._innerH * (1 - this.hiAlarm/100);
        const loY = ty + wall + this._innerH * (1 - this.loAlarm/100);
        this._hiLine.stroke(this.alarmHi ? '#ef5350' : 'rgba(239,83,80,0.35)');
        this._loLine.stroke(this.alarmLo ? '#ff9800' : 'rgba(255,152,0,0.35)');

        // 内腔颜色随流量
        this._innerCav.fill(`rgb(${Math.round(18+fr*8)},${Math.round(30+fr*25)},${Math.round(45+fr*35)})`);

        // 液面波纹（充放电动画驱动）
        const isActive = this.powered && !this.isBreak;
        if (liquidH > 4) {
            const wave = isActive ? Math.sin(this._chargePhase * 0.3) * 1.5 : 0;
            this._liquidSurf.height(Math.max(3, 4 + Math.abs(wave)));
        }
    }

    // ── 电场线粒子动画（探极周围）──────────
    _tickFieldAnimation(dt) {
        this._fieldGroup.destroyChildren();
        if (!this.powered || this.isBreak) return;

        const probeX   = this._probeCX;
        const probeTop = this._probeTopY;
        const probeBot = this._probeBotY;
        const ih       = this._innerH;
        const liquidTop = this._innerY + ih * (1 - this.liquidLevel/100);
        const innerLeft = this._innerX;
        const innerRight= this._innerX + this._innerW;

        // 电场线：从中心电极向容器壁辐射（水平方向）
        // 在液体浸没区域密度更高（介电常数大）
        const numLines  = 10;
        const submerged = Math.min(1, this.liquidLevel / 100);

        for (let i = 0; i < numLines; i++) {
            const y = probeTop + (probeBot - probeTop) * (i / (numLines - 1));
            const isInLiquid = y > liquidTop;
            const intensity  = isInLiquid ? 0.85 : 0.35;
            const pulse      = 0.5 + 0.5 * Math.sin(this._chargePhase + i * 0.7);
            const alpha      = intensity * (0.4 + 0.6 * pulse);
            const lineColor  = isInLiquid
                ? `rgba(30,136,229,${alpha})`
                : `rgba(255,213,79,${alpha * 0.6})`;

            // 左侧电场线
            this._fieldGroup.add(new Konva.Line({
                points: [probeX - 4, y, innerLeft + 2, y],
                stroke: lineColor, strokeWidth: isInLiquid ? 1.2 : 0.8, dash: [3,3],
            }));
            // 右侧电场线
            this._fieldGroup.add(new Konva.Line({
                points: [probeX + 4, y, innerRight - 2, y],
                stroke: lineColor, strokeWidth: isInLiquid ? 1.2 : 0.8, dash: [3,3],
            }));

            // 电场粒子（在液体中更活跃）
            if (isInLiquid && Math.random() < 0.15) {
                const px = innerLeft + 6 + Math.random() * (this._innerW - 12);
                const py = y + (Math.random() - 0.5) * 8;
                this._fieldGroup.add(new Konva.Circle({
                    x: px, y: py, radius: 1.5 + Math.random(),
                    fill: `rgba(100,181,246,${0.4 + Math.random()*0.4})`,
                }));
            }
        }

        // 探极表面高亮（充放电闪烁）
        const probeGlow = 0.2 + 0.3 * Math.abs(Math.sin(this._chargePhase));
        this._fieldGroup.add(new Konva.Rect({
            x: probeX - 5, y: probeTop + 2,
            width: 10, height: probeBot - probeTop - 2,
            fill: `rgba(255,213,79,${probeGlow})`, cornerRadius: 2,
        }));
    }

    // ── 截面图动态更新 ──────────────────────
    _tickCrossSection() {
        const lvRatio = this.liquidLevel / 100;

        // 液体填充弧（以角度表示液位比例）
        if (this._secLiqArc) this._secLiqArc.angle(Math.min(360, lvRatio * 360));

        // 电场线颜色随充电相位闪烁
        const pulse = 0.3 + 0.4 * Math.abs(Math.sin(this._chargePhase * 0.6));
        this._secFieldLines?.forEach((line, i) => {
            const angle    = (i / 8) * Math.PI * 2;
            const isInLiq  = Math.sin(angle + Math.PI/2) > (1 - lvRatio * 2 - 1);
            line.stroke(isInLiq
                ? `rgba(30,136,229,${pulse * 0.6})`
                : `rgba(255,213,79,${pulse * 0.35})`);
        });

        // 有效介电常数（加权平均）
        const epsEff = this.epsilonGas * (1-lvRatio) + this.epsilonLiq * lvRatio;
        if (this._secEpsLabel) this._secEpsLabel.text(`ε=${epsEff.toFixed(1)}`);
        if (this._secCapLabel) this._secCapLabel.text(this.powered && !this.isBreak ? `C=${this.capacitance.toFixed(1)} pF` : 'C=-- pF');
        if (this._secFreqLabel) this._secFreqLabel.text(this.powered && !this.isBreak ? `f=${this.oscFreq.toFixed(1)} kHz` : 'f=-- kHz');
        if (this._secLvLabel) this._secLvLabel.text(this.powered && !this.isBreak ? `${this.liquidLevel.toFixed(1)}%` : '--');
    }

    // ── 示波器 ────────────────────────────
    _tickOscilloscope(dt) {
        const active = this.powered && !this.isBreak;

        // 滚动速度与振荡频率正相关
        const scrollSpeed = active ? Math.min(5, this.oscFreq / 40 + 0.5) : 0;
        this._oscScrollAcc += scrollSpeed * dt * this._oscBufLen;
        const steps = Math.floor(this._oscScrollAcc);
        this._oscScrollAcc -= steps;

        for (let i = 0; i < steps; i++) {
            this._oscBuf = new Float32Array([...this._oscBuf.slice(1), active ? Math.sin(this._chargePhase) : 0]);
        }

        // 绘制波形
        const ox = this._oscX + 3, oy = this._oscY;
        const ow = this._oscW - 6, oh = this._oscH;
        const mid = this._oscMidY;
        const amp = oh * 0.28;
        const n   = this._oscBufLen;
        const dx  = ow / n;

        const pts = [];
        for (let i = 0; i < n; i++) {
            pts.push(ox + i*dx, mid - this._oscBuf[i] * amp);
        }
        if (this._oscLine) this._oscLine.points(pts);

        if (this._oscCapLabel) this._oscCapLabel.text(active ? `C=${this.capacitance.toFixed(1)} pF` : 'C=-- pF');
        if (this._oscFrqLabel) this._oscFrqLabel.text(active ? `f=${this.oscFreq.toFixed(1)} kHz` : 'f=-- kHz');
        if (this._oscMaLabel)  this._oscMaLabel.text(active ? `${this.outCurrent.toFixed(2)} mA` : '-- mA');
    }

    // ── 显示刷新 ──────────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;
        const lv = this.liquidLevel;

        if (!pw) {
            this._lcdMain.text('----'); this._lcdMain.fill('#0d2030');
            this._lcdUnit.text(''); this._lcdCap.text(''); this._lcdEps.text('');
            this._lcdCurrent.text('-- mA');
            return;
        }
        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdCurrent.text('1.8 mA'); this._lcdBg.fill('#1a0808');
            return;
        }

        const adjLv   = Math.max(0, Math.min(100, (lv + this.zeroAdj*100)*this.spanAdj));
        const lvColor = this.alarmHi ? '#ff5722' : this.alarmLo ? '#ffa726' : '#7986cb';

        this._lcdBg.fill('#020c14');
        this._lcdMain.text(adjLv.toFixed(1)); this._lcdMain.fill(lvColor);
        this._lcdUnit.text('%');
        this._lcdCap.text(`C=${this.capacitance.toFixed(1)} pF`);
        this._lcdCurrent.text(`${this.outCurrent.toFixed(2)} mA`);
        this._lcdEps.text(`ε=${(this.epsilonGas*(1-lv/100)+this.epsilonLiq*(lv/100)).toFixed(1)}`);
    }

    // ═════════════════════════════════════════════
    //  外部接口
    // ═════════════════════════════════════════════
    update(level) {
        if (typeof level === 'number') this.liquidLevel = Math.max(0, Math.min(100, level));
        this._refreshCache();
    }

    // ═════════════════════════════════════════════
    //  配置
    // ═════════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'id',          type: 'text'   },
            { label: '电极有效长度 (m)',    key: 'electrodeLen',type: 'number' },
            { label: '气相介电常数 εᵣ_gas', key: 'epsilonGas',  type: 'number' },
            { label: '液相介电常数 εᵣ_liq', key: 'epsilonLiq',  type: 'number' },
            { label: '最小电容 C_min (pF)', key: 'cMin',        type: 'number' },
            { label: '最大电容 C_max (pF)', key: 'cMax',        type: 'number' },
            { label: '高报阈值 (%)',        key: 'hiAlarm',     type: 'number' },
            { label: '低报阈值 (%)',        key: 'loAlarm',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id          = cfg.id          || this.id;
        this.electrodeLen= parseFloat(cfg.electrodeLen) || this.electrodeLen;
        this.epsilonGas  = parseFloat(cfg.epsilonGas)   || this.epsilonGas;
        this.epsilonLiq  = parseFloat(cfg.epsilonLiq)   || this.epsilonLiq;
        this.cMin        = parseFloat(cfg.cMin)         || this.cMin;
        this.cMax        = parseFloat(cfg.cMax)         || this.cMax;
        this.hiAlarm     = parseFloat(cfg.hiAlarm)      ?? this.hiAlarm;
        this.loAlarm     = parseFloat(cfg.loAlarm)      ?? this.loAlarm;
        this.config      = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}