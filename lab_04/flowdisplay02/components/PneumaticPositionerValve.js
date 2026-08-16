import { BaseComponent } from './BaseComponent.js';

/**
 * 带气动阀门定位器的气动薄膜调节阀仿真组件
 * （Pneumatic Diaphragm Control Valve with Valve Positioner）
 *
 * ── 参考图纸编号对照 ─────────────────────────────────────────
 *
 *  左侧——气动薄膜执行机构：
 *   ①  阀体（Valve Body）—— 流体通道，含阀座
 *   ②  阀杆（Valve Stem）—— 连接阀芯与执行机构
 *   ③  支架/轭架（Yoke）—— 连接阀体与膜头
 *   ④  弹簧（Spring）—— 复位弹簧（气关型：弹簧在上；气开型：弹簧在下）
 *   ⑤  膜室下盖（Lower Diaphragm Case）
 *   ⑥  膜片（Diaphragm）—— 将气压转化为推力
 *   ⑦  膜室上盖（Upper Diaphragm Case）
 *   ⑧  气室进气口（Diaphragm Chamber Inlet）—— 接定位器输出
 *
 *  右侧——阀门定位器（Valve Positioner）：
 *   ⑨  定位器外壳（Positioner Housing）
 *   ⑩  比较放大机构/力矩马达（Flapper-Nozzle / Force Motor）
 *   ⑪  喷嘴-挡板（Nozzle-Flapper Assembly）
 *   ⑫  先导阀（Pilot Valve）
 *   ⑬  调零旋钮（Zero Adjustment）—— 调节零点偏差
 *   ⑭  气源进口（Air Supply Inlet，0.14~0.7MPa）
 *   ⑮  排气口（Exhaust Port）
 *   ⑯  继动器/放大器（Relay/Amplifier）
 *   ⑰  输出气路（Output to Diaphragm Chamber）
 *   ⑱  输出气路切换块
 *   ⑲  输出截止阀（Output Shutoff Valve）
 *   ⑳  弹性反馈元件（Feedback Bellows/Spring）
 *   ㉑  反馈凸轮（Feedback Cam）—— 将阀杆位移转为反馈力
 *   ㉒  反馈杆（Feedback Lever）—— 传递位置信号
 *   ㉓  量程弹簧（Range Spring）—— 信号弹簧（4~20mA 对应气压）
 *   ㉔  输入信号接收元件（Signal Bellows/Coil，4~20mA 电流信号）
 *   ㉕  气源过滤减压阀（Filter Regulator，25号）
 *
 * ── 工作原理 ─────────────────────────────────────────────────
 *
 *  信号电流（4~20mA）→ 电流/气压转换器（I/P）→ 先导气压（0.02~0.1MPa）
 *    → 继动器放大（0.02~0.1MPa→0.02~输出气压）
 *    → 膜室充气/排气 → 膜片推动阀杆 → 阀芯移动（开/关）
 *    → 反馈凸轮+反馈杆 → 量程弹簧反馈力 → 力矩平衡
 *    → 阀门开度精确对应输入信号（位置闭环）
 *
 * ── 仿真状态机 ───────────────────────────────────────────────
 *
 *  输入：4~20mA 控制信号（通过 wire 端口接入）
 *  气源：0.14~0.4MPa（通过 pipe 端口接入）
 *  输出：
 *    · 阀门开度（0%~100%）
 *    · 定位器输出气压（0.02~0.1MPa）
 *    · 膜室气压
 *    · 阀杆实际位移（像素）
 *
 *  气开型（FC，Fail Close）：无气源时弹簧关闭阀门
 *    4mA→全关（0%）；20mA→全开（100%）
 *  气关型（FO，Fail Open）：无气源时弹簧开启阀门
 *    4mA→全开（100%）；20mA→全关（0%）
 *
 * ── 动画 ─────────────────────────────────────────────────────
 *
 *  · 膜片随气压上下移动（strokePx = 80px 原始尺寸）
 *  · 弹簧随压缩量实时重绘（_getSpringPoints）
 *  · 阀杆/阀芯跟随膜片联动
 *  · 反馈凸轮随阀杆位移旋转
 *  · 定位器输出气压表指针实时转动
 *  · 定位器 LCD 显示电流值 + 开度百分比
 *  · 流体通道颜色随阀门开度变化（开→蓝绿，关→深灰）
 *  · 气路管道颜色随气压变化（无压→灰，有压→蓝）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_r      — 控制信号正极（4~20mA +）
 *  wire_l      — 控制信号负极（4~20mA -）
 *  pipe_supply — 气源进口（0.14~0.4MPa，接过滤减压阀）
 *  pipe_in     — 流体进口（阀体入口）
 *  pipe_out    — 流体出口（阀体出口）
 */
