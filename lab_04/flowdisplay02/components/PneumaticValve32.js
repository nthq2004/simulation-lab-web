import { BaseComponent } from './BaseComponent.js';

/**
 * 气动两位三通换向阀仿真组件
 * （Pneumatic 3/2-Way Directional Control Valve）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  两位三通阀是气动系统中常用的方向控制元件，
 *  有三个气口、两个工作位，由以下部分组成：
 *
 *  1. 阀体（Valve Body）：铝合金长方体，内含三条气道
 *     - P 口（Supply）：压缩空气进气口，阀体底部中央
 *     - A 口（Work）：  工作口，阀体顶部
 *     - R 口（Exhaust）：排气口，阀体底部侧面（带消声器）
 *
 *  2. 阀芯（Spool）：在阀体孔内左右滑动的精密圆柱滑块
 *     - 位置 1（常态位 / Spring Return）：弹簧复位
 *       A 口与 R 口连通（排气），P 口封闭
 *     - 位置 2（气控位 / Actuated）：气信号推动
 *       P 口与 A 口连通（供气），R 口封闭
 *
 *  3. 气控端（Pilot Port / 12 号口）：阀体右端
 *     - 接入控制气信号（先导压力）推动阀芯向左
 *  4. 复位弹簧（Return Spring）：阀体左端，断气时将阀芯推回右位
 *  5. 弹簧盖（Spring Cap）：左端封盖，内含复位弹簧
 *  6. 消声器（Silencer）：R 口安装的排气消声块
 *  7. ISO 符号（辅助图）：阀体下方的两格方块图
 *
 * ── 两个工作位 ────────────────────────────────────────────────
 *
 *  ┌───────────────────────────────────────────────────────────┐
 *  │  常态位（位置 1 / Normal）：无控制信号，弹簧保持           │
 *  │    A → R（工作口排气），P 口封闭                          │
 *  │  动作位（位置 2 / Actuated）：气控信号加压                │
 *  │    P → A（供气至工作口），R 口封闭                        │
 *  └───────────────────────────────────────────────────────────┘
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View）剖面仿真，可见：
 *  铝合金阀体、阀芯凸肩/凹槽、左端弹簧盖及弹簧、
 *  右端气控腔及先导气口、三个管口（P/A/R）、
 *  消声器、流道高亮、气泡粒子、ISO 符号
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_p  — P 口（供气口，底部中央）
 *  port_a  — A 口（工作口，顶部）
 *  port_r  — R 口（排气口，底部右侧，带消声器）
 *  pilot   — 气控口 12（右端侧面）
 */
