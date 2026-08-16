import { BaseComponent } from './BaseComponent.js';

/**
 * 气动双座止回阀（Pneumatic Double-Seat Check Valve）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  气动双座止回阀是一种用于防止流体逆流的单向控制阀，
 *  与普通止回阀不同，它设有两个独立的阀座和阀瓣，
 *  并配备气动先导控制机构，由以下部分组成：
 *
 *  1. 阀体（Body）：对称式铸造阀体，左右各一个流道口
 *     - 进口（IN / Port 1）：左侧法兰接口（正向流入）
 *     - 出口（OUT / Port 2）：右侧法兰接口（正向流出）
 *
 *  2. 左阀座（Left Seat）+ 左阀瓣（Left Disc）
 *     - 控制左侧流道的止回功能
 *     - 正向流：压差推开左阀瓣 → 流体通过
 *     - 逆流：阀瓣被压差 + 弹簧压紧阀座 → 截断
 *
 *  3. 右阀座（Right Seat）+ 右阀瓣（Right Disc）
 *     - 与左侧对称，控制右侧流道
 *
 *  4. 中腔（Middle Chamber）：连通两个阀瓣背侧的共用腔室
 *     - 双阀瓣均开启时流体在此混流后从出口流出
 *
 *  5. 复位弹簧（Return Springs）：阀瓣两侧各一根，保持常闭
 *
 *  6. 气动先导缸（Pneumatic Pilot Cylinder）：安装在阀体顶部
 *     - 先导口（PILOT）：接入控制气压
 *     - 活塞杆（Piston Rod）向下推压阀瓣，可强制开启
 *     - 用于紧急泄压、测试或旁通场合
 *
 *  7. 止回状态说明：
 *     - 无气控、正向流（IN→OUT）：压差 > 弹簧力 → 两阀瓣开启 → 流通
 *     - 无气控、逆向流（OUT→IN）：压差反向 + 弹簧 → 阀瓣关闭 → 截止
 *     - 气控强制开启：先导气缸活塞杆下推 → 强制顶开两阀瓣 → 双向导通
 *
 * ── 三种工作状态 ──────────────────────────────────────────────
 *
 *  state = 'closed'   : 正向无压差 / 逆向流 → 两阀瓣关闭（常态截止）
 *  state = 'flowing'  : 正向压差导通 → 两阀瓣被压差顶开（自动止回导通）
 *  state = 'forced'   : 先导气缸强制开启 → 活塞杆下推，双向导通
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View）剖面仿真，可见：
 *  对称阀体截面、左右两套阀座/阀瓣/弹簧、中腔、
 *  顶部气缸（活塞+活塞杆）、先导管口、法兰管颈、
 *  流体粒子动画、ISO 止回符号辅助图
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_in   — 进口（左侧法兰）
 *  port_out  — 出口（右侧法兰）
 *  port_pilot— 先导气口（气缸顶部）
 */
export class PneumaticDoubleCheckValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(260, config.width  || 300);
        this.height = Math.max(230, config.height || 270);

        this.type    = 'pneumatic_double_check_valve';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedPressure  = config.ratedPressure  || 1.6;    // MPa
        this.crackPressure  = config.crackPressure  || 0.03;   // MPa（开启压差）
        this.pilotPressure  = config.pilotPressure  || 0.4;    // MPa（先导开启压力）
        this.medium         = config.medium         || '水';
        this.label          = config.label          || 'HCV';  // 位号
        this.nominalDN      = config.nominalDN      || 25;     // mm

        // ── 状态机 ──
        // state: 'closed' | 'flowing' | 'forced'
        this._state     = config.initState || 'closed';
        this._animating = false;
        this._animT     = 0;
        this._animFrom  = this._state;
        this._animTo    = this._state;
        this._animDur   = config.animDur || 0.22;

        // 阀瓣开度（0=全关，1=全开），左右独立
        this._openL  = this._state !== 'closed' ? 1.0 : 0.0;
        this._openR  = this._state !== 'closed' ? 1.0 : 0.0;
        // 先导活塞杆位移（0=缩回，1=伸出压下）
        this._pistY  = this._state === 'forced'  ? 1.0 : 0.0;

        this._flowPhase  = 0;
        this._pilotOn    = this._state === 'forced';
        this.opsCount    = config.initOps || 0;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 阀体主矩形（宽体，左右对称）
        this._body = {
            x: W * 0.12, y: H * 0.34,
            w: W * 0.76, h: H * 0.34,
            rx: 5,
        };

        // 阀体内腔（中腔背景）
        this._chamber = {
            x: this._body.x + this._body.w * 0.06,
            y: this._body.y + this._body.h * 0.06,
            w: this._body.w * 0.88,
            h: this._body.h * 0.88,
            rx: 3,
        };

        // 左、右阀座中心 X（对称分布）
        this._seatLx = W * 0.320;
        this._seatRx = W * 0.680;
        this._seatY  = this._body.y + this._body.h * 0.50;
        this._seatRo = this._body.h * 0.20;   // 阀座外半径
        this._seatRi = this._body.h * 0.115;  // 阀座内孔半径（节流口）
        this._seatH  = this._body.h * 0.070;  // 阀座高度

        // 阀瓣运动行程（水平，向中腔方向为正）
        this._discStroke = this._body.w * 0.075;

        // 进出口法兰管颈
        const flangeH = H * 0.100;
        const flangeW = W * 0.140;
        const flangeY = this._body.y + this._body.h * 0.30;
        this._flangeIn  = { x: this._body.x - flangeW, y: flangeY, w: flangeW, h: flangeH };
        this._flangeOut = { x: this._body.x + this._body.w, y: flangeY, w: flangeW, h: flangeH };

        // 顶部气动先导缸
        const cylW = W * 0.180, cylH = H * 0.200;
        this._cylinder = {
            x: W / 2 - cylW / 2,
            y: this._body.y - cylH,
            w: cylW, h: cylH, rx: 4,
        };
        // 活塞（缸内）
        this._pistonH   = cylH * 0.18;
        this._pistonMinY = this._cylinder.y + this._cylinder.h * 0.10;
        this._pistonMaxY = this._cylinder.y + this._cylinder.h * 0.60;
        // 活塞杆（穿过缸底到阀体顶面）
        this._rodW      = W * 0.030;
        this._rodTopY   = this._pistonMinY + this._pistonH;          // 活塞底面
        this._rodBotY   = this._body.y + this._body.h * 0.24;        // 阀体内顶
        // 先导气口（缸顶）
        this._pilotPort = {
            x: W / 2 - W * 0.022,
            y: this._cylinder.y - H * 0.048,
            w: W * 0.044, h: H * 0.048,
        };


        this._init();

        // 注册端口
        this.addPort(
            this._flangeIn.x,
            this._flangeIn.y + this._flangeIn.h / 2,
            'port_in', 'pipe', 'IN'
        );
        this.addPort(
            this._flangeOut.x + this._flangeOut.w,
            this._flangeOut.y + this._flangeOut.h / 2,
            'port_out', 'pipe', 'OUT'
        );
        this.addPort(
            this._pilotPort.x + this._pilotPort.w / 2,
            this._pilotPort.y,
            'port_pilot', 'pipe', 'PILOT'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawFlanges();
        this._drawBody();
        this._drawSeats();
        this._drawCylinder();
        this._drawPilotPort();
        this._drawIsoSymbol();
        this._drawLabel();
        this._drawPortLabels();
        this._drawStatusIndicator();
        this._drawDynamicLayer();
        
    }

    // ── 进出口法兰管颈 ────────────────────────
    _drawFlanges() {
        const defs = [
            { f: this._flangeIn,  isLeft: true,  color: '#ef9a9a', tag: 'IN'  },
            { f: this._flangeOut, isLeft: false, color: '#90caf9', tag: 'OUT' },
        ];
        defs.forEach(({ f, isLeft, color, tag }) => {
            const cr = isLeft ? [3,0,0,3] : [0,3,3,0];
            // 管颈
            this._staticGroup.add(new Konva.Rect({
                x: f.x, y: f.y, width: f.w, height: f.h,
                fillLinearGradientStartPoint: { x:0, y:0 },
                fillLinearGradientEndPoint:   { x:0, y:f.h },
                fillLinearGradientColorStops: [0,'#585860',0.3,'#909099',0.65,'#aaabb4',1,'#4a4a52'],
                stroke: '#38383e', strokeWidth: 1.2, cornerRadius: cr,
            }));
            // 内腔
            this._staticGroup.add(new Konva.Rect({
                x: f.x + f.w*0.15, y: f.y + f.h*0.18,
                width: f.w*0.70, height: f.h*0.64,
                fill: '#0e0e1a', cornerRadius: 2,
            }));
            // 法兰盘
            const fx = isLeft ? f.x + f.w*0.85 : f.x;
            this._staticGroup.add(new Konva.Rect({
                x: fx, y: f.y - f.h*0.18,
                width: f.w*0.15, height: f.h*1.36,
                fill: '#7a7a84', stroke: '#505058', strokeWidth: 0.8, cornerRadius: 1,
            }));
            // 螺栓孔
            const boltX = fx + f.w*0.075;
            [f.y + f.h*0.15, f.y + f.h*0.85].forEach(by => {
                this._staticGroup.add(new Konva.Circle({ x: boltX, y: by, radius: f.h*0.10, fill:'#444', stroke:'#333', strokeWidth:0.5 }));
            });
            // 色标环
            const rx = isLeft ? f.x : f.x + f.w - f.w*0.09;
            this._staticGroup.add(new Konva.Rect({
                x: rx, y: f.y + f.h*0.12,
                width: f.w*0.09, height: f.h*0.76,
                fill: color, cornerRadius: isLeft ? [2,0,0,2] : [0,2,2,0],
            }));
            // 标注
            this._staticGroup.add(new Konva.Text({
                x: isLeft ? f.x - 2 : f.x + f.w - 14,
                y: f.y + f.h + 4,
                text: tag, fontSize: 8, fontStyle: 'bold', fill: color,
            }));
        });
    }

    // ── 阀体主体 ──────────────────────────────
    _drawBody() {
        const b = this._body, ch = this._chamber;

        // 阀体主矩形（铸铁灰）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:0, y:b.h },
            fillLinearGradientColorStops: [
                0,'#72727c', 0.22,'#929298', 0.50,'#a0a0aa', 0.78,'#909096', 1,'#5a5a62',
            ],
            stroke: '#38383e', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetY: 3, shadowOpacity: 0.35,
        }));
        // 顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: b.x+3, y: b.y+2, width: b.w-6, height: b.h*0.12,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: [b.rx,b.rx,0,0],
        }));
        // 底面暗影
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y+b.h*0.82, width: b.w, height: b.h*0.18,
            fill: 'rgba(0,0,0,0.22)', cornerRadius: [0,0,b.rx,b.rx],
        }));
        // 阀体内腔背景
        this._staticGroup.add(new Konva.Rect({
            x: ch.x, y: ch.y, width: ch.w, height: ch.h,
            fill: '#121218', stroke: '#1e1e28', strokeWidth: 0.8, cornerRadius: ch.rx,
        }));

        // 左进口腔（法兰到左阀座区域）
        const lCavW = this._seatLx - ch.x - this._seatRo * 0.6;
        this._staticGroup.add(new Konva.Rect({
            x: ch.x, y: ch.y + ch.h*0.22,
            width: lCavW, height: ch.h*0.56,
            fill: '#0e0e18', cornerRadius: [0,0,0,0],
        }));
        // 右出口腔（右阀座到右边）
        const rCavX = this._seatRx + this._seatRo * 0.6;
        this._staticGroup.add(new Konva.Rect({
            x: rCavX, y: ch.y + ch.h*0.22,
            width: ch.x + ch.w - rCavX, height: ch.h*0.56,
            fill: '#0e0e18',
        }));
        // 中腔（两阀座之间）
        const midX = this._seatLx + this._seatRo * 0.6;
        const midW = this._seatRx - this._seatRo * 0.6 - midX;
        this._staticGroup.add(new Konva.Rect({
            x: midX, y: ch.y + ch.h*0.12,
            width: midW, height: ch.h*0.76,
            fill: '#0d0d16', cornerRadius: 2,
        }));

        // 活塞杆导向孔（阀体顶面中央）
        const holeX = this.width/2 - this._rodW*1.2;
        this._staticGroup.add(new Konva.Rect({
            x: holeX, y: b.y, width: this._rodW*2.4, height: b.h*0.26,
            fill: '#0a0a14', stroke: '#1e1e26', strokeWidth: 0.6, cornerRadius: [2,2,0,0],
        }));

        // 阀体侧面加强肋（装饰）
        [b.x + b.w*0.08, b.x + b.w*0.92].forEach(rx2 => {
            this._staticGroup.add(new Konva.Rect({
                x: rx2 - 3, y: b.y + 3, width: 6, height: b.h - 6,
                fill: 'rgba(255,255,255,0.06)', cornerRadius: 2,
            }));
        });

        // 铭牌
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w*0.38, y: b.y + b.h*0.08,
            width: b.w*0.24, height: b.h*0.18,
            fill: '#181820', stroke: '#28283a', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.x + b.w*0.38, y: b.y + b.h*0.11,
            width: b.w*0.24,
            text: `DN${this.nominalDN}`, fontSize: 7, fontStyle: 'bold', fill: '#9090a8', align: 'center',
        }));
    }

    // ── 左右阀座（静态，固定在阀体上）─────────
    _drawSeats() {
        [this._seatLx, this._seatRx].forEach((cx, i) => {
            const sy  = this._seatY;
            const ro  = this._seatRo;
            const ri  = this._seatRi;
            const sh  = this._seatH;

            // 左阀座：阀瓣从右侧（中腔方向）来压合
            // 右阀座：阀瓣从左侧（中腔方向）来压合
            const sealSide = i === 0 ? 1 : -1; // +1=右侧密封面，-1=左侧密封面

            // 阀座环体（梯形截面 → 左右两个斜肩）
            // 外侧（进/出口侧）肩
            const outerX = cx + sealSide * ri;
            const outerW = sealSide * (ro - ri);
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + sealSide*ri, sy,
                    cx + sealSide*ro, sy,
                    cx + sealSide*ro, sy + sh,
                    cx + sealSide*ri, sy + sh,
                ],
                closed: true,
                fillLinearGradientStartPoint: { x: cx + sealSide*ri, y:0 },
                fillLinearGradientEndPoint:   { x: cx + sealSide*ro, y:0 },
                fillLinearGradientColorStops: i===0
                    ? [0,'#b0b0bc',0.5,'#d0d0dc',1,'#888892']
                    : [0,'#888892',0.5,'#d0d0dc',1,'#b0b0bc'],
                stroke: '#3a3a44', strokeWidth: 0.8,
            }));
            // 内侧（中腔侧）肩
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx - sealSide*ri, sy,
                    cx - sealSide*ri, sy + sh,
                    cx - sealSide*ro*0.4, sy + sh,
                    cx - sealSide*ro*0.4, sy,
                ],
                closed: true,
                fill: '#909098', stroke: '#3a3a44', strokeWidth: 0.6,
            }));
            // 阀座内孔（节流口）
            this._staticGroup.add(new Konva.Rect({
                x: cx - ri, y: sy, width: ri*2, height: sh,
                fill: '#080810',
            }));
            // 密封面高光线
            this._staticGroup.add(new Konva.Line({
                points: [cx + sealSide*ri, sy + 1, cx + sealSide*ri, sy + sh - 1],
                stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1.2, lineCap: 'round',
            }));
        });
    }

    // ── 顶部气动先导缸 ────────────────────────
    _drawCylinder() {
        const cy = this._cylinder;

        // 缸体主体（铝合金）
        this._staticGroup.add(new Konva.Rect({
            x: cy.x, y: cy.y, width: cy.w, height: cy.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:cy.w, y:0 },
            fillLinearGradientColorStops: [
                0,'#5a5a62', 0.25,'#8a8a96', 0.55,'#9c9ca8', 0.80,'#7a7a84', 1,'#4e4e58',
            ],
            stroke: '#2e2e38', strokeWidth: 1.2,
            cornerRadius: cy.rx,
            shadowColor: '#000', shadowBlur: 5, shadowOpacity: 0.30,
        }));
        // 缸体顶面高光
        this._staticGroup.add(new Konva.Rect({
            x: cy.x+2, y: cy.y+2, width: cy.w-4, height: cy.h*0.10,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: [cy.rx,cy.rx,0,0],
        }));
        // 缸体内腔（活塞行程腔）
        this._staticGroup.add(new Konva.Rect({
            x: cy.x + cy.w*0.10, y: cy.y + cy.h*0.06,
            width: cy.w*0.80, height: cy.h*0.80,
            fill: '#10101a', stroke: '#1e1e28', strokeWidth: 0.6, cornerRadius: 2,
        }));
        // 缸底进气区
        this._staticGroup.add(new Konva.Rect({
            x: cy.x + cy.w*0.10, y: cy.y + cy.h*0.06,
            width: cy.w*0.80, height: cy.h*0.12,
            fill: '#0a0a14', cornerRadius: [2,2,0,0],
        }));
        // 缸体螺栓（两侧连接）
        [cy.x + cy.w*0.05, cy.x + cy.w*0.95].forEach(bx => {
            this._staticGroup.add(new Konva.Rect({
                x: bx - 3, y: cy.y + cy.h*0.80, width: 6, height: cy.h*0.25,
                fill: '#888', stroke: '#555', strokeWidth: 0.6, cornerRadius: 1,
            }));
        });
        // 缸底与阀体连接法兰
        this._staticGroup.add(new Konva.Rect({
            x: cy.x - cy.w*0.06, y: cy.y + cy.h*0.92,
            width: cy.w*1.12, height: cy.h*0.08,
            fill: '#7a7a84', stroke: '#505058', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 活塞杆导套（缸底中央孔）
        this._staticGroup.add(new Konva.Rect({
            x: this.width/2 - this._rodW*1.4,
            y: cy.y + cy.h*0.88,
            width: this._rodW*2.8, height: cy.h*0.14,
            fill: '#505058', stroke: '#303038', strokeWidth: 0.5, cornerRadius: 1,
        }));
    }

    // ── 先导气口管嘴 ──────────────────────────
    _drawPilotPort() {
        const pp = this._pilotPort;
        this._staticGroup.add(new Konva.Rect({
            x: pp.x, y: pp.y, width: pp.w, height: pp.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:pp.w, y:0 },
            fillLinearGradientColorStops: [0,'#505058',0.5,'#909098',1,'#505058'],
            stroke: '#383840', strokeWidth: 0.8, cornerRadius: [2,2,0,0],
        }));
        // 内腔
        this._staticGroup.add(new Konva.Rect({
            x: pp.x + pp.w*0.22, y: pp.y,
            width: pp.w*0.56, height: pp.h,
            fill: '#0a0a14',
        }));
        // 色标（橙色 = 气控）
        this._staticGroup.add(new Konva.Rect({
            x: pp.x + pp.w*0.08, y: pp.y,
            width: pp.w*0.84, height: pp.h*0.18,
            fill: '#ff8c42', cornerRadius: [2,2,0,0],
        }));
    }

    // ── ISO 止回阀符号（底部辅助图）──────────
    _drawIsoSymbol() {
        const W = this.width, H = this.height;
        const sy  = H * 0.84;
        const isoW = W * 0.56, isoH = H * 0.09;
        const sx  = W / 2 - isoW / 2;
        const cy  = sy + isoH / 2;

        // 止回阀符号外框（两个三角 + 中线）
        const triW = isoH * 0.85;

        // 左止回符（▷|）
        const lx = sx + isoW * 0.18;
        this._staticGroup.add(new Konva.Line({
            points: [lx - triW*0.5, cy - isoH*0.36, lx + triW*0.5, cy, lx - triW*0.5, cy + isoH*0.36],
            closed: true, fill: 'rgba(60,120,200,0.30)', stroke: '#4070b0', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [lx + triW*0.5, cy - isoH*0.38, lx + triW*0.5, cy + isoH*0.38],
            stroke: '#4070b0', strokeWidth: 1.2, lineCap: 'round',
        }));

        // 右止回符（|◁）
        const rx2 = sx + isoW * 0.82;
        this._staticGroup.add(new Konva.Line({
            points: [rx2 + triW*0.5, cy - isoH*0.36, rx2 - triW*0.5, cy, rx2 + triW*0.5, cy + isoH*0.36],
            closed: true, fill: 'rgba(60,120,200,0.30)', stroke: '#4070b0', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [rx2 - triW*0.5, cy - isoH*0.38, rx2 - triW*0.5, cy + isoH*0.38],
            stroke: '#4070b0', strokeWidth: 1.2, lineCap: 'round',
        }));

        // 中间连接线
        this._staticGroup.add(new Konva.Line({
            points: [lx + triW*0.5, cy, rx2 - triW*0.5, cy],
            stroke: '#4070b0', strokeWidth: 0.8, dash: [3, 2],
        }));

        // 气缸符号（上方三角形，代表气控先导）
        const gcx = sx + isoW / 2;
        this._staticGroup.add(new Konva.Line({
            points: [gcx - isoH*0.22, sy - isoH*0.28, gcx + isoH*0.22, sy - isoH*0.28, gcx, sy - isoH*0.65],
            closed: true, fill: 'rgba(255,140,60,0.30)', stroke: '#ff8c42', strokeWidth: 0.8,
        }));
        // 连接线（气缸到中央）
        this._staticGroup.add(new Konva.Line({
            points: [gcx, sy - isoH*0.28, gcx, cy],
            stroke: '#ff8c42', strokeWidth: 0.7, dash: [2,2],
        }));

        // IN / OUT 标注
        this._staticGroup.add(new Konva.Text({ x: sx - 4,          y: sy + isoH + 3, text: 'IN',  fontSize: 7, fontStyle: 'bold', fill: '#ef9a9a' }));
        this._staticGroup.add(new Konva.Text({ x: sx + isoW - 14,  y: sy + isoH + 3, text: 'OUT', fontSize: 7, fontStyle: 'bold', fill: '#90caf9' }));
    }

    // ── 标注 ──────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  气动双座止回阀  DN${this.nominalDN}  ${this.ratedPressure}MPa  Δp≥${this.crackPressure}MPa`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: 0, y: this._body.y + this._body.h + 6, width: this.width,
            text: `介质：${this.medium}   先导≥${this.pilotPressure}MPa`,
            fontSize: 8, fill: '#78909c', align: 'center',
        }));
    }

    _drawPortLabels() {
        const pp = this._pilotPort;
        this._staticGroup.add(new Konva.Text({
            x: pp.x + pp.w + 3, y: pp.y - 2,
            text: 'PILOT', fontSize: 7, fontStyle: 'bold', fill: '#ff8c42',
        }));
        // 阀座标注
        this._staticGroup.add(new Konva.Text({
            x: this._seatLx - 12, y: this._body.y - 12,
            text: '左阀座', fontSize: 7, fill: '#7a8a9a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._seatRx - 12, y: this._body.y - 12,
            text: '右阀座', fontSize: 7, fill: '#7a8a9a',
        }));
    }

    // ── 状态指示 ──────────────────────────────
    _drawStatusIndicator() {
        const b  = this._body;
        const ix = b.x + 10, iy = b.y + b.h/2;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 0.8,
            shadowColor: '#ef5350', shadowBlur: 2, shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text: '关闭', fontSize: 8, fontStyle: 'bold', fill: '#ef5350',
        });
        // 先导压力指示点
        this._pilotDot = new Konva.Circle({
            x: this._pilotPort.x + this._pilotPort.w/2,
            y: this._pilotPort.y + this._pilotPort.h + 4,
            radius: 3.5,
            fill: '#546e7a', stroke: '#37474f', strokeWidth: 0.6,
        });
        this._staticGroup.add(this._statusDot, this._statusText, this._pilotDot);
    }

    // ════════════════════════════════════════════
    // ── 动态层 ───────────────────────────────────
    // ════════════════════════════════════════════
    _drawDynamicLayer() {
        this._dynGroup = new Konva.Group();
        this._staticGroup.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();

        const oL    = this._openL;    // 0~1
        const oR    = this._openR;    // 0~1
        const pistY = this._pistY;    // 0~1
        const phase = this._flowPhase;

        // ── 1. 先导腔光晕 ──
        if (this._pilotOn) this._drawPilotGlow();

        // ── 2. 活塞 + 活塞杆 ──
        this._drawPiston(pistY);

        // ── 3. 流道高亮 ──
        this._drawFlowChannels(oL, oR, phase);

        // ── 4. 左阀瓣 + 弹簧 ──
        this._drawDisc('left',  oL, phase);

        // ── 5. 右阀瓣 + 弹簧 ──
        this._drawDisc('right', oR, phase);

        // ── 6. 流体粒子 ──
        if (oL > 0.05 || oR > 0.05) {
            this._drawFlowParticles(oL, oR, phase);
        }

        // ── 7. 切换瞬间 ──
        if (this._animating && this._animT < 0.15) {
            this._drawSwitchEffect();
        }
    }

    // ── 先导腔光晕 ────────────────────────────
    _drawPilotGlow() {
        const cy    = this._cylinder;
        const pulse = 0.08 + 0.05 * Math.sin(this._flowPhase * 4);
        this._dynGroup.add(new Konva.Rect({
            x: cy.x - 3, y: cy.y - 3, width: cy.w + 6, height: cy.h + 6,
            fill: `rgba(255,140,60,${pulse})`, cornerRadius: cy.rx + 3,
        }));
        // 进气腔橙色高亮（缸顶区域）
        this._dynGroup.add(new Konva.Rect({
            x: cy.x + cy.w*0.10, y: cy.y + cy.h*0.06,
            width: cy.w*0.80, height: cy.h*0.12,
            fill: `rgba(255,140,60,${0.18 + 0.08 * Math.sin(this._flowPhase*3)})`,
            cornerRadius: [2,2,0,0],
        }));
    }

    // ── 活塞 + 活塞杆 ─────────────────────────
    _drawPiston(pistY) {
        const cy   = this._cylinder;
        const minY = this._pistonMinY;
        const maxY = this._pistonMaxY;
        const pH   = this._pistonH;
        const W    = this.width;

        // 活塞当前 Y（pistY=0 在上，pistY=1 在下）
        const curY = minY + (maxY - minY) * pistY;

        // 活塞主体
        this._dynGroup.add(new Konva.Rect({
            x: cy.x + cy.w*0.12, y: curY,
            width: cy.w*0.76, height: pH,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:0, y:pH },
            fillLinearGradientColorStops: [0,'#505060',0.3,'#909098',0.7,'#a0a0aa',1,'#404050'],
            stroke: '#28283a', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 活塞 O 型圈（密封槽）
        this._dynGroup.add(new Konva.Rect({
            x: cy.x + cy.w*0.12, y: curY + pH*0.35,
            width: cy.w*0.76, height: pH*0.30,
            fill: '#1a1a2a', stroke: '#2a2a3a', strokeWidth: 0.5,
        }));
        // 活塞顶部高光
        this._dynGroup.add(new Konva.Rect({
            x: cy.x + cy.w*0.14, y: curY + 1,
            width: cy.w*0.72, height: pH*0.15,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [1,1,0,0],
        }));

        // 活塞杆（从活塞底面延伸向下穿透缸底）
        const rodX = W/2 - this._rodW/2;
        const rodTop = curY + pH;
        const rodBot = this._rodBotY + pistY * (this._body.h * 0.28);
        this._dynGroup.add(new Konva.Rect({
            x: rodX, y: rodTop, width: this._rodW, height: Math.max(2, rodBot - rodTop),
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:this._rodW, y:0 },
            fillLinearGradientColorStops: [0,'#484852',0.4,'#9090a0',0.7,'#a8a8b8',1,'#484852'],
            stroke: '#28283a', strokeWidth: 0.5,
        }));
        // 活塞杆螺纹（装饰）
        for (let ty = rodTop + 3; ty < rodBot - 4; ty += 4) {
            this._dynGroup.add(new Konva.Line({
                points: [rodX, ty, rodX + this._rodW, ty + 2],
                stroke: 'rgba(0,0,0,0.22)', strokeWidth: 0.6,
            }));
        }
        // 活塞杆底端压头（顶住阀瓣时的平面）
        if (pistY > 0.05) {
            this._dynGroup.add(new Konva.Rect({
                x: rodX - this._rodW*0.5, y: rodBot - 2,
                width: this._rodW*2, height: 4,
                fill: pistY > 0.8 ? '#ff8c42' : '#707080',
                stroke: '#28283a', strokeWidth: 0.4, cornerRadius: 1,
            }));
        }
    }

    // ── 阀瓣 + 弹簧（左右各一套）────────────
    _drawDisc(side, opening, phase) {
        const seatCx = side === 'left' ? this._seatLx : this._seatRx;
        const seatY  = this._seatY;
        const seatRo = this._seatRo;
        const seatRi = this._seatRi;
        const seatH  = this._seatH;
        const stroke = this._discStroke;
        const ch     = this._chamber;

        // 阀瓣开启方向：
        //   左阀瓣 → 向左（远离中腔）开启
        //   右阀瓣 → 向右（远离中腔）开启
        // 关闭位置：阀瓣密封面贴紧阀座内侧面
        const dir    = side === 'left' ? -1 : 1;
        const discW  = seatRo * 0.80;
        const discH  = seatH  * 1.50;

        // 阀瓣中心 X（关闭时紧贴中腔侧阀座面，开启时向外偏移）
        // 关闭：disc 的密封面 = 阀座中腔侧（cx - dir*seatRi）
        // 开启：向外偏移 stroke
        const sealFaceX = seatCx - dir * seatRi;
        const discCx    = sealFaceX - dir * (discW * 0.45) - dir * opening * stroke;

        // ── 弹簧（阀瓣外侧 ~ 阀体腔壁）──
        const springEndX  = discCx - dir * discW * 0.45;
        const springWallX = side === 'left'
            ? ch.x + ch.w * 0.04
            : ch.x + ch.w * 0.96;
        const cy2 = seatY + seatH / 2;
        const springLen = Math.abs(springEndX - springWallX);
        const sw2   = seatH * 0.38;
        const coils = 5;
        const pts   = [];
        const x1    = Math.min(springEndX, springWallX);
        const x2    = Math.max(springEndX, springWallX);
        for (let k = 0; k <= coils * 2; k++) {
            const t  = k / (coils * 2);
            const lx = x1 + springLen * t;
            const ly = cy2 + (k % 2 === 0 ? -sw2/2 : sw2/2);
            pts.push(lx, ly);
        }
        // 弹簧压缩时变色
        const compressed = opening < 0.05;
        this._dynGroup.add(new Konva.Line({
            points: pts,
            stroke: compressed ? '#a8c8e8' : '#6a7888',
            strokeWidth: compressed ? 1.5 : 1.2,
            lineJoin: 'round', lineCap: 'round',
        }));

        // ── 阀瓣主体（矩形 + 锥面） ──
        const closed = opening < 0.02;

        // 阀瓣侧视图（从中腔侧看：左阀瓣为左视，右阀瓣为右视）
        // 上下各加圆角帽
        this._dynGroup.add(new Konva.Rect({
            x: discCx - discW/2, y: seatY - discH*0.10,
            width: discW, height: discH * 1.10,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:discW, y:0 },
            fillLinearGradientColorStops: side==='left'
                ? [0,'#606068',0.35,'#9898a8',0.7,'#aaaab8',1,'#505058']
                : [0,'#505058',0.3,'#aaaab8',0.65,'#9898a8',1,'#606068'],
            stroke: '#28283a', strokeWidth: 0.7, cornerRadius: 2,
        }));
        // 阀瓣密封锥面（中腔侧，斜面）
        const coneX = discCx + dir * discW * 0.42;
        this._dynGroup.add(new Konva.Line({
            points: [
                coneX, seatY - discH*0.02,
                coneX + dir * discW*0.14, seatY + seatH*0.5,
                coneX, seatH + seatY + discH*0.10,
            ],
            closed: true,
            fill: closed ? 'rgba(255,60,60,0.18)' : 'rgba(80,200,120,0.18)',
            stroke: closed ? '#882222' : '#286838',
            strokeWidth: 0.7,
        }));
        // 阀瓣顶部高光
        this._dynGroup.add(new Konva.Rect({
            x: discCx - discW*0.40, y: seatY - discH*0.08,
            width: discW*0.80, height: discH*0.12,
            fill: 'rgba(255,255,255,0.12)', cornerRadius: [2,2,0,0],
        }));

        // 密封面贴合高光（全关时红色渗漏抑制）
        if (closed) {
            this._dynGroup.add(new Konva.Rect({
                x: seatCx - dir*seatRi - (side==='left'?2:0),
                y: seatY - 2,
                width: 4, height: seatH + 4,
                fill: 'rgba(255,80,80,0.25)',
                cornerRadius: 2,
            }));
        }
    }

    // ── 流道高亮 ──────────────────────────────
    _drawFlowChannels(oL, oR, phase) {
        if (oL < 0.05 && oR < 0.05) return;

        const b  = this._body, ch = this._chamber;
        const aL = Math.min(1, oL) * 0.50;
        const aR = Math.min(1, oR) * 0.50;
        const fIn  = this._flangeIn;
        const fOut = this._flangeOut;

        // 进口腔（左侧）
        if (oL > 0.05) {
            this._dynGroup.add(new Konva.Rect({
                x: fIn.x + fIn.w*0.10, y: fIn.y + fIn.h*0.18,
                width: fIn.w*0.80 + (this._seatLx - b.x - this._seatRo*0.6),
                height: fIn.h*0.64,
                fill: `rgba(40,160,255,${aL})`, cornerRadius: 2,
            }));
        }
        // 中腔（两阀瓣之间）
        const midX = this._seatLx + this._seatRo * 0.6;
        const midW = this._seatRx - this._seatRo * 0.6 - midX;
        if (oL > 0.05 && oR > 0.05) {
            const midA = Math.min(aL, aR) * 0.8;
            this._dynGroup.add(new Konva.Rect({
                x: midX, y: ch.y + ch.h*0.14,
                width: midW, height: ch.h*0.72,
                fill: `rgba(40,200,120,${midA})`, cornerRadius: 2,
            }));
        }
        // 出口腔（右侧）
        if (oR > 0.05) {
            this._dynGroup.add(new Konva.Rect({
                x: this._seatRx + this._seatRo*0.6, y: fOut.y + fOut.h*0.18,
                width: fOut.x + fOut.w*0.90 - this._seatRx - this._seatRo*0.6,
                height: fOut.h*0.64,
                fill: `rgba(40,160,255,${aR})`, cornerRadius: 2,
            }));
        }
    }

    // ── 流体粒子 ──────────────────────────────
    _drawFlowParticles(oL, oR, phase) {
        const numPts = 8;
        const ch     = this._chamber;
        const fIn    = this._flangeIn;
        const fOut   = this._flangeOut;
        const midX   = this._seatLx + this._seatRo * 0.6;
        const midW   = this._seatRx - this._seatRo * 0.6 - midX;
        const midCX  = midX + midW / 2;

        for (let i = 0; i < numPts; i++) {
            const t = ((i / numPts) + phase * 0.38) % 1.0;
            let px, py, r, a, rgb;

            if (t < 0.28) {
                // 进口段（左法兰 → 左阀瓣）
                if (oL < 0.05) continue;
                const tt = t / 0.28;
                px = fIn.x + (this._seatLx - fIn.x) * tt;
                py = fIn.y + fIn.h * (0.25 + 0.50 * Math.sin(phase*2.5 + i));
                rgb = '40,160,255'; a = 0.40 + 0.30*oL;
            } else if (t < 0.55) {
                // 中腔段（两阀瓣开启后汇流）
                if (oL < 0.05 || oR < 0.05) continue;
                const tt = (t - 0.28) / 0.27;
                px = midX + midW * tt;
                py = ch.y + ch.h * (0.25 + 0.50 * Math.random());
                rgb = '60,210,130'; a = 0.35 + 0.25 * Math.min(oL, oR);
            } else {
                // 出口段（右阀瓣 → 右法兰）
                if (oR < 0.05) continue;
                const tt = (t - 0.55) / 0.45;
                px = this._seatRx + (fOut.x + fOut.w - this._seatRx) * tt;
                py = fOut.y + fOut.h * (0.25 + 0.50 * Math.sin(phase*2 + i + 1));
                rgb = '40,160,255'; a = 0.40 + 0.30*oR;
            }

            r = (1.4 + 0.9 * Math.sin(phase*5 + i*1.3));
            this._dynGroup.add(new Konva.Circle({
                x: px, y: py, radius: Math.max(0.5, r),
                fill: `rgba(${rgb},${a * (0.6 + 0.4 * Math.sin(phase*4 + i))})`,
            }));
        }
    }

    // ── 切换瞬间效果 ──────────────────────────
    _drawSwitchEffect() {
        const cx = this.width / 2;
        const cy = this._body.y + this._body.h * 0.4;
        for (let i = 0; i < 4; i++) {
            const dx = (Math.random()-0.5) * 16;
            this._dynGroup.add(new Konva.Line({
                points: [cx+dx*0.2, cy, cx+dx, cy - 8, cx+dx*0.6, cy - 16],
                stroke: `rgba(100,${180+Math.round(Math.random()*60)},255,${0.4+Math.random()*0.4})`,
                strokeWidth: 0.8 + Math.random(),
                lineJoin: 'round', lineCap: 'round',
            }));
        }
    }

    // ════════════════════════════════════════════
    // ── 动画驱动 ─────────────────────────────────
    // ════════════════════════════════════════════
    _bindInteraction() {
        this._dynGroup.on('click tap', () => {
            if (this._state === 'forced') this.releaseForce();
            else if (this._state === 'flowing') this.setClose();
            else this.setFlowing();
        });
        this._dynGroup.listening(true);
    }

    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        this._flowPhase = (this._flowPhase + dt * 1.8) % (Math.PI * 2);

        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._state     = this._animTo;
            }

            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);

            // 目标开度
            const targetOpen  = this._animTo !== 'closed' ? 1.0 : 0.0;
            const fromOpen    = this._animFrom !== 'closed' ? 1.0 : 0.0;
            const targetPist  = this._animTo === 'forced'  ? 1.0 : 0.0;
            const fromPist    = this._animFrom === 'forced' ? 1.0 : 0.0;

            this._openL  = fromOpen  + (targetOpen  - fromOpen)  * ease;
            this._openR  = fromOpen  + (targetOpen  - fromOpen)  * ease;
            this._pistY  = fromPist  + (targetPist  - fromPist)  * ease;
        }

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const s = this._animating ? this._animTo : this._state;
        const colorMap   = { closed: '#ef5350', flowing: '#66bb6a', forced: '#ff8c42' };
        const strokeMap  = { closed: '#c62828', flowing: '#2e7d32', forced: '#cc6010' };
        const labelMap   = { closed: '关闭',    flowing: '正流',    forced: '强开' };
        const blurMap    = { closed: 2,          flowing: 5,         forced: 6 };

        const c = colorMap[s], dk = strokeMap[s];
        if (this._statusDot) {
            this._statusDot.fill(c); this._statusDot.stroke(dk);
            this._statusDot.shadowColor(c); this._statusDot.shadowBlur(blurMap[s]);
        }
        if (this._statusText) {
            this._statusText.text(labelMap[s]); this._statusText.fill(c);
        }
        if (this._pilotDot) {
            const on = this._pilotOn;
            this._pilotDot.fill(on ? '#ff8c42' : '#546e7a');
            this._pilotDot.stroke(on ? '#cc6010' : '#37474f');
            this._pilotDot.shadowColor('#ff8c42');
            this._pilotDot.shadowBlur(on ? 6 : 0);
        }
    }

    // ════════════════════════════════════════════
    // ── 公开 API ─────────────────────────────────
    // ════════════════════════════════════════════

    /** 设置为流动状态（正向压差导通，两阀瓣自动开启） */
    setFlowing() {
        if (this._animating) return;
        if (this._state === 'flowing') return;
        this._animFrom  = this._state;
        this._animTo    = 'flowing';
        this._animT     = 0;
        this._animating = true;
        this._pilotOn   = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 设置为关闭状态（逆流或无压差，弹簧复位关闭） */
    setClose() {
        if (this._animating) return;
        if (this._state === 'closed') return;
        this._animFrom  = this._state;
        this._animTo    = 'closed';
        this._animT     = 0;
        this._animating = true;
        this._pilotOn   = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 先导气缸强制开启（双向导通） */
    forceOpen() {
        if (this._animating) return;
        if (this._state === 'forced') return;
        this._animFrom  = this._state;
        this._animTo    = 'forced';
        this._animT     = 0;
        this._animating = true;
        this._pilotOn   = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 释放先导气压（恢复止回功能） */
    releaseForce() {
        if (this._animating) return;
        if (this._state !== 'forced') return;
        this._animFrom  = 'forced';
        this._animTo    = 'closed';
        this._animT     = 0;
        this._animating = true;
        this._pilotOn   = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 切换（循环：closed → flowing → forced → closed） */
    toggle() {
        if (this._animating) return;
        const next = { closed: 'flowing', flowing: 'forced', forced: 'closed' };
        const to   = next[this._state];
        this._animFrom  = this._state;
        this._animTo    = to;
        this._animT     = 0;
        this._animating = true;
        this._pilotOn   = to === 'forced';
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询 */
    getState()    { return this._state; }
    isFlowing()   { return this._state === 'flowing'; }
    isClosed()    { return this._state === 'closed';  }
    isForced()    { return this._state === 'forced';  }
    isPilotOn()   { return this._pilotOn; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    /** 通用更新接口 */
    update(state) {
        if      (state === 'flowing' || state === true  || state === 1) this.setFlowing();
        else if (state === 'closed'  || state === false || state === 0) this.setClose();
        else if (state === 'forced'  || state === 2)                    this.forceOpen();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',         key: 'label',         type: 'text'   },
            { label: '公称通径 DN (mm)',   key: 'nominalDN',     type: 'number' },
            { label: '额定压力 (MPa)',     key: 'ratedPressure', type: 'number' },
            { label: '开启压差 (MPa)',     key: 'crackPressure', type: 'number' },
            { label: '先导压力 (MPa)',     key: 'pilotPressure', type: 'number' },
            { label: '介质',               key: 'medium',        type: 'text'   },
            { label: '初始状态(closed/flowing/forced)', key: 'initState', type: 'text' },
            { label: '动作时间 (s)',       key: 'animDur',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label         = cfg.label         || this.label;
        this.nominalDN     = parseFloat(cfg.nominalDN)     || this.nominalDN;
        this.ratedPressure = parseFloat(cfg.ratedPressure) || this.ratedPressure;
        this.crackPressure = parseFloat(cfg.crackPressure) || this.crackPressure;
        this.pilotPressure = parseFloat(cfg.pilotPressure) || this.pilotPressure;
        this.medium        = cfg.medium        || this.medium;
        this._animDur      = parseFloat(cfg.animDur)       || this._animDur;
        if (cfg.initState) this.update(cfg.initState);
        this.config        = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}