import { BaseComponent } from './BaseComponent.js';

/**
 * 手动截止阀（Manual Globe Valve）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  截止阀（Globe Valve）是靠阀瓣沿阀座中心线做直线运动来
 *  控制流体通断与流量调节的手动阀门，由以下部分组成：
 *
 *  1. 阀体（Body）：S 形流道铸铁/铸钢体
 *     - 进口（IN 端）：左侧法兰接口
 *     - 出口（OUT 端）：右侧法兰接口
 *     - 阀座（Seat）：阀体内部的密封环面
 *  2. 阀杆（Stem）：连接手轮与阀瓣的传动螺柱
 *     - 旋转手轮 → 阀杆沿轴向上下移动 → 带动阀瓣
 *  3. 阀盖（Bonnet）：压盖，封闭阀体顶部，引导阀杆
 *  4. 填料函（Packing Gland）：阀盖上部密封填料压盖
 *  5. 阀瓣（Disc / Plug）：与阀座配合的密封件
 *     - 全开（Open）：阀瓣抬起，流道导通
 *     - 全关（Closed）：阀瓣压紧阀座，流道截断
 *  6. 手轮（Handwheel）：顶部操作轮，顺时针关闭（右旋截止）
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  开启：手轮逆时针旋转 → 阀杆上移 → 阀瓣离开阀座 → 流道导通
 *  关闭：手轮顺时针旋转 → 阀杆下移 → 阀瓣压紧阀座 → 流道截断
 *
 *  开度（opening）：0.0（全关）~ 1.0（全开），支持中间开度调节
 *  手轮旋转动画：开关过程中手轮同步旋转（多圈）
 *  流体粒子动画：开启时在 S 形流道内显示流动粒子
 *  填料函密封光晕：阀杆处根据密封状态显示提示
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View）剖面仿真，可见：
 *  阀体 S 形流道截面、阀座、阀瓣位置、阀杆、阀盖、
 *  填料函、手轮（含辐条）、进出口法兰
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_in  — 进口（左侧法兰外端面）
 *  port_out — 出口（右侧法兰外端面）
 */
