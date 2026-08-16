import { BaseComponent } from './BaseComponent.js';

/**
 * 三位四通电磁换向阀仿真组件
 * （4/3-Way Solenoid Directional Control Valve）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  三位四通换向阀是液压/气动系统中最常见的方向控制元件，
 *  由以下部分组成：
 *
 *  1. 阀体（Valve Body）：矩形金属主体，内含四条流道
 *     - P 口（Pressure）：压力油进口，阀体底部中央
 *     - T 口（Tank）：    回油口，阀体底部两侧
 *     - A 口（Work A）：  工作口 A，阀体顶部左侧
 *     - B 口（Work B）：  工作口 B，阀体顶部右侧
 *
 *  2. 阀芯（Spool）：在阀体孔内左右滑动的精密圆柱滑块
 *     - 阀芯上有若干凸肩（Land）和凹槽（Groove），
 *       通过位置决定各口之间的连通关系
 *
 *  3. 左电磁铁（Solenoid A / YVa）：推动阀芯向右切换至左位
 *  4. 右电磁铁（Solenoid B / YVb）：推动阀芯向左切换至右位
 *  5. 对中弹簧（Centering Springs）：两端各一根，断电时将阀芯复中位
 *
 * ── 三个工作位（机能）──────────────────────────────────────
 *
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  左 位（Left Position）：YVa 通电，YVb 断电              │
 *  │    P → B，A → T  （油缸活塞杆伸出）                     │
 *  │  中 位（Center Position）：两线圈均断电（弹簧对中）      │
 *  │    P 封闭，A 封闭，B 封闭，T 封闭  （O 型机能）         │
 *  │  右 位（Right Position）：YVb 通电，YVa 断电             │
 *  │    P → A，B → T  （油缸活塞杆缩回）                     │
 *  └──────────────────────────────────────────────────────────┘
 *
 * ── 图形表示 ──────────────────────────────────────────────────
 *
 *  按 ISO 1219 液压符号标准，换向阀用方格符号表示：
 *
 *       YVa ▶│◀ YVb
 *       ═══╦═╩═╦═══
 *       左位│中位│右位
 *
 *  本组件采用正视图（Front View）实物仿真绘制，展现：
 *    - 阀体截面和四个管口
 *    - 阀芯位置（左/中/右）及凸肩、凹槽
 *    - 内部流道连通状态（彩色流道高亮）
 *    - 两端电磁铁线圈及弹簧
 *    - 流体粒子动画
 *    - ISO 符号辅助图（阀体下方）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_p  — P 口（压力进口，底部中央）
 *  port_t1 — T1 口（左回油口，底部左侧）
 *  port_t2 — T2 口（右回油口，底部右侧）
 *  port_a  — A 口（工作口 A，顶部左侧）
 *  port_b  — B 口（工作口 B，顶部右侧）
 *  coil_a  — YVa 线圈供电端（左端子）
 *  coil_b  — YVb 线圈供电端（右端子）
 */