export class PneumaticPositionerValve extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 整体尺寸 ──
        // 原始设计空间：400×750，缩放 0.72 后约 288×540
        this.ORIG_W  = 400;
        this.ORIG_H  = 750;
        this.scale   = config.scale || 0.72;
        this.w = Math.round(this.ORIG_W * this.scale);
        this.h = Math.round(this.ORIG_H * this.scale);

        this.type    = 'pneumatic_positioner_valve';
        this.special = 'actuator';
        this.cache   = 'fixed';

        this._initGroups();
        // ── 铭牌参数 ──
        this.label        = config.label        || 'FV';
        this.cvValue      = config.cvValue      || 40;     // 流量系数
        this.ratedPress   = config.ratedPress   || 1.6;    // MPa 公称压力
        this.supplyMin    = config.supplyMin    || 0.14;   // MPa 气源范围
        this.supplyMax    = config.supplyMax    || 0.40;
        this.signalMin    = config.signalMin    || 4;      // mA 信号范围
        this.signalMax    = config.signalMax    || 20;

        // ── 动作方向 ──
        // 'FC'（气开/故障关）：气压↑→开度↑
        // 'FO'（气关/故障开）：气压↑→开度↓
        this.dir = config.dir || 'FC';

        // ── 核心物理状态 ──
        this.travel       = 0;         // 归一化阀门开度 0~1
        this.targetTravel = 0;
        this.strokePx     = 80;        // 原始坐标系中膜片最大行程（px）
        this.currentmA    = 4.0;       // 当前输入信号 mA
        this.outPress     = 0.02;      // 定位器输出气压 MPa
        this.sourcePress  = 0;         // 气源压力 MPa
        this.chamberPress = 0;         // 膜室压力 MPa
        this.isLeaking    = false;
        this.isStuck      = false;

        // ── 原始坐标系中的关键 X 中心 ──
        this.CX = this.ORIG_W * 0.32;  // 执行机构中心线 X

        this._loopTimer = null;
        this._initVisuals();
        this._initPositioner();
        this._initPneumaticLines();

        // ── 端口（缩放后坐标）──
        const s = this.scale;
        const cx = this.CX * s;
        // 控制信号线端口（定位器电气接线端子）
        this.addPort(this.w + 5, 430 * s, 'r',       'wire',  '+');
        this.addPort(this.w + 5, 455 * s, 'l',       'wire',  '-');
        // 气源进口（过滤减压阀底部）
        this.addPort(this.w + 5, 620 * s, 'supply',  'pipe',  'AS');
        // 流体进出口
        this.addPort(cx - 70*s,  this.h + 5, 'pipe_in',  'pipe', 'IN');
        this.addPort(cx + 70*s,  this.h + 5, 'pipe_out', 'pipe', 'OUT');

    }

    // ════════════════════════════════════════════════════════
    // 一、执行机构本体（左侧大结构）
    // ════════════════════════════════════════════════════════
    _initVisuals() {
        const s = this.scale;
        this.scaleGroup = new Konva.Group({ scaleX: s, scaleY: s });
        this._staticGroup.add(this.scaleGroup);

        const cx = this.CX;

        // ── ① 阀体 ──────────────────────────────
        this._drawValveBody(cx);

        // ── ③ 支架（Yoke）────────────────────────
        this._drawYoke(cx);

        // ── ④⑤⑥⑦ 膜头组件 ──────────────────────
        this._drawDiaphragmHead(cx);

        // ── ② 阀杆 + 阀芯（动态）────────────────
        this._initStemGroup(cx);

        // ── 填料函 ───────────────────────────────
        this._drawPackingBox(cx);
    }

    // ① 阀体
    _drawValveBody(cx) {
        const bodyY  = 580;
        const bodyW  = 220, bodyH = 150;

        // 阀体外壳（铸铁灰）
        this.scaleGroup.add(new Konva.Rect({
            x: cx - bodyW/2, y: bodyY,
            width: bodyW, height: bodyH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bodyW, y: 0 },
            fillLinearGradientColorStops: [
                0,'#5a5e68', 0.15,'#8a8e98', 0.40,'#a8acb8',
                0.65,'#9098a8', 0.85,'#7a8090', 1,'#505460',
            ],
            stroke: '#3a3e48', strokeWidth: 2,
            cornerRadius: [6,6,10,10],
            shadowColor: '#000', shadowBlur: 10, shadowOpacity: 0.35,
        }));
        // 阀体高光
        this.scaleGroup.add(new Konva.Rect({
            x: cx - bodyW/2 + 4, y: bodyY + 3,
            width: bodyW - 8, height: bodyH * 0.15,
            fill: 'rgba(255,255,255,0.12)',
            cornerRadius: [4,4,0,0],
        }));

        // 流体进出口管道（水平，左进右出）
        const pipeY = bodyY + bodyH * 0.40;
        const pipeH = bodyH * 0.38;
        // 左侧进口管
        this.scaleGroup.add(new Konva.Rect({
            x: cx - bodyW/2 - 80, y: pipeY,
            width: 82, height: pipeH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: pipeH },
            fillLinearGradientColorStops: [0,'#606a78', 0.4,'#8a96a8', 0.7,'#7a8698', 1,'#505a68'],
            stroke: '#3a4050', strokeWidth: 1.5,
        }));
        // 右侧出口管
        this.scaleGroup.add(new Konva.Rect({
            x: cx + bodyW/2 - 2, y: pipeY,
            width: 82, height: pipeH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: pipeH },
            fillLinearGradientColorStops: [0,'#606a78', 0.4,'#8a96a8', 0.7,'#7a8698', 1,'#505a68'],
            stroke: '#3a4050', strokeWidth: 1.5,
        }));

        // 流体通道内腔（颜色随开度变）
        this._fluidPath = new Konva.Path({
            x: cx, y: bodyY,
            data: `M -${bodyW/2-2} ${bodyH*0.40} L -${bodyW/2-2} ${bodyH*0.78}
                   L ${bodyW/2-2} ${bodyH*0.78} L ${bodyW/2-2} ${bodyH*0.40}
                   L ${bodyW*0.28} ${bodyH*0.40} L ${bodyW*0.28} ${bodyH*0.44}
                   L -${bodyW*0.28} ${bodyH*0.44} L -${bodyW*0.28} ${bodyH*0.40} Z`,
            fill: 'rgba(30,80,160,0.18)',
        });
        this.scaleGroup.add(this._fluidPath);

        // 阀座（阀体中央孔口）
        this._seatPath = new Konva.Path({
            x: cx, y: bodyY + bodyH*0.42,
            data: `M -28 0 L 28 0 L 20 22 L 0 28 L -20 22 Z`,
            fill: '#2a2e38', stroke: '#1a1e28', strokeWidth: 1,
        });
        this.scaleGroup.add(this._seatPath);

        // 端部法兰
        [[cx-bodyW/2-2, pipeY], [cx+bodyW/2-2+78, pipeY]].forEach(([fx, fy]) => {
            this.scaleGroup.add(new Konva.Rect({
                x: fx - 3, y: fy - 6,
                width: 6, height: pipeH + 12,
                fill: '#707888', stroke: '#505860', strokeWidth: 1,
                cornerRadius: 2,
            }));
            // 法兰螺钉
            [-pipeH*0.25, pipeH*0.25].forEach(dy => {
                this.scaleGroup.add(new Konva.Circle({
                    x: fx, y: fy + pipeH/2 + dy,
                    radius: 4, fill: '#909aa8', stroke: '#606870', strokeWidth: 0.8,
                }));
            });
        });

        // 流向箭头
        [cx - bodyW/2 - 40, cx + bodyW/2 + 40].forEach((ax, i) => {
            this.scaleGroup.add(new Konva.Text({
                x: ax - 12, y: pipeY + pipeH/2 - 7,
                text: i === 0 ? '→' : '→',
                fontSize: 18, fill: 'rgba(100,160,220,0.60)',
            }));
        });

        this._bodyY    = bodyY;
        this._bodyW    = bodyW;
        this._bodyH    = bodyH;
        this._pipeY    = pipeY;
        this._pipeH    = pipeH;
    }

    // ③ 支架 Yoke
    _drawYoke(cx) {
        const yokeTopY = 390, yokeBotY = this._bodyY;
        // 两侧立柱
        [cx - 75, cx + 75].forEach(xx => {
            this.scaleGroup.add(new Konva.Rect({
                x: xx - 8, y: yokeTopY,
                width: 16, height: yokeBotY - yokeTopY,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint:   { x: 16, y: 0 },
                fillLinearGradientColorStops: [0,'#2a4aaa', 0.35,'#4a6aca', 0.65,'#3a5aba', 1,'#1a3a8a'],
                stroke: '#1a3080', strokeWidth: 1,
            }));
        });
        // 顶部横梁
        this.scaleGroup.add(new Konva.Rect({
            x: cx - 83, y: yokeTopY - 4,
            width: 166, height: 20,
            fill: '#3a5aba', stroke: '#1a3080', strokeWidth: 1,
            cornerRadius: 4,
        }));
        // 底部连接法兰（连接阀体顶部）
        this.scaleGroup.add(new Konva.Rect({
            x: cx - 95, y: this._bodyY - 18,
            width: 190, height: 22,
            fill: '#3a3e48', stroke: '#252830', strokeWidth: 1.5,
            cornerRadius: 3,
        }));
        // 法兰连接螺栓
        [cx-70, cx-25, cx+25, cx+70].forEach(bx => {
            this.scaleGroup.add(new Konva.Circle({
                x: bx, y: this._bodyY - 7,
                radius: 5, fill: '#808890', stroke: '#505860', strokeWidth: 0.8,
            }));
        });

        this._yokeTopY = yokeTopY;
    }

    // ④⑤⑥⑦ 膜头组件
    _drawDiaphragmHead(cx) {
        const headCenterY = 200;
        const headRx = 140, headRy = 85;

        // ⑦ 上膜室（气室上盖，浅灰）
        this.scaleGroup.add(new Konva.Ellipse({
            x: cx, y: headCenterY - headRy,
            radiusX: headRx, radiusY: headRy * 0.45,
            fillLinearGradientStartPoint: { x: -headRx, y: 0 },
            fillLinearGradientEndPoint:   { x: headRx, y: 0 },
            fillLinearGradientColorStops: [0,'#8090a0', 0.3,'#c0cad8', 0.55,'#d8e2ee', 0.8,'#b0beca', 1,'#7a8898'],
            stroke: '#607080', strokeWidth: 2,
        }));
        // 上盖顶面高光
        this.scaleGroup.add(new Konva.Ellipse({
            x: cx - headRx*0.08, y: headCenterY - headRy - headRy*0.18,
            radiusX: headRx*0.60, radiusY: headRy*0.18,
            fill: 'rgba(255,255,255,0.25)',
        }));

        // ⑧ 气室进气接头（上盖顶部右侧）
        const inletX = cx + headRx * 0.55;
        const inletY = headCenterY - headRy - 10;
        this.scaleGroup.add(new Konva.Rect({
            x: inletX - 8, y: inletY - 28,
            width: 16, height: 32,
            fill: '#707880', stroke: '#505860', strokeWidth: 1,
            cornerRadius: 3,
        }));
        // 接头螺纹纹路
        for (let i = 0; i < 4; i++) {
            this.scaleGroup.add(new Konva.Line({
                points: [inletX-8, inletY-24+i*6, inletX+8, inletY-24+i*6],
                stroke: '#404848', strokeWidth: 0.8,
            }));
        }
        // 接头顶帽
        this.scaleGroup.add(new Konva.Rect({
            x: inletX - 12, y: inletY - 34,
            width: 24, height: 8,
            fill: '#909aa8', stroke: '#606870', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 上膜室侧壁圆柱部分
        this.scaleGroup.add(new Konva.Rect({
            x: cx - headRx, y: headCenterY - headRy,
            width: headRx*2, height: headRy,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: headRx*2, y: 0 },
            fillLinearGradientColorStops: [0,'#8090a0', 0.12,'#b0beca', 0.45,'#ccd6e4', 0.75,'#b8c2d0', 0.90,'#909aa8', 1,'#707888'],
            stroke: '#607080', strokeWidth: 1.5,
        }));

        // ⑤ 下膜室盖板（较小，在膜片下方）
        this.scaleGroup.add(new Konva.Ellipse({
            x: cx, y: headCenterY + headRy*0.55,
            radiusX: headRx*0.72, radiusY: headRy*0.30,
            fillLinearGradientStartPoint: { x: -headRx*0.72, y: 0 },
            fillLinearGradientEndPoint:   { x: headRx*0.72, y: 0 },
            fillLinearGradientColorStops: [0,'#6a7888', 0.4,'#9aa8b8', 0.65,'#a8b8c8', 1,'#6a7888'],
            stroke: '#506070', strokeWidth: 1.5,
        }));

        // 膜头固定螺栓（外圆周均布 8 颗）
        for (let i = 0; i < 8; i++) {
            const a = (i/8)*Math.PI*2 - Math.PI*0.1;
            const bx = cx + Math.cos(a)*headRx*0.92;
            const by = headCenterY + Math.sin(a)*headRy*0.28;
            this.scaleGroup.add(new Konva.Circle({
                x: bx, y: by, radius: 6,
                fill: '#808890', stroke: '#505860', strokeWidth: 0.8,
            }));
            this.scaleGroup.add(new Konva.Circle({
                x: bx, y: by, radius: 3,
                fill: '#404848',
            }));
        }

        // ⑥ 膜片（动态，跟随气压移动）
        this.membrane = new Konva.Ellipse({
            x: cx, y: headCenterY,
            radiusX: headRx*0.90, radiusY: headRy*0.14,
            fill: '#1a1e5e',
            stroke: '#0d1040', strokeWidth: 3,
            shadowColor: '#0d1040', shadowBlur: 4, shadowOpacity: 0.5,
        });
        this.scaleGroup.add(this.membrane);
        // 膜片中心盘（压板）
        this.memPlate = new Konva.Ellipse({
            x: cx, y: headCenterY,
            radiusX: headRx*0.28, radiusY: headRy*0.10,
            fill: '#8090a0', stroke: '#607080', strokeWidth: 1.5,
        });
        this.scaleGroup.add(this.memPlate);

        // 悬挂导线（连接膜片两端到上盖内壁）
        this.leftWire  = new Konva.Line({ points:[-headRx*0.90, 0, -headRx*0.90, 0], stroke:'#1a2a9e', strokeWidth:3, x:cx, y:headCenterY });
        this.rightWire = new Konva.Line({ points:[ headRx*0.90, 0,  headRx*0.90, 0], stroke:'#1a2a9e', strokeWidth:3, x:cx, y:headCenterY });
        this.scaleGroup.add(this.leftWire, this.rightWire);

        // ④ 弹簧（在膜片下方～支架顶横梁）
        this.spring = new Konva.Line({
            x: cx, y: headCenterY,
            points: this._getSpringPoints(this._yokeTopY - headCenterY),
            stroke: '#087b16', strokeWidth: 5, lineJoin: 'round',
        });
        this.scaleGroup.add(this.spring);

        // 刻度尺（支架左侧，指示开度）
        this._drawScaleRule(cx - headRx - 30, this._yokeTopY + 10, this._bodyY - 30);

        this._headCX = cx;
        this._headCY = headCenterY;
        this._headRx = headRx;
        this._headRy = headRy;
    }

    // 开度刻度尺（③ 编号区域）
    _drawScaleRule(x, topY, botY) {
        const rulerH = botY - topY;
        // 刻度尺背景
        this.scaleGroup.add(new Konva.Rect({
            x: x - 2, y: topY, width: 28, height: rulerH,
            fill: '#e8eaee', stroke: '#a0a8b0', strokeWidth: 1,
            cornerRadius: 2,
        }));
        // 刻度线（10 等分）
        for (let i = 0; i <= 10; i++) {
            const ty = topY + rulerH * (i/10);
            const long = i % 5 === 0;
            this.scaleGroup.add(new Konva.Line({
                points: [x, ty, x + (long ? 22 : 14), ty],
                stroke: '#606870', strokeWidth: long ? 1.2 : 0.7,
            }));
            if (long) {
                this.scaleGroup.add(new Konva.Text({
                    x: x + 14, y: ty - 5,
                    text: `${100 - i*10}`,
                    fontSize: 8, fill: '#404850',
                }));
            }
        }
        // 指示指针（动态，跟随阀杆）
        this._rulePointer = new Konva.Line({
            points: [x - 4, topY, x - 4 + 8, topY],
            stroke: '#ef5350', strokeWidth: 2.5, lineCap: 'round',
        });
        this.scaleGroup.add(this._rulePointer);
        this._ruleTopY = topY;
        this._ruleH    = rulerH;
    }

    // ② 阀杆 + 阀芯（动态组）
    _initStemGroup(cx) {
        this.stemGroup = new Konva.Group();
        this.scaleGroup.add(this.stemGroup);

        // 阀杆主体
        this.stem = new Konva.Rect({
            x: cx - 5, y: this._headCY,
            width: 10, height: this._bodyY + this._bodyH*0.52 - this._headCY,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 10, y: 0 },
            fillLinearGradientColorStops: [0,'#888', 0.35,'#e0e0e0', 0.65,'#d0d0d0', 1,'#888'],
            stroke: '#666', strokeWidth: 0.8,
        });
        this.stemGroup.add(this.stem);

        // 阀芯（圆头锥形）
        this.plug = new Konva.Path({
            x: cx, y: this._bodyY + this._bodyH*0.30,
            data: 'M -22 0 L 22 0 Q 22 55 0 60 Q -22 55 -22 0 Z',
            fill: '#1a1e28', stroke: '#101420', strokeWidth: 1.5,
        });
        this.stemGroup.add(this.plug);

        // 联结器（阀杆与膜片连接块）
        this.coupling = new Konva.Group({ x: cx, y: this._headCY });
        this.coupling.add(new Konva.Rect({
            x: -14, y: -6, width: 28, height: 40,
            fill: '#444', stroke: '#333', strokeWidth: 0.8, cornerRadius: 3,
        }));
        this.coupling.add(new Konva.Rect({
            x: -17, y: 10, width: 34, height: 12,
            fill: '#222', cornerRadius: 2,
        }));
        this.stemGroup.add(this.coupling);
    }

    // 填料函（阀体顶部）
    _drawPackingBox(cx) {
        const pbY = this._bodyY - 65;
        this.packingBox = new Konva.Group({ x: cx - 22, y: pbY });

        this.packingBox.add(new Konva.Rect({
            width: 44, height: 68,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 44, y: 0 },
            fillLinearGradientColorStops: [0,'#606870', 0.3,'#909aa8', 0.6,'#a0aab8', 1,'#606870'],
            stroke: '#404850', strokeWidth: 1.2,
            cornerRadius: [3,3,0,0],
        }));
        // 填料纹路
        for (let i = 1; i <= 5; i++) {
            this.packingBox.add(new Konva.Line({
                points: [2, i*10, 42, i*10+4],
                stroke: 'rgba(100,110,120,0.5)', strokeWidth: 1,
            }));
        }
        // 压盖螺母
        this.packingBox.add(new Konva.Rect({
            x: -6, y: -8, width: 56, height: 10,
            fill: '#808890', stroke: '#606870', strokeWidth: 1, cornerRadius: 2,
        }));
        this.scaleGroup.add(this.packingBox);
    }

    // ════════════════════════════════════════════════════════
    // 二、气动阀门定位器（右侧）
    // ════════════════════════════════════════════════════════
    _initPositioner() {
        const s   = this.scale;
        // 定位器原始坐标（在原始坐标系内）
        const PX  = this.CX + 95;   // 定位器左边缘 X（原始）
        const PY  = 340;             // 定位器顶部 Y（原始）
        const PW  = 170;
        const PH  = 310;

        this.posGroup = new Konva.Group({ x: PX, y: PY });
        this.scaleGroup.add(this.posGroup);

        // ⑨ 定位器外壳
        this.posGroup.add(new Konva.Rect({
            width: PW, height: PH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: PW, y: PH },
            fillLinearGradientColorStops: [0,'#c8ccd4', 0.5,'#e0e4ec', 1,'#b8bcc8'],
            stroke: '#909098', strokeWidth: 2,
            cornerRadius: 6,
            shadowColor: '#000', shadowBlur: 8, shadowOpacity: 0.30,
        }));
        // 前盖（虚线边框区域）
        this.posGroup.add(new Konva.Rect({
            x: 8, y: 8, width: PW-16, height: PH-16,
            fill: '#b8bcc8', cornerRadius: 4,
            stroke: '#909098', strokeWidth: 1, dash: [5,4],
        }));
        // 顶部品牌标签
        this.posGroup.add(new Konva.Rect({
            x: 0, y: 0, width: PW, height: 22,
            fill: '#1565c0', cornerRadius: [6,6,0,0],
        }));
        this.posGroup.add(new Konva.Text({
            x: 0, y: 5, width: PW,
            text: 'POSITIONER  4~20mA',
            fontSize: 9, fontStyle: 'bold', fill: '#fff', align: 'center',
        }));

        // ──── 内部机构（从上到下） ────

        // ⑩ 比较放大机构（力矩马达线圈图示）
        this._drawForceMotor(PW, PH);

        // ⑪ 喷嘴-挡板组件
        this._drawNozzleFlapper(PW, PH);

        // ⑯ 继动器（气动放大器）
        this._drawRelay(PW, PH);

        // ⑳ 弹性反馈元件（量程弹簧）
        this._drawFeedbackBellows(PW, PH);

        // ⑬ 调零旋钮
        this._drawZeroKnob(PW, PH);

        // ㉑ 反馈凸轮（动态）
        this._drawFeedbackCam(PW, PH);

        // ㉒ 反馈杆
        this._drawFeedbackLever(PW, PH);

        // LCD 显示屏（电流 + 开度）
        this._drawPositionerLCD(PW, PH);

        // ㉕ 过滤减压阀（底部）
        this._drawFilterRegulator(PW, PH);

        // 气路接口标注
        this._drawPosPortLabels(PW, PH);

        this._PX = PX; this._PY = PY; this._PW = PW; this._PH = PH;
    }

    // ⑩ 力矩马达（线圈图示）
    _drawForceMotor(PW, PH) {
        const cx = PW/2, y = 35;
        // 线圈外框
        this.posGroup.add(new Konva.Rect({
            x: cx-30, y: y, width: 60, height: 38,
            fill: '#1a1e2a', stroke: '#303448', strokeWidth: 1.5, cornerRadius: 4,
        }));
        // 线圈绕组线条（水平波浪线模拟）
        for (let i = 0; i < 5; i++) {
            const ly = y + 6 + i*5;
            this.posGroup.add(new Konva.Line({
                points: [cx-26, ly, cx-18, ly+3, cx-10, ly, cx-2, ly+3, cx+6, ly, cx+14, ly+3, cx+22, ly],
                stroke: '#d4a020', strokeWidth: 1.5, lineJoin: 'round',
            }));
        }
        // 线圈中心铁芯
        this.posGroup.add(new Konva.Rect({
            x: cx-4, y: y+2, width: 8, height: 34,
            fill: '#404858', stroke: '#303040', strokeWidth: 0.8,
        }));
        // 输入端子引线
        this.posGroup.add(new Konva.Line({
            points: [cx-30, y+10, cx-44, y+10],
            stroke: '#ef5350', strokeWidth: 2, lineCap: 'round',
        }));
        this.posGroup.add(new Konva.Line({
            points: [cx-30, y+28, cx-44, y+28],
            stroke: '#1565c0', strokeWidth: 2, lineCap: 'round',
        }));
        // 端子标注
        this.posGroup.add(new Konva.Text({ x: cx-62, y: y+5,  text: '+', fontSize: 10, fontStyle: 'bold', fill: '#ef5350' }));
        this.posGroup.add(new Konva.Text({ x: cx-62, y: y+23, text: '−', fontSize: 10, fontStyle: 'bold', fill: '#1565c0' }));
    }

    // ⑪ 喷嘴-挡板 + 先导阀
    _drawNozzleFlapper(PW, PH) {
        const cx = PW * 0.48, y = 90;
        // 挡板（小矩形）
        this.posGroup.add(new Konva.Rect({
            x: cx-18, y: y, width: 36, height: 8,
            fill: '#505868', stroke: '#303848', strokeWidth: 1, cornerRadius: 2,
        }));
        // 喷嘴管（三角形符号）
        this.posGroup.add(new Konva.RegularPolygon({
            x: cx, y: y+20, sides: 3, radius: 10,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1, rotation: 180,
        }));
        // 先导阀体（⑫）
        this.posGroup.add(new Konva.Rect({
            x: cx-14, y: y+30, width: 28, height: 18,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 1, cornerRadius: 3,
        }));
        // ⑬ 调零旋钮（右侧小圆）
        this.posGroup.add(new Konva.Circle({
            x: cx+40, y: y+8, radius: 10,
            fill: '#808898', stroke: '#606070', strokeWidth: 1.2,
        }));
        this.posGroup.add(new Konva.Text({
            x: cx+28, y: y+20, text: 'ZERO',
            fontSize: 7, fill: '#404850',
        }));
        // °F 标注（参考图中⑫处）
        this.posGroup.add(new Konva.Text({
            x: cx-52, y: y+32, text: '°F',
            fontSize: 10, fontStyle: 'bold', fill: '#ef5350',
        }));
    }

    // ⑯ 继动器（气动放大器）
    _drawRelay(PW, PH) {
        const cx = PW/2, y = 160;
        // 继动器外壳（红色上半，蓝色下半 对应图片）
        this.posGroup.add(new Konva.Rect({
            x: cx-32, y: y, width: 64, height: 28,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 1.2, cornerRadius: [4,4,0,0],
        }));
        this.posGroup.add(new Konva.Rect({
            x: cx-32, y: y+28, width: 64, height: 28,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1.2, cornerRadius: [0,0,4,4],
        }));
        // 活塞/阀门内部（黑点）
        this.posGroup.add(new Konva.Circle({ x: cx, y: y+14, radius: 8, fill: '#1a1e2a', stroke: '#303040', strokeWidth: 0.8 }));
        this.posGroup.add(new Konva.Circle({ x: cx, y: y+42, radius: 8, fill: '#1a1e2a', stroke: '#303040', strokeWidth: 0.8 }));
        // 标注
        this.posGroup.add(new Konva.Text({ x: cx-28, y: y+3,  text: 'RELAY', fontSize: 8, fill: '#fff', fontStyle: 'bold' }));
    }

    // ⑳ 弹性反馈元件（量程弹簧+波纹管）
    _drawFeedbackBellows(PW, PH) {
        const cx = PW*0.22, y = 165;
        // 波纹管外框
        this.posGroup.add(new Konva.Rect({
            x: cx-14, y: y, width: 28, height: 55,
            fill: 'transparent', stroke: '#707880', strokeWidth: 1, cornerRadius: 4,
        }));
        // 波纹（水平线模拟）
        for (let i = 0; i < 7; i++) {
            this.posGroup.add(new Konva.Line({
                points: [cx-12, y+4+i*7, cx+12, y+4+i*7],
                stroke: '#8090a0', strokeWidth: 1.5,
            }));
        }
    }

    // 调零旋钮（独立绘制）
    _drawZeroKnob(PW, PH) { /* 已在 _drawNozzleFlapper 中绘制 */ }

    // ㉑ 反馈凸轮（动态可旋转）
    _drawFeedbackCam(PW, PH) {
        const cx = PW * 0.78, cy = 220;
        // 凸轮本体
        this._camGroup = new Konva.Group({ x: cx, y: cy });
        this._camGroup.add(new Konva.Ellipse({
            radiusX: 18, radiusY: 22,
            fill: '#505868', stroke: '#303848', strokeWidth: 1.5,
        }));
        // 凸起轮廓
        this._camGroup.add(new Konva.Path({
            data: 'M 0 -22 Q 18 -14 18 0 Q 18 16 0 22 Q -12 16 -18 0 Q -18 -14 0 -22 Z',
            fill: 'transparent', stroke: '#6a7880', strokeWidth: 2,
        }));
        // 中心轴孔
        this._camGroup.add(new Konva.Circle({ radius: 4, fill: '#808898', stroke: '#505860', strokeWidth: 1 }));
        // 随动滚轮（凸轮右侧小圆）
        this._camGroup.add(new Konva.Circle({ x: 20, y: 0, radius: 5, fill: '#909aa8', stroke: '#606870', strokeWidth: 0.8 }));

        this.posGroup.add(this._camGroup);
        // 中心轴连线（连接到阀杆）
        this._camLink = new Konva.Line({
            points: [cx, cy, cx-60, cy],
            stroke: '#506080', strokeWidth: 2, dash: [4,3], lineCap: 'round',
        });
        this.posGroup.add(this._camLink);
    }

    // ㉒ 反馈杆
    _drawFeedbackLever(PW, PH) {
        const y = 220;
        this._feedbackLever = new Konva.Line({
            points: [PW*0.78-18, y, PW*0.20, y],
            stroke: '#8090a8', strokeWidth: 4, lineCap: 'round',
        });
        this.posGroup.add(this._feedbackLever);
        // 铰接点
        this.posGroup.add(new Konva.Circle({ x: PW*0.35, y: y, radius: 5, fill: '#606870', stroke: '#404850', strokeWidth: 1 }));
        // 量程弹簧（㉓）水平弹簧
        const spPts = [];
        const spCount = 8, spStartX = PW*0.18, spEndX = PW*0.50;
        for (let i = 0; i <= spCount; i++) {
            spPts.push(spStartX + (spEndX-spStartX)*(i/spCount), y + (i%2===0?-5:5));
        }
        this.posGroup.add(new Konva.Line({
            points: spPts, stroke: '#2e7d32', strokeWidth: 3, lineJoin: 'round',
        }));
        // ㉔ 信号波纹管（输入侧，左侧小方块）
        this.posGroup.add(new Konva.Rect({
            x: 10, y: y-12, width: 22, height: 24,
            fill: '#1565c0', stroke: '#0d47a1', strokeWidth: 1, cornerRadius: 3,
        }));
        for (let i=0; i<4; i++) {
            this.posGroup.add(new Konva.Line({
                points: [12, y-8+i*5, 30, y-8+i*5],
                stroke: 'rgba(255,255,255,0.25)', strokeWidth: 0.8,
            }));
        }
    }

    // 定位器 LCD 显示屏
    _drawPositionerLCD(PW, PH) {
        const lx = 12, ly = PH - 95;
        // 外框
        this.posGroup.add(new Konva.Rect({
            x: lx-2, y: ly-2, width: PW-20, height: 46,
            fill: '#0a0e14', stroke: '#2a3040', strokeWidth: 1, cornerRadius: 3,
        }));
        // 屏幕
        this._lcdBg = new Konva.Rect({
            x: lx, y: ly, width: PW-24, height: 42,
            fill: '#0d1e2e', cornerRadius: 2,
        });
        this.posGroup.add(this._lcdBg);

        this._lcdText = new Konva.Text({
            x: lx+4, y: ly+4,
            width: PW-32, text: '4.0 mA  0.0%',
            fontSize: 13, fontFamily: 'Courier New',
            fontStyle: 'bold', fill: '#33ff33',
        });
        this.posGroup.add(this._lcdText);

        // 输出气压表（LCD 右侧）
        this._drawOutputGauge(PW-32, ly + 6);
    }

    // 定位器输出气压表（⑰ 区域）
    _drawOutputGauge(gx, gy) {
        const gr = 22;
        // 表盘外圈
        this.posGroup.add(new Konva.Circle({
            x: gx, y: gy + gr,
            radius: gr+2, fill: '#606870', stroke: '#404850', strokeWidth: 1,
        }));
        this.posGroup.add(new Konva.Circle({
            x: gx, y: gy + gr,
            radius: gr, fill: '#f8f8f8',
        }));
        // 刻度弧（0~0.1MPa，150°~390°）
        for (let i = 0; i <= 10; i++) {
            const angle = 150 + i * 24;
            const rad = angle * Math.PI / 180;
            const long = i%5===0;
            this.posGroup.add(new Konva.Line({
                points: [
                    gx + Math.cos(rad)*(gr-1), gy + gr + Math.sin(rad)*(gr-1),
                    gx + Math.cos(rad)*(gr-1-(long?7:4)), gy + gr + Math.sin(rad)*(gr-1-(long?7:4)),
                ],
                stroke: '#333', strokeWidth: long?1.5:0.8,
            }));
        }
        // 表盘文字
        this.posGroup.add(new Konva.Text({
            x: gx-14, y: gy+gr+4, width: 28, text: 'MPa',
            fontSize: 7, fill: '#0d47a1', align: 'center',
        }));
        // 指针（动态）
        this._gaugePointer = new Konva.Line({
            points: [gx, gy+gr, gx + Math.cos(150*Math.PI/180)*14, gy+gr + Math.sin(150*Math.PI/180)*14],
            stroke: '#ef5350', strokeWidth: 2, lineCap: 'round',
        });
        this.posGroup.add(this._gaugePointer);
        this.posGroup.add(new Konva.Circle({ x: gx, y: gy+gr, radius: 2.5, fill: '#333' }));
        this._gaugeCX = gx; this._gaugeCY = gy + gr; this._gaugeR = gr;
    }

    // ㉕ 过滤减压阀（定位器底部）
    _drawFilterRegulator(PW, PH) {
        const fx = PW/2, fy = PH - 42;
        // 阀体
        this.posGroup.add(new Konva.Rect({
            x: fx-25, y: fy, width: 50, height: 35,
            fill: '#c0c8d0', stroke: '#909aa8', strokeWidth: 1.2, cornerRadius: 4,
        }));
        // 过滤器网格
        for (let i=0; i<4; i++) {
            this.posGroup.add(new Konva.Line({
                points: [fx-22, fy+6+i*5, fx+22, fy+6+i*5],
                stroke: 'rgba(80,90,100,0.25)', strokeWidth: 0.8,
            }));
        }
        // 调压旋钮（顶部小帽）
        this.posGroup.add(new Konva.Circle({
            x: fx, y: fy+5, radius: 10,
            fill: '#808898', stroke: '#606070', strokeWidth: 1,
        }));
        this.posGroup.add(new Konva.Circle({
            x: fx, y: fy+5, radius: 4, fill: '#404858',
        }));
        // 底部气源进口管
        this.posGroup.add(new Konva.Rect({
            x: fx-6, y: fy+35, width: 12, height: 20,
            fill: '#707880', stroke: '#505860', strokeWidth: 1,
        }));
        // 标注
        this.posGroup.add(new Konva.Text({
            x: fx-22, y: fy+14, width: 44, text: 'FILTER\nREG.',
            fontSize: 7, fill: '#404850', align: 'center',
        }));
        // 气源标注
        this.posGroup.add(new Konva.Text({
            x: fx-12, y: fy+55, text: 'AS↑', fontSize: 9, fontStyle: 'bold', fill: '#1565c0',
        }));
    }

    // 端口标注
    _drawPosPortLabels(PW, PH) {
        // 电气端子（右侧）
        this.posGroup.add(new Konva.Text({ x: PW+2, y: 42,  text: '+', fontSize: 9, fontStyle: 'bold', fill: '#ef5350' }));
        this.posGroup.add(new Konva.Text({ x: PW+2, y: 67, text: '−', fontSize: 9, fontStyle: 'bold', fill: '#1565c0' }));
        // 输出接管（到膜室的气管，⑰）
        this.posGroup.add(new Konva.Text({ x: -30, y: 155, text: 'OUT→', fontSize: 8, fill: '#1976d2' }));
    }

    // ════════════════════════════════════════════════════════
    // 三、气路连接管线（蓝色虚线，参考图纸）
    // ════════════════════════════════════════════════════════
    _initPneumaticLines() {
        this._pneumaticGroup = new Konva.Group();
        this.scaleGroup.add(this._pneumaticGroup);
        this._redrawPneumaticLines(0);
    }

    _redrawPneumaticLines(pressure) {
        this._pneumaticGroup.destroyChildren();
        const alpha = Math.min(1, 0.3 + pressure / 0.1 * 0.7);
        const color = `rgba(21,101,192,${alpha})`;
        const lw    = 2.5;

        // 气源到定位器过滤减压阀（底部向上）
        this._addDashedLine([this._PX + this._PW/2, 700,
                              this._PX + this._PW/2, this._PY + this._PH - 5], color, lw, [6,4]);

        // 定位器输出到膜室进气接头（左出口 → 膜室上盖接头）
        const outX = this._PX;
        const outY = this._PY + 165;
        const inX  = this._headCX + this._headRx * 0.55;
        const inY  = this._headCY - this._headRy - 40;
        this._addDashedLine([outX, outY, inX+8, outY, inX+8, inY], color, lw, [6,4]);

        // 排气口向下（⑮）
        this._addDashedLine([this._PX + this._PW/2 + 20, this._PY + this._PH - 5,
                              this._PX + this._PW/2 + 20, 720], 'rgba(100,100,100,0.35)', 1.5, [4,4]);
    }

    _addDashedLine(pts, color, width, dash) {
        this._pneumaticGroup.add(new Konva.Line({
            points: pts, stroke: color, strokeWidth: width,
            dash: dash, lineCap: 'round',
        }));
    }

    // ════════════════════════════════════════════════════════
    // 四、弹簧辅助函数
    // ════════════════════════════════════════════════════════
    _getSpringPoints(h) {
        const pts   = [];
        const coils = 14;
        const amp   = 26;
        for (let i = 0; i <= coils; i++) {
            pts.push(i % 2 === 0 ? -amp : amp, (i / coils) * h);
        }
        return pts;
    }

    // ════════════════════════════════════════════════════════
    // 五、主仿真循环
    // ════════════════════════════════════════════════════════
    tick(dt) {
        this._tickAcc = (this._tickAcc || 0) + dt;
        if (this._tickAcc < 0.15) return;
        this._tickAcc = 0;
        try {
            const voltage = this.sys?.getVoltageBetween(`${this.id}_wire_r`, `${this.id}_wire_l`) || 0;
            const mA = Math.max(4, Math.min(20, voltage / 250 * 1000));
            this.update(mA);
        } catch(e) {
            this.update(this.currentmA);
        }
        this._refreshCache();
    }

    // ════════════════════════════════════════════════════════
    // 六、核心更新函数
    // ════════════════════════════════════════════════════════
    update(inputmA) {
        const mA = typeof inputmA === 'number'
            ? Math.max(4, Math.min(20, inputmA)) : 4;
        this.currentmA = mA;

        // ── 1. 电流 → 开度转换 ──
        const percent = (mA - 4) / 16;  // 0~1
        const targetOpen = this.dir === 'FC' ? percent : (1 - percent);

        // 定位器输出气压（0.02~0.1MPa）
        this.outPress = 0.02 + percent * 0.08;

        // 膜室实际气压（若无气源则无法动作）
        const hasSupply = this.sourcePress > 0.12;
        this.chamberPress = hasSupply
            ? Math.min(this.sourcePress, this.outPress)
            : 0;

        // ── 2. 卡死 / 泄漏处理 ──
        if (this.isStuck) {
            // 保持 travel 不变
        } else if (this.isLeaking) {
            // 泄漏：travel 缓慢归零
            this.travel += (-this.travel) * 0.05;
        } else if (!hasSupply) {
            // 无气源：弹簧复位
            const failOpen = this.dir === 'FO' ? 1 : 0;
            this.travel += (failOpen - this.travel) * 0.08;
        } else {
            // 正常：带惯性跟踪目标开度
            this.travel += (targetOpen - this.travel) * 0.25;
        }
        this.travel = Math.max(0, Math.min(1, this.travel));

        // ── 3. 机械联动 ──
        const move = this.travel * this.strokePx;  // 像素位移（原始坐标系）
        const effectiveMove = this.dir === 'FC' ? move : (this.strokePx - move);

        // 膜片移动
        this.membrane.y(this._headCY + effectiveMove);
        this.memPlate.y(this._headCY + effectiveMove);

        // 悬挂导线（膜片两端连接上盖壁）
        this.leftWire.points([-this._headRx*0.90, 0, -this._headRx*0.90, effectiveMove]);
        this.leftWire.y(this._headCY);
        this.rightWire.points([this._headRx*0.90, 0, this._headRx*0.90, effectiveMove]);
        this.rightWire.y(this._headCY);

        // 弹簧（膜片下面~支架顶部）
        const springLen = this._yokeTopY - this._headCY - effectiveMove;
        this.spring.y(this._headCY + effectiveMove);
        this.spring.points(this._getSpringPoints(Math.max(10, springLen)));

        // 阀杆整体跟随
        this.stem.y(this._headCY + effectiveMove);
        this.coupling.y(this._headCY + effectiveMove);
        this.plug.y(this._bodyY + this._bodyH*0.30 + effectiveMove);

        // 填料函（固定不动，但颜色可变化）

        // 开度刻度指针
        if (this._rulePointer) {
            const ruleY = this._ruleTopY + this._ruleH * (1 - this.travel);
            this._rulePointer.points([
                this._headCX - this._headRx - 34, ruleY,
                this._headCX - this._headRx - 26, ruleY,
            ]);
        }

        // 反馈凸轮旋转（随阀杆位移旋转 0~120°）
        if (this._camGroup) {
            this._camGroup.rotation(-this.travel * 120);
        }

        // 流体通道颜色（随开度变化）
        if (this._fluidPath) {
            const a = 0.08 + this.travel * 0.45;
            this._fluidPath.fill(`rgba(30,100,200,${a.toFixed(3)})`);
        }

        // ── 4. 定位器 LCD 更新 ──
        if (this._lcdText) {
            const openPct = (this.travel * 100).toFixed(1);
            this._lcdText.text(`${mA.toFixed(1)}mA  ${openPct}%`);
        }

        // ── 5. 输出气压表指针 ──
        if (this._gaugePointer) {
            const targetAngle = 150 + (this.chamberPress / 0.1) * 240;
            const rad = targetAngle * Math.PI / 180;
            this._gaugePointer.points([
                this._gaugeCX, this._gaugeCY,
                this._gaugeCX + Math.cos(rad) * 14,
                this._gaugeCY + Math.sin(rad) * 14,
            ]);
        }

        // ── 6. 气路管线颜色（随气压） ──
        this._redrawPneumaticLines(this.chamberPress);

        this._refreshCache();
    }

    // ════════════════════════════════════════════════════════
    // 七、公开 API
    // ════════════════════════════════════════════════════════

    /** 设置气源压力（MPa，通常 0.14~0.40）*/
    setSupplyPressure(p) {
        this.sourcePress = Math.max(0, Math.min(0.7, p));
    }

    /** 设置控制信号 mA（4~20）*/
    setSignal(mA) { this.update(mA); }

    /** 模拟卡死 */
    setStuck(v)   { this.isStuck   = !!v; }

    /** 模拟泄漏 */
    setLeaking(v) { this.isLeaking = !!v; }

    getOpenPercent() { return (this.travel * 100).toFixed(1); }
    getChamberPress(){ return this.chamberPress; }
    getOutPress()    { return this.outPress; }

    getConfigFields() {
        return [
            { label: '位号',               key: 'label',       type: 'text'   },
            { label: '流量系数 Cv',         key: 'cvValue',     type: 'number' },
            { label: '公称压力 (MPa)',       key: 'ratedPress',  type: 'number' },
            {
                label: '气开/气关',
                key: 'dir', type: 'select',
                options: [
                    { label: '气开阀 (FC)', value: 'FC' },
                    { label: '气关阀 (FO)', value: 'FO' },
                ],
            },
            { label: '气源最低压力 (MPa)',   key: 'supplyMin',   type: 'number' },
            { label: '气源最高压力 (MPa)',   key: 'supplyMax',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)      this.label      = cfg.label;
        if (cfg.cvValue)    this.cvValue    = parseFloat(cfg.cvValue);
        if (cfg.ratedPress) this.ratedPress = parseFloat(cfg.ratedPress);
        if (cfg.dir)        this.dir        = cfg.dir;
        if (cfg.supplyMin)  this.supplyMin  = parseFloat(cfg.supplyMin);
        if (cfg.supplyMax)  this.supplyMax  = parseFloat(cfg.supplyMax);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}