export class PneumaticValve32 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(240, config.width  || 280);
        this.height = Math.max(180, config.height || 210);

        this.type    = 'pneumatic_valve_3_2';
        this.special = 'none';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 额定参数 ──
        this.ratedPressure  = config.ratedPressure  || 0.8;   // MPa
        this.pilotPressure  = config.pilotPressure  || 0.15;  // MPa（最小先导压力）
        this.ratedFlow      = config.ratedFlow      || 200;   // L/min
        this.medium         = config.medium         || '压缩空气';
        this.label          = config.label          || 'QV';  // 位号
        this.valveFunc      = config.valveFunc      || 'NC';  // NC=常闭(A排气), NO=常开(A供气)

        // ── 状态 ──
        // position: 'normal'（常态）| 'actuated'（动作）
        this._position  = 'normal';
        this._animating = false;
        this._animT     = 0;
        this._animFrom  = 'normal';
        this._animTo    = 'normal';
        this._animDur   = config.animDur || 0.16;   // s
        // 阀芯偏移：0 = 常态（弹簧侧），1 = 动作（气控侧推入）
        this._spoolX    = 0;
        this._flowPhase = 0;
        this._pilotOn   = false;
        this.opsCount   = config.initOps || 0;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        // 阀体主体（铝合金长方体，横向）
        this._body = {
            x: W * 0.16, y: H * 0.30,
            w: W * 0.68, h: H * 0.36,
            rx: 4,
        };

        // 阀孔（bore）：阀芯在此水平滑动
        this._bore = {
            x: this._body.x + this._body.w * 0.03,
            y: this._body.y + this._body.h * 0.28,
            w: this._body.w * 0.94,
            h: this._body.h * 0.44,
        };

        // 阀芯总长 & 最大偏移
        this._spoolLen    = this._bore.w * 0.58;
        this._spoolMaxOff = this._bore.w * 0.20;  // 单侧最大位移

        // 弹簧盖（左端）
        this._springCap = {
            x: this._body.x - W * 0.080,
            y: this._body.y + this._body.h * 0.08,
            w: W * 0.080,
            h: this._body.h * 0.84,
            rx: 3,
        };

        // 气控腔盖（右端）
        this._pilotCap = {
            x: this._body.x + this._body.w,
            y: this._body.y + this._body.h * 0.08,
            w: W * 0.080,
            h: this._body.h * 0.84,
            rx: 3,
        };

        // 三个气口管颈
        const neckH = H * 0.12, neckW = W * 0.058;
        const bodyTopY = this._body.y;
        const bodyBotY = this._body.y + this._body.h;

        // A 口：顶部，阀体中偏左
        this._portA = {
            x: W * 0.355, y: bodyTopY - neckH,
            w: neckW, h: neckH,
        };
        // P 口：底部中央
        this._portP = {
            x: W * 0.470, y: bodyBotY,
            w: neckW, h: neckH,
        };
        // R 口：底部右侧（带消声器）
        this._portR = {
            x: W * 0.600, y: bodyBotY,
            w: neckW, h: neckH,
        };
        // 气控口（先导口，右端盖右侧面）
        this._portPilot = {
            x: this._pilotCap.x + this._pilotCap.w,
            y: this._pilotCap.y + this._pilotCap.h * 0.45,
        };

        // 各口在阀体内的中心 X（用于流道绘制）
        this._portAx = this._portA.x + neckW / 2;
        this._portPx = this._portP.x + neckW / 2;
        this._portRx = this._portR.x + neckW / 2;


        this._init();

        // 注册端口
        this.addPort(
            this._portA.x + neckW / 2,
            this._portA.y,
            'port_a', 'pipe', 'A'
        );
        this.addPort(
            this._portP.x + neckW / 2,
            this._portP.y + neckH,
            'port_p', 'pipe', 'P'
        );
        this.addPort(
            this._portR.x + neckW / 2,
            this._portR.y + neckH,
            'port_r', 'pipe', 'R'
        );
        this.addPort(
            this._portPilot.x + 2,
            this._portPilot.y,
            'pilot', 'pipe', '12'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();
        this._drawSpringCap();
        this._drawPilotCap();
        this._drawPorts();
        this._drawSilencer();
        this._drawIsoSymbol();
        this._drawLabel();
        this._drawPortLabels();
        this._drawStatusIndicator();
        this._drawDynamicLayer();
        
    }

    // ── 阀体主体 ──────────────────────────────
    _drawBody() {
        const b = this._body;

        // 铝合金阀体（银灰渐变）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#7a7a84',
                0.22,'#a2a2ae',
                0.50,'#b4b4c0',
                0.78,'#9898a4',
                1,   '#606068',
            ],
            stroke: '#3c3c44', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 7,
            shadowOffsetY: 3, shadowOpacity: 0.35,
        }));
        // 顶面高光条
        this._staticGroup.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 2, width: b.w - 6, height: b.h * 0.13,
            fill: 'rgba(255,255,255,0.13)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 底面暗影
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y + b.h * 0.82, width: b.w, height: b.h * 0.18,
            fill: 'rgba(0,0,0,0.20)',
            cornerRadius: [0, 0, b.rx, b.rx],
        }));
        // 阀体铭牌区
        this._staticGroup.add(new Konva.Rect({
            x: b.x + b.w * 0.32, y: b.y + b.h * 0.10,
            width: b.w * 0.36, height: b.h * 0.20,
            fill: '#1c1c24', stroke: '#2e2e3a', strokeWidth: 0.5, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.x + b.w * 0.32, y: b.y + b.h * 0.13,
            width: b.w * 0.36,
            text: `3/2  ${this.ratedPressure}MPa`,
            fontSize: 7, fontStyle: 'bold', fill: '#a0a0b0', align: 'center',
        }));
        // 阀孔背景（镗孔内腔）
        const bo = this._bore;
        this._staticGroup.add(new Konva.Rect({
            x: bo.x, y: bo.y, width: bo.w, height: bo.h,
            fill: '#16161e', stroke: '#24242e', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        // 加工表面高光（孔顶）
        this._staticGroup.add(new Konva.Rect({
            x: bo.x + 2, y: bo.y, width: bo.w - 4, height: 2,
            fill: 'rgba(255,255,255,0.06)',
        }));

        // 阀体定位销（顶面两侧，装饰）
        const pinY = b.y + b.h * 0.08;
        [b.x + b.w * 0.10, b.x + b.w * 0.90].forEach(px => {
            this._staticGroup.add(new Konva.Circle({
                x: px, y: pinY, radius: this.width * 0.014,
                fill: '#888', stroke: '#555', strokeWidth: 0.7,
            }));
        });
    }

    // ── 弹簧盖（左端）────────────────────────
    _drawSpringCap() {
        const sc = this._springCap;
        // 端盖主体
        this._staticGroup.add(new Konva.Rect({
            x: sc.x, y: sc.y, width: sc.w, height: sc.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: sc.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#282830', 0.5, '#484858', 1, '#303038',
            ],
            stroke: '#1e1e28', strokeWidth: 1.2,
            cornerRadius: [sc.rx, 0, 0, sc.rx],
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.3,
        }));
        // 端盖螺栓圆角缘
        this._staticGroup.add(new Konva.Rect({
            x: sc.x, y: sc.y - 2, width: sc.w * 0.30, height: sc.h + 4,
            fill: '#3a3a48', stroke: '#1e1e26', strokeWidth: 0.6,
            cornerRadius: [sc.rx, 0, 0, sc.rx],
        }));
        // 端盖固定螺钉
        [sc.y + sc.h * 0.18, sc.y + sc.h * 0.82].forEach(sy => {
            this._staticGroup.add(new Konva.Circle({
                x: sc.x + sc.w * 0.72, y: sy,
                radius: sc.w * 0.22,
                fill: '#666', stroke: '#444', strokeWidth: 0.6,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [
                    sc.x + sc.w*0.50, sy,
                    sc.x + sc.w*0.94, sy,
                ],
                stroke: '#333', strokeWidth: 0.9, lineCap: 'round',
            }));
        });
        // 标注 "弹簧侧"
        this._staticGroup.add(new Konva.Text({
            x: sc.x - 2, y: sc.y + sc.h + 4,
            text: '14', fontSize: 7, fill: '#7a8a9a', fontStyle: 'bold',
        }));
    }

    // ── 气控腔盖（右端）──────────────────────
    _drawPilotCap() {
        const pc = this._pilotCap;
        // 端盖主体
        this._staticGroup.add(new Konva.Rect({
            x: pc.x, y: pc.y, width: pc.w, height: pc.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: pc.w, y: 0 },
            fillLinearGradientColorStops: [
                0, '#303038', 0.5, '#484858', 1, '#282830',
            ],
            stroke: '#1e1e28', strokeWidth: 1.2,
            cornerRadius: [0, pc.rx, pc.rx, 0],
        }));
        // 端盖螺栓缘
        this._staticGroup.add(new Konva.Rect({
            x: pc.x + pc.w * 0.70, y: pc.y - 2,
            width: pc.w * 0.30, height: pc.h + 4,
            fill: '#3a3a48', stroke: '#1e1e26', strokeWidth: 0.6,
            cornerRadius: [0, pc.rx, pc.rx, 0],
        }));
        // 固定螺钉
        [pc.y + pc.h * 0.18, pc.y + pc.h * 0.82].forEach(sy => {
            this._staticGroup.add(new Konva.Circle({
                x: pc.x + pc.w * 0.28, y: sy,
                radius: pc.w * 0.22,
                fill: '#666', stroke: '#444', strokeWidth: 0.6,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [pc.x + pc.w*0.06, sy, pc.x + pc.w*0.50, sy],
                stroke: '#333', strokeWidth: 0.9, lineCap: 'round',
            }));
        });
        // 气控口管嘴（右侧面）
        const pp = this._portPilot;
        this._staticGroup.add(new Konva.Rect({
            x: pp.x - 2, y: pp.y - pc.h * 0.10,
            width: this.width * 0.038, height: pc.h * 0.20,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: pc.h*0.20 },
            fillLinearGradientColorStops: [0,'#606068',0.5,'#9898a4',1,'#606068'],
            stroke: '#3a3a42', strokeWidth: 0.8, cornerRadius: [0, 2, 2, 0],
        }));
        // 标注 "12"（先导口号）
        this._staticGroup.add(new Konva.Text({
            x: pc.x + pc.w * 0.10, y: pc.y + pc.h + 4,
            text: '12', fontSize: 7, fill: '#ef9a9a', fontStyle: 'bold',
        }));
    }

    // ── 三个管口（P / A / R）─────────────────
    _drawPorts() {
        const portDefs = [
            { p: this._portA, dir: 'top',    color: '#c8a840', label: 'A',  cr: [3,3,0,0] },
            { p: this._portP, dir: 'bottom', color: '#d03030', label: 'P',  cr: [0,0,3,3] },
            { p: this._portR, dir: 'bottom', color: '#506070', label: 'R',  cr: [0,0,3,3] },
        ];
        portDefs.forEach(({ p, dir, color, label, cr }) => {
            // 管颈主体
            this._staticGroup.add(new Konva.Rect({
                x: p.x, y: p.y, width: p.w, height: p.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: p.w, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#525258', 0.4,'#a0a0aa', 0.7,'#b8b8c2', 1,'#525258',
                ],
                stroke: '#383840', strokeWidth: 1.0,
                cornerRadius: cr,
            }));
            // 内腔
            this._staticGroup.add(new Konva.Rect({
                x: p.x + p.w*0.22, y: p.y + p.h*0.14,
                width: p.w*0.56, height: p.h*0.72,
                fill: '#0c0c16', cornerRadius: 2,
            }));
            // 色标环
            const isTop = dir === 'top';
            this._staticGroup.add(new Konva.Rect({
                x: p.x + p.w*0.08,
                y: isTop ? p.y : p.y + p.h - p.h*0.16,
                width: p.w*0.84, height: p.h*0.16,
                fill: color,
                cornerRadius: isTop ? [3,3,0,0] : [0,0,3,3],
            }));
            // 法兰缘
            const flangeY = isTop ? p.y : p.y + p.h - p.h*0.14;
            this._staticGroup.add(new Konva.Rect({
                x: p.x - p.w*0.10, y: flangeY,
                width: p.w*1.20, height: p.h*0.14,
                fill: '#828288', stroke: '#505058', strokeWidth: 0.6, cornerRadius: 1,
            }));
        });
    }

    // ── 消声器（R 口底端）────────────────────
    _drawSilencer() {
        const r  = this._portR;
        const W  = this.width;
        const sx = r.x + r.w / 2 - W * 0.032;
        const sy = r.y + r.h;
        const sw = W * 0.064;
        const sh = this.height * 0.062;

        // 消声器主体（多孔黑色块）
        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: sw, height: sh,
            fill: '#1e1e24', stroke: '#2e2e38', strokeWidth: 0.8,
            cornerRadius: [0, 0, 3, 3],
            shadowColor: '#000', shadowBlur: 2, shadowOpacity: 0.3,
        }));
        // 消声孔格（横纹）
        for (let i = 0; i < 4; i++) {
            const ly = sy + sh * (i + 0.5) / 4;
            this._staticGroup.add(new Konva.Line({
                points: [sx + 2, ly, sx + sw - 2, ly],
                stroke: '#404050', strokeWidth: 1.0,
            }));
        }
        // 消声器侧面纹
        for (let i = 0; i < 3; i++) {
            const lx = sx + sw * (i + 1) / 4;
            this._staticGroup.add(new Konva.Line({
                points: [lx, sy + 2, lx, sy + sh - 2],
                stroke: '#404050', strokeWidth: 0.7,
            }));
        }
        // 消声器标注
        this._staticGroup.add(new Konva.Text({
            x: sx - 2, y: sy + sh + 3,
            text: '消声', fontSize: 6, fill: '#607080',
        }));
    }

    // ── ISO 1219 气动符号图 ───────────────────
    _drawIsoSymbol() {
        const W = this.width, H = this.height;
        const bw = W * 0.60 / 2;   // 每格宽（两格）
        const bh = H * 0.11;
        const sx = W * 0.20, sy = H * 0.82;

        // 两格外框
        for (let i = 0; i < 2; i++) {
            this._staticGroup.add(new Konva.Rect({
                x: sx + i*bw, y: sy, width: bw, height: bh,
                fill: i === 0
                    ? 'rgba(255,255,255,0.05)'
                    : 'rgba(255,255,255,0.02)',
                stroke: '#556', strokeWidth: 0.8,
            }));
        }

        // 合并外边框
        this._staticGroup.add(new Konva.Rect({
            x: sx, y: sy, width: bw*2, height: bh,
            stroke: '#667', strokeWidth: 1.2, fill: 'transparent',
        }));

        const mcy = sy + bh / 2;

        // ── 常态格（左格）：A-R 连通，P 封闭 ──
        const lc = sx + bw * 0.5;
        // A→R 连通线（竖向，左侧）
        this._staticGroup.add(new Konva.Arrow({
            x: lc - bw*0.18, y: mcy - bh*0.28,
            points: [0, 0, 0, bh*0.56],
            stroke: '#8a9aaa', fill: '#8a9aaa',
            strokeWidth: 1.0, pointerLength: 3, pointerWidth: 3,
        }));
        // P 封闭（横线段带堵头）
        this._staticGroup.add(new Konva.Line({
            points: [lc+bw*0.08, mcy+bh*0.24, lc+bw*0.28, mcy+bh*0.24],
            stroke: '#8a9aaa', strokeWidth: 1.0,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [lc+bw*0.28, mcy+bh*0.14, lc+bw*0.28, mcy+bh*0.34],
            stroke: '#8a9aaa', strokeWidth: 1.8, lineCap: 'round',
        }));

        // ── 动作格（右格）：P-A 连通，R 封闭 ──
        const rc = sx + bw * 1.5;
        // P→A 箭头（竖向）
        this._staticGroup.add(new Konva.Arrow({
            x: rc, y: mcy + bh*0.28,
            points: [0, 0, 0, -bh*0.56],
            stroke: '#d05050', fill: '#d05050',
            strokeWidth: 1.0, pointerLength: 3, pointerWidth: 3,
        }));
        // R 封闭
        this._staticGroup.add(new Konva.Line({
            points: [rc+bw*0.08, mcy+bh*0.24, rc+bw*0.28, mcy+bh*0.24],
            stroke: '#8a9aaa', strokeWidth: 1.0,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [rc+bw*0.28, mcy+bh*0.14, rc+bw*0.28, mcy+bh*0.34],
            stroke: '#8a9aaa', strokeWidth: 1.8, lineCap: 'round',
        }));

        // 弹簧符号（左端）
        const spts = [];
        for (let i = 0; i <= 8; i++) {
            spts.push(sx - bw*0.32 + i*bw*0.038, mcy + (i%2===0 ? -bh*0.18 : bh*0.18));
        }
        this._staticGroup.add(new Konva.Line({ points: spts, stroke: '#889', strokeWidth: 0.7, lineJoin: 'round' }));

        // 气控三角符号（右端，▷ 表示气控）
        this._staticGroup.add(new Konva.Line({
            points: [
                sx + bw*2 + bw*0.04, mcy - bh*0.22,
                sx + bw*2 + bw*0.22, mcy,
                sx + bw*2 + bw*0.04, mcy + bh*0.22,
            ],
            closed: true,
            fill: 'rgba(60,120,200,0.35)',
            stroke: '#4080c0', strokeWidth: 0.8,
        }));

        // 各口字母
        [
            { t:'A', x: sx + bw*0.38, y: sy - 10 },
            { t:'P', x: sx + bw*0.88, y: sy + bh + 2 },
            { t:'R', x: sx + bw*1.38, y: sy + bh + 2 },
        ].forEach(({ t, x, y }) => {
            this._staticGroup.add(new Konva.Text({ x, y, text: t, fontSize: 7, fontStyle:'bold', fill:'#7a8a9a' }));
        });

        // "常态" / "动作" 标注
        this._staticGroup.add(new Konva.Text({ x: sx + bw*0.20, y: sy + bh + 10, text:'常态', fontSize:6, fill:'#556677' }));
        this._staticGroup.add(new Konva.Text({ x: sx + bw*1.20, y: sy + bh + 10, text:'动作', fontSize:6, fill:'#556677' }));
    }

    // ── 标注 ──────────────────────────────────
    _drawLabel() {
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  3/2-Way  ${this.ratedPressure}MPa  先导≥${this.pilotPressure}MPa  [${this.valveFunc}]`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    _drawPortLabels() {
        const b = this._body;
        const portLabels = [
            { t: 'A',  x: this._portA.x + this._portA.w/2 - 4, y: this._portA.y - 11, fill: '#f4c842' },
            { t: 'P',  x: this._portP.x + this._portP.w/2 - 4, y: this._portP.y + this._portP.h + 3, fill: '#ef5350' },
            { t: 'R',  x: this._portR.x + this._portR.w/2 - 4, y: this._portR.y + this._portR.h + 3, fill: '#78909c' },
            { t: '12', x: this._portPilot.x + 4, y: this._portPilot.y - 6, fill: '#ef9a9a' },
            { t: '14', x: this._springCap.x - 2, y: this._springCap.y - 10, fill: '#78909c' },
        ];
        portLabels.forEach(({ t, x, y, fill }) => {
            this._staticGroup.add(new Konva.Text({ x, y, text: t, fontSize: 8, fontStyle: 'bold', fill }));
        });
    }

    // ── 状态指示 ──────────────────────────────
    _drawStatusIndicator() {
        const b  = this._body;
        const ix = b.x + 10;
        const iy = b.y + b.h / 2;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill:        '#ef5350', stroke: '#c62828', strokeWidth: 0.8,
            shadowColor: '#ef5350', shadowBlur: 2, shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text: '常态', fontSize: 8, fontStyle: 'bold', fill: '#ef5350',
        });
        // 先导压力指示点
        this._pilotDot = new Konva.Circle({
            x: this._portPilot.x + this.width * 0.020,
            y: this._portPilot.y,
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

        const pos   = this._position;
        const sx    = this._spoolX;   // 0(常态) ~ 1(动作)
        const phase = this._flowPhase;
        const bo    = this._bore;

        // 阀芯中心 X（常态=偏右，动作=偏左，被气控推入）
        // 常态：弹簧将阀芯推向右侧，spoolX=0
        // 动作：气控将阀芯推向左侧，spoolX=1
        const spoolCenterX = bo.x + bo.w * 0.62 - sx * this._spoolMaxOff;
        const spoolLeft    = spoolCenterX - this._spoolLen / 2;

        // ── 1. 弹簧（左端盖内侧 ~ 阀芯左端）──
        this._drawSpring(spoolLeft, bo, sx);

        // ── 2. 气控腔先导压力（右端光晕）──
        if (this._pilotOn) {
            this._drawPilotGlow();
        }

        // ── 3. 流道高亮 ──
        this._drawFlowChannels(pos, phase);

        // ── 4. 阀芯主体 ──
        this._drawSpool(spoolLeft, bo, this._spoolLen);

        // ── 5. 气泡粒子 ──
        this._drawFlowParticles(pos, phase);

        // ── 6. 排气气泡（R 口） ──
        if (pos === 'normal') {
            this._drawExhaustBubbles(phase);
        }

        // ── 7. 切换电弧（瞬间） ──
        if (this._animating && this._animT < 0.15) {
            this._drawSwitchEffect(spoolCenterX, bo.y + bo.h / 2);
        }
    }

    // ── 弹簧 ──────────────────────────────────
    _drawSpring(spoolLeft, bo, spoolX) {
        const sc       = this._springCap;
        const wallX    = sc.x + sc.w;                  // 左端盖内壁 X
        const endX     = spoolLeft - 2;                // 阀芯左端面 X
        const springLen = Math.max(4, endX - wallX);
        const cy       = bo.y + bo.h / 2;
        const sw       = bo.h * 0.32;
        const coils    = 6;
        const pts      = [];

        for (let i = 0; i <= coils * 2; i++) {
            const t  = i / (coils * 2);
            const lx = wallX + springLen * t;
            const ly = cy + (i % 2 === 0 ? -sw/2 : sw/2);
            pts.push(lx, ly);
        }
        // 弹簧受压（动作时被压缩 → 颜色变亮）
        const compressed = spoolX > 0.1;
        this._dynGroup.add(new Konva.Line({
            points: pts,
            stroke: compressed ? '#b0cce8' : '#7a8898',
            strokeWidth: compressed ? 1.6 : 1.2,
            lineJoin: 'round', lineCap: 'round',
        }));
    }

    // ── 气控腔先导光晕 ────────────────────────
    _drawPilotGlow() {
        const pc    = this._pilotCap;
        const pulse = 0.10 + 0.06 * Math.sin(this._flowPhase * 4);
        this._dynGroup.add(new Konva.Rect({
            x: pc.x - 2, y: pc.y - 2,
            width: pc.w + 4, height: pc.h + 4,
            fill: `rgba(60,160,255,${pulse})`,
            cornerRadius: pc.rx + 2,
        }));
        // 气控管嘴内气流光晕
        const pp = this._portPilot;
        this._dynGroup.add(new Konva.Circle({
            x: pp.x, y: pp.y,
            radius: this.width * 0.022,
            fill: `rgba(80,180,255,${0.25 + 0.12 * Math.sin(this._flowPhase * 3)})`,
        }));
    }

    // ── 流道高亮 ──────────────────────────────
    _drawFlowChannels(pos, phase) {
        const b  = this._body;
        const bo = this._bore;
        const bodyTopY = b.y + 2;
        const bodyBotY = b.y + b.h - 2;

        const drawVChan = (cx, y1, y2, rgb, alpha) => {
            this._dynGroup.add(new Konva.Rect({
                x: cx - 4, y: y1, width: 8, height: y2 - y1,
                fill: `rgba(${rgb},${alpha})`, cornerRadius: 2,
            }));
        };

        if (pos === 'actuated') {
            // P → A 连通（供气）
            // P 口下行段
            drawVChan(this._portPx, bo.y + bo.h, bodyBotY, '220,50,50', 0.55);
            // 阀腔内横向（P → A 方向）
            this._dynGroup.add(new Konva.Rect({
                x: this._portAx - 5, y: bo.y + bo.h * 0.15,
                width: this._portPx - this._portAx + 10, height: bo.h * 0.70,
                fill: 'rgba(220,50,50,0.18)', cornerRadius: 2,
            }));
            // A 口上行段
            drawVChan(this._portAx, bodyTopY, bo.y, '200,150,50', 0.48);

        } else {
            // A → R 连通（排气）
            // A 口竖向
            drawVChan(this._portAx, bodyTopY, bo.y, '200,150,50', 0.38);
            // 阀腔内横向（A → R 方向）
            this._dynGroup.add(new Konva.Rect({
                x: this._portAx - 5, y: bo.y + bo.h * 0.15,
                width: this._portRx - this._portAx + 10, height: bo.h * 0.70,
                fill: 'rgba(80,110,140,0.15)', cornerRadius: 2,
            }));
            // R 口竖向
            drawVChan(this._portRx, bo.y + bo.h, bodyBotY, '60,90,110', 0.40);
        }
    }

    // ── 阀芯（凸肩+凹槽）────────────────────
    _drawSpool(spoolLeft, bo, sLen) {
        // 阀芯基体
        this._dynGroup.add(new Konva.Rect({
            x: spoolLeft, y: bo.y + bo.h * 0.05,
            width: sLen, height: bo.h * 0.90,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: bo.h * 0.90 },
            fillLinearGradientColorStops: [
                0,   '#48484e',
                0.28,'#848490',
                0.55,'#9898a4',
                0.78,'#78787e',
                1,   '#38383e',
            ],
            stroke: '#202028', strokeWidth: 0.8,
            cornerRadius: 2,
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.25,
        }));

        // 三位两通阀阀芯凸肩（3 肩 2 槽）
        const landW = sLen * 0.22;
        const landH = bo.h * 0.90;
        const lands = [0.04, 0.39, 0.74];   // 左、中、右凸肩起始比例

        lands.forEach(lt => {
            const lx = spoolLeft + sLen * lt;
            this._dynGroup.add(new Konva.Rect({
                x: lx, y: bo.y + bo.h * 0.05,
                width: landW, height: landH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: landW, y: 0 },
                fillLinearGradientColorStops: [
                    0,'#585860', 0.3,'#a4a4b0', 0.65,'#bcbcc8', 1,'#585860',
                ],
                stroke: '#30303a', strokeWidth: 0.6,
                cornerRadius: 1,
            }));
            // 凸肩顶部高光
            this._dynGroup.add(new Konva.Rect({
                x: lx + landW*0.10, y: bo.y + bo.h*0.07,
                width: landW*0.80, height: bo.h*0.10,
                fill: 'rgba(255,255,255,0.14)',
                cornerRadius: [1,1,0,0],
            }));
        });

        // 阀芯整体顶部高光
        this._dynGroup.add(new Konva.Rect({
            x: spoolLeft + 2, y: bo.y + bo.h * 0.06,
            width: sLen - 4, height: bo.h * 0.07,
            fill: 'rgba(255,255,255,0.08)', cornerRadius: 1,
        }));

        // 推杆（阀芯右端伸出至气控腔）
        const rodX = spoolLeft + sLen;
        const cy   = bo.y + bo.h / 2;
        const rodR = bo.h * 0.11;
        this._dynGroup.add(new Konva.Rect({
            x: rodX, y: cy - rodR,
            width: bo.x + bo.w - rodX - 2, height: rodR * 2,
            fill: '#585860', stroke: '#30303a', strokeWidth: 0.6, cornerRadius: 1,
        }));
    }

    // ── 气泡粒子（工作流道）──────────────────
    _drawFlowParticles(pos, phase) {
        const numPts = 6;
        const b  = this._body, bo = this._bore;

        if (pos === 'actuated') {
            // P → A：从 P 口底部进，横穿阀腔，从 A 口顶部出
            for (let i = 0; i < numPts; i++) {
                const t = ((i / numPts) + phase * 0.42) % 1.0;
                let px, py;
                if (t < 0.30) {
                    // P 口进入段（竖向向上）
                    const tt = t / 0.30;
                    px = this._portPx + (Math.random()-0.5) * 3;
                    py = b.y + b.h + 6 + (bo.y + bo.h/2 - b.y - b.h - 6) * tt;
                } else if (t < 0.62) {
                    // 阀腔横向段（P → A 水平）
                    const tt = (t - 0.30) / 0.32;
                    px = this._portPx + (this._portAx - this._portPx) * tt;
                    py = bo.y + bo.h * (0.30 + 0.40 * Math.sin(phase * 2 + i));
                } else {
                    // A 口出口段（竖向向上）
                    const tt = (t - 0.62) / 0.38;
                    px = this._portAx + (Math.random()-0.5) * 3;
                    py = bo.y + bo.h/2 + (b.y - 8 - bo.y - bo.h/2) * tt;
                }
                const r = (1.5 + 1.0 * Math.sin(phase*4 + i*1.3));
                const a = 0.40 + 0.35 * Math.sin(phase*3 + i);
                this._dynGroup.add(new Konva.Circle({
                    x: px, y: py, radius: Math.max(0.6, r),
                    fill: `rgba(220,80,60,${a})`,   // 红色（压缩空气）
                }));
            }
        } else {
            // A → R：从 A 口向下进，横穿，从 R 口排出
            for (let i = 0; i < numPts; i++) {
                const t = ((i / numPts) + phase * 0.38) % 1.0;
                let px, py;
                if (t < 0.28) {
                    const tt = t / 0.28;
                    px = this._portAx + (Math.random()-0.5) * 3;
                    py = b.y - 6 + (bo.y + bo.h/2 - b.y + 6) * tt;
                } else if (t < 0.60) {
                    const tt = (t - 0.28) / 0.32;
                    px = this._portAx + (this._portRx - this._portAx) * tt;
                    py = bo.y + bo.h * (0.30 + 0.40 * Math.sin(phase * 2.5 + i));
                } else {
                    const tt = (t - 0.60) / 0.40;
                    px = this._portRx + (Math.random()-0.5) * 3;
                    py = bo.y + bo.h/2 + (b.y + b.h + 6 - bo.y - bo.h/2) * tt;
                }
                const r = (1.4 + 0.9 * Math.sin(phase*4 + i*1.2));
                const a = 0.30 + 0.30 * Math.sin(phase*3 + i + 1.5);
                this._dynGroup.add(new Konva.Circle({
                    x: px, y: py, radius: Math.max(0.5, r),
                    fill: `rgba(100,140,180,${a})`,  // 蓝灰色（排气）
                }));
            }
        }
    }

    // ── 消声器排气气泡（R 口排气时）─────────
    _drawExhaustBubbles(phase) {
        const r  = this._portR;
        const cx = r.x + r.w / 2;
        const baseY = r.y + r.h + this.height * 0.062 + 4;

        for (let i = 0; i < 4; i++) {
            const t = ((i / 4) + phase * 0.30) % 1.0;
            const spread = (i % 2 === 0 ? -1 : 1) * (1 + i * 1.5);
            const px = cx + spread + (Math.random()-0.5) * 2;
            const py = baseY + t * this.height * 0.06;
            const rad = (0.8 + 0.6 * Math.sin(phase*5 + i));
            const alpha = 0.5 - 0.4 * t;
            this._dynGroup.add(new Konva.Circle({
                x: px, y: py, radius: Math.max(0.4, rad),
                fill: `rgba(140,170,200,${alpha})`,
                stroke: `rgba(100,140,180,${alpha * 0.6})`,
                strokeWidth: 0.4,
            }));
        }
    }

    // ── 切换瞬间效果 ──────────────────────────
    _drawSwitchEffect(cx, cy) {
        for (let i = 0; i < 3; i++) {
            const dx = (Math.random()-0.5) * 10;
            this._dynGroup.add(new Konva.Line({
                points: [cx+dx*0.2, cy-3, cx+dx+(Math.random()-0.5)*4, cy-8, cx+dx*0.5, cy-14],
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
        // 点击气控腔 → 动作/复位
        this._dynGroup.on('click tap', e => {
            this._position === 'actuated' ? this.release() : this.actuate();
        });
        this._dynGroup.listening(true);
    }

    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    
        this._refreshCache();
    }
    _tickAnimation(dt) {
        // 持续推进粒子
        this._flowPhase = (this._flowPhase + dt * 2.0) % (Math.PI * 2);

        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._position  = this._animTo;
            }
            const ease       = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            const fromX      = this._animFrom === 'actuated' ? 1 : 0;
            const toX        = this._animTo   === 'actuated' ? 1 : 0;
            this._spoolX     = fromX + (toX - fromX) * ease;
        }

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const actuated = this._position === 'actuated' ||
            (this._animating && this._animTo === 'actuated');
        const color = actuated ? '#66bb6a' : '#ef5350';
        const cDark = actuated ? '#2e7d32' : '#c62828';

        if (this._statusDot) {
            this._statusDot.fill(color);
            this._statusDot.stroke(cDark);
            this._statusDot.shadowColor(color);
            this._statusDot.shadowBlur(actuated ? 5 : 2);
        }
        if (this._statusText) {
            this._statusText.text(actuated ? '动作' : '常态');
            this._statusText.fill(color);
        }
        if (this._pilotDot) {
            const on = this._pilotOn;
            this._pilotDot.fill(on ? '#42a5f5' : '#546e7a');
            this._pilotDot.stroke(on ? '#1565c0' : '#37474f');
            this._pilotDot.shadowColor('#42a5f5');
            this._pilotDot.shadowBlur(on ? 6 : 0);
        }
    }

    // ════════════════════════════════════════════
    // ── 公开 API ─────────────────────────────────
    // ════════════════════════════════════════════

    /**
     * 施加先导气控信号 → 切换至动作位
     * （P → A 供气，R 封闭）
     */
    actuate() {
        if (this._animating) return;
        if (this._position === 'actuated') return;
        this._animFrom  = 'normal';
        this._animTo    = 'actuated';
        this._animT     = 0;
        this._animating = true;
        this._pilotOn   = true;
        this.opsCount++;
        this._refreshCache();
    }

    /**
     * 撤除先导气控信号 → 弹簧复位至常态
     * （A → R 排气，P 封闭）
     */
    release() {
        if (this._animating) return;
        if (this._position === 'normal') return;
        this._animFrom  = 'actuated';
        this._animTo    = 'normal';
        this._animT     = 0;
        this._animating = true;
        this._pilotOn   = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 切换（toggle） */
    toggle() {
        if (this._animating) return;
        this._position === 'actuated' ? this.release() : this.actuate();
    }

    /** 查询 */
    isActuated()  { return this._position === 'actuated'; }
    isNormal()    { return this._position === 'normal';   }
    isPilotOn()   { return this._pilotOn; }
    isAnimating() { return this._animating; }
    getPosition() { return this._position; }
    getOpsCount() { return this.opsCount; }

    /** 通用更新接口 */
    update(state) {
        if      (state === true  || state === 1 || state === 'actuated') this.actuate();
        else if (state === false || state === 0 || state === 'normal')   this.release();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',            key: 'label',         type: 'text'   },
            { label: '额定工作压力 (MPa)',    key: 'ratedPressure', type: 'number' },
            { label: '最小先导压力 (MPa)',    key: 'pilotPressure', type: 'number' },
            { label: '额定流量 (L/min)',      key: 'ratedFlow',     type: 'number' },
            { label: '介质',                  key: 'medium',        type: 'text'   },
            { label: '阀功能 (NC/NO)',        key: 'valveFunc',     type: 'text'   },
            { label: '动作时间 (s)',          key: 'animDur',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label         = cfg.label         || this.label;
        this.ratedPressure = parseFloat(cfg.ratedPressure) || this.ratedPressure;
        this.pilotPressure = parseFloat(cfg.pilotPressure) || this.pilotPressure;
        this.ratedFlow     = parseFloat(cfg.ratedFlow)     || this.ratedFlow;
        this.medium        = cfg.medium        || this.medium;
        this.valveFunc     = cfg.valveFunc     || this.valveFunc;
        this._animDur      = parseFloat(cfg.animDur)       || this._animDur;
        this.config        = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}