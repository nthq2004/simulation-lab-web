import { BaseComponent } from './BaseComponent.js';

/**
 * 电磁阀（Solenoid Valve）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  电磁阀是通过电磁力驱动阀芯实现流体通断控制的执行元件，
 *  由以下部分组成：
 *
 *  1. 阀体（Valve Body）：灰色金属主体，内含流道
 *     - 进口（IN 端）：左侧管口
 *     - 出口（OUT 端）：右侧管口
 *  2. 电磁线圈（Solenoid Coil）：安装在阀体顶部的线圈组件
 *     - 线圈外壳：黑色圆柱形
 *     - 线圈绕组：内部铜线圈（可见截面）
 *  3. 铁芯/阀柱（Plunger / Armature）：在线圈磁场中移动的铁芯
 *     - 励磁（通电）：铁芯被吸入，阀口开启
 *     - 失磁（断电）：弹簧复位，阀口关闭
 *  4. 弹簧（Return Spring）：复位弹簧，保持常闭状态
 *  5. 阀口（Orifice）：阀体内的流道开口
 *  6. 接线端子（Terminals）：线圈供电接线柱（L1、L2）
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  常闭型（NC）：
 *    断电 → 弹簧将铁芯压下 → 阀口关闭 → 流体截止
 *    通电 → 线圈励磁，铁芯上移 → 阀口开启 → 流体导通
 *
 *  动作过程带平滑动画（200ms，正弦缓动）
 *  通电时线圈发出蓝色磁场光晕
 *  开启时阀口显示流体流动粒子动画
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View）二维仿真，展现：
 *  阀体截面、线圈外壳、铁芯位置、弹簧状态、流道通断
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_in  — 流体进口（左侧）
 *  terminal_out — 流体出口（右侧）
 *  coil_l1      — 线圈 L1 端（左接线柱）
 *  coil_l2      — 线圈 L2 端（右接线柱）
 */
