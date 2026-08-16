import { BaseComponent } from './BaseComponent.js';

/**
 * 压电式差压力传感器仿真组件
 * （Piezoelectric Differential Pressure Sensor）
 *
 * ── 工作原理（正压电效应）────────────────────────────────────
 *  压电材料（石英、PZT 陶瓷等）在受到机械应力时，
 *  内部极化产生与应力成正比的表面电荷：
 *
 *    Q = d · F
 *    Q = d · A · (P₁ - P₂)
 *
 *  其中：
 *    Q   — 产生的电荷量 (pC，皮库仑)
 *    d   — 压电系数 (pC/N 或 pC/Pa)
 *    F   — 施加力 (N)
 *    A   — 敏感元件有效面积 (m²)
 *    P₁  — 正压口压力 (MPa)
 *    P₂  — 负压口压力 (MPa)
 *    ΔP  — 差压 P₁ - P₂ (MPa)
 *
 *  压电材料的变形量：
 *    δ = F / k = d·ΔP·A / k
 *    k — 材料等效刚度 (N/m)
 *
 *  开路电压：
 *    V = Q / C_s      (C_s 为压电元件自身电容)
 *
 *  信号链：
 *    ΔP → 机械变形 δ → 表面电荷 Q → 电荷放大器 → 电压输出
 *
 * ── 材料极化方向 ─────────────────────────────────────────────
 *  正压（P₁ > P₂）→ 弯曲变形 → 上表面聚积正电荷 (+)
 *                            → 下表面聚积负电荷 (-)
 *  负压（P₁ < P₂）→ 反向变形 → 极性翻转
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 双压力接口（P1 正压口、P2 负压口）+ 压力腔
 *  ② 压电晶片（中央敏感元件，弯曲变形动画）
 *  ③ 表面电荷可视化（正负电荷符号随变形量分布）
 *  ④ 电荷-电压信号链（等效电路图）
 *  ⑤ 实时仪表显示（ΔP、Q、V_oc、变形量 δ）
 *  ⑥ 波形示波器（Q 随时间变化）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pipe_p1  — 正压输入口 P₁
 *  pipe_p2  — 负压输入口 P₂
 *  wire_p   — 电荷/电压信号正极
 *  wire_n   — 电荷/电压信号负极（参考）
 *
 * ── 气路求解器集成 ───────────────────────────────────────────
 *  special = 'diff'
 *  update(press, flow) — press 为 ΔP (MPa)
 */