export class DirectionalValve43 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(280, config.width  || 340);
        this.height = Math.max(200, config.height || 240);

        this.type    = 'directional_valve_4_3';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedVoltage  = config.ratedVoltage  || 24;      // V
        this.ratedPressure = config.ratedPressure || 20.0;    // MPa
        this.ratedFlow     = config.ratedFlow     || 60;      // L/min
        this.medium        = config.medium        || '液压油';
        this.label         = config.label         || 'YV';
        this.centerFunc    = config.centerFunc    || 'O';     // 中位机能：O/H/Y/P/M

        // ── 阀位状态 ──
        // position: 'left' | 'center' | 'right'
        this._position    = 'center';
        this._animating   = false;
        this._animT       = 0;
        this._animFrom    = 'center';
        this._animTo      = 'center';
        this._animDur     = 0.18;          // s
        this._spoolX      = 0;            // 阀芯偏移量，−1=全左，0=中，+1=全右（归一化）
        this._flowPhase   = 0;
        this._coilAOn     = false;
        this._coilBOn     = false;
        this.opsCount     = config.initOps || 0;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 阀体主矩形（中央大块）
        this._body = {
            x: W * 0.18, y: H * 0.22,
            w: W * 0.64, h: H * 0.44,
            rx: 4,
        };

        // 阀芯孔（阀体内横向通孔）
        this._bore = {
            x: this._body.x + this._body.w * 0.04,
            y: this._body.y + this._body.h * 0.30,
            w: this._body.w * 0.92,
            h: this._body.h * 0.40,
        };

        // 阀芯总长 = 孔宽 × 0.76，阀芯最大偏移 = (孔宽 - 芯长) / 2
        this._spoolLen    = this._bore.w * 0.76;
        this._spoolMaxOff = (this._bore.w - this._spoolLen) / 2;   // px，单侧最大偏移

        // 左/右电磁铁壳
        const solenoidH = this._body.h * 0.80;
        const solenoidW = W * 0.15;
        this._solA = {   // 左端（YVa）
            x: this._body.x - solenoidW - W * 0.01,
            y: this._body.y + (this._body.h - solenoidH) / 2,
            w: solenoidW, h: solenoidH, rx: 3,
        };
        this._solB = {   // 右端（YVb）
            x: this._body.x + this._body.w + W * 0.01,
            y: this._body.y + (this._body.h - solenoidH) / 2,
            w: solenoidW, h: solenoidH, rx: 3,
        };

        // 四个管口（管颈尺寸）
        const neckW = W * 0.055, neckH = H * 0.13;
        const bodyMidY_top = this._body.y;
        const bodyMidY_bot = this._body.y + this._body.h;

        this._portA = { x: W * 0.295, y: bodyMidY_top - neckH, w: neckW, h: neckH };
        this._portB = { x: W * 0.645, y: bodyMidY_top - neckH, w: neckW, h: neckH };
        this._portP = { x: W * 0.470, y: bodyMidY_bot, w: neckW, h: neckH };
        this._portT1 = { x: W * 0.245, y: bodyMidY_bot, w: neckW, h: neckH };
        this._portT2 = { x: W * 0.695, y: bodyMidY_bot, w: neckW, h: neckH };

        // 各口在阀体内的"接入点"X 坐标（用于流道绘制）
        this._portAx  = this._portA.x  + neckW / 2;
        this._portBx  = this._portB.x  + neckW / 2;
        this._portPx  = this._portP.x  + neckW / 2;
        this._portT1x = this._portT1.x + neckW / 2;
        this._portT2x = this._portT2.x + neckW / 2;


        this._init();

        // ── 流体端口 ──
        this.addPort(this._portA.x  + neckW/2, this._portA.y,             'port_a',  'pipe', 'A');
        this.addPort(this._portB.x  + neckW/2, this._portB.y,             'port_b',  'pipe', 'B');
        this.addPort(this._portP.x  + neckW/2, this._portP.y + neckH,     'port_p',  'pipe', 'P');
        this.addPort(this._portT1.x + neckW/2, this._portT1.y + neckH,    'port_t1', 'pipe', 'T1');
        this.addPort(this._portT2.x + neckW/2, this._portT2.y + neckH,    'port_t2', 'pipe', 'T2');
        // ── 电气端口（线圈顶部中央）──
        this.addPort(
            this._solA.x + this._solA.w / 2,
            this._solA.y - 2,
            'coil_a', 'wire', 'YVa'
        );
        this.addPort(
            this._solB.x + this._solB.w / 2,
            this._solB.y - 2,
            'coil_b', 'wire', 'YVb'
        );
    }

    // ═══════════════════════════════════════════════
    _init() {
        this._drawBodyBase();
        this._drawPorts();
        this._drawSolenoidCases();
        this._drawIsoSymbol();
        this._drawLabel();
        this._drawDynamicLayer();   // 阀芯 + 弹簧 + 磁场 + 流道 + 粒子
        this._drawStatusIndicator();
        this._drawPortLabels();
        
    }

    // ── 阀体底座 ──────────────────────────────────
    _drawBodyBase() {
        const b = this._body;
        // 主体
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#72727a',
                0.25,'#909098',
                0.55,'#9e9ea8',
                1,   '#5a5a62',
            ],
            stroke: '#38383e', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.38,
        }));
        // 顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 2,
            width: b.w - 6, height: b.h * 0.16,
            fill: 'rgba(255,255,255,0.10)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 底面暗影
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y + b.h * 0.82,
            width: b.w, height: b.h * 0.18,
            fill: 'rgba(0,0,0,0.20)',
            cornerRadius: [0, 0, b.rx, b.rx],
        }));
        // 阀体侧面装饰螺栓
        const boltY = b.y + b.h / 2;
        [b.x + b.w * 0.06, b.x + b.w * 0.94].forEach(bx => {
            const r = this.width * 0.018;
            this._staticGroup.add(new Konva.Circle({ x: bx, y: boltY, radius: r, fill: '#777', stroke: '#444', strokeWidth: 0.8 }));
            this._staticGroup.add(new Konva.Line({ points: [bx-r*0.65,boltY, bx+r*0.65,boltY], stroke:'#444', strokeWidth:1.0, lineCap:'round' }));
            this._staticGroup.add(new Konva.Line({ points: [bx,boltY-r*0.65, bx,boltY+r*0.65], stroke:'#444', strokeWidth:1.0, lineCap:'round' }));
        });
        // 阀孔背景（镗孔内腔）
        const bo = this._bore;
        this._staticGroup.add(new Konva.Rect({
            x: bo.x, y: bo.y, width: bo.w, height: bo.h,
            fill: '#1a1a22', stroke: '#2a2a32', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
    }

    // ── 五个管口（管颈 + 法兰）────────────────────
    _drawPorts() {
        const ports = [
            { p: this._portA,  dir: 'top',    color: '#c8a840' },   // A：顶部，黄色
            { p: this._portB,  dir: 'top',    color: '#4090d8' },   // B：顶部，蓝色
            { p: this._portP,  dir: 'bottom', color: '#d03030' },   // P：底部，红色
            { p: this._portT1, dir: 'bottom', color: '#506070' },   // T1：底部，灰色
            { p: this._portT2, dir: 'bottom', color: '#506070' },   // T2：底部，灰色
        ];
        ports.forEach(({ p, dir, color }) => {
            const isTop = dir === 'top';
            const cr    = isTop ? [3, 3, 0, 0] : [0, 0, 3, 3];
            // 管颈主体（金属灰渐变）
            this._staticGroup.add(new Konva.Rect({
                x: p.x, y: p.y, width: p.w, height: p.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: p.w, y: 0 },
                fillLinearGradientColorStops: [0,'#585858',0.4,'#ababab',0.7,'#c0c0c0',1,'#585858'],
                stroke: '#3a3a3a', strokeWidth: 1,
                cornerRadius: cr,
            }));
            // 管颈内腔
            this._staticGroup.add(new Konva.Rect({
                x: p.x + p.w*0.22, y: p.y + p.h*0.12,
                width: p.w*0.56, height: p.h*0.76,
                fill: '#0e0e18', cornerRadius: 2,
            }));
            // 端口色标环（区分 PABT）
            const ringY = isTop ? p.y : p.y + p.h - p.h*0.14;
            this._staticGroup.add(new Konva.Rect({
                x: p.x + p.w*0.08, y: ringY,
                width: p.w*0.84, height: p.h*0.14,
                fill: color, cornerRadius: isTop ? [3,3,0,0] : [0,0,3,3],
            }));
        });
    }

    // ── 两端电磁铁壳体 ───────────────────────────
    _drawSolenoidCases() {
        [
            { s: this._solA, label: 'YVa', side: 'left'  },
            { s: this._solB, label: 'YVb', side: 'right' },
        ].forEach(({ s, label, side }) => {
            // 外壳主体（黑色工程塑料）
            this._staticGroup.add(new Konva.Rect({
                x: s.x, y: s.y, width: s.w, height: s.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: s.w, y: 0 },
                fillLinearGradientColorStops: side === 'left'
                    ? [0,'#1a1a22',0.45,'#38383e',1,'#28282e']
                    : [0,'#28282e',0.55,'#38383e',1,'#1a1a22'],
                stroke: '#111', strokeWidth: 1.2,
                cornerRadius: side === 'left' ? [s.rx, 0, 0, s.rx] : [0, s.rx, s.rx, 0],
                shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.3,
            }));
            // 顶面高光
            this._staticGroup.add(new Konva.Rect({
                x: s.x + 1, y: s.y + 2,
                width: s.w - 2, height: s.h * 0.12,
                fill: 'rgba(255,255,255,0.07)',
                cornerRadius: side === 'left' ? [s.rx,0,0,0] : [0,s.rx,0,0],
            }));
            // 铭牌
            this._staticGroup.add(new Konva.Rect({
                x: s.x + s.w*0.10, y: s.y + s.h*0.18,
                width: s.w*0.80, height: s.h*0.20,
                fill: '#12121a', stroke: '#2a2a30', strokeWidth: 0.5, cornerRadius: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: s.x + s.w*0.10, y: s.y + s.h*0.21,
                width: s.w*0.80, text: label,
                fontSize: 7, fontStyle: 'bold', fill: '#aaa', align: 'center',
            }));
            // 线圈绕组截面（竖向铜线条纹）
            const wY = s.y + s.h * 0.44, wH = s.h * 0.44;
            const wX = s.x + s.w * 0.12, wW = s.w * 0.76;
            this._staticGroup.add(new Konva.Rect({ x: wX, y: wY, width: wW, height: wH, fill: '#120e0a', stroke: '#2a2218', strokeWidth: 0.5, cornerRadius: 2 }));
            for (let i = 0; i < 6; i++) {
                const lx = wX + wW * (i + 0.5) / 6;
                this._staticGroup.add(new Konva.Line({
                    points: [lx, wY+2, lx, wY+wH-2],
                    stroke: `rgba(${170+i*8},${95+i*5},28,0.55)`,
                    strokeWidth: 1.4,
                }));
            }
            // 推杆孔（对准阀孔一侧）
            const plugY = s.y + s.h * 0.44 + s.h * 0.44 / 2;
            const plugX = side === 'left' ? s.x + s.w - 2 : s.x + 2;
            this._staticGroup.add(new Konva.Circle({
                x: plugX, y: plugY,
                radius: this._bore.h * 0.28,
                fill: '#0a0a10', stroke: '#1e1e26', strokeWidth: 0.8,
            }));
        });
    }

    // ── ISO 1219 符号（阀体下方辅助图）────────────
    _drawIsoSymbol() {
        const W = this.width, H = this.height;
        const sx = W * 0.20, sy = H * 0.80;
        const bw = W * 0.60 / 3; // 每格宽
        const bh = H * 0.13;

        // 三格外框
        for (let i = 0; i < 3; i++) {
            this._staticGroup.add(new Konva.Rect({
                x: sx + i*bw, y: sy, width: bw, height: bh,
                fill: i === 1 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                stroke: '#556', strokeWidth: 0.8,
            }));
        }

        // 在每格内画流道箭头（简化 ISO 符号）
        const drawArrow = (cx, cy, from, to, color) => {
            const len = bh * 0.28;
            // 各口位置（相对格子中心）
            const dirs = {
                P: [0,  bh*0.40], T: [0, -bh*0.40],
                A: [-bw*0.28, 0], B: [bw*0.28, 0],
                block: null,
            };
            if (from === 'block' || to === 'block') return;
            const f = dirs[from], t = dirs[to];
            if (!f || !t) return;
            this._staticGroup.add(new Konva.Arrow({
                x: cx, y: cy,
                points: [f[0], f[1], t[0], t[1]],
                stroke: color, strokeWidth: 1.2,
                fill: color,
                pointerLength: 4, pointerWidth: 3,
            }));
        };

        // 左位：P→B, A→T
        const lcx = sx + bw * 0.5, mcy = sy + bh / 2;
        drawArrow(lcx, mcy, 'P', 'B', '#d03030');
        drawArrow(lcx, mcy, 'A', 'T', '#c8a840');

        // 中位（O型）：封闭 → 画×
        const mcx = sx + bw * 1.5;
        [[-bw*0.12,-bh*0.12],[bw*0.12,bh*0.12],
         [bw*0.12,-bh*0.12],[-bw*0.12,bh*0.12]].forEach((pt, i) => {
            if (i % 2 === 0) return;
            this._staticGroup.add(new Konva.Line({
                points: [-bw*0.12 + mcx, -bh*0.12 + mcy, bw*0.12 + mcx, bh*0.12 + mcy],
                stroke: '#777', strokeWidth: 1,
            }));
        });
        this._staticGroup.add(new Konva.Line({ points: [mcx-bw*0.13,mcy-bh*0.13, mcx+bw*0.13,mcy+bh*0.13], stroke:'#777', strokeWidth:1 }));
        this._staticGroup.add(new Konva.Line({ points: [mcx+bw*0.13,mcy-bh*0.13, mcx-bw*0.13,mcy+bh*0.13], stroke:'#777', strokeWidth:1 }));

        // 右位：P→A, B→T
        const rcx = sx + bw * 2.5;
        drawArrow(rcx, mcy, 'P', 'A', '#d03030');
        drawArrow(rcx, mcy, 'B', 'T', '#4090d8');

        // 外框边线（三格合并外框）
        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: bw*3, height: bh,
            stroke: '#667', strokeWidth: 1.2, fill: 'transparent',
        }));

        // 弹簧符号（两端）
        const springSymbol = (ox, oy, dir) => {
            const pts = [];
            for (let i = 0; i <= 8; i++) {
                pts.push(ox + (dir * i * bw * 0.040), oy + (i % 2 === 0 ? 0 : bh * 0.35));
            }
            this._staticGroup.add(new Konva.Line({ points: pts, stroke: '#889', strokeWidth: 0.8, lineJoin: 'round' }));
        };
        springSymbol(sx - bw*0.36, sy + bh*0.32, 1);
        springSymbol(sx + bw*3 + bw*0.02, sy + bh*0.32, 1);

        // 电磁铁符号（最外侧）
        const electMagnet = (ox, oy) => {
            this._staticGroup.add(new Konva.Rect({ x: ox, y: oy, width: bw*0.30, height: bh*0.55, stroke:'#557', strokeWidth:0.8, fill:'rgba(60,80,140,0.15)', cornerRadius:1 }));
            this._staticGroup.add(new Konva.Line({ points:[ox+bw*0.15,oy-bh*0.10, ox+bw*0.15,oy], stroke:'#779', strokeWidth:0.9 }));
        };
        electMagnet(sx - bw*0.72, sy + bh*0.22);
        electMagnet(sx + bw*3 + bw*0.41, sy + bh*0.22);

        // 各口字母
        const portLabelY = sy + bh + 3;
        const portLabelStyle = { fontSize: 7, fontStyle: 'bold', fill: '#7a8a9a' };
        [
            { text: 'A', x: sx + bw*0.42 },
            { text: 'B', x: sx + bw*0.90 },
            { text: 'P', x: sx + bw*1.42 },
            { text: 'T', x: sx + bw*2.42 },
        ].forEach(({ text, x }) => {
            this._staticGroup.add(new Konva.Text({ x, y: portLabelY, text, ...portLabelStyle }));
        });
    }

    // ── 标注 ──────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  4/3-Way  ${this.ratedVoltage}V  ${this.ratedPressure}MPa  ${this.ratedFlow}L/min  [${this.centerFunc}型]`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    _drawPortLabels() {
        const lStyle = { fontSize: 8, fontStyle: 'bold' };
        const pLabels = [
            { text: 'A',  x: this._portA.x + this._portA.w/2 - 4,   y: this._portA.y - 12,   fill: '#f4c842' },
            { text: 'B',  x: this._portB.x + this._portB.w/2 - 4,   y: this._portB.y - 12,   fill: '#6ab4f0' },
            { text: 'P',  x: this._portP.x + this._portP.w/2 - 4,   y: this._portP.y + this._portP.h + 3, fill: '#ef5350' },
            { text: 'T1', x: this._portT1.x + this._portT1.w/2 - 6, y: this._portT1.y + this._portT1.h + 3, fill: '#78909c' },
            { text: 'T2', x: this._portT2.x + this._portT2.w/2 - 6, y: this._portT2.y + this._portT2.h + 3, fill: '#78909c' },
        ];
        pLabels.forEach(({ text, x, y, fill }) => {
            this._staticGroup.add(new Konva.Text({ x, y, text, fill, ...lStyle }));
        });
    }

    // ── 状态指示灯 ────────────────────────────────
    _drawStatusIndicator() {
        const b = this._body;
        const ix = b.x + b.w * 0.50 - 20, iy = b.y - 14;
        this._statusText = new Konva.Text({
            x: ix, y: iy, width: 40,
            text: this._posLabel(),
            fontSize: 9, fontStyle: 'bold',
            fill: this._posColor(), align: 'center',
        });
        // YVa 通电点
        this._dotA = new Konva.Circle({
            x: this._solA.x + this._solA.w/2,
            y: this._solA.y + this._solA.h * 0.08,
            radius: 3.5,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.6,
        });
        // YVb 通电点
        this._dotB = new Konva.Circle({
            x: this._solB.x + this._solB.w/2,
            y: this._solB.y + this._solB.h * 0.08,
            radius: 3.5,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.6,
        });
        this._staticGroup.add(this._statusText, this._dotA, this._dotB);
    }

    _posLabel() {
        return { left: '左 位', center: '中 位', right: '右 位' }[this._position];
    }
    _posColor() {
        return { left: '#ffb74d', center: '#90a4ae', right: '#64b5f6' }[this._position];
    }

    // ════════════════════════════════════════════════
    // ── 动态层（主渲染核心）─────────────────────────
    // ════════════════════════════════════════════════
    _drawDynamicLayer() {
        this._dynGroup = new Konva.Group();
        this._staticGroup.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();
        const pos    = this._position;
        const bo     = this._bore;
        const b      = this._body;
        const sx     = this._spoolX;          // −1…+1
        const phase  = this._flowPhase;

        // 阀芯当前中心 X
        const spoolCx = bo.x + bo.w/2 + sx * this._spoolMaxOff;
        const spoolX  = spoolCx - this._spoolLen / 2;
        const spoolY  = bo.y;
        const spoolH  = bo.h;
        const sLen    = this._spoolLen;

        // ── 1. 流道高亮（根据位置决定连通关系）──
        this._drawFlowChannels(pos, phase);

        // ── 2. 弹簧（两端） ──
        this._drawSpring('left',  spoolX,        spoolY, spoolH, sx);
        this._drawSpring('right', spoolX + sLen, spoolY, spoolH, sx);

        // ── 3. 磁场光晕 ──
        if (this._coilAOn) this._drawCoilGlow(this._solA, 'left');
        if (this._coilBOn) this._drawCoilGlow(this._solB, 'right');

        // ── 4. 阀芯主体（分段绘制：凸肩 + 凹槽）──
        this._drawSpool(spoolX, spoolY, sLen, spoolH);

        // ── 5. 推杆（线圈推杆） ──
        this._drawPushRods(spoolX, spoolY + spoolH/2, sLen, spoolH);

        // ── 6. 流体粒子 ──
        this._drawFlowParticles(pos, phase);

        // ── 7. 电弧（切换瞬间） ──
        if (this._animating && this._animT < 0.18) {
            this._drawArcEffect(spoolCx, spoolY + spoolH/2);
        }
    }

    // ── 流道高亮 ──────────────────────────────────
    _drawFlowChannels(pos, phase) {
        const b = this._body, bo = this._bore;
        // 各口在阀体内对应的 Y 段
        const chanTop_y1 = b.y + 2;
        const chanTop_y2 = bo.y;
        const chanBot_y1 = bo.y + bo.h;
        const chanBot_y2 = b.y + b.h - 2;

        const drawVChan = (cx, y1, y2, color, alpha) => {
            this._dynGroup.add(new Konva.Rect({
                x: cx - 4, y: y1, width: 8, height: y2 - y1,
                fill: `rgba(${color},${alpha})`, cornerRadius: 2,
            }));
        };

        // 颜色常量（r,g,b 字串）
        const cP  = '220,50,50',  cT = '80,100,110';
        const cA  = '200,170,60', cB = '60,140,210';

        if (pos === 'left') {
            // P→B，A→T1
            drawVChan(this._portPx,  chanBot_y1, chanBot_y2, cP, 0.50);
            drawVChan(this._portBx,  chanTop_y1, chanTop_y2, cP, 0.45);
            // 横向 P-B 流道
            this._dynGroup.add(new Konva.Rect({
                x: this._portPx - 4, y: bo.y + bo.h*0.20,
                width: this._portBx - this._portPx + 8, height: bo.h * 0.60,
                fill: 'rgba(220,50,50,0.18)', cornerRadius: 2,
            }));
            drawVChan(this._portAx,  chanTop_y1, chanTop_y2, cA, 0.45);
            drawVChan(this._portT1x, chanBot_y1, chanBot_y2, cT, 0.40);
            this._dynGroup.add(new Konva.Rect({
                x: this._portT1x - 4, y: bo.y + bo.h*0.20,
                width: this._portAx - this._portT1x + 8, height: bo.h * 0.60,
                fill: 'rgba(200,170,60,0.15)', cornerRadius: 2,
            }));
        } else if (pos === 'right') {
            // P→A，B→T2
            drawVChan(this._portPx,  chanBot_y1, chanBot_y2, cP, 0.50);
            drawVChan(this._portAx,  chanTop_y1, chanTop_y2, cP, 0.45);
            this._dynGroup.add(new Konva.Rect({
                x: this._portPx - 4, y: bo.y + bo.h*0.20,
                width: this._portAx - this._portPx + 8, height: bo.h * 0.60,
                fill: 'rgba(220,50,50,0.18)', cornerRadius: 2,
            }));
            drawVChan(this._portBx,  chanTop_y1, chanTop_y2, cB, 0.45);
            drawVChan(this._portT2x, chanBot_y1, chanBot_y2, cT, 0.40);
            this._dynGroup.add(new Konva.Rect({
                x: this._portBx - 4, y: bo.y + bo.h*0.20,
                width: this._portT2x - this._portBx + 8, height: bo.h * 0.60,
                fill: 'rgba(60,140,210,0.15)', cornerRadius: 2,
            }));
        }
        // 中位（O 型）：所有口封闭，不画流道
    }

    // ── 弹簧 ──────────────────────────────────────
    _drawSpring(side, spoolEdgeX, spoolY, spoolH, spoolX) {
        const bo       = this._bore;
        const compress = Math.abs(spoolX) * this._spoolMaxOff * 0.55;

        // 弹簧范围（从阀孔端壁到阀芯端面）
        const wallX  = side === 'left' ? bo.x : bo.x + bo.w;
        const endX   = side === 'left'
            ? spoolEdgeX - 2
            : spoolEdgeX + 2;

        const x1 = side === 'left' ? wallX + 1 : endX;
        const x2 = side === 'left' ? endX       : wallX - 1;
        const springLen = Math.abs(x2 - x1);
        const cy    = spoolY + spoolH / 2;
        const sw    = spoolH * 0.28;
        const coils = 5;
        const pts   = [];
        for (let i = 0; i <= coils * 2; i++) {
            const t  = i / (coils * 2);
            const lx = x1 + springLen * t;
            const ly = cy + (i % 2 === 0 ? -sw/2 : sw/2);
            pts.push(lx, ly);
        }
        // 弹簧受压高亮（被压缩侧变亮）
        const compressed = (side === 'left' && spoolX > 0.1) || (side === 'right' && spoolX < -0.1);
        this._dynGroup.add(new Konva.Line({
            points: pts,
            stroke: compressed ? '#b8d0e8' : '#7a8898',
            strokeWidth: compressed ? 1.6 : 1.2,
            lineJoin: 'round', lineCap: 'round',
        }));
    }

    // ── 磁场光晕 ──────────────────────────────────
    _drawCoilGlow(s, side) {
        const pulse = 0.10 + 0.05 * Math.sin(this._flowPhase * 4);
        this._dynGroup.add(new Konva.Rect({
            x: s.x - 3, y: s.y - 3,
            width: s.w + 6, height: s.h + 6,
            fill: `rgba(55,110,255,${pulse})`,
            cornerRadius: s.rx + 2,
        }));
        // 推杆孔发光
        const plugY = s.y + s.h * 0.44 + s.h * 0.44 / 2;
        const plugX = side === 'left' ? s.x + s.w : s.x;
        this._dynGroup.add(new Konva.Circle({
            x: plugX, y: plugY,
            radius: this._bore.h * 0.28,
            fill: `rgba(80,150,255,${0.20 + 0.10 * Math.sin(this._flowPhase*3)})`,
        }));
    }

    // ── 阀芯（凸肩+凹槽细节）────────────────────
    _drawSpool(sx, sy, sLen, sH) {
        // 阀芯整体底色（深钢色）
        this._dynGroup.add(new Konva.Rect({
            x: sx, y: sy + sH*0.04,
            width: sLen, height: sH*0.92,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: sH*0.92 },
            fillLinearGradientColorStops: [
                0,    '#4a4a52',
                0.30, '#88888e',
                0.55, '#9c9ca4',
                0.80, '#78787e',
                1,    '#3a3a40',
            ],
            stroke: '#22222a', strokeWidth: 0.8,
            cornerRadius: 2,
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.3,
        }));

        // 凸肩位置（5 个凸肩，4 个凹槽）—— 按阀口数量设计
        // 凸肩相对阀芯长度的比例位置
        const lands = [0.04, 0.22, 0.44, 0.66, 0.84];
        const landW = sLen * 0.14;
        const landH = sH * 0.92;

        lands.forEach(lt => {
            const lx = sx + sLen * lt;
            // 凸肩（圆柱凸起，与阀孔紧密配合）
            this._dynGroup.add(new Konva.Rect({
                x: lx, y: sy + sH*0.04,
                width: landW, height: landH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: landW, y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#606068',
                    0.3, '#a8a8b0',
                    0.6, '#c0c0c8',
                    1,   '#606068',
                ],
                stroke: '#3a3a42', strokeWidth: 0.6,
                cornerRadius: 1,
            }));
            // 凸肩顶部高光环
            this._dynGroup.add(new Konva.Rect({
                x: lx + landW*0.10, y: sy + sH*0.04 + 1,
                width: landW*0.80, height: landH*0.12,
                fill: 'rgba(255,255,255,0.16)',
                cornerRadius: [1, 1, 0, 0],
            }));
        });

        // 凸肩高光（整体顶面）
        this._dynGroup.add(new Konva.Rect({
            x: sx + 2, y: sy + sH*0.05,
            width: sLen - 4, height: sH*0.08,
            fill: 'rgba(255,255,255,0.10)',
            cornerRadius: 1,
        }));
    }

    // ── 推杆（阀芯伸出到线圈侧）──────────────────
    _drawPushRods(spoolLX, cy, sLen, sH) {
        const bo   = this._bore;
        const rodR = sH * 0.12;
        // 左推杆（从阀芯左端伸到阀孔左壁）
        this._dynGroup.add(new Konva.Rect({
            x: bo.x + 2, y: cy - rodR,
            width: spoolLX - bo.x - 2, height: rodR * 2,
            fill: '#5a5a62', stroke: '#3a3a40', strokeWidth: 0.6,
            cornerRadius: 1,
        }));
        // 右推杆
        this._dynGroup.add(new Konva.Rect({
            x: spoolLX + sLen, y: cy - rodR,
            width: bo.x + bo.w - spoolLX - sLen - 2, height: rodR * 2,
            fill: '#5a5a62', stroke: '#3a3a40', strokeWidth: 0.6,
            cornerRadius: 1,
        }));
    }

    // ── 流体粒子 ──────────────────────────────────
    _drawFlowParticles(pos, phase) {
        if (pos === 'center') return;

        const numPts = 6;
        const b = this._body, bo = this._bore;

        // 根据位置确定流动路径
        const paths = pos === 'left'
            ? [
                // P 进 → (阀体内横向) → B 出
                { x1: this._portPx, y1: b.y + b.h + 8, x2: this._portBx, y2: b.y - 8, color: '220,80,60' },
                // A 口 → (阀体内横向) → T1 出
                { x1: this._portAx, y1: b.y - 8,        x2: this._portT1x, y2: b.y + b.h + 8, color: '200,170,60' },
            ]
            : [
                // P 进 → A 出
                { x1: this._portPx, y1: b.y + b.h + 8, x2: this._portAx, y2: b.y - 8, color: '220,80,60' },
                // B → T2
                { x1: this._portBx, y1: b.y - 8,        x2: this._portT2x, y2: b.y + b.h + 8, color: '60,140,210' },
            ];

        paths.forEach(({ x1, y1, x2, y2, color }) => {
            for (let i = 0; i < numPts; i++) {
                const t  = ((i / numPts) + phase * 0.45) % 1;
                // L 形路径：竖 → 横 → 竖
                let px, py;
                const halfT = 0.5;
                if (t < 0.35) {
                    // 进口段（竖向）
                    const tt = t / 0.35;
                    px = x1 + (Math.random()-0.5)*2;
                    py = y1 + (bo.y + bo.h/2 - y1) * tt;
                } else if (t < 0.65) {
                    // 阀体内（横向）
                    const tt = (t - 0.35) / 0.30;
                    px = x1 + (x2 - x1) * tt;
                    py = bo.y + bo.h * 0.35 + (Math.random()-0.5) * bo.h * 0.30;
                } else {
                    // 出口段（竖向）
                    const tt = (t - 0.65) / 0.35;
                    px = x2 + (Math.random()-0.5)*2;
                    py = bo.y + bo.h/2 + (y2 - (bo.y + bo.h/2)) * tt;
                }
                const r  = 1.8 + 1.0 * Math.sin(phase * 5 + i * 1.4);
                const a  = 0.45 + 0.30 * Math.sin(phase * 4 + i);
                this._dynGroup.add(new Konva.Circle({
                    x: px, y: py, radius: r,
                    fill: `rgba(${color},${a})`,
                }));
            }
        });
    }

    // ── 电弧效果 ──────────────────────────────────
    _drawArcEffect(cx, cy) {
        for (let i = 0; i < 4; i++) {
            const dx = (Math.random()-0.5) * 14;
            this._dynGroup.add(new Konva.Line({
                points: [
                    cx + dx*0.2, cy - 3,
                    cx + dx + Math.random()*5, cy - 8,
                    cx + dx*0.6, cy - 14,
                ],
                stroke: `rgba(80,${160+Math.round(Math.random()*80)},255,${0.5+Math.random()*0.4})`,
                strokeWidth: 0.8 + Math.random(),
                lineJoin: 'round', lineCap: 'round',
            }));
        }
    }

    // ════════════════════════════════════════════════
    // ── 动画驱动 ─────────────────────────────────────
    // ════════════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        // 持续推进粒子相位
        this._flowPhase = (this._flowPhase + dt * 2.0) % (Math.PI * 2);

        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._position  = this._animTo;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            // spoolX 目标：left=-1, center=0, right=+1
            const targetMap = { left: -1, center: 0, right: 1 };
            const fromX = targetMap[this._animFrom];
            const toX   = targetMap[this._animTo];
            this._spoolX = fromX + (toX - fromX) * ease;
        }

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const pos = this._animating ? this._animTo : this._position;
        if (this._statusText) {
            this._statusText.text(this._posLabel());
            this._statusText.fill(this._posColor());
        }
        if (this._dotA) {
            const on = this._coilAOn;
            this._dotA.fill(on ? '#42a5f5' : '#546e7a');
            this._dotA.stroke(on ? '#1565c0' : '#37474f');
            this._dotA.shadowColor('#42a5f5');
            this._dotA.shadowBlur(on ? 6 : 0);
        }
        if (this._dotB) {
            const on = this._coilBOn;
            this._dotB.fill(on ? '#42a5f5' : '#546e7a');
            this._dotB.stroke(on ? '#1565c0' : '#37474f');
            this._dotB.shadowColor('#42a5f5');
            this._dotB.shadowBlur(on ? 6 : 0);
        }
    }

    // ── 交互绑定 ──────────────────────────────────
    _bindInteraction() {
        // 左侧线圈区域 → 切换左位/复中位
        this._solA && this.group.on('click tap', e => {
            const lx = e.target?.getAbsolutePosition?.()?.x ?? 0;
            const groupX = this.group.getAbsolutePosition().x;
            const relX = lx - groupX;
            const midX = this.width / 2;
            if (relX < midX * 0.55) {
                // 点击左侧
                this._position === 'left' ? this.toCenter() : this.toLeft();
            } else if (relX > midX * 1.45) {
                // 点击右侧
                this._position === 'right' ? this.toCenter() : this.toRight();
            } else {
                this.toCenter();
            }
        });
    }

    // ════════════════════════════════════════════════
    // ── 公开 API ─────────────────────────────────────
    // ════════════════════════════════════════════════

    /** YVa 通电 → 切换至左位（P→B, A→T） */
    toLeft() {
        if (this._animating) return;
        if (this._position === 'left') return;
        this._animFrom  = this._position;
        this._animTo    = 'left';
        this._animT     = 0;
        this._animating = true;
        this._coilAOn   = true;
        this._coilBOn   = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 两线圈均断电 → 弹簧对中 → 中位（O型封闭） */
    toCenter() {
        if (this._animating) return;
        if (this._position === 'center') return;
        this._animFrom  = this._position;
        this._animTo    = 'center';
        this._animT     = 0;
        this._animating = true;
        this._coilAOn   = false;
        this._coilBOn   = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** YVb 通电 → 切换至右位（P→A, B→T） */
    toRight() {
        if (this._animating) return;
        if (this._position === 'right') return;
        this._animFrom  = this._position;
        this._animTo    = 'right';
        this._animT     = 0;
        this._animating = true;
        this._coilAOn   = false;
        this._coilBOn   = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询 */
    getPosition()  { return this._position; }
    isLeft()       { return this._position === 'left';   }
    isCenter()     { return this._position === 'center'; }
    isRight()      { return this._position === 'right';  }
    isAnimating()  { return this._animating; }
    isCoilAOn()    { return this._coilAOn; }
    isCoilBOn()    { return this._coilBOn; }
    getOpsCount()  { return this.opsCount; }

    /** 通用更新接口（兼容外部控制器） */
    update(state) {
        if      (state === 'left'   || state === -1) this.toLeft();
        else if (state === 'right'  || state ===  1) this.toRight();
        else if (state === 'center' || state ===  0) this.toCenter();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',         type: 'text'   },
            { label: '线圈电压 (V)',       key: 'ratedVoltage',  type: 'number' },
            { label: '额定压力 (MPa)',     key: 'ratedPressure', type: 'number' },
            { label: '额定流量 (L/min)',   key: 'ratedFlow',     type: 'number' },
            { label: '介质',               key: 'medium',        type: 'text'   },
            { label: '中位机能 (O/H/Y/P)', key: 'centerFunc',    type: 'text'   },
            { label: '动作时间 (s)',        key: 'animDur',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label         = cfg.label         || this.label;
        this.ratedVoltage  = parseFloat(cfg.ratedVoltage)  || this.ratedVoltage;
        this.ratedPressure = parseFloat(cfg.ratedPressure) || this.ratedPressure;
        this.ratedFlow     = parseFloat(cfg.ratedFlow)     || this.ratedFlow;
        this.medium        = cfg.medium        || this.medium;
        this.centerFunc    = cfg.centerFunc    || this.centerFunc;
        this._animDur      = parseFloat(cfg.animDur)       || this._animDur;
        this.config        = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}