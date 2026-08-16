import { BaseComponent } from './BaseComponent.js';

/**
 * 变浮力式液位传感器仿真组件
 * （Displacer / Buoyancy Level Transmitter with LVDT）
 *
 * ── 测量原理 ─────────────────────────────────────────────────
 *  阿基米德浮力原理 + 差动变压器（LVDT）:
 *
 *  浮力 F = ρ · g · V_submerged
 *         = ρ · g · A · H_sub
 *
 *  其中：
 *    ρ   — 液体密度 (kg/m³)
 *    g   — 重力加速度 9.81 m/s²
 *    A   — 浮筒截面积 (m²)
 *    H_sub — 浮筒浸入液体的深度 (m)
 *
 *  悬挂弹簧平衡：
 *    F_spring = k · x     (弹簧力 = 弹簧系数 × 位移)
 *
 *  平衡条件：
 *    W_displacer = F_spring + F_buoyancy
 *    k · x = W - ρ·g·A·H_sub
 *
 *  因此弹簧位移 x 随液位线性变化（液位↑ → 浮力↑ → x↑ → LVDT铁芯上移）
 *
 *  LVDT（线性可变差动变压器）:
 *    初级线圈励磁，铁芯位置决定两路次级线圈的感应电压差：
 *    V_out = V_A - V_B  ∝  铁芯位移 x
 *    V_out → 鉴相解调 → 直流电压 → 4-20mA 转换
 *
 * ── 组件结构 ─────────────────────────────────────────────────
 *  ① 储罐截面（可拖拽液位）+ 悬挂浮筒（动态位移）
 *  ② 弹簧悬挂机构（弹簧变形动画）
 *  ③ LVDT 差动变压器（剖面图 + 铁芯位移动画 + 线圈磁场）
 *  ④ LVDT 输出波形（V_A、V_B、差压 V_out 三路信号）
 *  ⑤ 仪表头（圆形 LCD，显示液位 % + 浮力 + 弹簧位移）
 *  ⑥ 底部数据面板
 *
 * ── 输出 ─────────────────────────────────────────────────────
 *  4-20 mA 对应 0~100% 液位
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_p  — 24VDC +
 *  wire_n  — 4-20mA / GND
 */