export class PiezoelectricPressureSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 360);
        this.height = Math.max(300, config.height || 340);

        this.type    = 'piezo_pressure';
        this.special = 'diff';
        this.cache   = 'fixed';

        // ── 材料参数 ──
        this.d33         = config.d33         || 300;     // 压电系数 pC/N (PZT-5A: ~374)
        this.area        = config.area         || 1e-4;   // 有效面积 m² (1 cm²)
        this.thickness   = config.thickness    || 0.5e-3; // 晶片厚度 m (0.5 mm)
        this.stiffness   = config.stiffness    || 2e7;    // 等效刚度 N/m
        this.capSelf     = config.capSelf      || 1000;   // 自身电容 pF
        this.maxDP       = config.maxDP        || 1.0;    // 最大差压 MPa
        this.maxCharge   = config.maxCharge    || 500;    // 最大电荷量 pC

        // ── 零点/量程 ──
        this.zeroAdj     = 0;
        this.spanAdj     = 1.0;

        // ── 状态 ──
        this.pressP1     = 0;    // 正压口 MPa
        this.pressP2     = 0;    // 负压口 MPa
        this.deltaP      = 0;    // 差压 MPa
        this.chargeQ     = 0;    // 电荷量 pC
        this.voltageVoc  = 0;    // 开路电压 mV
        this.deformation = 0;    // 变形量 μm
        this.isBreak     = false;
        this.powered     = true; // 压电效应无需供电

        // ── 动画 ──
        this._deformTarget  = 0;    // 目标变形（平滑）
        this._deformCurrent = 0;    // 当前显示变形
        this._chargePhase   = 0;    // 电荷动画相位
        this._glowAlpha     = 0;    // 电荷辉光强度

        // ── 波形缓冲 ──
        this._wavLen    = 200;
        this._wavQ      = new Float32Array(this._wavLen).fill(0);
        this._wavDP     = new Float32Array(this._wavLen).fill(0);
        this._wavAcc    = 0;

        // ── 几何布局 ──
        // 压力腔区（左侧大区域）
        this._chamX   = 8;
        this._chamY   = 36;
        this._chamW   = Math.round(this.width * 0.56);
        this._chamH   = Math.round(this.height * 0.48);

        // 压电晶片中心
        this._crystCX = this._chamX + this._chamW / 2;
        this._crystCY = this._chamY + this._chamH / 2;
        this._crystW  = this._chamW * 0.72;
        this._crystH  = 18;    // 晶片厚度（像素）

        // 仪表头（右侧）
        this._headX   = this._chamX + this._chamW + 10;
        this._headY   = this._chamY;
        this._headW   = this.width - this._headX - 8;
        this._headH   = this._chamH;

        // 等效电路（左下）
        this._circX   = this._chamX;
        this._circY   = this._chamY + this._chamH + 10;
        this._circW   = this._chamW;
        this._circH   = Math.round(this.height * 0.28);

        // 波形（右下）
        this._wavX    = this._headX;
        this._wavY    = this._circY;
        this._wavW    = this._headW;
        this._wavH    = this._circH;

        this._lastTs  = null;
        this._animId  = null;
        this.knobs    = {};

        this.config = {
            id: this.id, d33: this.d33, area: this.area,
            maxDP: this.maxDP, maxCharge: this.maxCharge,
        };

        this._init();

        const midY = this._crystCY;
        this.addPort(0,           midY - 20,        'p1', 'pipe', 'P1+');
        this.addPort(0,           midY + 20,        'p2', 'pipe', 'P2−');
        this.addPort(this.width,  this._headY + 20, 'ep', 'wire', 'Q+');
        this.addPort(this.width,  this._headY + 44, 'en', 'wire', 'Q−');
    }

    // ═══════════════════════════════════════════
    //  初始化
    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawChamber();
        this._drawPressurePorts();
        this._drawCrystalBase();
        this._drawChargeLayer();   // 动态层
        this._drawCrystalDeform(); // 动态层
        this._drawFieldArrows();   // 电场线层
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawEquivCircuit();
        this._drawWaveform();
        this._drawBottomPanel();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '压电式差压力传感器（正压电效应）',
            fontSize: 13, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 压力腔外壳 ───────────────────────────
    _drawChamber() {
        const { _chamX: cx, _chamY: cy, _chamW: cw, _chamH: ch } = this;

        // 外壳（金属腔体）
        const body = new Konva.Rect({
            x: cx, y: cy, width: cw, height: ch,
            fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: 5,
        });
        // 顶部腔（P1 正压腔）
        this._topCav = new Konva.Rect({
            x: cx + 6, y: cy + 6,
            width: cw - 12, height: ch / 2 - 16,
            fill: '#0d2137',
        });
        // 底部腔（P2 负压腔）
        this._botCav = new Konva.Rect({
            x: cx + 6, y: cy + ch / 2 + 10,
            width: cw - 12, height: ch / 2 - 16,
            fill: '#0d2137',
        });
        // 安装螺孔
        [[cx+10, cy+10], [cx+cw-10, cy+10], [cx+10, cy+ch-10], [cx+cw-10, cy+ch-10]].forEach(([bx, by]) => {
            this.group.add(new Konva.Circle({ x: bx, y: by, radius: 4, fill: '#263238', stroke: '#1a252f', strokeWidth: 0.5 }));
            this.group.add(new Konva.Circle({ x: bx-1, y: by-1, radius: 1.2, fill: 'rgba(255,255,255,0.22)' }));
        });
        // 分隔密封槽（中部）
        this.group.add(new Konva.Rect({
            x: cx, y: cy + ch/2 - 8, width: cw, height: 16,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
        }));
        // P1/P2 标注
        this.group.add(new Konva.Text({ x: cx + 8, y: cy + 8, text: 'P₁  (正压腔)', fontSize: 9, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: cx + 8, y: cy + ch/2 + 12, text: 'P₂  (负压腔)', fontSize: 9, fontStyle: 'bold', fill: '#90caf9' }));

        this.group.add(body, this._topCav, this._botCav);
    }

    // ── 双压力接口（左侧法兰管）────────────
    _drawPressurePorts() {
        const cx = this._chamX;
        const cy = this._chamY + this._chamH / 2;

        // P1 正压口（上方）
        const p1Y = cy - 22;
        [  // 法兰
            new Konva.Rect({ x: cx - 28, y: p1Y - 8, width: 28, height: 16, fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.5, cornerRadius: 2 }),
            new Konva.Circle({ x: cx - 28, y: p1Y - 6, radius: 2.5, fill: '#b71c1c' }),
            new Konva.Circle({ x: cx - 28, y: p1Y + 6, radius: 2.5, fill: '#b71c1c' }),
            new Konva.Text({ x: cx - 40, y: p1Y - 20, text: 'P₁+', fontSize: 10, fontStyle: 'bold', fill: '#ef5350' }),
        ].forEach(n => this.group.add(n));

        // P2 负压口（下方）
        const p2Y = cy + 22;
        [
            new Konva.Rect({ x: cx - 28, y: p2Y - 8, width: 28, height: 16, fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1.5, cornerRadius: 2 }),
            new Konva.Circle({ x: cx - 28, y: p2Y - 6, radius: 2.5, fill: '#0d47a1' }),
            new Konva.Circle({ x: cx - 28, y: p2Y + 6, radius: 2.5, fill: '#0d47a1' }),
            new Konva.Text({ x: cx - 40, y: p2Y + 10, text: 'P₂−', fontSize: 10, fontStyle: 'bold', fill: '#1565c0' }),
        ].forEach(n => this.group.add(n));

        // 压力传导线（虚线）
        this.group.add(new Konva.Line({ points: [cx - 1, p1Y, cx + 6, this._crystCY - this._crystH/2 - 4], stroke: '#ef5350', strokeWidth: 1, dash: [3,2], opacity: 0.6 }));
        this.group.add(new Konva.Line({ points: [cx - 1, p2Y, cx + 6, this._crystCY + this._crystH/2 + 4], stroke: '#1565c0', strokeWidth: 1, dash: [3,2], opacity: 0.6 }));
    }

    // ── 压电晶片基础层（静态外观）──────────
    _drawCrystalBase() {
        const cx = this._crystCX, cy = this._crystCY;
        const cw = this._crystW,  ch = this._crystH;

        // 左右固定端（夹持器）
        const clampW = 14, clampH = ch + 20;
        [-cw/2 - clampW + 2, cw/2 - 2].forEach(xOff => {
            this.group.add(new Konva.Rect({
                x: cx + xOff, y: cy - clampH/2,
                width: clampW, height: clampH,
                fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5, cornerRadius: 2,
            }));
        });
        // 夹持螺丝
        [-cw/2 - clampW/2 + 2, cw/2 + clampW/2 - 2].forEach(xOff => {
            for (let dy of [-clampH/3, clampH/3]) {
                this.group.add(new Konva.Circle({ x: cx + xOff, y: cy + dy, radius: 4, fill: '#37474f', stroke: '#263238', strokeWidth: 0.5 }));
            }
        });
        // 顶部电极（金色）
        this._topElectrode = new Konva.Rect({
            x: cx - cw/2, y: cy - ch/2 - 4,
            width: cw, height: 4,
            fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 0.8, cornerRadius: 1,
        });
        // 底部电极
        this._botElectrode = new Konva.Rect({
            x: cx - cw/2, y: cy + ch/2,
            width: cw, height: 4,
            fill: '#ffd54f', stroke: '#f9a825', strokeWidth: 0.8, cornerRadius: 1,
        });
        // 电极引线
        this.group.add(new Konva.Line({ points: [cx + cw/2 + 2, cy - ch/2 - 2, this._headX - 4, this._headY + 20], stroke: '#ffd54f', strokeWidth: 1.5, dash: [3,2] }));
        this.group.add(new Konva.Line({ points: [cx + cw/2 + 2, cy + ch/2 + 2, this._headX - 4, this._headY + 44], stroke: '#ffd54f', strokeWidth: 1.5, dash: [3,2] }));
        // 标注
        this.group.add(new Konva.Text({ x: cx - 30, y: cy - ch/2 - 22, text: '压电晶片（PZT）', fontSize: 9, fontStyle: 'bold', fill: '#80cbc4' }));

        this.group.add(this._topElectrode, this._botElectrode);
    }

    // ── 电荷层（动态，每帧重绘）────────────
    _drawChargeLayer() {
        this._chargeGroup = new Konva.Group();
        this.group.add(this._chargeGroup);
    }

    // ── 晶体变形层（动态）──────────────────
    _drawCrystalDeform() {
        // 初始（平直）晶片
        this._crystalLine = new Konva.Line({ points: [], stroke: '#80cbc4', strokeWidth: 3, lineCap: 'round', lineJoin: 'round' });
        this._crystalFill = new Konva.Line({ points: [], closed: true, fill: 'rgba(0,188,212,0.18)', stroke: 'none' });
        this._crystalTopLine = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.5, lineCap: 'round' });
        this._crystalBotLine = new Konva.Line({ points: [], stroke: '#ffd54f', strokeWidth: 1.5, lineCap: 'round' });
        this.group.add(this._crystalFill, this._crystalLine, this._crystalTopLine, this._crystalBotLine);
    }

    // ── 电场线层（动态）────────────────────
    _drawFieldArrows() {
        this._fieldGroup = new Konva.Group();
        this.group.add(this._fieldGroup);
    }

    // ── 仪表头 ──────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 40, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+6+i*10, hx+hw, hy+6+i*10], stroke: 'rgba(255,255,255,0.14)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+4, width: hw-16, height: 23, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+7, width: hw-16, text: this.id || 'PT-P01', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+17, width: hw-16, text: 'PIEZO  DIFF', fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx, y: hy+3, width: 10, height: 36, fill: '#b0bec5', cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+3, width: 10, height: 36, fill: '#b0bec5', cornerRadius: [0,2,2,0] });
        const body = new Konva.Rect({ x: hx, y: hy+40, width: hw, height: hh-40, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 40 + (this._headH - 40) * 0.50;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        // 蓝紫色压电传感器风格外环
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#1a237e', stroke: '#3949ab', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        // 电荷量弧（主要输出）
        this._chargeArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#7986cb', rotation: -90 });

        this._lcdMain   = new Konva.Text({ x: lcx-R+4, y: lcy-R*.38, width:(R-4)*2, text:'0.0',   fontSize:R*.40, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#7986cb', align:'center' });
        this._lcdUnit   = new Konva.Text({ x: lcx-R+4, y: lcy+R*.07, width:(R-4)*2, text:'pC',    fontSize:R*.18, fill:'#1a237e', align:'center' });
        this._lcdDP     = new Konva.Text({ x: lcx-R+4, y: lcy+R*.29, width:(R-4)*2, text:'ΔP=0', fontSize:R*.14, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdVoc    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.60, width:(R-4)*2, text:'Voc=0', fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdDeform = new Konva.Text({ x: lcx-R+4, y: lcy+R*.47, width:(R-4)*2, text:'δ=0 μm', fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._chargeArc, this._lcdMain, this._lcdUnit, this._lcdDP, this._lcdVoc, this._lcdDeform);
    }

    // ── 旋钮 ───────────────────────────────
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
                const sy = e.evt.clientY ?? e.evt.touches?.[0]?.clientY ?? 0;
                const sr = rotor.rotation();
                const mv = me => {
                    const cy2 = me.clientY ?? me.touches?.[0]?.clientY ?? 0;
                    rotor.rotation(sr+(sy-cy2)*2);
                    if(k.id==='zero') this.zeroAdj=(rotor.rotation()/360)*0.05;
                    else              this.spanAdj=1+(rotor.rotation()/360)*0.3;
                };
                const up = () => { window.removeEventListener('mousemove',mv); window.removeEventListener('touchmove',mv); window.removeEventListener('mouseup',up); window.removeEventListener('touchend',up); };
                window.addEventListener('mousemove',mv); window.addEventListener('touchmove',mv);
                window.addEventListener('mouseup',up); window.addEventListener('touchend',up);
            });
            this.group.add(g);
        });
    }

    // ── 等效电路（左下）────────────────────
    _drawEquivCircuit() {
        const { _circX: cx2, _circY: cy2, _circW: cw, _circH: ch } = this;
        const bg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: ch, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.2, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: cx2, y: cy2, width: cw, height: 14, fill: '#0d1a30', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: cx2+4, y: cy2+2, width: cw-8, text: '等效电路  Q=d·A·ΔP　V_oc=Q/C_s', fontSize: 8, fontStyle: 'bold', fill: '#7986cb', align: 'center' }));

        const x1 = cx2 + 10, x2 = cx2 + cw - 10;
        const midX = (x1 + x2) / 2;
        const y1  = cy2 + 20, y2 = cy2 + ch - 12;

        // 压电源（左侧，菱形标记）
        this.group.add(new Konva.Line({ points: [x1, y1, x1, y2], stroke: '#7986cb', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x1-8, (y1+y2)/2, x1, (y1+y2)/2-10, x1+8, (y1+y2)/2, x1, (y1+y2)/2+10, x1-8, (y1+y2)/2], closed: true, stroke: '#7986cb', fill: '#0d1a30', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: x1+12, y: (y1+y2)/2-5, text: 'Q', fontSize: 9, fontStyle: 'bold', fill: '#7986cb' }));

        // 自身电容 Cs
        const capX = midX;
        this.group.add(new Konva.Line({ points: [x1, y1, capX, y1], stroke: '#7986cb', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [capX-8, y1+4, capX+8, y1+4], stroke: '#ffd54f', strokeWidth: 2 }));
        this.group.add(new Konva.Line({ points: [capX-8, y1+10, capX+8, y1+10], stroke: '#ffd54f', strokeWidth: 2 }));
        this.group.add(new Konva.Line({ points: [capX, y1+10, capX, y2], stroke: '#7986cb', strokeWidth: 1 }));
        this.group.add(new Konva.Text({ x: capX+10, y: y1+5, text: 'Cs', fontSize: 8, fill: '#ffd54f' }));

        // 导线连接到输出
        this.group.add(new Konva.Line({ points: [x2, y1, x2, y2], stroke: '#7986cb', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x1, y2, x2, y2], stroke: '#7986cb', strokeWidth: 1 }));
        this.group.add(new Konva.Line({ points: [x1, y1, capX-0, y1], stroke: '#7986cb', strokeWidth: 1 }));

        // 输出端子
        this._circVout = new Konva.Text({ x: x2+2, y: y1-1, text: 'V+', fontSize: 8, fill: '#80cbc4' });
        this._circQlbl = new Konva.Text({ x: cx2+4, y: cy2+ch-12, text: 'Q=0 pC', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#7986cb' });

        this.group.add(bg, titleBg, this._circVout, this._circQlbl);
    }

    // ── 波形示波器（右下）──────────────────
    _drawWaveform() {
        const { _wavX: wx, _wavY: wy, _wavW: ww, _wavH: wh } = this;

        const bg = new Konva.Rect({ x: wx, y: wy, width: ww, height: wh, fill: '#010d18', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: wx, y: wy, width: ww, height: 14, fill: '#0a1a28', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: wx+4, y: wy+2, width: ww-8, text: 'Q(t) 电荷输出  ΔP(t) 差压', fontSize: 8, fontStyle: 'bold', fill: '#7986cb', align: 'center' }));

        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [wx, wy+wh*i/3, wx+ww, wy+wh*i/3], stroke: 'rgba(121,134,203,0.08)', strokeWidth: 0.5 }));
        for (let i = 1; i < 4; i++) this.group.add(new Konva.Line({ points: [wx+ww*i/4, wy, wx+ww*i/4, wy+wh], stroke: 'rgba(121,134,203,0.05)', strokeWidth: 0.5 }));

        this._wavMidQ  = wy + wh * 0.30;
        this._wavMidDP = wy + wh * 0.75;

        [this._wavMidQ, this._wavMidDP].forEach(my => {
            this.group.add(new Konva.Line({ points: [wx+2, my, wx+ww-2, my], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineQ   = new Konva.Line({ points: [], stroke: '#7986cb', strokeWidth: 1.8, lineJoin: 'round' });
        this._wLineDP  = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.4, lineJoin: 'round' });

        this.group.add(new Konva.Text({ x: wx+4, y: wy+16, text: 'Q (pC)', fontSize: 8, fill: '#7986cb' }));
        this.group.add(new Konva.Text({ x: wx+4, y: wy+wh/2+6, text: 'ΔP (kPa)', fontSize: 8, fill: '#ef9a9a' }));

        this._wQLbl  = new Konva.Text({ x: wx+ww-80, y: wy+16, width: 76, text: '0 pC', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#7986cb', align: 'right' });
        this._wDPLbl = new Konva.Text({ x: wx+ww-80, y: wy+wh/2+6, width: 76, text: '0 kPa', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ef9a9a', align: 'right' });

        this.group.add(bg, titleBg, this._wLineQ, this._wLineDP, this._wQLbl, this._wDPLbl);
    }

    // ── 底部数据面板 ────────────────────────
    _drawBottomPanel() {
        const py = this.height - 40;
        const bg = new Konva.Rect({ x: 4, y: py, width: this.width-8, height: 36, fill: '#050d18', stroke: '#1a3040', strokeWidth: 1, cornerRadius: 4 });
        this._panelDP    = new Konva.Text({ x: 10, y: py+5,  width: (this.width-8)*.45, text: 'ΔP=0 MPa', fontSize: 9, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#7986cb' });
        this._panelQ     = new Konva.Text({ x: 10, y: py+20, width: (this.width-8)*.45, text: 'Q=0.0 pC', fontSize: 8,  fontFamily: 'Courier New, monospace', fill: '#546e7a' });
        this._panelSt    = new Konva.Text({ x: (this.width-8)*.48+4, y: py+5,  width: (this.width-8)*.5, text: '● 正常', fontSize: 9, fontStyle: 'bold', fill: '#66bb6a', align: 'right' });
        this._panelDeform= new Konva.Text({ x: (this.width-8)*.48+4, y: py+20, width: (this.width-8)*.5, text: 'δ=0 μm  Voc=0 mV', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#37474f', align: 'right' });
        this.group.add(bg, this._panelDP, this._panelQ, this._panelSt, this._panelDeform);
    }

    // ═══════════════════════════════════════════
    //  动画主循环
    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickPhysics(dt);
                this._tickCrystalDeform();
                this._tickChargeViz();
                this._tickFieldLines();
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

    // ── 物理计算 ──────────────────────────
    _tickPhysics(dt) {
        // 差压
        const rawDP = this.pressP1 - this.pressP2;   // MPa
        const adjDP = (rawDP + this.zeroAdj * this.maxDP) * this.spanAdj;
        this.deltaP = Math.max(-this.maxDP, Math.min(this.maxDP, adjDP));

        // 压电效应：Q = d33 × A × ΔP × 1e6 (MPa→Pa) × 1e12 (C→pC)
        const F = this.deltaP * 1e6 * this.area;  // 力 N
        this.chargeQ    = this.isBreak ? 0 : this.d33 * F;  // pC
        this.deformation = Math.abs(F) / this.stiffness * 1e6;  // μm
        this.voltageVoc  = this.chargeQ / this.capSelf * 1000; // mV (Q pC / C pF = V → mV)

        // 平滑变形目标
        this._deformTarget = this.deltaP / this.maxDP;   // -1 ~ +1
        this._deformCurrent += (this._deformTarget - this._deformCurrent) * Math.min(1, dt * 12);

        // 电荷动画相位
        this._chargePhase += dt * 4;
        this._glowAlpha = Math.abs(this._deformCurrent) * 0.6 + 0.1;

        // 电荷弧
        if (this._chargeArc) {
            const ratio = Math.min(1, Math.abs(this.chargeQ) / this.maxCharge);
            this._chargeArc.angle(ratio * 360);
            this._chargeArc.fill(this.chargeQ >= 0 ? '#7986cb' : '#ef9a9a');
        }

        // 压力腔颜色
        if (this._topCav) {
            const r1 = Math.min(1, this.pressP1 / this.maxDP);
            this._topCav.fill(`rgb(${Math.round(40+r1*80)},${Math.round(20+r1*10)},${Math.round(50+r1*20)})`);
        }
        if (this._botCav) {
            const r2 = Math.min(1, this.pressP2 / this.maxDP);
            this._botCav.fill(`rgb(${Math.round(13+r2*12)},${Math.round(33+r2*30)},${Math.round(80+r2*50)})`);
        }
    }

    // ── 晶体变形动画 ──────────────────────
    _tickCrystalDeform() {
        const cx = this._crystCX, cy = this._crystCY;
        const cw = this._crystW,  ch = this._crystH;
        const def = this._deformCurrent;
        const maxDef = ch * 0.7;   // 最大视觉变形像素

        // 弯曲曲线（二次贝塞尔近似用折线段）
        const N = 24;
        const topPts = [], botPts = [], midPts = [];
        for (let i = 0; i <= N; i++) {
            const t  = i / N;
            const x  = cx - cw/2 + t * cw;
            // 抛物线变形
            const sag = def * maxDef * 4 * t * (1 - t);   // 中点最大变形
            topPts.push(x, cy - ch/2 - sag);
            botPts.push(x, cy + ch/2 - sag);
            midPts.push(x, cy - sag);
        }

        // 填充多边形（顶+底拼接）
        const fillPts = [...topPts, ...botPts.slice().reverse()];
        if (this._crystalFill) this._crystalFill.points(fillPts);

        // 中线（晶片中面）
        if (this._crystalLine) {
            this._crystalLine.points(midPts);
            // 应力颜色：正变形=蓝，负变形=红
            const stress = this._deformCurrent;
            const r = Math.round(128 + stress * 80);
            const b = Math.round(200 - stress * 80);
            this._crystalLine.stroke(`rgb(${r},180,${b})`);
            this._crystalLine.strokeWidth(3 + Math.abs(stress) * 2);
        }

        // 顶部/底部电极（跟随变形）
        if (this._crystalTopLine) this._crystalTopLine.points(topPts);
        if (this._crystalBotLine) this._crystalBotLine.points(botPts);

        // 更新金色电极矩形位置（近似，用弯曲中点）
        const midSag = def * maxDef;
        if (this._topElectrode) this._topElectrode.y(cy - ch/2 - 4 - midSag);
        if (this._botElectrode) this._botElectrode.y(cy + ch/2 - midSag);

        // 力箭头（显示差压方向）
        this._fieldGroup.destroyChildren();
        if (Math.abs(this.deltaP) > 1e-4) {
            const arrowDir = this.deltaP > 0 ? 1 : -1;
            const arrowY   = this.deltaP > 0 ? (cy - ch/2 - midSag - 32) : (cy + ch/2 - midSag + 32);
            const arrowEndY = arrowY + arrowDir * 22;

            this._fieldGroup.add(new Konva.Line({
                points: [cx, arrowY, cx, arrowEndY],
                stroke: '#ff8f00', strokeWidth: 2.5, lineCap: 'round',
            }));
            this._fieldGroup.add(new Konva.Line({
                points: [cx - 7, arrowEndY - arrowDir*8, cx, arrowEndY, cx + 7, arrowEndY - arrowDir*8],
                stroke: '#ff8f00', strokeWidth: 2.5, lineJoin: 'round',
            }));
            this._fieldGroup.add(new Konva.Text({
                x: cx + 12, y: (arrowY + arrowEndY) / 2 - 5,
                text: `F=${Math.abs(this.deltaP * this.area * 1e6).toFixed(2)}N`,
                fontSize: 8.5, fontFamily: 'Courier New, monospace', fill: '#ff8f00',
            }));
        }
    }

    // ── 表面电荷可视化 ────────────────────
    _tickChargeViz() {
        this._chargeGroup.destroyChildren();
        if (Math.abs(this._deformCurrent) < 0.02 || this.isBreak) return;

        const cx = this._crystCX, cy = this._crystCY;
        const cw = this._crystW,  ch = this._crystH;
        const def = this._deformCurrent;
        const midSag = def * ch * 0.7;

        const isPositive = def > 0;
        const topSign = isPositive ? '+' : '−';
        const botSign = isPositive ? '−' : '+';
        const topCol  = isPositive ? '#ef9a9a' : '#90caf9';
        const botCol  = isPositive ? '#90caf9' : '#ef9a9a';

        const numCharge = 7;
        const pulse     = 0.6 + 0.4 * Math.abs(Math.sin(this._chargePhase));

        for (let i = 0; i < numCharge; i++) {
            const t   = (i + 0.5) / numCharge;
            const x   = cx - cw/2 + t * cw;
            const sag = def * ch * 0.7 * 4 * t * (1-t);

            // 上表面电荷符号
            const topY = cy - ch/2 - sag - 12;
            this._chargeGroup.add(new Konva.Text({
                x: x - 5, y: topY,
                text: topSign, fontSize: 14, fontStyle: 'bold',
                fill: topCol, opacity: Math.abs(def) * pulse,
            }));
            // 下表面电荷符号
            const botY = cy + ch/2 - sag + 4;
            this._chargeGroup.add(new Konva.Text({
                x: x - 5, y: botY,
                text: botSign, fontSize: 14, fontStyle: 'bold',
                fill: botCol, opacity: Math.abs(def) * pulse,
            }));

            // 辉光点（模拟电荷密度）
            if (i % 2 === 0) {
                const glowR = Math.abs(def) * 4;
                this._chargeGroup.add(new Konva.Circle({
                    x, y: topY + 8, radius: glowR,
                    fill: `rgba(${isPositive?'239,154,154':'144,202,249'},${Math.abs(def) * 0.3})`,
                }));
                this._chargeGroup.add(new Konva.Circle({
                    x, y: botY + 4, radius: glowR,
                    fill: `rgba(${isPositive?'144,202,249':'239,154,154'},${Math.abs(def) * 0.3})`,
                }));
            }
        }

        // 极化方向箭头（晶体内部电场）
        const fieldColor  = isPositive ? 'rgba(239,154,154,0.35)' : 'rgba(144,202,249,0.35)';
        const fieldDir    = isPositive ? -1 : 1;   // 电场方向（从+到-）
        const innerTopY   = cy - ch/2 - midSag + 2;
        const innerBotY   = cy + ch/2 - midSag - 2;
        const fieldArrowY = (innerTopY + innerBotY) / 2;

        for (let i = 1; i < numCharge; i += 2) {
            const t = (i + 0.5) / numCharge;
            const x2 = cx - cw/2 + t * cw;
            const fSag = def * ch * 0.7 * 4 * t * (1-t);
            const fy = cy - fSag;
            this._chargeGroup.add(new Konva.Line({
                points: [x2, fy - 6 * fieldDir, x2, fy + 6 * fieldDir],
                stroke: fieldColor, strokeWidth: 1.5, lineCap: 'round',
            }));
            this._chargeGroup.add(new Konva.Line({
                points: [x2 - 3, fy + 6*fieldDir - 3*fieldDir, x2, fy + 6*fieldDir, x2 + 3, fy + 6*fieldDir - 3*fieldDir],
                stroke: fieldColor, strokeWidth: 1.2, lineJoin: 'round',
            }));
        }
    }

    // ── 电场线（内部极化）────────────────
    _tickFieldLines() {
        // 电场线已在 _tickChargeViz 中绘制
    }

    // ── 波形缓冲 ──────────────────────────
    _tickWaveform(dt) {
        const scrollSpeed = 1.5;
        this._wavAcc += scrollSpeed * dt * this._wavLen;
        const steps = Math.floor(this._wavAcc);
        this._wavAcc -= steps;

        for (let i = 0; i < steps; i++) {
            this._wavQ  = new Float32Array([...this._wavQ.slice(1),  this.chargeQ]);
            this._wavDP = new Float32Array([...this._wavDP.slice(1), this.deltaP * 1000]); // kPa
        }

        const wx = this._wavX + 3, wy2 = this._wavY;
        const ww = this._wavW - 6, wh = this._wavH;
        const n  = this._wavLen, dx = ww / n;
        const qAmp  = wh * 0.22;
        const dpAmp = wh * 0.18;

        const qPts = [], dpPts = [];
        for (let i = 0; i < n; i++) {
            const x   = wx + i * dx;
            const qv  = this._wavQ[i]  / (this.maxCharge + 0.01);
            const dpv = this._wavDP[i] / (this.maxDP * 1000 + 0.01);
            qPts.push(x,  this._wavMidQ  - qv * qAmp);
            dpPts.push(x, this._wavMidDP - dpv * dpAmp);
        }
        if (this._wLineQ)  this._wLineQ.points(qPts);
        if (this._wLineDP) this._wLineDP.points(dpPts);

        if (this._wQLbl)  this._wQLbl.text(`${this.chargeQ.toFixed(1)} pC`);
        if (this._wDPLbl) this._wDPLbl.text(`${(this.deltaP*1000).toFixed(1)} kPa`);
    }

    // ── 显示刷新 ──────────────────────────
    _tickDisplay() {
        if (this.isBreak) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._panelSt.text('⚠ 断线'); this._panelSt.fill('#ef5350');
            return;
        }

        const ratio    = Math.min(1, Math.abs(this.chargeQ) / this.maxCharge);
        const isNeg    = this.chargeQ < 0;
        const mainColor = ratio > 0.8 ? '#ff5722' : isNeg ? '#ef9a9a' : '#7986cb';

        this._lcdBg.fill('#020c14');
        this._lcdMain.text(this.chargeQ.toFixed(1)); this._lcdMain.fill(mainColor);
        this._lcdUnit.text('pC');
        this._lcdDP.text(`ΔP=${(this.deltaP*1000).toFixed(1)}kPa`);
        this._lcdDP.fill(this.deltaP > 0 ? '#ef9a9a' : this.deltaP < 0 ? '#90caf9' : '#37474f');
        this._lcdVoc.text(`V=${this.voltageVoc.toFixed(1)}mV`);
        this._lcdDeform.text(`δ=${this.deformation.toFixed(2)}μm`);

        const stStr = ratio > 0.9 ? '⬆ 量程上限' : Math.abs(this.deltaP) > 0.01 ? '● 正常测量' : '○ 零压平衡';
        const stCol = ratio > 0.9 ? '#ff5722' : Math.abs(this.deltaP) > 0.01 ? '#66bb6a' : '#546e7a';
        this._panelSt.text(stStr); this._panelSt.fill(stCol);
        this._panelDP.text(`ΔP=${(this.deltaP*1000).toFixed(2)} kPa`);
        this._panelQ.text(`Q=${this.chargeQ.toFixed(2)} pC`);
        this._panelDeform.text(`δ=${this.deformation.toFixed(3)}μm  V=${this.voltageVoc.toFixed(2)}mV`);

        if (this._circQlbl) this._circQlbl.text(`Q=${this.chargeQ.toFixed(2)} pC`);
    }

    // ═══════════════════════════════════════════
    //  气路求解器接口
    // ═══════════════════════════════════════════
    update(press, flow) {
        // press = ΔP (MPa)，由求解器注入
        if (typeof press === 'number') {
            // diff 模式：press 直接是差压
            this.pressP1 = Math.max(0, press);
            this.pressP2 = 0;
        }
        this._refreshCache();
    }

    /**
     * 直接设置双压口压力
     * @param {number} p1 正压口 MPa
     * @param {number} p2 负压口 MPa
     */
    setPressure(p1, p2) {
        this.pressP1 = Math.max(0, p1);
        this.pressP2 = Math.max(0, p2);
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    //  配置
    // ═══════════════════════════════════════════
    getConfigFields() {
        return [
            { label: '位号/名称',             key: 'id',          type: 'text'   },
            { label: '压电系数 d33 (pC/N)',   key: 'd33',         type: 'number' },
            { label: '有效面积 A (cm²)',       key: 'areaCC',      type: 'number' },
            { label: '自身电容 Cs (pF)',       key: 'capSelf',     type: 'number' },
            { label: '最大差压 (MPa)',         key: 'maxDP',       type: 'number' },
            { label: '最大电荷 (pC)',          key: 'maxCharge',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id         = cfg.id         || this.id;
        this.d33        = parseFloat(cfg.d33)       || this.d33;
        if (cfg.areaCC) this.area = parseFloat(cfg.areaCC) * 1e-4;
        this.capSelf    = parseFloat(cfg.capSelf)   || this.capSelf;
        this.maxDP      = parseFloat(cfg.maxDP)     || this.maxDP;
        this.maxCharge  = parseFloat(cfg.maxCharge) || this.maxCharge;
        this.config     = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}