export class GlobeValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 240);
        this.height = Math.max(220, config.height || 260);

        this.type    = 'globe_valve';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedPressure = config.ratedPressure || 1.6;    // MPa
        this.ratedTemp     = config.ratedTemp     || 200;    // ℃
        this.nominalDN     = config.nominalDN     || 25;     // mm（公称通径）
        this.medium        = config.medium        || '水';
        this.label         = config.label         || 'V';    // 位号

        // ── 状态 ──
        // opening: 0.0 = 全关，1.0 = 全开
        this._opening     = config.initOpening != null
            ? Math.min(1, Math.max(0, config.initOpening))
            : 0.0;                        // 默认全关
        this._animating   = false;
        this._animT       = 0;
        this._animFrom    = this._opening;
        this._animTo      = this._opening;
        this._animDur     = config.animDur || 0.40;  // s（全行程动画时长）
        this._wheelAngle  = 0;            // °，手轮累计旋转角
        this._flowPhase   = 0;
        this.opsCount     = config.initOps || 0;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 阀体主矩形（中央）
        this._body = {
            x: W * 0.18, y: H * 0.42,
            w: W * 0.64, h: H * 0.30,
            rx: 6,
        };

        // 阀体中腔（S 流道腔室）
        this._chamber = {
            x: W * 0.22, y: H * 0.44,
            w: W * 0.56, h: H * 0.26,
            rx: 4,
        };

        // 阀座（位于阀体内中央）
        this._seat = {
            cx: W * 0.50,
            y:  H * 0.54,
            rOuter: W * 0.095,
            rInner: W * 0.052,
            h:  H * 0.035,
        };

        // 阀盖（Bonnet，阀体顶部向上延伸）
        this._bonnet = {
            x: W * 0.37, y: H * 0.22,
            w: W * 0.26, h: H * 0.22,
            rx: 3,
        };

        // 填料函（Gland，阀盖上端）
        this._gland = {
            x: W * 0.40, y: H * 0.15,
            w: W * 0.20, h: H * 0.08,
            rx: 2,
        };

        // 阀杆（Stem，贯穿阀盖到阀瓣）
        this._stemX   = W * 0.50;
        this._stemW   = W * 0.040;
        // 阀杆行程（阀瓣全开时阀杆顶端比全关时高出 stemStroke px）
        this._stemStroke = H * 0.090;
        // 阀杆底端（阀瓣顶部连接点）在全关时的 Y
        this._stemBotClosed = this._seat.y - H * 0.010;
        // 阀盖顶端 Y（阀杆从这里伸出）
        this._stemTopY = this._gland.y;

        // 手轮（Handwheel，填料函上方）
        this._wheel = {
            cx: W * 0.50,
            cy: H * 0.085,
            rOuter: W * 0.170,
            rInner: W * 0.028,
            spokeCount: 5,
            rimW: W * 0.028,
        };

        // 进出口法兰管颈
        const flangeY   = H * 0.49;
        const flangeH   = H * 0.115;
        const flangeW   = W * 0.20;
        this._flangeIn  = { x: this._body.x - flangeW, y: flangeY, w: flangeW, h: flangeH };
        this._flangeOut = { x: this._body.x + this._body.w, y: flangeY, w: flangeW, h: flangeH };


        this._init();

        // 端口
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
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawFlanges();
        this._drawBody();
        this._drawBonnet();
        this._drawGland();
        this._drawSeat();
        this._drawLabel();
        this._drawStatusIndicator();
        this._drawDynamicLayer();   // 阀杆 + 阀瓣 + 流道 + 手轮
        
    }

    // ── 进出口法兰管颈 ────────────────────────
    _drawFlanges() {
        [this._flangeIn, this._flangeOut].forEach((f, i) => {
            const isLeft = i === 0;
            const crBody = isLeft ? [3, 0, 0, 3] : [0, 3, 3, 0];

            // 管颈主体（金属灰渐变）
            this.group.add(new Konva.Rect({
                x: f.x, y: f.y, width: f.w, height: f.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: f.h },
                fillLinearGradientColorStops: [
                    0,   '#5a5a60',
                    0.3, '#909098',
                    0.6, '#a8a8b0',
                    1,   '#4a4a50',
                ],
                stroke: '#38383e', strokeWidth: 1.2,
                cornerRadius: crBody,
            }));
            // 管颈内腔（流道）
            this.group.add(new Konva.Rect({
                x: f.x + f.w * 0.15, y: f.y + f.h * 0.18,
                width: f.w * 0.70, height: f.h * 0.64,
                fill: '#0e0e1a', cornerRadius: 2,
            }));
            // 法兰盘（连接面）
            const flangeX = isLeft ? f.x + f.w - f.w * 0.12 : f.x;
            this.group.add(new Konva.Rect({
                x: flangeX, y: f.y - f.h * 0.15,
                width: f.w * 0.12, height: f.h * 1.30,
                fill: '#7a7a82', stroke: '#505058', strokeWidth: 0.8,
                cornerRadius: 1,
            }));
            // 法兰螺栓孔（装饰）
            const boltX = flangeX + f.w * 0.06;
            [f.y + f.h * 0.15, f.y + f.h * 0.85].forEach(by => {
                this.group.add(new Konva.Circle({
                    x: boltX, y: by, radius: f.h * 0.10,
                    fill: '#444', stroke: '#333', strokeWidth: 0.6,
                }));
            });
            // 端口色标环
            const ringX = isLeft ? f.x : f.x + f.w - f.w * 0.08;
            this.group.add(new Konva.Rect({
                x: ringX, y: f.y + f.h * 0.10,
                width: f.w * 0.08, height: f.h * 0.80,
                fill: isLeft ? '#ef9a9a' : '#90caf9',
                cornerRadius: isLeft ? [2, 0, 0, 2] : [0, 2, 2, 0],
            }));
            // IN / OUT 标注
            this.group.add(new Konva.Text({
                x: isLeft ? f.x - 2 : f.x + f.w - 16,
                y: f.y + f.h + 4,
                text: isLeft ? 'IN' : 'OUT',
                fontSize: 8, fontStyle: 'bold',
                fill: isLeft ? '#ef9a9a' : '#90caf9',
            }));
        });
    }

    // ── 阀体 ──────────────────────────────────
    _drawBody() {
        const b = this._body;

        // 阀体主体（铸铁灰）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#70707a',
                0.28,'#909098',
                0.55,'#9c9ca6',
                1,   '#565660',
            ],
            stroke: '#38383e', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetY: 3, shadowOpacity: 0.38,
        }));
        // 顶面高光
        this.group.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 2, width: b.w - 6, height: b.h * 0.14,
            fill: 'rgba(255,255,255,0.10)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 底面暗影
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y + b.h * 0.80, width: b.w, height: b.h * 0.20,
            fill: 'rgba(0,0,0,0.22)',
            cornerRadius: [0, 0, b.rx, b.rx],
        }));

        // 阀体内腔（S 形流道背景）
        const ch = this._chamber;
        this.group.add(new Konva.Rect({
            x: ch.x, y: ch.y, width: ch.w, height: ch.h,
            fill: '#131318', stroke: '#222228', strokeWidth: 0.8,
            cornerRadius: ch.rx,
        }));

        // 左侧流道横腔（连接法兰进口到阀座）
        const seat = this._seat;
        this.group.add(new Konva.Rect({
            x: ch.x, y: ch.y + ch.h * 0.28,
            width: seat.cx - ch.x - seat.rOuter * 0.5, height: ch.h * 0.44,
            fill: '#0e0e18', cornerRadius: [0, 0, 0, 2],
        }));
        // 右侧流道横腔（连接阀座到法兰出口）
        this.group.add(new Konva.Rect({
            x: seat.cx + seat.rOuter * 0.5, y: ch.y + ch.h * 0.28,
            width: ch.x + ch.w - seat.cx - seat.rOuter * 0.5, height: ch.h * 0.44,
            fill: '#0e0e18', cornerRadius: [0, 0, 2, 0],
        }));
        // 阀座下腔（阀座下方出流腔）
        this.group.add(new Konva.Rect({
            x: seat.cx - seat.rOuter * 0.80, y: seat.y + seat.h,
            width: seat.rOuter * 1.60, height: ch.y + ch.h - seat.y - seat.h - 2,
            fill: '#0d0d16', cornerRadius: [0, 0, 2, 2],
        }));

        // 阀体侧面装饰加强筋
        const ribY = b.y + b.h * 0.40;
        [b.x + b.w * 0.12, b.x + b.w * 0.88].forEach(rx => {
            this.group.add(new Konva.Rect({
                x: rx - 3, y: b.y + 2, width: 6, height: b.h - 4,
                fill: 'rgba(255,255,255,0.06)', cornerRadius: 2,
            }));
        });
    }

    // ── 阀盖 ──────────────────────────────────
    _drawBonnet() {
        const bn = this._bonnet;

        // 阀盖主体
        this.group.add(new Konva.Rect({
            x: bn.x, y: bn.y, width: bn.w, height: bn.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bn.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#5a5a62',
                0.30,'#8a8a94',
                0.60,'#9a9aa4',
                1,   '#4e4e58',
            ],
            stroke: '#38383e', strokeWidth: 1.2,
            cornerRadius: [bn.rx, bn.rx, 0, 0],
            shadowColor: '#000', shadowBlur: 4, shadowOpacity: 0.25,
        }));
        // 阀盖内孔（阀杆孔）
        this.group.add(new Konva.Rect({
            x: this._stemX - this._stemW * 0.9,
            y: bn.y + 2,
            width: this._stemW * 1.8,
            height: bn.h - 2,
            fill: '#0d0d18', cornerRadius: [1, 1, 0, 0],
        }));
        // 阀盖螺柱（两侧）
        [bn.x + bn.w * 0.12, bn.x + bn.w * 0.88].forEach(bx => {
            this.group.add(new Konva.Rect({
                x: bx - 4, y: bn.y + bn.h * 0.60,
                width: 8, height: bn.h * 0.50,
                fill: '#888', stroke: '#555', strokeWidth: 0.6,
                cornerRadius: 1,
            }));
        });
        // 阀盖顶部六角凸缘
        const hexW = bn.w * 1.10, hexH = bn.h * 0.14;
        this.group.add(new Konva.Rect({
            x: bn.x - bn.w * 0.05, y: bn.y,
            width: hexW, height: hexH,
            fill: '#7a7a84', stroke: '#505058', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 高光
        this.group.add(new Konva.Line({
            points: [bn.x + 4, bn.y + bn.h * 0.25, bn.x + 4, bn.y + bn.h * 0.75],
            stroke: 'rgba(255,255,255,0.12)', strokeWidth: 2, lineCap: 'round',
        }));
    }

    // ── 填料函 ────────────────────────────────
    _drawGland() {
        const g = this._gland;

        // 填料函主体（压盖，六角形简化为矩形）
        this.group.add(new Konva.Rect({
            x: g.x, y: g.y, width: g.w, height: g.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: g.w, y: 0 },
            fillLinearGradientColorStops: [0,'#606068',0.5,'#a0a0a8',1,'#606068'],
            stroke: '#404048', strokeWidth: 1.0,
            cornerRadius: [2, 2, 0, 0],
        }));
        // 填料函顶部六角缘
        this.group.add(new Konva.Rect({
            x: g.x - g.w * 0.08, y: g.y,
            width: g.w * 1.16, height: g.h * 0.28,
            fill: '#888', stroke: '#555', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 阀杆孔
        this.group.add(new Konva.Rect({
            x: this._stemX - this._stemW * 0.85,
            y: g.y,
            width: this._stemW * 1.7,
            height: g.h,
            fill: '#0a0a14', cornerRadius: [1, 1, 0, 0],
        }));
    }

    // ── 阀座（固定静态部分）──────────────────
    _drawSeat() {
        const s = this._seat;

        // 阀座环（梯形截面简化为矩形，两侧斜肩用多边形）
        // 左侧阀座肩
        this.group.add(new Konva.Line({
            points: [
                s.cx - s.rOuter, s.y,
                s.cx - s.rInner, s.y + s.h,
                s.cx - s.rInner, s.y + s.h,
                s.cx - s.rOuter, s.y,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: -s.rOuter, y: 0 },
            fillLinearGradientEndPoint:   { x: -s.rInner, y: 0 },
            fillLinearGradientColorStops: [0,'#8a8a94',0.5,'#c0c0ca',1,'#7a7a84'],
            stroke: '#3a3a42', strokeWidth: 0.8,
        }));
        // 右侧阀座肩
        this.group.add(new Konva.Line({
            points: [
                s.cx + s.rInner, s.y + s.h,
                s.cx + s.rOuter, s.y,
                s.cx + s.rOuter, s.y,
                s.cx + s.rInner, s.y + s.h,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: s.rInner, y: 0 },
            fillLinearGradientEndPoint:   { x: s.rOuter, y: 0 },
            fillLinearGradientColorStops: [0,'#7a7a84',0.5,'#c0c0ca',1,'#8a8a94'],
            stroke: '#3a3a42', strokeWidth: 0.8,
        }));
        // 阀座内孔（节流口）
        this.group.add(new Konva.Rect({
            x: s.cx - s.rInner, y: s.y,
            width: s.rInner * 2, height: s.h,
            fill: '#080810',
        }));
        // 阀座密封面高光
        this.group.add(new Konva.Line({
            points: [s.cx - s.rOuter, s.y + 1, s.cx + s.rOuter, s.y + 1],
            stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1, lineCap: 'round',
        }));
    }

    // ── 标注 ──────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  DN${this.nominalDN}  ${this.ratedPressure}MPa  ${this.ratedTemp}℃`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: this._body.y + this._body.h + 6, width: W,
            text: `介质：${this.medium}`,
            fontSize: 8, fill: '#78909c', align: 'center',
        }));
    }

    // ── 状态指示 ──────────────────────────────
    _drawStatusIndicator() {
        const ix = this._body.x + 10;
        const iy = this._body.y + this._body.h / 2;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill:        this._opening > 0.01 ? '#66bb6a' : '#ef5350',
            stroke:      this._opening > 0.01 ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: this._opening > 0.01 ? '#66bb6a' : '#ef5350',
            shadowBlur:  this._opening > 0.01 ? 5 : 2,
            shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text:     this._openingLabel(),
            fontSize: 8, fontStyle: 'bold',
            fill:     this._opening > 0.01 ? '#66bb6a' : '#ef5350',
        });
        // 开度数值（阀盖右侧）
        this._openingText = new Konva.Text({
            x: this._bonnet.x + this._bonnet.w + 4,
            y: this._bonnet.y + this._bonnet.h * 0.40,
            text: `${Math.round(this._opening * 100)}%`,
            fontSize: 9, fontStyle: 'bold', fill: '#80cbc4',
        });
        this.group.add(this._statusDot, this._statusText, this._openingText);
    }

    _openingLabel() {
        if (this._opening < 0.01) return '关';
        if (this._opening > 0.99) return '全开';
        return `${Math.round(this._opening * 100)}%`;
    }

    // ════════════════════════════════════════════
    // ── 动态层 ───────────────────────────────────
    // ════════════════════════════════════════════
    _drawDynamicLayer() {
        this._dynGroup = new Konva.Group();
        this.group.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();

        const opening = this._opening;    // 0~1
        const phase   = this._flowPhase;
        const seat    = this._seat;
        const g       = this._gland;
        const bn      = this._bonnet;

        // ── 1. 阀杆当前底端 Y ──
        // 全关时阀杆底端 = 阀座顶部；全开时抬起 stemStroke
        const stemBotY = this._stemBotClosed - opening * this._stemStroke;
        const stemTopY = g.y + g.h * 0.30;   // 从填料函穿出
        const stemX    = this._stemX;
        const stemHW   = this._stemW / 2;

        // ── 2. 阀瓣（Disc）──
        this._drawDisc(stemBotY, opening, seat);

        // ── 3. 阀杆 ──
        this._dynGroup.add(new Konva.Rect({
            x: stemX - stemHW, y: stemTopY,
            width: stemHW * 2, height: stemBotY - stemTopY,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: stemHW * 2, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#4a4a52',
                0.35,'#9898a2',
                0.65,'#aaaab4',
                1,   '#4a4a52',
            ],
            stroke: '#30303a', strokeWidth: 0.6,
        }));
        // 阀杆螺纹线条（装饰）
        const threadTop = stemTopY + 2, threadBot = stemTopY + (stemBotY - stemTopY) * 0.55;
        for (let ty = threadTop; ty < threadBot; ty += 4) {
            this._dynGroup.add(new Konva.Line({
                points: [stemX - stemHW, ty, stemX + stemHW, ty + 2],
                stroke: 'rgba(0,0,0,0.25)', strokeWidth: 0.7,
            }));
        }
        // 阀杆顶部连接头（与手轮轮毂连接）
        this._dynGroup.add(new Konva.Rect({
            x: stemX - stemHW * 1.5, y: stemTopY - 4,
            width: stemHW * 3, height: 6,
            fill: '#7a7a84', stroke: '#505058', strokeWidth: 0.6, cornerRadius: 1,
        }));

        // ── 4. 流体粒子（有开度时）──
        if (opening > 0.02) {
            this._drawFlowParticles(opening, phase, seat);
        }

        // ── 5. 手轮 ──
        this._drawHandwheel(opening);
    }

    // ── 阀瓣 ──────────────────────────────────
    _drawDisc(stemBotY, opening, seat) {
        const closed = opening < 0.01;
        const discW  = seat.rInner * 2.6;
        const discH  = seat.h * 1.40;

        // 阀瓣主体（锥形，正视图简化为矩形+下梯形）
        // 阀瓣上部（圆柱段）
        this._dynGroup.add(new Konva.Rect({
            x: seat.cx - discW * 0.38, y: stemBotY,
            width: discW * 0.76, height: discH * 0.55,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: discW * 0.76, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#5a5a62',
                0.3, '#9090a0',
                0.6, '#a8a8b8',
                1,   '#5a5a62',
            ],
            stroke: '#30303a', strokeWidth: 0.7,
            cornerRadius: [2, 2, 0, 0],
        }));
        // 阀瓣下部（锥面密封段）
        this._dynGroup.add(new Konva.Line({
            points: [
                seat.cx - discW * 0.38, stemBotY + discH * 0.55,
                seat.cx + discW * 0.38, stemBotY + discH * 0.55,
                seat.cx + seat.rInner * 0.80, stemBotY + discH,
                seat.cx - seat.rInner * 0.80, stemBotY + discH,
            ],
            closed: true,
            fillLinearGradientStartPoint: { x: -discW*0.38, y: 0 },
            fillLinearGradientEndPoint:   { x: discW*0.38,  y: 0 },
            fillLinearGradientColorStops: [0,'#505058',0.5,'#9898a8',1,'#505058'],
            stroke: '#30303a', strokeWidth: 0.7,
        }));
        // 密封面（阀瓣底端接触面）
        this._dynGroup.add(new Konva.Ellipse({
            x: seat.cx, y: stemBotY + discH,
            radiusX: seat.rInner * 0.80,
            radiusY: discH * 0.06,
            fill: closed ? '#880000' : 'rgba(80,160,80,0.5)',
            stroke: closed ? '#550000' : 'rgba(60,140,60,0.8)',
            strokeWidth: 0.8,
            shadowColor: closed ? '#ff0000' : '#00ff88',
            shadowBlur:  closed ? 4 : 2,
            shadowOpacity: closed ? 0.35 : 0.25,
        }));
        // 全关时密封接触高亮
        if (closed) {
            this._dynGroup.add(new Konva.Ellipse({
                x: seat.cx, y: seat.y + seat.h * 0.5,
                radiusX: seat.rInner * 0.90,
                radiusY: seat.h * 0.40,
                fill: 'rgba(255,60,60,0.18)',
            }));
        }
    }

    // ── 流体粒子（S 形路径）──────────────────
    _drawFlowParticles(opening, phase, seat) {
        const numPts = 7;
        const ch     = this._chamber;
        const fIn    = this._flangeIn;
        const fOut   = this._flangeOut;

        // 根据开度调整粒子透明度和速度
        const alpha = 0.35 + 0.40 * opening;

        for (let i = 0; i < numPts; i++) {
            // S 形路径：进口横向 → 向下过阀座 → 出口横向
            const t   = ((i / numPts) + phase * 0.40) % 1.0;
            let px, py;

            if (t < 0.30) {
                // 阶段1：进口段（横向从左进入阀腔左侧）
                const tt = t / 0.30;
                px = fIn.x + (seat.cx - seat.rOuter * 1.2 - fIn.x) * tt;
                py = ch.y + ch.h * (0.35 + 0.12 * Math.sin(phase * 3 + i));
            } else if (t < 0.55) {
                // 阶段2：向下穿越阀座节流口
                const tt = (t - 0.30) / 0.25;
                px = seat.cx + (Math.random() - 0.5) * seat.rInner * 1.2;
                py = (seat.y - seat.h) + (ch.y + ch.h - seat.y + seat.h * 2) * tt;
            } else {
                // 阶段3：出口段（从阀腔右侧横向流出）
                const tt = (t - 0.55) / 0.45;
                px = (seat.cx + seat.rOuter * 1.2) + (fOut.x + fOut.w - seat.cx - seat.rOuter * 1.2) * tt;
                py = ch.y + ch.h * (0.35 + 0.12 * Math.sin(phase * 2.5 + i + 1));
            }

            const r = (1.5 + 1.2 * Math.sin(phase * 5 + i * 1.2)) * opening;
            this._dynGroup.add(new Konva.Circle({
                x: px, y: py, radius: Math.max(0.5, r),
                fill: `rgba(40,150,255,${alpha * (0.6 + 0.4 * Math.sin(phase * 4 + i))})`,
            }));
        }

        // 阀座节流口过流高亮（光柱）
        const gapH = seat.h + (seat.y - this._stemBotClosed + opening * this._stemStroke) * 0.6;
        const glowA = 0.08 + 0.08 * opening + 0.04 * Math.sin(phase * 6);
        this._dynGroup.add(new Konva.Rect({
            x: seat.cx - seat.rInner, y: seat.y,
            width: seat.rInner * 2, height: gapH,
            fill: `rgba(40,180,255,${glowA})`,
            cornerRadius: 1,
        }));
    }

    // ── 手轮 ──────────────────────────────────
    _drawHandwheel(opening) {
        const wh  = this._wheel;
        const cx  = wh.cx, cy  = wh.cy;
        const rO  = wh.rOuter, rI = wh.rInner;
        const angle = this._wheelAngle;   // °

        const g = this._dynGroup;

        // ── 手轮轮缘（外圈） ──
        g.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: rO - wh.rimW,
            outerRadius: rO,
            fillLinearGradientStartPoint: { x: -rO, y: 0 },
            fillLinearGradientEndPoint:   { x: rO,  y: 0 },
            fillLinearGradientColorStops: [
                0,   '#4a4a52',
                0.3, '#8888a0',
                0.6, '#a0a0b8',
                1,   '#4a4a52',
            ],
            stroke: '#28283a', strokeWidth: 1.0,
            rotation: angle,
            shadowColor: '#000', shadowBlur: 5,
            shadowOffsetY: 2, shadowOpacity: 0.35,
        }));

        // ── 辐条 ──
        for (let k = 0; k < wh.spokeCount; k++) {
            const spokeAngle = (angle + k * 360 / wh.spokeCount) * Math.PI / 180;
            const x1 = cx + Math.cos(spokeAngle) * rI * 1.8;
            const y1 = cy + Math.sin(spokeAngle) * rI * 1.8;
            const x2 = cx + Math.cos(spokeAngle) * (rO - wh.rimW * 0.8);
            const y2 = cy + Math.sin(spokeAngle) * (rO - wh.rimW * 0.8);
            g.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#7878a0', strokeWidth: 2.5, lineCap: 'round',
            }));
            // 辐条高光
            g.add(new Konva.Line({
                points: [x1 + 0.6, y1 + 0.6, x2 + 0.6, y2 + 0.6],
                stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1, lineCap: 'round',
            }));
        }

        // ── 轮毂（中心） ──
        g.add(new Konva.Circle({
            x: cx, y: cy, radius: rI * 1.6,
            fillLinearGradientStartPoint: { x: -rI*1.6, y: -rI*1.6 },
            fillLinearGradientEndPoint:   { x: rI*1.6,  y: rI*1.6  },
            fillLinearGradientColorStops: [0,'#606070',0.5,'#a0a0b8',1,'#505060'],
            stroke: '#30303e', strokeWidth: 1.0,
        }));
        // 轮毂十字槽
        g.add(new Konva.Line({
            points: [cx - rI, cy, cx + rI, cy],
            stroke: 'rgba(0,0,0,0.30)', strokeWidth: 1.2, lineCap: 'round',
        }));
        g.add(new Konva.Line({
            points: [cx, cy - rI, cx, cy + rI],
            stroke: 'rgba(0,0,0,0.30)', strokeWidth: 1.2, lineCap: 'round',
        }));
        // 轮毂顶部高光
        g.add(new Konva.Circle({
            x: cx - rI * 0.40, y: cy - rI * 0.40,
            radius: rI * 0.55,
            fill: 'rgba(255,255,255,0.10)',
        }));

        // ── 手轮顶端固定螺母 ──
        g.add(new Konva.RegularPolygon({
            x: cx, y: cy, sides: 6, radius: rI * 0.85,
            fill: '#888', stroke: '#555', strokeWidth: 0.7, rotation: 30,
        }));

        // ── 开/关方向指示文字 ──
        g.add(new Konva.Text({
            x: cx - rO * 0.75, y: cy + rO * 0.55,
            text: '→关', fontSize: 7, fill: '#ef9a9a', fontStyle: 'bold',
        }));
        g.add(new Konva.Text({
            x: cx + rO * 0.26, y: cy + rO * 0.55,
            text: '开←', fontSize: 7, fill: '#90caf9', fontStyle: 'bold',
        }));
    }

    // ════════════════════════════════════════════
    // ── 动画驱动 ─────────────────────────────────
    // ════════════════════════════════════════════
    _bindInteraction() {
        // 点击手轮区域 → 切换全开/全关
        this._dynGroup.on('click tap', () => {
            this._opening > 0.5 ? this.close() : this.open();
        });
        this._dynGroup.listening(true);
    }

    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        // 持续推进粒子相位
        if (this._opening > 0.02) {
            this._flowPhase = (this._flowPhase + dt * 1.6) % (Math.PI * 2);
        }

        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._opening   = this._animTo;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._opening = this._animFrom + (this._animTo - this._animFrom) * ease;

            // 手轮旋转：全行程对应 360°×3 圈
            const delta = (this._animTo - this._animFrom);
            this._wheelAngle -= delta * dt / this._animDur * 360 * 3;
        }

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const o = this._opening;
        const isOpen = o > 0.01;
        if (this._statusDot) {
            this._statusDot.fill(isOpen ? '#66bb6a' : '#ef5350');
            this._statusDot.stroke(isOpen ? '#2e7d32' : '#c62828');
            this._statusDot.shadowColor(isOpen ? '#66bb6a' : '#ef5350');
            this._statusDot.shadowBlur(isOpen ? 5 : 2);
        }
        if (this._statusText) {
            this._statusText.text(this._openingLabel());
            this._statusText.fill(isOpen ? '#66bb6a' : '#ef5350');
        }
        if (this._openingText) {
            this._openingText.text(`${Math.round(o * 100)}%`);
            this._openingText.fill(
                o < 0.01 ? '#ef5350' : o > 0.99 ? '#66bb6a' : '#80cbc4'
            );
        }
    }

    // ════════════════════════════════════════════
    // ── 公开 API ─────────────────────────────────
    // ════════════════════════════════════════════

    /** 全开（逆时针旋转手轮，阀杆上移） */
    open() {
        if (this._animating) return;
        if (this._opening >= 1.0) return;
        this._animFrom  = this._opening;
        this._animTo    = 1.0;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 全关（顺时针旋转手轮，阀杆下移压紧阀座） */
    close() {
        if (this._animating) return;
        if (this._opening <= 0.0) return;
        this._animFrom  = this._opening;
        this._animTo    = 0.0;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /**
     * 设置开度（0.0~1.0），带动画过渡
     * @param {number} target  目标开度 0.0~1.0
     */
    setOpening(target) {
        target = Math.min(1, Math.max(0, target));
        if (this._animating) return;
        if (Math.abs(target - this._opening) < 0.01) return;
        // 动画时长按行程比例缩短
        const stroke    = Math.abs(target - this._opening);
        this._animDur   = (this.config.animDur || 0.40) * stroke;
        this._animFrom  = this._opening;
        this._animTo    = target;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询状态 */
    isOpen()      { return this._opening > 0.01; }
    isClosed()    { return this._opening < 0.01; }
    isFullOpen()  { return this._opening > 0.99; }
    getOpening()  { return this._opening; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    /** 通用更新接口 */
    update(state) {
        if      (state === true  || state === 1)    this.open();
        else if (state === false || state === 0)    this.close();
        else if (typeof state === 'number')         this.setOpening(state);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',        key: 'label',         type: 'text'   },
            { label: '公称通径 DN (mm)',  key: 'nominalDN',     type: 'number' },
            { label: '额定压力 (MPa)',    key: 'ratedPressure', type: 'number' },
            { label: '额定温度 (℃)',     key: 'ratedTemp',     type: 'number' },
            { label: '介质',              key: 'medium',        type: 'text'   },
            { label: '初始开度 (0~1)',    key: 'initOpening',   type: 'number' },
            { label: '动作时间 (s)',      key: 'animDur',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label         = cfg.label         || this.label;
        this.nominalDN     = parseFloat(cfg.nominalDN)     || this.nominalDN;
        this.ratedPressure = parseFloat(cfg.ratedPressure) || this.ratedPressure;
        this.ratedTemp     = parseFloat(cfg.ratedTemp)     || this.ratedTemp;
        this.medium        = cfg.medium        || this.medium;
        if (cfg.animDur !== undefined) this._animDur = parseFloat(cfg.animDur) || this._animDur;
        if (cfg.initOpening !== undefined) {
            const target = Math.min(1, Math.max(0, parseFloat(cfg.initOpening)));
            if (Math.abs(target - this._opening) > 0.01) this.setOpening(target);
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}