export class SolenoidValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 220);
        this.height = Math.max(160, config.height || 200);

        this.type    = 'solenoid_valve';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.ratedVoltage  = config.ratedVoltage  || 24;     // V（线圈额定电压）
        this.ratedPressure = config.ratedPressure || 1.0;    // MPa（额定工作压力）
        this.medium        = config.medium        || '气体'; // 介质
        this.label         = config.label         || 'YV';   // 位号
        this.valveType     = config.valveType     || 'NC';   // NC=常闭, NO=常开

        // ── 状态 ──
        this._energized   = false;          // 线圈是否通电
        this._open        = this.valveType === 'NO'; // 阀门当前是否开启
        this._animating   = false;
        this._animT       = 0;              // 动画进度 0~1
        this._animDir     = 1;              // +1=开启方向，-1=关闭方向
        this._animDur     = 0.20;           // s（动画时长）
        this._plungerY    = 0;              // 铁芯位移（0=底部，1=顶部吸合）
        this._flowPhase   = 0;              // 流体粒子相位

        // 操作计数
        this.opsCount = config.initOps || 0;

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 阀体
        this._body = {
            x: W * 0.10, y: H * 0.52,
            w: W * 0.80, h: H * 0.26,
            rx: 5,
        };

        // 线圈外壳（坐在阀体顶部中央）
        this._coilCase = {
            x: W * 0.33, y: H * 0.14,
            w: W * 0.34, h: H * 0.40,
            rx: 4,
        };

        // 铁芯（在线圈腔内上下移动）
        this._plungerBase = {
            x: this._coilCase.x + this._coilCase.w * 0.20,
            yTop:  this._coilCase.y + this._coilCase.h * 0.08,   // 吸合位置（顶部）
            yBot:  this._coilCase.y + this._coilCase.h * 0.45,   // 复位位置（底部）
            w:     this._coilCase.w * 0.60,
            h:     this._coilCase.h * 0.36,
        };

        // 接线柱（线圈顶部两侧）
        this._termL1 = {
            x: this._coilCase.x + this._coilCase.w * 0.12,
            y: this._coilCase.y - H * 0.055,
            w: W * 0.060, h: H * 0.065,
        };
        this._termL2 = {
            x: this._coilCase.x + this._coilCase.w * 0.68,
            y: this._coilCase.y - H * 0.055,
            w: W * 0.060, h: H * 0.065,
        };

        // 进出口管口
        this._portIn = {
            x: this._body.x - W * 0.10,
            y: this._body.y + this._body.h * 0.25,
            w: W * 0.12, h: this._body.h * 0.50,
        };
        this._portOut = {
            x: this._body.x + this._body.w,
            y: this._body.y + this._body.h * 0.25,
            w: W * 0.12, h: this._body.h * 0.50,
        };

        // 阀口（阀体内部流道）
        this._orifice = {
            x: W * 0.43, y: this._body.y + this._body.h * 0.05,
            w: W * 0.14, h: this._body.h * 0.90,
        };


        this._init();

        // 端口（流体）
        this.addPort(
            this._portIn.x,
            this._portIn.y + this._portIn.h / 2,
            'terminal_in', 'pipe', 'IN'
        );
        this.addPort(
            this._portOut.x + this._portOut.w,
            this._portOut.y + this._portOut.h / 2,
            'terminal_out', 'pipe', 'OUT'
        );
        // 端口（线圈供电）
        this.addPort(
            this._termL1.x + this._termL1.w / 2,
            this._termL1.y,
            'coil_l1', 'wire', 'L1'
        );
        this.addPort(
            this._termL2.x + this._termL2.w / 2,
            this._termL2.y,
            'coil_l2', 'wire', 'L2'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawPipes();
        this._drawBody();
        this._drawOrifice();
        this._drawCoilCase();
        this._drawTerminals();
        this._drawDynamicLayer();   // 动态层：铁芯 + 弹簧 + 磁场光晕 + 流体
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 进出口管口 ────────────────────────────
    _drawPipes() {
        const metalStops = [0, '#5a5a5a', 0.35, '#aaaaaa', 0.65, '#cccccc', 1, '#5a5a5a'];
        [this._portIn, this._portOut].forEach((p, i) => {
            // 管壁（金属灰）
            this.group.add(new Konva.Rect({
                x: p.x, y: p.y, width: p.w, height: p.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 0, y: p.h },
                fillLinearGradientColorStops: metalStops,
                stroke: '#3a3a3a', strokeWidth: 1,
                cornerRadius: i === 0 ? [3, 0, 0, 3] : [0, 3, 3, 0],
            }));
            // 管内腔
            this.group.add(new Konva.Rect({
                x: p.x + p.w * 0.20, y: p.y + p.h * 0.18,
                width: p.w * 0.60, height: p.h * 0.64,
                fill: '#1a1a2a',
                cornerRadius: 2,
            }));
            // 管口法兰
            const flangeX = i === 0 ? p.x : p.x + p.w - p.w * 0.15;
            this.group.add(new Konva.Rect({
                x: flangeX, y: p.y - p.h * 0.10,
                width: p.w * 0.15, height: p.h * 1.20,
                fill: '#888', stroke: '#555', strokeWidth: 0.8, cornerRadius: 1,
            }));
        });
    }

    // ── 阀体主体 ──────────────────────────────
    _drawBody() {
        const b = this._body;
        const W = this.width;

        // 阀体主体（铸铁灰）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [
                0,   '#6a6a70',
                0.3, '#8a8a92',
                0.6, '#9a9aa2',
                1,   '#5a5a60',
            ],
            stroke: '#3a3a40', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 6,
            shadowOffsetY: 3, shadowOpacity: 0.35,
        }));
        // 阀体顶面高光
        this.group.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 2, width: b.w - 6, height: b.h * 0.20,
            fill: 'rgba(255,255,255,0.10)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 阀体底面阴影
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y + b.h * 0.78, width: b.w, height: b.h * 0.22,
            fill: 'rgba(0,0,0,0.22)',
            cornerRadius: [0, 0, b.rx, b.rx],
        }));
        // 阀体侧面螺栓（装饰）
        const boltY = b.y + b.h / 2;
        [b.x + b.w * 0.08, b.x + b.w * 0.92].forEach(bx => {
            this.group.add(new Konva.Circle({
                x: bx, y: boltY, radius: W * 0.022,
                fill: '#777', stroke: '#444', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Line({
                points: [bx - W*0.013, boltY, bx + W*0.013, boltY],
                stroke: '#444', strokeWidth: 1, lineCap: 'round',
            }));
        });
    }

    // ── 阀口（内部流道可见截面）──────────────
    _drawOrifice() {
        const o = this._orifice;
        // 阀口背景（流道暗腔）
        this.group.add(new Konva.Rect({
            x: o.x, y: o.y, width: o.w, height: o.h,
            fill: '#111118', stroke: '#2a2a30', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
    }

    // ── 线圈外壳 ──────────────────────────────
    _drawCoilCase() {
        const c = this._coilCase;

        // 外壳主体（黑色工程塑料）
        this.group.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: c.w, y: 0 },
            fillLinearGradientColorStops: [
                0,    '#222228',
                0.25, '#3a3a42',
                0.55, '#44444e',
                0.80, '#2e2e36',
                1,    '#1a1a20',
            ],
            stroke: '#111', strokeWidth: 1.5,
            cornerRadius: c.rx,
            shadowColor: '#000', shadowBlur: 5,
            shadowOffsetY: 2, shadowOpacity: 0.4,
        }));
        // 外壳顶面高光
        this.group.add(new Konva.Rect({
            x: c.x + 2, y: c.y + 2, width: c.w - 4, height: c.h * 0.12,
            fill: 'rgba(255,255,255,0.08)',
            cornerRadius: [c.rx, c.rx, 0, 0],
        }));
        // 线圈铭牌区域
        this.group.add(new Konva.Rect({
            x: c.x + c.w * 0.08, y: c.y + c.h * 0.16,
            width: c.w * 0.84, height: c.h * 0.22,
            fill: '#18181e', stroke: '#333', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        this.group.add(new Konva.Text({
            x: c.x + c.w * 0.08, y: c.y + c.h * 0.19,
            width: c.w * 0.84,
            text: `${this.ratedVoltage}V AC`,
            fontSize: 7, fontStyle: 'bold', fill: '#aaa', align: 'center',
        }));
        // 线圈绕组截面（底部可见）
        const wY = c.y + c.h * 0.46;
        const wH = c.h * 0.42;
        const wX = c.x + c.w * 0.10;
        const wW = c.w * 0.80;
        // 绕组区背景
        this.group.add(new Konva.Rect({
            x: wX, y: wY, width: wW, height: wH,
            fill: '#1a1210', stroke: '#333', strokeWidth: 0.5, cornerRadius: 2,
        }));
        // 绕组铜线条纹（横向）
        for (let i = 0; i < 7; i++) {
            const ly = wY + wH * (i + 0.5) / 7;
            this.group.add(new Konva.Line({
                points: [wX + 2, ly, wX + wW - 2, ly],
                stroke: `rgba(${180 + i*8},${100 + i*5},30,0.55)`,
                strokeWidth: 1.5,
            }));
        }
        // 铁芯导向孔（线圈中央）
        const holeX = c.x + c.w * 0.35;
        const holeW = c.w * 0.30;
        this.group.add(new Konva.Rect({
            x: holeX, y: c.y + c.h * 0.46, width: holeW, height: c.h * 0.44,
            fill: '#0d0d14', stroke: '#252530', strokeWidth: 0.8,
            cornerRadius: [0, 0, 2, 2],
        }));
        // 外壳与阀体连接颈（导向管）
        const neckX = c.x + c.w * 0.30;
        const neckW = c.w * 0.40;
        const neckY = c.y + c.h - 2;
        const neckH = this._body.y - neckY;
        if (neckH > 0) {
            this.group.add(new Konva.Rect({
                x: neckX, y: neckY, width: neckW, height: neckH + 2,
                fill: '#555560', stroke: '#3a3a40', strokeWidth: 0.8,
            }));
        }
    }

    // ── 接线端子 ──────────────────────────────
    _drawTerminals() {
        [this._termL1, this._termL2].forEach((t, i) => {
            // 端子主体（黄铜）
            this.group.add(new Konva.Rect({
                x: t.x, y: t.y, width: t.w, height: t.h,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: t.w, y: 0 },
                fillLinearGradientColorStops: [0,'#7a6a30',0.5,'#c8a84b',1,'#7a6a30'],
                stroke: '#6a5a28', strokeWidth: 0.8,
                cornerRadius: [2, 2, 0, 0],
            }));
            // 端子槽（十字槽螺钉头）
            const cx = t.x + t.w / 2;
            const cy = t.y + t.h * 0.35;
            const sr = t.w * 0.28;
            this.group.add(new Konva.Circle({ x: cx, y: cy, radius: sr, fill: '#999', stroke: '#666', strokeWidth: 0.5 }));
            this.group.add(new Konva.Line({ points: [cx-sr*0.7,cy, cx+sr*0.7,cy], stroke:'#444', strokeWidth:1, lineCap:'round' }));
            this.group.add(new Konva.Line({ points: [cx,cy-sr*0.7, cx,cy+sr*0.7], stroke:'#444', strokeWidth:1, lineCap:'round' }));
            // 标注
            this.group.add(new Konva.Text({
                x: t.x - t.w * 0.1, y: t.y - 9,
                width: t.w * 1.2,
                text: i === 0 ? 'L1' : 'L2',
                fontSize: 7, fontStyle: 'bold',
                fill: '#ef9a9a', align: 'center',
            }));
        });
    }

    // ── 动态层：铁芯 + 弹簧 + 磁场 + 流体 ──
    _drawDynamicLayer() {
        this._dynGroup = new Konva.Group();
        this.group.add(this._dynGroup);
        this._rebuildDynamic();
    }

    _rebuildDynamic() {
        this._dynGroup.destroyChildren();

        const open      = this._open;
        const energized = this._energized;
        const c         = this._coilCase;
        const b         = this._body;
        const o         = this._orifice;
        const pb        = this._plungerBase;

        // ── 铁芯当前 Y 位置（插值）──
        const plungerY  = pb.yBot - (pb.yBot - pb.yTop) * this._plungerY;

        // ── 磁场光晕（线圈通电时）──
        if (energized) {
            const glowIntensity = 0.12 + 0.06 * Math.sin(this._flowPhase * 4);
            this._dynGroup.add(new Konva.Rect({
                x: c.x - 4, y: c.y - 4,
                width: c.w + 8, height: c.h + 8,
                fill: `rgba(60,120,255,${glowIntensity})`,
                cornerRadius: c.rx + 2,
            }));
            // 铁芯导向孔内磁场（蓝紫辉光）
            const holeX = c.x + c.w * 0.35;
            const holeW = c.w * 0.30;
            this._dynGroup.add(new Konva.Rect({
                x: holeX - 2, y: c.y + c.h * 0.46,
                width: holeW + 4, height: c.h * 0.44,
                fill: `rgba(80,140,255,${0.22 + 0.08 * Math.sin(this._flowPhase * 3)})`,
                cornerRadius: 2,
            }));
        }

        // ── 弹簧（阀体上方、铁芯下方）──
        this._drawSpring(plungerY, pb, c, b);

        // ── 铁芯主体 ──
        this._dynGroup.add(new Konva.Rect({
            x: pb.x, y: plungerY,
            width: pb.w, height: pb.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: pb.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#4a4a50',
                0.3, '#8a8a92',
                0.6, '#9e9ea6',
                1,   '#4a4a50',
            ],
            stroke: '#2a2a30', strokeWidth: 0.8,
            cornerRadius: 3,
            shadowColor: energized ? '#3060ff' : '#000',
            shadowBlur:  energized ? 8 : 2,
            shadowOpacity: energized ? 0.5 : 0.2,
        }));
        // 铁芯顶部吸合面（磁感应面）
        this._dynGroup.add(new Konva.Rect({
            x: pb.x + pb.w * 0.10, y: plungerY,
            width: pb.w * 0.80, height: pb.h * 0.14,
            fill: energized ? 'rgba(80,140,255,0.35)' : 'rgba(100,100,110,0.5)',
            cornerRadius: [3, 3, 0, 0],
        }));
        // 铁芯底部密封头（阀口密封面）
        const sealY = plungerY + pb.h;
        const sealR = pb.w * 0.35;
        this._dynGroup.add(new Konva.Ellipse({
            x: pb.x + pb.w / 2, y: sealY,
            radiusX: sealR, radiusY: pb.h * 0.12,
            fill: open ? '#ff6622' : '#880000',
            stroke: open ? '#cc4400' : '#550000',
            strokeWidth: 0.8,
        }));

        // ── 阀口状态（开/关）──
        if (open) {
            // 流道开启——画流体粒子
            this._drawFlowParticles(o);
        } else {
            // 流道关闭——画密封挡块
            this._dynGroup.add(new Konva.Rect({
                x: o.x, y: o.y + o.h * 0.05,
                width: o.w, height: o.h * 0.30,
                fill: '#600808', stroke: '#400505', strokeWidth: 0.8,
                cornerRadius: 2,
            }));
            // 密封标志（×）
            const mx = o.x + o.w / 2, my = o.y + o.h * 0.20;
            const ms = o.w * 0.22;
            this._dynGroup.add(new Konva.Line({
                points:[mx-ms,my-ms,mx+ms,my+ms], stroke:'#ff4444', strokeWidth:1.2, lineCap:'round',
            }));
            this._dynGroup.add(new Konva.Line({
                points:[mx+ms,my-ms,mx-ms,my+ms], stroke:'#ff4444', strokeWidth:1.2, lineCap:'round',
            }));
        }

        // ── 电弧效果（切换瞬间）──
        if (this._animating && this._animT < 0.20) {
            this._drawArcEffect(pb.x + pb.w / 2, sealY);
        }
    }

    // ── 弹簧 ──────────────────────────────────
    _drawSpring(plungerY, pb, c, b) {
        const springTop = plungerY + pb.h;
        const springBot = b.y + b.h * 0.10;
        const springH   = Math.max(4, springBot - springTop);
        const cx        = pb.x + pb.w / 2;
        const sw        = pb.w * 0.55;
        const coils     = 6;
        const pts       = [];

        for (let i = 0; i <= coils * 2; i++) {
            const t  = i / (coils * 2);
            const sy = springTop + springH * t;
            const sx = cx + (i % 2 === 0 ? -sw / 2 : sw / 2);
            pts.push(sx, sy);
        }
        this._dynGroup.add(new Konva.Line({
            points: pts,
            stroke: '#888', strokeWidth: 1.2,
            lineJoin: 'round', lineCap: 'round',
        }));
    }

    // ── 流体粒子（阀开时）────────────────────
    _drawFlowParticles(o) {
        const phase = this._flowPhase;
        const b     = this._body;
        const numPts = 5;
        // 横向流动粒子（从进口流向出口）
        for (let i = 0; i < numPts; i++) {
            const t  = ((i / numPts) + phase * 0.5) % 1;
            const px = this._portIn.x + (this._portOut.x + this._portOut.w - this._portIn.x) * t;
            const py = b.y + b.h * (0.35 + 0.12 * Math.sin(phase * 3 + i));
            const r  = 2.0 + 1.0 * Math.sin(phase * 4 + i * 1.3);
            this._dynGroup.add(new Konva.Circle({
                x: px, y: py, radius: r,
                fill: `rgba(40,160,255,${0.5 + 0.3 * Math.sin(phase * 5 + i)})`,
            }));
        }
        // 阀口过流高亮
        this._dynGroup.add(new Konva.Rect({
            x: o.x, y: o.y, width: o.w, height: o.h,
            fill: `rgba(30,140,255,${0.10 + 0.05 * Math.sin(phase * 6)})`,
            cornerRadius: 2,
        }));
    }

    // ── 电弧效果 ─────────────────────────────
    _drawArcEffect(cx, cy) {
        for (let i = 0; i < 3; i++) {
            const spread = (Math.random() - 0.5) * 12;
            this._dynGroup.add(new Konva.Line({
                points: [
                    cx + spread * 0.3, cy - 4,
                    cx + spread + Math.random() * 6, cy - 10,
                    cx + spread * 0.5, cy - 16,
                ],
                stroke: `rgba(80,${160 + Math.round(Math.random() * 80)},255,${0.5 + Math.random() * 0.4})`,
                strokeWidth: 1 + Math.random(),
                lineJoin: 'round', lineCap: 'round',
            }));
        }
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const W = this.width;
        // 位号
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.ratedVoltage}V / ${this.ratedPressure}MPa  [${this.valveType}]`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // 进出口标注
        this.group.add(new Konva.Text({
            x: this._portIn.x - 2, y: this._portIn.y + this._portIn.h + 4,
            text: 'IN', fontSize: 8, fill: '#ef9a9a', fontStyle: 'bold',
        }));
        this.group.add(new Konva.Text({
            x: this._portOut.x + this._portOut.w - 14, y: this._portOut.y + this._portOut.h + 4,
            text: 'OUT', fontSize: 8, fill: '#90caf9', fontStyle: 'bold',
        }));
        // 介质标注
        this.group.add(new Konva.Text({
            x: 0, y: this._body.y + this._body.h + 6, width: W,
            text: `介质：${this.medium}`,
            fontSize: 8, fill: '#78909c', align: 'center',
        }));
    }

    // ── 状态指示 ─────────────────────────────
    _drawStatusIndicator() {
        const ix = this._body.x + 10;
        const iy = this._body.y + this._body.h / 2;
        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill:        this._open ? '#66bb6a' : '#ef5350',
            stroke:      this._open ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: this._open ? '#66bb6a' : '#ef5350',
            shadowBlur:  this._open ? 5 : 2,
            shadowOpacity: 0.8,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text:      this._open ? '开' : '关',
            fontSize:  8, fontStyle: 'bold',
            fill:      this._open ? '#66bb6a' : '#ef5350',
        });
        // 线圈通电指示
        this._coilDot = new Konva.Circle({
            x: this._coilCase.x + this._coilCase.w - 10,
            y: this._coilCase.y + this._coilCase.h * 0.08,
            radius: 3,
            fill:        this._energized ? '#42a5f5' : '#546e7a',
            stroke:      this._energized ? '#1565c0' : '#37474f',
            strokeWidth: 0.6,
            shadowColor: '#42a5f5',
            shadowBlur:  this._energized ? 5 : 0,
            shadowOpacity: 0.9,
        });
        this.group.add(this._statusDot, this._statusText, this._coilDot);
    }

    // ── 点击触发动作 ─────────────────────────
    _bindInteraction() {
        // 线圈外壳可点击（模拟通电）
        this._dynGroup.on('click tap', () => this.toggle());
        this._dynGroup.listening(true);
        this._coilCase && this.group.on('click tap', () => this.toggle());
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        // 流体粒子相位（持续推进，阀开时可见）
        this._flowPhase = (this._flowPhase + dt * 1.8) % (Math.PI * 2);

        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._open      = this._animDir > 0;
                this._energized = this._animDir > 0;
            }
            // 正弦缓动
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._plungerY = this._animDir > 0 ? ease : (1 - ease);
        }

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const o = this._open || (this._animating && this._animDir > 0 && this._plungerY > 0.5);
        const e = this._energized || (this._animating && this._animDir > 0);
        if (this._statusDot) {
            this._statusDot.fill(o ? '#66bb6a' : '#ef5350');
            this._statusDot.stroke(o ? '#2e7d32' : '#c62828');
            this._statusDot.shadowColor(o ? '#66bb6a' : '#ef5350');
            this._statusDot.shadowBlur(o ? 5 : 2);
        }
        if (this._statusText) {
            this._statusText.text(o ? '开' : '关');
            this._statusText.fill(o ? '#66bb6a' : '#ef5350');
        }
        if (this._coilDot) {
            this._coilDot.fill(e ? '#42a5f5' : '#546e7a');
            this._coilDot.stroke(e ? '#1565c0' : '#37474f');
            this._coilDot.shadowBlur(e ? 5 : 0);
        }
    }

    // ═══════════════════════════════════════════
    /** 切换电磁阀通/断电状态 */
    toggle() {
        if (this._animating) return;
        if (this.valveType === 'NC') {
            // 常闭：通电→开，断电→关
            this._animDir = this._open ? -1 : 1;
        } else {
            // 常开：通电→关，断电→开
            this._animDir = this._open ? -1 : 1;
        }
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 通电（励磁） */
    energize() {
        if (this._energized || this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this._energized = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 断电（失磁，弹簧复位） */
    deEnergize() {
        if (!this._energized || this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animating = true;
        this._energized = false;
        this.opsCount++;
        this._refreshCache();
    }

    /** 查询当前状态 */
    isOpen()      { return this._open; }
    isEnergized() { return this._energized; }
    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.energize() : this.deEnergize();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',         type: 'text'   },
            { label: '线圈电压 (V)',         key: 'ratedVoltage',  type: 'number' },
            { label: '额定压力 (MPa)',       key: 'ratedPressure', type: 'number' },
            { label: '介质',                 key: 'medium',        type: 'text'   },
            { label: '阀型 (NC/NO)',         key: 'valveType',     type: 'text'   },
            { label: '初始通电状态（1=是）', key: 'initEnergized', type: 'number' },
            { label: '动作时间 (s)',         key: 'animDur',       type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label         = cfg.label         || this.label;
        this.ratedVoltage  = parseFloat(cfg.ratedVoltage)  || this.ratedVoltage;
        this.ratedPressure = parseFloat(cfg.ratedPressure) || this.ratedPressure;
        this.medium        = cfg.medium        || this.medium;
        this.valveType     = cfg.valveType     || this.valveType;
        this._animDur      = parseFloat(cfg.animDur)       || this._animDur;
        if (cfg.initEnergized !== undefined) {
            const wantOn = !!parseInt(cfg.initEnergized);
            if (wantOn !== this._energized) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}