export class DisplacerLevelSensor extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 380);
        this.height = Math.max(360, config.height || 400);

        this.type    = 'displacer_level';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.displacerLen    = config.displacerLen    || 0.5;    // 浮筒有效长度 m
        this.displacerArea   = config.displacerArea   || 0.002;  // 浮筒截面积 m²
        this.displacerWeight = config.displacerWeight || 2.0;    // 浮筒重量 kg
        this.springK         = config.springK         || 800;    // 弹簧系数 N/m
        this.liquidDensity   = config.liquidDensity   || 1000;   // 液体密度 kg/m³
        this.lvdtRange       = config.lvdtRange       || 0.025;  // LVDT 量程 m（±25mm）
        this.hiAlarm         = config.hiAlarm         || 85;
        this.loAlarm         = config.loAlarm         || 15;

        // ── 零点/量程 ──
        this.zeroAdj = 0;
        this.spanAdj = 1.0;

        // ── 状态 ──
        this.liquidLevel     = config.initLevel || 50;   // % (0~100)
        this.buoyancy        = 0;    // N
        this.springDisplace  = 0;    // m（弹簧压缩量，正=上移）
        this.lvdtCore        = 0;    // m（LVDT铁芯位移，±range）
        this.vA              = 0;    // V（次级A）
        this.vB              = 0;    // V（次级B）
        this.vOut            = 0;    // V（差压输出）
        this.outCurrent      = 12;   // mA
        this.isBreak         = false;
        this.powered         = false;
        this.alarmHi         = false;
        this.alarmLo         = false;

        // ── LVDT 励磁 ──
        this._excPhase       = 0;    // 励磁相位 rad
        this._excFreq        = 1000; // 励磁频率 Hz（工业常用）

        // ── 波形缓冲 ──
        this._waveLen        = 200;
        this._waveBufA       = new Float32Array(this._waveLen).fill(0);
        this._waveBufB       = new Float32Array(this._waveLen).fill(0);
        this._waveBufD       = new Float32Array(this._waveLen).fill(0);
        this._waveAcc        = 0;

        // ── 弹簧动画 ──
        this._springCoils    = 10;   // 弹簧圈数

        // ── 拖拽 ──
        this._dragActive     = false;
        this._dragStartY     = 0;
        this._dragStartLv    = 0;

        // ── 几何布局 ──
        // 储罐+浮筒（左侧主区）
        this._tankX  = 10;
        this._tankY  = 36;
        this._tankW  = Math.round(this.width * 0.36);
        this._tankH  = Math.round(this.height * 0.56);

        // LVDT 截面图（中部）
        this._lvdtX  = this._tankX + this._tankW + 12;
        this._lvdtY  = this._tankY;
        this._lvdtW  = Math.round(this.width * 0.22);
        this._lvdtH  = Math.round(this.height * 0.56);

        // 仪表头（右侧）
        this._headX  = this._lvdtX + this._lvdtW + 10;
        this._headY  = this._tankY;
        this._headW  = this.width - this._headX - 8;
        this._headH  = Math.round(this.height * 0.56);

        // 波形示波器（底部全宽）
        this._oscX   = 8;
        this._oscY   = this._tankY + this._tankH + 10;
        this._oscW   = this.width - 16;
        this._oscH   = Math.round(this.height * 0.28);

        this._lastTs = null;
        this._animId = null;
        this.knobs   = {};

        this.config = {
            id: this.id, displacerLen: this.displacerLen,
            displacerArea: this.displacerArea, displacerWeight: this.displacerWeight,
            springK: this.springK, liquidDensity: this.liquidDensity,
        };

        this._init();

        this.addPort(this.width, this._headY + 16, 'p', 'wire', 'V+');
        this.addPort(this.width, this._headY + 38, 'n', 'wire', '4-20');
    }

    // ═════════════════════════════════════════════
    //  初始化
    // ═════════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawTank();
        this._drawSpringHanger();   // 弹簧悬挂机构（静态骨架）
        this._drawDisplacerGroup(); // 浮筒（动态组）
        this._drawLiquidLayer();
        this._drawTankDynamic();
        this._drawLVDT();
        this._drawInstrHead();
        this._drawLCD();
        this._drawKnobs();
        this._drawWaveform();
        this._setupDrag();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '变浮力式液位传感器（悬挂浮筒 + LVDT 差动变压器）',
            fontSize: 12.5, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 储罐外壳 ──────────────────────────────
    _drawTank() {
        const { _tankX: tx, _tankY: ty, _tankW: tw, _tankH: th } = this;
        const wall = 10;

        this.group.add(new Konva.Text({
            x: tx, y: ty - 16, width: tw,
            text: '被测储罐', fontSize: 10, fontStyle: 'bold', fill: '#37474f', align: 'center',
        }));

        // 外壁
        const outer = new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#455a64', stroke: '#263238', strokeWidth: 2, cornerRadius: [4,4,2,2],
        });
        // 顶盖（悬挂法兰）
        const topCap = new Konva.Rect({
            x: tx, y: ty, width: tw, height: wall,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1,
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
        this.group.add(new Konva.Rect({
            x: tx, y: ty+th, width: tw, height: 6,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 1, cornerRadius: [0,0,3,3],
        }));
        // 量程刻度
        for (let i = 0; i <= 4; i++) {
            const ly = ty + wall + (this._innerH * i) / 4;
            this.group.add(new Konva.Line({ points: [tx+tw, ly, tx+tw+7, ly], stroke: '#78909c', strokeWidth: 0.8 }));
            this.group.add(new Konva.Text({ x: tx+tw+9, y: ly-5, text: `${100-i*25}%`, fontSize: 8, fill: '#607d8b' }));
        }
        // 报警线
        const hiY = ty+wall + this._innerH*(1-this.hiAlarm/100);
        const loY = ty+wall + this._innerH*(1-this.loAlarm/100);
        this._hiLine = new Konva.Line({ points: [tx+wall, hiY, tx+tw-wall, hiY], stroke: 'rgba(239,83,80,0.4)', strokeWidth: 1, dash: [5,3] });
        this._loLine = new Konva.Line({ points: [tx+wall, loY, tx+tw-wall, loY], stroke: 'rgba(255,152,0,0.4)',  strokeWidth: 1, dash: [5,3] });

        this.group.add(outer, topCap, this._innerCav, this._hiLine, this._loLine);
    }

    // ── 弹簧悬挂机构（静态 + 动态合并）──────
    _drawSpringHanger() {
        const tx = this._tankX;
        const tw = this._tankW;
        const ty = this._tankY;
        const springCX = tx + tw / 2;

        // 顶部支撑横梁
        const beam = new Konva.Rect({
            x: springCX - 20, y: ty - 22,
            width: 40, height: 10,
            fill: '#607d8b', stroke: '#455a64', strokeWidth: 1.5, cornerRadius: 2,
        });
        // 连接杆（从横梁到弹簧顶端）
        const rod = new Konva.Line({
            points: [springCX, ty - 12, springCX, ty + 8],
            stroke: '#607d8b', strokeWidth: 3, lineCap: 'round',
        });
        // 传杆（从弹簧底到LVDT）
        this._rodLine = new Konva.Line({
            points: [springCX, ty + 8, springCX, ty + this._tankH - 14],
            stroke: '#ffd54f', strokeWidth: 2, dash: [4, 2], lineCap: 'round',
        });
        // 导线（从弹簧上端到仪表头）
        this.group.add(new Konva.Line({
            points: [springCX + 22, ty - 12, this._headX, ty - 12, this._headX, this._headY + 16],
            stroke: '#546e7a', strokeWidth: 1.5, dash: [3, 2],
        }));
        // 标注：弹簧系数
        this._springLbl = new Konva.Text({
            x: springCX + 12, y: ty + this._tankH * 0.15,
            text: `k=${this.springK}\nN/m`, fontSize: 8, fill: '#80cbc4', lineHeight: 1.4,
        });

        this._springCX = springCX;
        this._springTopY = ty + 8;
        this._springBotY = ty + this._tankH * 0.45;

        this.group.add(beam, rod, this._rodLine, this._springLbl);
    }

    // ── 浮筒（动态组）───────────────────────
    _drawDisplacerGroup() {
        this._displacerGroup = new Konva.Group();
        const dW = this._tankW * 0.30;
        const dH = this._tankH * 0.38;
        const cx = this._tankX + this._tankW / 2;

        // 浮筒外壳（金属圆柱）
        const body = new Konva.Rect({
            x: -dW/2, y: 0,
            width: dW, height: dH,
            fill: '#bf8500', stroke: '#8a6000', strokeWidth: 1.5, cornerRadius: [2,2,3,3],
        });
        // 顶部封盖
        const topCap = new Konva.Rect({
            x: -dW/2-2, y: -6,
            width: dW+4, height: 8,
            fill: '#ffa000', stroke: '#e65100', strokeWidth: 1, cornerRadius: 2,
        });
        // 浮筒高光
        const glint = new Konva.Rect({
            x: -dW/2+2, y: 2,
            width: 4, height: dH-4,
            fill: 'rgba(255,220,100,0.25)', cornerRadius: 1,
        });
        // 浮筒刻度线（帮助观察浸入深度）
        for (let i = 1; i < 4; i++) {
            this._displacerGroup.add(new Konva.Line({
                points: [-dW/2+2, dH*i/4, -dW/2+dW-2, dH*i/4],
                stroke: 'rgba(255,220,100,0.3)', strokeWidth: 0.8,
            }));
        }
        // 浮筒连杆（顶端连接弹簧底）
        const rod2 = new Konva.Line({
            points: [0, -6, 0, -20],
            stroke: '#ffd54f', strokeWidth: 2.5, lineCap: 'round',
        });
        // 浮筒标注
        this._displacerGroup.add(new Konva.Text({
            x: -dW/2 - 24, y: dH/2 - 6,
            text: '浮\n筒', fontSize: 8, fontStyle: 'bold', fill: '#ffa000', lineHeight: 1.4,
        }));

        this._displacerGroup.add(body, topCap, glint, rod2);
        this._displacerW = dW;
        this._displacerH = dH;

        // 初始位置
        this._displacerBaseY = this._springBotY + 20;
        this._displacerGroup.x(cx);
        this._displacerGroup.y(this._displacerBaseY);

        this.group.add(this._displacerGroup);
    }

    // ── 液体层 ───────────────────────────────
    _drawLiquidLayer() {
        this._liquidRect = new Konva.Rect({
            x: this._innerX, y: this._innerY,
            width: this._innerW, height: 0,
            fill: '#1e88e5', opacity: 0.7,
        });
        this._liquidSurf = new Konva.Rect({
            x: this._innerX, y: this._innerY,
            width: this._innerW, height: 4,
            fill: 'rgba(255,255,255,0.22)',
        });
        this.group.add(this._liquidRect, this._liquidSurf);
    }

    // ── 弹簧动态绘制组 ───────────────────────
    _drawTankDynamic() {
        this._springGroup = new Konva.Group();
        this.group.add(this._springGroup);
    }

    // ── LVDT 差动变压器（中部剖面图）───────
    _drawLVDT() {
        const { _lvdtX: lx, _lvdtY: ly, _lvdtW: lw, _lvdtH: lh } = this;

        // 背景板
        const bg = new Konva.Rect({
            x: lx, y: ly, width: lw, height: lh,
            fill: '#0a1520', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4,
        });
        // 标题
        const titleBg = new Konva.Rect({ x: lx, y: ly, width: lw, height: 16, fill: '#0c1e30', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: lx+2, y: ly+3, width: lw-4, text: 'LVDT 差动变压器', fontSize: 8, fontStyle: 'bold', fill: '#e57373', align: 'center' }));

        const cx = lx + lw / 2;
        const bodyY = ly + 22;
        const bodyH = lh * 0.62;
        const bodyW = lw * 0.62;

        // LVDT 外壳
        const shell = new Konva.Rect({
            x: cx-bodyW/2, y: bodyY, width: bodyW, height: bodyH,
            fill: '#1a2634', stroke: '#37474f', strokeWidth: 1.5, cornerRadius: 3,
        });

        // 初级线圈（中央，橙色）
        const primH = bodyH * 0.28;
        const primY = bodyY + (bodyH - primH) / 2;
        const prim  = new Konva.Rect({
            x: cx-bodyW/2+4, y: primY, width: bodyW-8, height: primH,
            fill: '#8a3a00', stroke: '#e65100', strokeWidth: 1, cornerRadius: 2,
        });
        this.group.add(new Konva.Text({
            x: cx-bodyW/2+4, y: primY+primH/2-5, width: bodyW-8,
            text: '初级\n(励磁)', fontSize: 7, fill: '#ffccbc', align: 'center', lineHeight: 1.3,
        }));

        // 次级线圈 A（上方，蓝色）
        const secH = bodyH * 0.24;
        const secAY = bodyY + 4;
        const secA  = new Konva.Rect({
            x: cx-bodyW/2+4, y: secAY, width: bodyW-8, height: secH,
            fill: '#1a3a6a', stroke: '#1565c0', strokeWidth: 1, cornerRadius: 2,
        });
        this.group.add(new Konva.Text({
            x: cx-bodyW/2+4, y: secAY+secH/2-5, width: bodyW-8,
            text: '次级\nA', fontSize: 7, fill: '#90caf9', align: 'center', lineHeight: 1.3,
        }));

        // 次级线圈 B（下方，绿色）
        const secBY = bodyY + bodyH - secH - 4;
        const secB  = new Konva.Rect({
            x: cx-bodyW/2+4, y: secBY, width: bodyW-8, height: secH,
            fill: '#1a4a2a', stroke: '#2e7d32', strokeWidth: 1, cornerRadius: 2,
        });
        this.group.add(new Konva.Text({
            x: cx-bodyW/2+4, y: secBY+secH/2-5, width: bodyW-8,
            text: '次级\nB', fontSize: 7, fill: '#a5d6a7', align: 'center', lineHeight: 1.3,
        }));

        // 铁芯（动态，随液位上下移动）
        this._coreGroup = new Konva.Group({ x: cx, y: bodyY + bodyH/2 });
        const coreH = bodyH * 0.40;
        const coreW = bodyW * 0.22;
        this._coreRect = new Konva.Rect({
            x: -coreW/2, y: -coreH/2,
            width: coreW, height: coreH,
            fill: '#90a4ae', stroke: '#607d8b', strokeWidth: 1, cornerRadius: 2,
        });
        // 铁芯高光
        this._coreGroup.add(this._coreRect);
        this._coreGroup.add(new Konva.Rect({
            x: -coreW/2+1, y: -coreH/2+2, width: 2, height: coreH-4,
            fill: 'rgba(255,255,255,0.3)', cornerRadius: 1,
        }));
        // 铁芯连杆（穿出LVDT顶底）
        this._coreRodTop = new Konva.Line({ points: [0, -coreH/2, 0, -bodyH/2-2], stroke: '#90a4ae', strokeWidth: 2, lineCap: 'round' });
        this._coreRodBot = new Konva.Line({ points: [0, coreH/2,  0,  bodyH/2+2], stroke: '#90a4ae', strokeWidth: 2, lineCap: 'round' });
        this._coreGroup.add(this._coreRodTop, this._coreRodBot);

        // 磁场线（动态，辉光效果）
        this._fieldLinesGroup = new Konva.Group({ x: cx, y: bodyY + bodyH/2 });

        // 输出引线标注
        const outY = bodyY + bodyH + 8;
        this.group.add(new Konva.Text({ x: cx-bodyW/2+2, y: outY, text: `V_A`, fontSize: 8, fill: '#90caf9' }));
        this.group.add(new Konva.Text({ x: cx-bodyW/2+2, y: outY+10, text: `V_B`, fontSize: 8, fill: '#a5d6a7' }));
        this.group.add(new Konva.Text({ x: cx-bodyW/2+2, y: outY+20, text: `ΔV`, fontSize: 8, fill: '#e57373' }));

        // 实时输出值
        this._vALabel   = new Konva.Text({ x: cx-2, y: outY,    text: '--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#90caf9' });
        this._vBLabel   = new Konva.Text({ x: cx-2, y: outY+10, text: '--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#a5d6a7' });
        this._vOutLabel = new Konva.Text({ x: cx-2, y: outY+20, text: '--', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#e57373' });

        // 铁芯位移显示
        this._coreDispLabel = new Konva.Text({
            x: lx+2, y: ly+lh-20, width: lw-4,
            text: 'x=-- mm', fontSize: 8, fontFamily: 'Courier New, monospace', fill: '#ffd54f', align: 'center',
        });

        this._lvdtCX    = cx;
        this._lvdtBodyY = bodyY;
        this._lvdtBodyH = bodyH;
        this._lvdtBodyW = bodyW;
        this._primY = primY; this._primH = primH;
        this._secAY = secAY; this._secH  = secH;
        this._secBY = secBY;

        this.group.add(bg, titleBg, shell, prim, secA, secB, this._coreGroup, this._fieldLinesGroup, this._vALabel, this._vBLabel, this._vOutLabel, this._coreDispLabel);
    }

    // ── 仪表头 ─────────────────────────────────
    _drawInstrHead() {
        const hx = this._headX, hy = this._headY;
        const hw = this._headW, hh = this._headH;

        const jBox = new Konva.Rect({ x: hx, y: hy, width: hw, height: 44, fill: '#cfd8dc', stroke: '#90a4ae', strokeWidth: 1.5, cornerRadius: [5,5,0,0] });
        for (let i = 0; i < 3; i++) this.group.add(new Konva.Line({ points: [hx, hy+7+i*10, hx+hw, hy+7+i*10], stroke: 'rgba(255,255,255,0.16)', strokeWidth: 0.8 }));
        const plate = new Konva.Rect({ x: hx+8, y: hy+5, width: hw-16, height: 25, fill: '#eceff1', stroke: '#b0bec5', strokeWidth: 0.5, cornerRadius: 2 });
        this._idText = new Konva.Text({ x: hx+8, y: hy+8, width: hw-16, text: this.id || 'LT-901', fontSize: 9, fontStyle: 'bold', fill: '#263238', align: 'center' });
        this.group.add(new Konva.Text({ x: hx+8, y: hy+19, width: hw-16, text: 'DISPLACER  LVDT', fontSize: 7, fill: '#78909c', align: 'center' }));
        const lcap = new Konva.Rect({ x: hx,    y: hy+4, width: 10, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [2,0,0,2] });
        const rcap = new Konva.Rect({ x: hx+hw-10, y: hy+4, width: 10, height: 38, fill: '#b0bec5', stroke: '#78909c', strokeWidth: 1, cornerRadius: [0,2,2,0] });

        const body = new Konva.Rect({ x: hx, y: hy+44, width: hw, height: hh-44, fill: '#1e2a36', stroke: '#0d1520', strokeWidth: 1.5, cornerRadius: [0,0,4,4] });
        this.group.add(jBox, plate, lcap, rcap, this._idText, body);
    }

    // ── 圆形 LCD ──────────────────────────────
    _drawLCD() {
        const hx = this._headX, hw = this._headW;
        const lcy = this._headY + 44 + (this._headH - 44) * 0.48;
        const lcx = hx + hw / 2;
        const R   = Math.min(hw * 0.40, 42);
        this._lcCX = lcx; this._lcCY = lcy; this._lcR = R;

        this.group.add(new Konva.Circle({ x: lcx, y: lcy, radius: R+4, fill: '#0d1520', stroke: '#1a252f', strokeWidth: 1 }));
        const ring = new Konva.Circle({ x: lcx, y: lcy, radius: R+2, fill: '#8a3a00', stroke: '#bf360c', strokeWidth: 2.5 });
        this._lcdBg = new Konva.Circle({ x: lcx, y: lcy, radius: R, fill: '#020c14' });

        this._lvArc = new Konva.Arc({ x: lcx, y: lcy, innerRadius: R-5, outerRadius: R-3, angle: 0, fill: '#ef9a9a', rotation: -90 });

        this._lcdMain    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.36, width:(R-4)*2, text:'--.-', fontSize:R*.37, fontFamily:'Courier New, monospace', fontStyle:'bold', fill:'#ef9a9a', align:'center' });
        this._lcdUnit    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.08, width:(R-4)*2, text:'%',    fontSize:R*.18, fill:'#8a3a00', align:'center' });
        this._lcdBuoy    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.30, width:(R-4)*2, text:'F=-- N',fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#37474f', align:'center' });
        this._lcdCurr    = new Konva.Text({ x: lcx-R+4, y: lcy-R*.57, width:(R-4)*2, text:'4.00 mA',fontSize:R*.13, fontFamily:'Courier New, monospace', fill:'#80cbc4', align:'center' });
        this._lcdDisp    = new Konva.Text({ x: lcx-R+4, y: lcy+R*.48, width:(R-4)*2, text:'x=-- mm',fontSize:R*.12, fontFamily:'Courier New, monospace', fill:'#263238', align:'center' });

        this.group.add(ring, this._lcdBg, this._lvArc, this._lcdMain, this._lcdUnit, this._lcdBuoy, this._lcdCurr, this._lcdDisp);
    }

    // ── 旋钮 ───────────────────────────────────
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
                const mv = me => { const cy = me.clientY ?? me.touches?.[0]?.clientY ?? 0; rotor.rotation(sr+(sy-cy)*2); if(k.id==='zero') this.zeroAdj=(rotor.rotation()/360)*0.05; else this.spanAdj=1+(rotor.rotation()/360)*0.3; };
                const up = () => { window.removeEventListener('mousemove',mv); window.removeEventListener('touchmove',mv); window.removeEventListener('mouseup',up); window.removeEventListener('touchend',up); };
                window.addEventListener('mousemove',mv); window.addEventListener('touchmove',mv);
                window.addEventListener('mouseup',up); window.addEventListener('touchend',up);
            });
            this.group.add(g);
        });
    }

    // ── 波形示波器（三路信号）────────────────
    _drawWaveform() {
        const { _oscX: ox, _oscY: oy, _oscW: ow, _oscH: oh } = this;

        const bg = new Konva.Rect({ x: ox, y: oy, width: ow, height: oh, fill: '#020c14', stroke: '#1a3040', strokeWidth: 1.5, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: ox, y: oy, width: ow, height: 14, fill: '#0c1a2e', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: ox+4, y: oy+2, width: ow-8, text: 'LVDT 输出信号  ── V_A  ── V_B  ── ΔV=V_A−V_B', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a', align: 'center' }));

        // 网格
        for (let i = 1; i < 3; i++) this.group.add(new Konva.Line({ points: [ox, oy+oh*i/3, ox+ow, oy+oh*i/3], stroke: 'rgba(239,154,154,0.07)', strokeWidth: 0.5 }));
        for (let i = 1; i < 5; i++) this.group.add(new Konva.Line({ points: [ox+ow*i/5, oy, ox+ow*i/5, oy+oh], stroke: 'rgba(239,154,154,0.05)', strokeWidth: 0.5 }));

        // 三条基准中线
        this._wMidA = oy + oh * 0.20;
        this._wMidB = oy + oh * 0.52;
        this._wMidD = oy + oh * 0.84;
        [this._wMidA, this._wMidB, this._wMidD].forEach(my => {
            this.group.add(new Konva.Line({ points: [ox+2, my, ox+ow-2, my], stroke: 'rgba(200,200,200,0.1)', strokeWidth: 0.5, dash: [4,3] }));
        });

        this._wLineA  = new Konva.Line({ points: [], stroke: '#90caf9', strokeWidth: 1.4, lineJoin: 'round' });
        this._wLineB  = new Konva.Line({ points: [], stroke: '#a5d6a7', strokeWidth: 1.4, lineJoin: 'round' });
        this._wLineD  = new Konva.Line({ points: [], stroke: '#ef9a9a', strokeWidth: 1.8, lineJoin: 'round' });

        const lblY = oy + 16;
        this._wLblA = new Konva.Text({ x: ox+4, y: lblY,    text: 'V_A=-- V', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#90caf9' });
        this._wLblB = new Konva.Text({ x: ox+4, y: lblY+10, text: 'V_B=-- V', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#a5d6a7' });
        this._wLblD = new Konva.Text({ x: ox+4, y: lblY+20, text: 'ΔV=-- V',  fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#ef9a9a' });

        this.group.add(bg, titleBg, this._wLineA, this._wLineB, this._wLineD, this._wLblA, this._wLblB, this._wLblD);
    }

    // ── 拖拽 ───────────────────────────────────
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
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
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
                this._tickSpring();
                this._tickDisplacer();
                this._tickLVDT(dt);
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
        const lvRatio  = this.liquidLevel / 100;
        const dLen     = this.displacerLen;
        const dArea    = this.displacerArea;

        // 浮筒浸入深度（取决于液位与浮筒位置的关系）
        const H_sub = Math.max(0, Math.min(dLen, lvRatio * dLen));

        // 浮力
        this.buoyancy = this.liquidDensity * 9.81 * dArea * H_sub;

        // 弹簧平衡位移
        const W = this.displacerWeight * 9.81;
        const rawSpring = (W - this.buoyancy) / this.springK;  // 弹簧拉伸量
        this.springDisplace = Math.max(0, rawSpring);

        // LVDT 铁芯位移（液位↑ → 浮力↑ → 弹簧拉力↓ → 铁芯上移）
        const lvdtNominal = (this.lvdtRange * 2);
        this.lvdtCore = (lvRatio * 2 - 1) * this.lvdtRange;  // -range ~ +range

        // LVDT 次级电压（励磁幅度 × 耦合系数）
        const excAmp   = this.powered && !this.isBreak ? 10 : 0;  // 励磁幅度 V
        const coreNorm = this.lvdtCore / this.lvdtRange;           // -1 ~ +1
        // V_A: 铁芯靠近A时大，远离时小
        const kA = 0.5 + coreNorm * 0.5;  // 0~1
        const kB = 0.5 - coreNorm * 0.5;  // 1~0
        this.vA  = excAmp * kA;
        this.vB  = excAmp * kB;
        this.vOut = this.vA - this.vB;

        // 输出电流
        const adjLv = Math.max(0, Math.min(100, (this.liquidLevel + this.zeroAdj*100)*this.spanAdj));
        this.outCurrent = 4 + adjLv/100 * 16;
        if (this.isBreak) this.outCurrent = 1.8;
        if (!this.powered) this.outCurrent = 0;

        this.alarmHi = this.liquidLevel > this.hiAlarm;
        this.alarmLo = this.liquidLevel < this.loAlarm;

        if (this._lvArc) this._lvArc.angle(Math.min(360, lvRatio * 360));

        // 励磁相位
        this._excPhase += this._excFreq * dt * 2 * Math.PI * 0.02;  // 视觉减速
    }

    // ── 储罐液面 ──────────────────────────────
    _tickTankVisual() {
        const ih  = this._innerH;
        const liqH   = Math.max(0, (this.liquidLevel/100) * ih);
        const liqTop = this._innerY + ih - liqH;

        this._liquidRect.y(liqTop);
        this._liquidRect.height(liqH);
        this._liquidSurf.y(liqTop);

        const fr = this.liquidLevel / 100;
        this._liquidRect.fill(`rgba(${Math.round(20+fr*15)},${Math.round(100+fr*50)},${Math.round(210+fr*20)},0.7)`);
        this._hiLine.stroke(this.alarmHi ? '#ef5350' : 'rgba(239,83,80,0.35)');
        this._loLine.stroke(this.alarmLo ? '#ff9800' : 'rgba(255,152,0,0.35)');
        this._innerCav.fill(`rgb(${Math.round(18+fr*6)},${Math.round(28+fr*22)},${Math.round(42+fr*30)})`);
    }

    // ── 弹簧动画（锯齿形弹簧） ───────────────
    _tickSpring() {
        this._springGroup.destroyChildren();

        const cx   = this._springCX;
        const topY = this._springTopY;
        // 弹簧底端随浮筒上下移动
        const dispOffset = (this.liquidLevel / 100 - 0.5) * 18;
        const botY = this._springBotY - dispOffset;

        const n    = this._springCoils;
        const amp  = 9;    // 弹簧振幅（水平）
        const pts  = [cx, topY];

        for (let i = 0; i < n * 2; i++) {
            const y  = topY + ((botY - topY) * (i + 1)) / (n * 2 + 1);
            const dx = (i % 2 === 0) ? amp : -amp;
            pts.push(cx + dx, y);
        }
        pts.push(cx, botY);

        const spring = new Konva.Line({
            points: pts, stroke: '#80cbc4', strokeWidth: 2,
            lineCap: 'round', lineJoin: 'round',
        });
        // 弹簧应力颜色（压缩↑→红，拉伸↑→蓝）
        const stress = (this.liquidLevel / 100 - 0.5) * 2;
        const r = Math.round(128 + stress * 80);
        const b = Math.round(180 - stress * 80);
        spring.stroke(`rgb(${r},180,${b})`);

        // 弹簧底端连接节点
        const node = new Konva.Circle({ x: cx, y: botY, radius: 4, fill: '#ffd54f', stroke: '#ff8f00', strokeWidth: 1 });

        // 位移标注线
        const midSpringY = (topY + botY) / 2;

        this._springGroup.add(spring, node);

        // 更新传动杆位置
        if (this._rodLine) {
            this._rodLine.points([cx, botY, cx, this._tankY + this._tankH - 14]);
        }
    }

    // ── 浮筒位置更新 ──────────────────────────
    _tickDisplacer() {
        if (!this._displacerGroup) return;
        // 液位↑ → 浮筒受更大浮力 → 弹簧拉伸少 → 浮筒上移
        const offset = (this.liquidLevel / 100 - 0.5) * 18;
        this._displacerGroup.y(this._displacerBaseY - offset);
    }

    // ── LVDT 铁芯动画 ─────────────────────────
    _tickLVDT(dt) {
        const isActive = this.powered && !this.isBreak;

        // 铁芯位置（液位↑ → 铁芯上移）
        const maxCoreShift = this._lvdtBodyH * 0.28;
        const coreShift    = (this.liquidLevel / 100 - 0.5) * maxCoreShift * 2;
        if (this._coreGroup) this._coreGroup.y(this._lvdtBodyY + this._lvdtBodyH/2 - coreShift);

        // 铁芯颜色随励磁闪烁
        if (this._coreRect && isActive) {
            const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this._excPhase * 0.3));
            this._coreRect.fill(`rgba(${Math.round(130+pulse*30)},${Math.round(150+pulse*20)},${Math.round(165+pulse*15)},1)`);
        } else if (this._coreRect) {
            this._coreRect.fill('#546e7a');
        }

        // 重绘磁场线
        this._fieldLinesGroup.destroyChildren();
        if (isActive) {
            const bH = this._lvdtBodyH;
            const bW = this._lvdtBodyW;
            for (let i = 0; i < 6; i++) {
                const yOff = (i / 5 - 0.5) * bH * 0.55;
                const t    = this._excPhase + i * 0.5;
                const amp2  = 4 + 2 * Math.sin(t);
                const alpha = 0.12 + 0.18 * Math.abs(Math.sin(t));
                this._fieldLinesGroup.add(new Konva.Arc({
                    x: 0, y: yOff,
                    innerRadius: amp2,
                    outerRadius: amp2 + 1.5,
                    angle: 300,
                    rotation: t * 30 % 360,
                    fill: `rgba(229,115,115,${alpha})`,
                }));
            }
        }

        // 更新标签
        const coreDisp_mm = (this.lvdtCore * 1000).toFixed(2);
        if (this._coreDispLabel) this._coreDispLabel.text(isActive ? `x=${coreDisp_mm} mm` : 'x=-- mm');
        if (this._vALabel) this._vALabel.text(isActive ? `${this.vA.toFixed(2)}V` : '--');
        if (this._vBLabel) this._vBLabel.text(isActive ? `${this.vB.toFixed(2)}V` : '--');
        if (this._vOutLabel) this._vOutLabel.text(isActive ? `${this.vOut.toFixed(2)}V` : '--');
    }

    // ── 三路波形 ──────────────────────────────
    _tickWaveform(dt) {
        const isActive = this.powered && !this.isBreak;
        const excFreqVis = 4.0;  // 视觉波形频率（rad/frame）

        const scrollSpeed = isActive ? 1.5 : 0;
        this._waveAcc += scrollSpeed * dt * this._waveLen;
        const steps = Math.floor(this._waveAcc);
        this._waveAcc -= steps;

        const carrier = Math.sin(this._excPhase);

        for (let i = 0; i < steps; i++) {
            const sigA = isActive ? this.vA * carrier : 0;
            const sigB = isActive ? this.vB * carrier : 0;
            const sigD = isActive ? this.vOut * carrier : 0;
            this._waveBufA = new Float32Array([...this._waveBufA.slice(1), sigA]);
            this._waveBufB = new Float32Array([...this._waveBufB.slice(1), sigB]);
            this._waveBufD = new Float32Array([...this._waveBufD.slice(1), sigD]);
        }

        const ox = this._oscX+3, ow = this._oscW-6;
        const n  = this._waveLen, dx = ow / n;
        const ampA = this._oscH * 0.09;
        const ampB = ampA;
        const ampD = this._oscH * 0.09;

        const buildPts = (buf, midY, amp) => {
            const pts = [];
            for (let i = 0; i < n; i++) pts.push(ox + i*dx, midY - buf[i] * amp);
            return pts;
        };

        if (this._wLineA) this._wLineA.points(buildPts(this._waveBufA, this._wMidA, ampA));
        if (this._wLineB) this._wLineB.points(buildPts(this._waveBufB, this._wMidB, ampB));
        if (this._wLineD) this._wLineD.points(buildPts(this._waveBufD, this._wMidD, ampD));

        if (this._wLblA) this._wLblA.text(isActive ? `V_A=${this.vA.toFixed(2)} V` : 'V_A=-- V');
        if (this._wLblB) this._wLblB.text(isActive ? `V_B=${this.vB.toFixed(2)} V` : 'V_B=-- V');
        if (this._wLblD) this._wLblD.text(isActive ? `ΔV=${this.vOut.toFixed(2)} V` : 'ΔV=-- V');
    }

    // ── 显示刷新 ──────────────────────────────
    _tickDisplay() {
        const pw = this.powered, br = this.isBreak;
        const lv = this.liquidLevel;

        if (!pw) {
            this._lcdMain.text('----'); this._lcdMain.fill('#0d2030');
            this._lcdUnit.text(''); this._lcdBuoy.text(''); this._lcdDisp.text('');
            this._lcdCurr.text('-- mA');
            return;
        }
        if (br) {
            this._lcdMain.text('FAIL'); this._lcdMain.fill('#ef5350');
            this._lcdCurr.text('1.8 mA'); this._lcdBg.fill('#1a0808');
            return;
        }

        const adjLv   = Math.max(0, Math.min(100, (lv + this.zeroAdj*100)*this.spanAdj));
        const lvColor = this.alarmHi ? '#ff5722' : this.alarmLo ? '#ffa726' : '#ef9a9a';

        this._lcdBg.fill('#020c14');
        this._lcdMain.text(adjLv.toFixed(1)); this._lcdMain.fill(lvColor);
        this._lcdUnit.text('%');
        this._lcdBuoy.text(`F=${this.buoyancy.toFixed(2)} N`);
        this._lcdCurr.text(`${this.outCurrent.toFixed(2)} mA`);
        this._lcdDisp.text(`x=${(this.lvdtCore*1000).toFixed(2)} mm`);
    }

    // ═════════════════════════════════════════════
    //  外部接口
    // ═════════════════════════════════════════════
    update(level) {
        if (typeof level === 'number') this.liquidLevel = Math.max(0, Math.min(100, level));
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'id',                type: 'text'   },
            { label: '浮筒有效长度 (m)',     key: 'displacerLen',      type: 'number' },
            { label: '浮筒截面积 (m²)',      key: 'displacerArea',     type: 'number' },
            { label: '浮筒重量 (kg)',        key: 'displacerWeight',   type: 'number' },
            { label: '弹簧系数 k (N/m)',     key: 'springK',           type: 'number' },
            { label: '液体密度 (kg/m³)',     key: 'liquidDensity',     type: 'number' },
            { label: 'LVDT 量程 (m)',        key: 'lvdtRange',         type: 'number' },
            { label: '高报阈值 (%)',         key: 'hiAlarm',           type: 'number' },
            { label: '低报阈值 (%)',         key: 'loAlarm',           type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id               = cfg.id                 || this.id;
        this.displacerLen     = parseFloat(cfg.displacerLen)     || this.displacerLen;
        this.displacerArea    = parseFloat(cfg.displacerArea)    || this.displacerArea;
        this.displacerWeight  = parseFloat(cfg.displacerWeight)  || this.displacerWeight;
        this.springK          = parseFloat(cfg.springK)          || this.springK;
        this.liquidDensity    = parseFloat(cfg.liquidDensity)    || this.liquidDensity;
        this.lvdtRange        = parseFloat(cfg.lvdtRange)        || this.lvdtRange;
        this.hiAlarm          = parseFloat(cfg.hiAlarm)          ?? this.hiAlarm;
        this.loAlarm          = parseFloat(cfg.loAlarm)          ?? this.loAlarm;
        this.config           = { ...this.config, ...cfg };
        if (this._idText) this._idText.text(this.id);
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}