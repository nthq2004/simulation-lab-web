import { BaseComponent } from './BaseComponent.js';

/**
 * 电磁二位三通阀仿真组件
 * （Electromagnetic 2-Position 3-Way Solenoid Valve）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  电磁二位三通阀是电磁换向阀中最常见的品种之一，广泛用于
 *  气动/液压控制回路，实现流路的切换。"二位"指阀芯有两个
 *  工作位置，"三通"指阀体有三个通口。
 *
 *  主要结构（由上至下）：
 *
 *  1. 电磁线圈组件（Solenoid Coil Assembly）
 *     - 线圈骨架（Coil Bobbin）：绕有漆包铜线，通电产生磁场
 *     - 导磁套管（Flux Tube）：汇聚磁力线，引导磁场作用于铁芯
 *     - 接线端子（Coil Connector）：外接控制电源（DC 24V / AC 220V）
 *     - 线圈指示灯（LED）：线圈通电时亮绿灯
 *
 *  2. 静铁芯（Fixed Core / Pole Piece）
 *     固定在阀体上方，线圈通电后与动铁芯之间产生吸合力
 *
 *  3. 动铁芯（Moving Core / Plunger）
 *     可沿轴向运动的铁芯，上端受电磁力，下端连接阀芯推杆
 *     - 失电位（Spring Position）：弹簧推动，阀芯处于初始位
 *     - 得电位（Solenoid Position）：电磁力吸合，阀芯移至工作位
 *
 *  4. 复位弹簧（Return Spring）
 *     线圈失电后，弹簧将动铁芯和阀芯推回初始位
 *
 *  5. 阀体（Valve Body）
 *     铝合金或不锈钢阀体，内有精密加工的阀孔和密封座
 *     三个通口：
 *     - P 口（Pressure / Supply）：压力源进口，常位于阀体中央
 *     - A 口（Actuator / Working）：工作出口，接执行元件
 *     - R/T 口（Return / Tank / Exhaust）：回流/排气口
 *
 *  6. 阀芯（Spool / Piston）
 *     在阀孔内轴向滑动，通过台阶面开闭各通口：
 *     - 初始位（弹簧复位）：P→A 断，A→R 通（或 P→R 通，A 封）
 *     - 工作位（电磁得电）：P→A 通，A→R 断（或 P→A 通，R 封）
 *     注：具体通断逻辑取决于常通/常断型（可配置）
 *
 *  7. 密封圈（O-Ring）
 *     阀芯与阀体之间的动密封，防止内漏
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  常断型（Normally Closed，N.C.，默认）：
 *    失电（Spring）：P 口封闭，A→R 导通（执行元件泄压/排气）
 *    得电（Solenoid）：P→A 导通，R 口封闭（执行元件加压/充气）
 *
 *  常通型（Normally Open，N.O.）：
 *    失电（Spring）：P→A 导通，R 口封闭
 *    得电（Solenoid）：P 口封闭，A→R 导通
 *
 *  阀芯行程（Stroke）：约 3~8 mm，动画以正弦缓动（150ms）表现
 *
 * ── 仿真动画 ──────────────────────────────────────────────────
 *
 *  线圈得电：
 *    ① 线圈指示灯绿色亮起，线圈区磁场光晕渐显
 *    ② 动铁芯向上（或向下）吸合，弹簧压缩
 *    ③ 阀芯随铁芯同步移动（正弦缓动，150ms）
 *    ④ 导通路径粒子流动（P→A 或 A→R，随流向改变颜色）
 *    ⑤ 截断路径显示"X"封堵符号
 *
 *  线圈失电：
 *    ① 线圈灯灭，磁场光晕消散
 *    ② 弹簧将铁芯/阀芯推回初始位（正弦缓动）
 *    ③ 流向粒子切换
 *
 *  点击组件：切换线圈通断
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  纵截面正视图（Vertical Cross-Section, Front View）
 *  阀体竖直，线圈在上，三个管口在下（P 居中，A 在左，R 在右）
 *  内部结构以半透明叠加方式显示
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_p      — P 口（压力源进口，阀体底部中央）
 *  port_a      — A 口（工作口，阀体底部左侧）
 *  port_r      — R 口（回流/排气口，阀体底部右侧）
 *  coil_pos    — 线圈正极（+，顶部右侧）
 *  coil_neg    — 线圈负极（−，顶部左侧）
 */
export class SolenoidValve3Way extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(140, config.width  || 180);
        this.height = Math.max(240, config.height || 300);

        this.type    = 'solenoid_valve_3way';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label      = config.label     || 'YV';     // 位号
        this.coilVoltage= config.coilV     || 24;       // V，线圈电压
        this.medium     = config.medium    || 'Air';    // 介质
        this.normClose  = config.normClose !== false;   // true=常断，false=常通
        this.ratedPress = config.ratedPress|| 0.8;      // MPa，额定压力

        // ── 状态 ──
        this._energized = config.initEnergized || false;  // 线圈是否得电
        this._animating = false;
        this._animT     = 0;
        this._animDir   = 1;      // +1=得电方向，-1=失电方向
        this._animDur   = config.animDur || 0.15;         // s

        // 阀芯位移量（0=失电初位，1=得电工位），随动画更新
        this._spoolPos  = this._energized ? 1 : 0;

        // 流体粒子（两条路径各自独立）
        this._partPA    = [];   // P→A 路径粒子
        this._partAR    = [];   // A→R 路径粒子
        this._pTimer    = 0;

        this.opsCount   = config.initOps || 0;


        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 线圈组件（顶部）
        this._coil = {
            x: W * 0.18, y: H * 0.04,
            w: W * 0.64, h: H * 0.28,
            rx: 4,
        };

        // 阀体（中下部）
        this._body = {
            x: W * 0.12, y: H * 0.38,
            w: W * 0.76, h: H * 0.42,
            rx: 5,
        };

        // 阀体中心 x
        this._bodyCx = this._body.x + this._body.w / 2;

        // 铁芯轴线（竖向中轴）
        this._axisCx = this._bodyCx;

        // 静铁芯（线圈内固定，下端面）
        this._coreFixY  = this._coil.y + this._coil.h * 0.82;

        // 动铁芯（随阀芯移动）
        this._coreMovH  = H * 0.09;
        this._coreMovW  = W * 0.22;
        // 动铁芯在失电位时的 y（静铁芯下方，被弹簧撑开）
        this._coreMovY0 = this._coreFixY + H * 0.025;
        // 动铁芯在得电位时的 y（吸合到静铁芯底面）
        this._coreMovY1 = this._coreFixY;
        // 阀芯行程（px）
        this._stroke    = H * 0.07;

        // 弹簧（动铁芯下方）
        this._springTopY0 = this._coreMovY0 + this._coreMovH;  // 失电时弹簧顶端 y
        this._springBotY  = this._body.y + H * 0.05;           // 弹簧下端固定 y

        // 阀芯（阀体内）
        this._spoolW    = W * 0.22;
        this._spoolH    = H * 0.20;
        // 失电位：阀芯居中偏上
        this._spoolY0   = this._body.y + this._body.h * 0.18;
        // 得电位：阀芯下移一个行程
        this._spoolY1   = this._spoolY0 + this._stroke;

        // 三个管口（阀体底部）
        const portY = this._body.y + this._body.h + 4;
        this._portAX = this._bodyCx - W * 0.24;
        this._portPX = this._bodyCx;
        this._portRX = this._bodyCx + W * 0.24;
        this._portY  = portY;

        // 管口管道延伸长度
        this._pipeLen = H * 0.09;

        // 线圈接线端子
        this._connNegX = this._coil.x + this._coil.w * 0.15;
        this._connPosX = this._coil.x + this._coil.w * 0.85;
        this._connY    = this._coil.y - 4;

        this._init();

        // 端口
        this.addPort(this._portAX, this._portY + this._pipeLen + 2, 'port_a', 'wire', 'A');
        this.addPort(this._portPX, this._portY + this._pipeLen + 2, 'port_p', 'wire', 'P');
        this.addPort(this._portRX, this._portY + this._pipeLen + 2, 'port_r', 'wire', 'R');
        this.addPort(this._connNegX, this._connY - 2, 'coil_neg', 'wire', '−');
        this.addPort(this._connPosX, this._connY - 2, 'coil_pos', 'wire', '+');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawCoilAssembly();       // 静态：线圈组件外壳
        this._drawCoilConnector();      // 静态：接线端子
        this._drawBodyShell();          // 静态：阀体外壳
        this._drawPortPipes();          // 静态：三个管口 + 管道
        this._drawPortSymbols();        // 静态：P / A / R 标注 + 通路符号
        this._drawCoilGlowLayer();      // 动态层①：线圈磁场光晕
        this._drawInternalLayer();      // 动态层②：动铁芯 + 弹簧 + 阀芯 + 密封圈
        this._drawFlowLayer();          // 动态层③：流体粒子 + 通断符号
        this._drawBodyFront();          // 静态前景：阀体高光 + 轮廓（覆盖动态层）
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 线圈组件外壳 ─────────────────────────────────────────
    _drawCoilAssembly() {
        const c = this._coil;

        // 阴影
        this.group.add(new Konva.Rect({
            x: c.x + 2, y: c.y + 3,
            width: c.w, height: c.h,
            fill: 'rgba(0,0,0,0.28)', cornerRadius: c.rx,
        }));
        // 线圈外壳主体（深灰色工程塑料）
        this.group.add(new Konva.Rect({
            x: c.x, y: c.y, width: c.w, height: c.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: c.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#1e1e22',
                0.2, '#2e2e34',
                0.5, '#363640',
                0.8, '#2e2e34',
                1,   '#1e1e22',
            ],
            stroke: '#404048', strokeWidth: 1.2,
            cornerRadius: c.rx,
        }));
        // 顶面高光
        this.group.add(new Konva.Rect({
            x: c.x + 3, y: c.y + 2,
            width: c.w - 6, height: c.h * 0.08,
            fill: 'rgba(255,255,255,0.07)',
            cornerRadius: [c.rx, c.rx, 0, 0],
        }));

        // 线圈绕组可见区域（侧面漆包线纹）
        const windX  = c.x + c.w * 0.08;
        const windW  = c.w * 0.84;
        const windY  = c.y + c.h * 0.22;
        const windH  = c.h * 0.55;
        this.group.add(new Konva.Rect({
            x: windX, y: windY, width: windW, height: windH,
            fill: '#1a1018', stroke: '#2a1a28', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        // 铜线纹（多条细横线）
        for (let i = 0; i < 8; i++) {
            const ly = windY + windH * (i + 0.5) / 8;
            const col= i % 2 === 0
                ? 'rgba(180,110,30,0.38)'
                : 'rgba(140,80,20,0.25)';
            this.group.add(new Konva.Line({
                points: [windX + 2, ly, windX + windW - 2, ly],
                stroke: col, strokeWidth: 0.7,
            }));
        }

        // 导磁套管（线圈中央竖向深色圆柱区域）
        const tubeW = c.w * 0.20;
        this.group.add(new Konva.Rect({
            x: this._axisCx - tubeW / 2,
            y: c.y + c.h * 0.10,
            width: tubeW, height: c.h * 0.80,
            fillLinearGradientStartPoint: { x: 0,    y: 0 },
            fillLinearGradientEndPoint:   { x: tubeW,y: 0 },
            fillLinearGradientColorStops: [
                0, '#2a2a30', 0.4, '#484850', 0.6, '#404048', 1, '#2a2a30',
            ],
            stroke: '#383840', strokeWidth: 0.8, cornerRadius: 2,
        }));
    }

    // ── 线圈接线端子（顶部两侧）─────────────────────────────
    _drawCoilConnector() {
        const cw = this.width * 0.08;
        const ch = this.height * 0.042;

        [[this._connNegX, '−', '#ef9a9a'], [this._connPosX, '+', '#90caf9']].forEach(([cx, sym, col]) => {
            // 端子主体（黄铜色小块）
            this.group.add(new Konva.Rect({
                x: cx - cw / 2, y: this._connY,
                width: cw, height: ch,
                fillLinearGradientStartPoint: { x: 0,  y: 0 },
                fillLinearGradientEndPoint:   { x: cw, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#7a6820', 0.4, '#c8a840', 0.7, '#d4b040', 1, '#7a6820',
                ],
                stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 2,
            }));
            // 螺钉
            this.group.add(new Konva.Circle({
                x: cx, y: this._connY + ch / 2, radius: cw * 0.38,
                fill: '#888890', stroke: '#585860', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Line({
                points: [cx - cw * 0.22, this._connY + ch / 2,
                         cx + cw * 0.22, this._connY + ch / 2],
                stroke: '#404048', strokeWidth: 0.8, lineCap: 'round',
            }));
            // 标注
            this.group.add(new Konva.Text({
                x: cx - 5, y: this._connY + ch + 3,
                text: sym, fontSize: 8, fontStyle: 'bold', fill: col,
            }));
        });

        // 接线端子间连接线（模拟插头外壳）
        this.group.add(new Konva.Rect({
            x: this._connNegX - this.width * 0.04,
            y: this._connY - 4,
            width: this._connPosX - this._connNegX + this.width * 0.08,
            height: 5,
            fill: '#282830', stroke: '#383840', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
    }

    // ── 阀体外壳主体 ─────────────────────────────────────────
    _drawBodyShell() {
        const b = this._body;

        // 阴影
        this.group.add(new Konva.Rect({
            x: b.x + 2, y: b.y + 4,
            width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.30)', cornerRadius: b.rx,
        }));
        // 阀体主体（铝合金，冷银灰渐变）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#3a3a40',
                0.18,'#585862',
                0.40,'#666670',
                0.60,'#5e5e68',
                0.82,'#505058',
                1,   '#3a3a40',
            ],
            stroke: '#6a6a74', strokeWidth: 1.5, cornerRadius: b.rx,
        }));
        // 阀体内腔背景（暗色，截面）
        this.group.add(new Konva.Rect({
            x: b.x + 4, y: b.y + 4,
            width: b.w - 8, height: b.h - 8,
            fill: '#101014', cornerRadius: b.rx - 2,
        }));

        // 静铁芯底面（阀体顶部，铁芯安装座）
        const seatH = this.height * 0.032;
        this.group.add(new Konva.Rect({
            x: this._axisCx - this._coil.w * 0.14,
            y: this._body.y - seatH,
            width: this._coil.w * 0.28,
            height: seatH + 2,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: this._coil.w * 0.28, y: 0 },
            fillLinearGradientColorStops: [
                0, '#404048', 0.5, '#707078', 1, '#404048',
            ],
            stroke: '#505058', strokeWidth: 0.8,
        }));

        // 静铁芯（固定铁芯，线圈底部）
        const fcW = this._coreMovW;
        const fcH = this.height * 0.040;
        this.group.add(new Konva.Rect({
            x: this._axisCx - fcW / 2, y: this._coreFixY - fcH,
            width: fcW, height: fcH,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: fcW, y: 0 },
            fillLinearGradientColorStops: [
                0, '#484850', 0.5, '#7a7a86', 1, '#484850',
            ],
            stroke: '#585862', strokeWidth: 0.8, cornerRadius: [2, 2, 0, 0],
        }));
    }

    // ── 三个管口 + 管道（静态）──────────────────────────────
    _drawPortPipes() {
        const b    = this._body;
        const pipeW= this.width * 0.080;
        const pipeH= this._pipeLen;
        const portY= this._portY;

        const ports = [
            { x: this._portAX, col: '#4090d0', lbl: 'A' },
            { x: this._portPX, col: '#d04030', lbl: 'P' },
            { x: this._portRX, col: '#50a860', lbl: 'R' },
        ];

        ports.forEach(({ x, col, lbl }) => {
            // 阀体底部开口孔（暗色矩形）
            this.group.add(new Konva.Rect({
                x: x - pipeW / 2, y: b.y + b.h - 4,
                width: pipeW, height: 8,
                fill: '#0a0a0e', stroke: '#2a2a34', strokeWidth: 0.5,
            }));
            // 管道主体（黄铜色）
            this.group.add(new Konva.Rect({
                x: x - pipeW / 2, y: portY,
                width: pipeW, height: pipeH,
                fillLinearGradientStartPoint: { x: 0,    y: 0 },
                fillLinearGradientEndPoint:   { x: pipeW,y: 0 },
                fillLinearGradientColorStops: [
                    0,   '#6a5820',
                    0.3, '#c0a038',
                    0.6, '#d0b040',
                    0.8, '#a88828',
                    1,   '#6a5820',
                ],
                stroke: '#6a5820', strokeWidth: 0.8,
            }));
            // 管端螺纹（3条细横线）
            for (let i = 0; i < 3; i++) {
                const ty = portY + pipeH * (0.25 + i * 0.22);
                this.group.add(new Konva.Line({
                    points: [x - pipeW / 2 + 1, ty, x + pipeW / 2 - 1, ty],
                    stroke: 'rgba(80,60,20,0.38)', strokeWidth: 0.6,
                }));
            }
            // 管口标注
            this.group.add(new Konva.Text({
                x: x - 6, y: portY + pipeH + 5,
                text: lbl, fontSize: 10, fontStyle: 'bold',
                fill: col,
            }));
        });
    }

    // ── P/A/R 标注 + 逻辑符号（阀体上方）──────────────────
    _drawPortSymbols() {
        // 在阀体外壳内绘制静态的通道轮廓（半透明白色线）
        const b   = this._body;
        const bCx = this._bodyCx;

        // P 口竖向通道（进入阀体中央）
        this.group.add(new Konva.Line({
            points: [bCx, b.y + b.h, bCx, b.y + b.h * 0.72],
            stroke: 'rgba(200,60,40,0.22)', strokeWidth: 3,
            lineCap: 'round',
        }));
        // A 口竖向通道
        this.group.add(new Konva.Line({
            points: [this._portAX, b.y + b.h, this._portAX, b.y + b.h * 0.72],
            stroke: 'rgba(50,140,220,0.20)', strokeWidth: 3,
            lineCap: 'round',
        }));
        // R 口竖向通道
        this.group.add(new Konva.Line({
            points: [this._portRX, b.y + b.h, this._portRX, b.y + b.h * 0.72],
            stroke: 'rgba(60,180,100,0.20)', strokeWidth: 3,
            lineCap: 'round',
        }));
    }

    // ── 动态层①：线圈磁场光晕 ──────────────────────────────
    _drawCoilGlowLayer() {
        this._coilGlowGroup = new Konva.Group();
        this.group.add(this._coilGlowGroup);
        this._rebuildCoilGlow();
    }

    _rebuildCoilGlow() {
        this._coilGlowGroup.destroyChildren();
        const glow = this._spoolPos;   // 0=失电，1=得电
        if (glow < 0.01) return;

        const c  = this._coil;
        const cx = this._axisCx;

        // 线圈内磁场光晕（径向渐变椭圆）
        this._coilGlowGroup.add(new Konva.Ellipse({
            x: cx, y: c.y + c.h * 0.50,
            radiusX: c.w * 0.28, radiusY: c.h * 0.38,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   c.w * 0.30,
            fillRadialGradientColorStops: [
                0,   `rgba(120,200,255,${glow * 0.45})`,
                0.5, `rgba(80,160,240,${glow * 0.22})`,
                1,   `rgba(40,100,200,0)`,
            ],
        }));

        // 磁力线弧（4条，左右对称）
        const mlCount = 3;
        for (let i = 0; i < mlCount; i++) {
            const r  = c.w * (0.10 + i * 0.08) * glow;
            const my = c.y + c.h * 0.50;
            this._coilGlowGroup.add(new Konva.Arc({
                x: cx, y: my,
                innerRadius: r, outerRadius: r + 1,
                angle: 180, rotation: -90,
                stroke: `rgba(100,180,255,${glow * (0.30 - i * 0.08)})`,
                strokeWidth: 0.8,
            }));
            this._coilGlowGroup.add(new Konva.Arc({
                x: cx, y: my,
                innerRadius: r, outerRadius: r + 1,
                angle: 180, rotation: 90,
                stroke: `rgba(100,180,255,${glow * (0.30 - i * 0.08)})`,
                strokeWidth: 0.8,
            }));
        }

        // 指示灯（线圈通电绿灯）
        const ledX = this._coil.x + this._coil.w * 0.78;
        const ledY = this._coil.y + this._coil.h * 0.14;
        this._coilGlowGroup.add(new Konva.Circle({
            x: ledX, y: ledY, radius: 4.5,
            fill:  `rgba(80,220,80,${0.5 + glow * 0.5})`,
            stroke:'#2a6a2a', strokeWidth: 0.8,
            shadowColor: '#40e040',
            shadowBlur:  glow * 8, shadowOpacity: 0.85,
        }));
    }

    // ── 动态层②：动铁芯 + 弹簧 + 阀芯 ────────────────────
    _drawInternalLayer() {
        this._internalGroup = new Konva.Group();
        this.group.add(this._internalGroup);
        this._rebuildInternal();
    }

    _rebuildInternal() {
        this._internalGroup.destroyChildren();
        const sp   = this._spoolPos;    // 0=失电初位，1=得电工位
        const b    = this._body;
        const cx   = this._axisCx;

        // ── 动铁芯（随 spoolPos 上下移动）──
        const movY = this._coreMovY0 - sp * (this._coreMovY0 - this._coreMovY1);
        const mvW  = this._coreMovW;
        const mvH  = this._coreMovH;

        this._internalGroup.add(new Konva.Rect({
            x: cx - mvW / 2, y: movY,
            width: mvW, height: mvH,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: mvW, y: 0 },
            fillLinearGradientColorStops: [
                0, '#484850', 0.5, '#7a7a88', 1, '#484850',
            ],
            stroke: '#585862', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 动铁芯吸合面高光
        this._internalGroup.add(new Konva.Rect({
            x: cx - mvW / 2 + 2, y: movY + 2,
            width: mvW - 4, height: mvH * 0.18,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: 1,
        }));

        // ── 弹簧（动铁芯与阀芯之间）──
        const springTopY = movY + mvH;
        const spoolCurY  = this._spoolY0 + sp * this._stroke;
        const springBotY = spoolCurY;
        this._drawSpring(cx, springTopY, springBotY, sp);

        // ── 阀芯（阀体内，随行程上下移动）──
        const svW = this._spoolW;
        const svH = this._spoolH;
        const svY = spoolCurY;

        // 阀芯主体（钢件，深银灰）
        this._internalGroup.add(new Konva.Rect({
            x: cx - svW / 2, y: svY,
            width: svW, height: svH,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: svW, y: 0 },
            fillLinearGradientColorStops: [
                0, '#3a3a42', 0.35, '#6a6a78', 0.55, '#7a7a88', 0.75, '#5a5a68', 1, '#3a3a42',
            ],
            stroke: '#4a4a54', strokeWidth: 0.8,
            cornerRadius: 2,
        }));

        // 阀芯台阶（两个密封肩台，控制通断）
        const shoulderH = svH * 0.18;
        const shoulderW = svW * 0.90;
        [svY + svH * 0.08, svY + svH * 0.72].forEach(sy => {
            this._internalGroup.add(new Konva.Rect({
                x: cx - shoulderW / 2, y: sy,
                width: shoulderW, height: shoulderH,
                fill: '#909098', stroke: '#6a6a74', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
            // 密封圈（O-Ring，橙色细圈）
            this._internalGroup.add(new Konva.Rect({
                x: cx - shoulderW / 2 - 2,
                y: sy + shoulderH * 0.38,
                width: shoulderW + 4,
                height: shoulderH * 0.25,
                fill: 'rgba(200,100,20,0.60)',
                stroke: 'rgba(160,60,10,0.80)', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
        });

        // 阀芯推杆（连接到动铁芯底面）
        const rodX = cx - this.width * 0.020;
        const rodW = this.width * 0.040;
        this._internalGroup.add(new Konva.Rect({
            x: rodX, y: movY + mvH,
            width: rodW, height: svY - (movY + mvH),
            fill: '#606068', stroke: '#484850', strokeWidth: 0.5,
        }));

        // ── 密封座（阀体内壁，三个通道开口处）──
        const seatH  = this.height * 0.014;
        const seatW  = svW * 1.20;
        // P 口密封座（阀芯下方，受阀芯台阶控制）
        const pSeatY = b.y + b.h * 0.72;
        this._internalGroup.add(new Konva.Rect({
            x: cx - seatW / 2, y: pSeatY - seatH / 2,
            width: seatW, height: seatH,
            fill: '#222228', stroke: '#383840', strokeWidth: 0.5,
        }));
        // A/R 分流横通道（连通 A 和 R 的横向暗道）
        const crossY = b.y + b.h * 0.55;
        this._internalGroup.add(new Konva.Rect({
            x: b.x + 5, y: crossY - 4,
            width: b.w - 10, height: 8,
            fill: '#0e0e14', stroke: '#1e1e24', strokeWidth: 0.5,
        }));
    }

    // 绘制压缩弹簧（锯齿线形）
    _drawSpring(cx, topY, botY, compressed) {
        const springH = botY - topY;
        if (springH < 4) return;
        const turns  = 6;
        const halfW  = this._coreMovW * 0.32;
        const pts    = [];
        const steps  = turns * 2;
        for (let i = 0; i <= steps; i++) {
            const t   = i / steps;
            const sy  = topY + springH * t;
            const sx  = cx + (i % 2 === 0 ? -halfW : halfW);
            pts.push(sx, sy);
        }
        this._internalGroup.add(new Konva.Line({
            points: pts,
            stroke: `rgba(${Math.round(140 + compressed * 60)},${Math.round(160 + compressed * 20)},${Math.round(180 - compressed * 40)},0.70)`,
            strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
        }));
    }

    // ── 动态层③：流体粒子 + 通断状态标识 ─────────────────
    _drawFlowLayer() {
        this._flowGroup = new Konva.Group();
        this.group.add(this._flowGroup);
        this._rebuildFlow();
    }

    _rebuildFlow() {
        this._flowGroup.destroyChildren();
        const sp = this._spoolPos;          // 0=失电，1=得电
        const b  = this._body;
        const cx = this._bodyCx;

        // 判断通断（常断型 NC 逻辑）
        // sp=0（失电）：A→R 通，P 截断
        // sp=1（得电）：P→A 通，R 截断
        const paOpen = this.normClose ? sp > 0.5 : sp < 0.5;
        const arOpen = this.normClose ? sp < 0.5 : sp > 0.5;

        // ── P→A 通道粒子 ──
        if (paOpen && sp > 0.1) {
            this._partPA.forEach(p => {
                const alpha = p.alpha * Math.min(1, (sp - 0.1) / 0.4);
                this._flowGroup.add(new Konva.Circle({
                    x: p.x, y: p.y, radius: p.r,
                    fill: `rgba(210,80,40,${alpha})`,
                    shadowColor: 'rgba(240,100,60,0.6)',
                    shadowBlur: 2, shadowOpacity: alpha,
                }));
            });
            // P→A 导通路径高光
            this._drawFlowPath(
                cx, b.y + b.h,
                this._portAX, b.y + b.h,
                sp, '#d04030', true
            );
        }

        // ── A→R 通道粒子 ──
        if (arOpen && (1 - sp) > 0.1) {
            this._partAR.forEach(p => {
                const alpha = p.alpha * Math.min(1, (1 - sp - 0.1) / 0.4);
                this._flowGroup.add(new Konva.Circle({
                    x: p.x, y: p.y, radius: p.r,
                    fill: `rgba(50,160,100,${alpha})`,
                    shadowColor: 'rgba(70,200,120,0.6)',
                    shadowBlur: 2, shadowOpacity: alpha,
                }));
            });
            this._drawFlowPath(
                this._portAX, b.y + b.h,
                this._portRX, b.y + b.h,
                1 - sp, '#30a860', false
            );
        }

        // ── 截断符号（X 标记）──
        // P 口截断时（A→R 工况）
        if (!paOpen && sp < 0.5) {
            this._drawBlockSymbol(cx, b.y + b.h * 0.80, '#d04030', 0.6);
        }
        // R 口截断时（P→A 工况）
        if (!arOpen && sp > 0.5) {
            this._drawBlockSymbol(this._portRX, b.y + b.h * 0.80, '#30a860', 0.6);
        }

        // ── 当前状态位置框（二位三通标准图形符号，简化）──
        this._drawSchematicSymbol(sp);
    }

    // 导通路径发光条（连接两口的路径高光）
    _drawFlowPath(x1, y1, x2, y2, intensity, col, isPA) {
        const b   = this._body;
        const cy1 = b.y + b.h * 0.72;   // 路径中间横向 y
        const alpha = intensity * 0.30;

        // 路径连线（折线：从一口竖上→横向→另一口竖下）
        if (isPA) {
            // P→A：P 口向上进入阀体，横向到 A 口，向下出 A 口
            this._flowGroup.add(new Konva.Line({
                points: [
                    x1, y1, x1, cy1,
                    x2, cy1, x2, y1,
                ],
                stroke: `rgba(${parseInt(col.slice(1,3),16)},${parseInt(col.slice(3,5),16)},${parseInt(col.slice(5,7),16)},${alpha})`,
                strokeWidth: 4, lineCap: 'round', lineJoin: 'round',
            }));
        } else {
            const cy2 = b.y + b.h * 0.55;
            this._flowGroup.add(new Konva.Line({
                points: [x1, y1, x1, cy2, x2, cy2, x2, y1],
                stroke: `rgba(${parseInt(col.slice(1,3),16)},${parseInt(col.slice(3,5),16)},${parseInt(col.slice(5,7),16)},${alpha})`,
                strokeWidth: 4, lineCap: 'round', lineJoin: 'round',
            }));
        }
    }

    // 截断符号（红色 X）
    _drawBlockSymbol(cx, cy, col, alpha) {
        const r = 6;
        [[cx - r, cy - r, cx + r, cy + r], [cx + r, cy - r, cx - r, cy + r]].forEach(pts => {
            this._flowGroup.add(new Konva.Line({
                points: pts,
                stroke: col.replace(')', `,${alpha})`).replace('rgb', 'rgba'),
                strokeWidth: 1.8, lineCap: 'round',
            }));
        });
        this._flowGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 2,
            fill: 'transparent',
            stroke: col.replace(')', `,${alpha * 0.6})`).replace('rgb', 'rgba'),
            strokeWidth: 0.8,
        }));
    }

    // 简化原理图符号（阀体底部下方，二位三通示意图）
    _drawSchematicSymbol(sp) {
        const W    = this.width;
        const symY = this._portY + this._pipeLen + 20;
        const bw   = W * 0.30;
        const bh   = this.height * 0.068;
        const gap  = 3;

        // 失电位框（左框）
        const lx = this._bodyCx - bw - gap / 2;
        // 得电位框（右框）
        const rx = this._bodyCx + gap / 2;

        // 当前激活框高亮
        const actX   = sp > 0.5 ? rx : lx;
        const actAlpha = 0.22;
        this._flowGroup.add(new Konva.Rect({
            x: actX, y: symY, width: bw, height: bh,
            fill: `rgba(100,180,255,${actAlpha})`,
            stroke: '#6090c0', strokeWidth: 1, cornerRadius: 2,
        }));

        // 失电位框（常规状态）
        this._flowGroup.add(new Konva.Rect({
            x: lx, y: symY, width: bw, height: bh,
            fill: 'transparent', stroke: '#505060', strokeWidth: 1, cornerRadius: 2,
        }));
        // 得电位框
        this._flowGroup.add(new Konva.Rect({
            x: rx, y: symY, width: bw, height: bh,
            fill: 'transparent', stroke: '#505060', strokeWidth: 1, cornerRadius: 2,
        }));

        // 失电位通道符号（A→R 通，P 封）
        const col0 = '#8090a8';
        this._drawSymbolLine(lx, symY, bw, bh, false, col0);   // P 封
        this._drawSymbolLine(lx, symY, bw, bh, true,  col0);   // A→R 通

        // 得电位通道符号（P→A 通，R 封）
        const col1 = '#8090a8';
        this._drawSymbolLine(rx, symY, bw, bh, true,  col1, true);  // P→A
        this._drawSymbolLine(rx, symY, bw, bh, false, col1, false);  // R 封

        // 框图下方标注
        this._flowGroup.add(new Konva.Text({
            x: lx, y: symY + bh + 3,
            width: bw, text: '失电位', fontSize: 7, fill: '#506070', align: 'center',
        }));
        this._flowGroup.add(new Konva.Text({
            x: rx, y: symY + bh + 3,
            width: bw, text: '得电位', fontSize: 7, fill: '#506070', align: 'center',
        }));

        // 弹簧符号（左框外侧）
        for (let i = 0; i < 3; i++) {
            const sx = lx - 10 + (i % 2 === 0 ? -2 : 2);
            const sy = symY + bh * (0.20 + i * 0.25);
            this._flowGroup.add(new Konva.Line({
                points: [lx - 12, sy, sx, sy + bh * 0.12],
                stroke: '#607080', strokeWidth: 0.8, lineCap: 'round',
            }));
        }
        // 线圈符号（右框外侧，矩形代表线圈）
        this._flowGroup.add(new Konva.Rect({
            x: rx + bw + 2, y: symY + bh * 0.20,
            width: 12, height: bh * 0.60,
            fill: 'transparent', stroke: '#607080', strokeWidth: 0.8,
        }));
        this._flowGroup.add(new Konva.Line({
            points: [rx + bw + 14, symY + bh * 0.50, rx + bw + 18, symY + bh * 0.50],
            stroke: '#607080', strokeWidth: 0.8,
        }));
    }

    _drawSymbolLine(bx, by, bw, bh, isConnected, col, paMode) {
        // 简化：在方框内画箭头/封堵符号
        const mx = bx + bw / 2;
        if (isConnected) {
            // 连通箭头
            this._flowGroup.add(new Konva.Line({
                points: [bx + bw * 0.20, by + bh * 0.78,
                         bx + bw * 0.50, by + bh * 0.25,
                         bx + bw * 0.80, by + bh * 0.78],
                stroke: col, strokeWidth: 0.8, lineCap: 'round', lineJoin: 'round',
            }));
        } else {
            // 封堵短线
            this._flowGroup.add(new Konva.Line({
                points: [mx - 5, by + bh * 0.50, mx + 5, by + bh * 0.50],
                stroke: col, strokeWidth: 1.2, lineCap: 'round',
            }));
        }
    }

    // ── 阀体前景（高光 + 轮廓，覆盖动态层）─────────────────
    _drawBodyFront() {
        const b = this._body;

        // 顶面高光（不锈钢/铝）
        this.group.add(new Konva.Rect({
            x: b.x + b.rx * 0.5, y: b.y + b.h * 0.015,
            width: b.w - b.rx, height: b.h * 0.055,
            fill: 'rgba(255,255,255,0.10)', cornerRadius: b.rx * 0.5,
        }));
        // 左侧竖向高光
        this.group.add(new Konva.Rect({
            x: b.x + 3, y: b.y + b.h * 0.06,
            width: b.w * 0.055, height: b.h * 0.70,
            fill: 'rgba(255,255,255,0.07)', cornerRadius: 2,
        }));
        // 轮廓
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: 'transparent', stroke: '#6a6a74', strokeWidth: 1.5,
            cornerRadius: b.rx,
        }));
        // 线圈与阀体接缝线
        this.group.add(new Konva.Line({
            points: [b.x + b.rx, b.y + 2, b.x + b.w - b.rx, b.y + 2],
            stroke: '#4a4a54', strokeWidth: 0.8,
        }));
    }

    // ── 位号 + 规格标注 ─────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -18, width: W,
            text: `${this.label}  二位三通电磁阀`,
            fontSize: 10, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: 0, y: -6, width: W,
            text: `DC${this.coilVoltage}V  ${this.medium}  ${this.ratedPress}MPa  ${this.normClose ? 'N.C.' : 'N.O.'}`,
            fontSize: 7, fill: '#5a7a8a', align: 'center',
        }));
    }

    // ── 状态指示灯（阀体右下角）─────────────────────────────
    _drawStatusIndicator() {
        const ix = this._body.x + this._body.w - 10;
        const iy = this._body.y + this._body.h - 12;

        const on  = this._energized;
        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill:  on ? '#66bb6a' : '#ef5350',
            stroke:on ? '#2e7d32' : '#c62828',
            strokeWidth: 0.8,
            shadowColor: on ? '#66bb6a' : '#ef5350',
            shadowBlur:  on ? 6 : 2, shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: ix - 26, y: iy - 5,
            text: on ? '得电' : '失电',
            fontSize: 8, fontStyle: 'bold',
            fill: on ? '#66bb6a' : '#ef5350',
        });
        this.group.add(this._statusDot, this._statusText);
    }

    // ── 点击切换得电/失电 ────────────────────────────────────
    _bindInteraction() {
        this.group.on('click tap', () => this.toggle());
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        let needRefresh = false;

        // ── 阀芯位移动画（正弦缓动）──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._energized = this._animDir > 0;
            }
            const ease      = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._spoolPos  = this._animDir > 0 ? ease : 1 - ease;
            needRefresh = true;
        }

        // ── 流体粒子生成与更新 ──
        const sp = this._spoolPos;
        const paOpen = this.normClose ? sp > 0.1 : sp < 0.9;
        const arOpen = this.normClose ? sp < 0.9 : sp > 0.1;
        const b = this._body;

        this._pTimer += dt;
        if (this._pTimer > 0.055) {
            this._pTimer = 0;

            if (paOpen) {
                // P→A 粒子（从 P 口底部向 A 口运动）
                this._partPA.push({
                    x:  this._portPX,
                    y:  b.y + b.h * 0.90 + (Math.random() - 0.5) * 6,
                    vx: (this._portAX - this._portPX) * (0.7 + Math.random() * 0.6),
                    vy: (Math.random() - 0.5) * 8,
                    r:  1.5 + Math.random() * 1.2,
                    alpha: 0.7 + Math.random() * 0.3,
                });
            }
            if (arOpen) {
                // A→R 粒子（从 A 口底部向 R 口运动）
                this._partAR.push({
                    x:  this._portAX,
                    y:  b.y + b.h * 0.72 + (Math.random() - 0.5) * 5,
                    vx: (this._portRX - this._portAX) * (0.7 + Math.random() * 0.6),
                    vy: (Math.random() - 0.5) * 6,
                    r:  1.5 + Math.random() * 1.0,
                    alpha: 0.6 + Math.random() * 0.4,
                });
            }
        }

        this._partPA = this._partPA.filter(p => {
            p.x += p.vx * dt; p.y += p.vy * dt; p.alpha -= dt * 1.6;
            return p.alpha > 0 && p.x > this._portAX - 10;
        });
        this._partAR = this._partAR.filter(p => {
            p.x += p.vx * dt; p.y += p.vy * dt; p.alpha -= dt * 1.6;
            return p.alpha > 0 && p.x < this._portRX + 10;
        });
        needRefresh = true;

        if (needRefresh) {
            this._rebuildCoilGlow();
            this._rebuildInternal();
            this._rebuildFlow();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _updateStatus() {
        const on  = this._energized || (this._animating && this._animDir > 0 && this._spoolPos > 0.5);
        const col  = on ? '#66bb6a' : '#ef5350';
        const scol = on ? '#2e7d32' : '#c62828';
        if (this._statusDot) {
            this._statusDot.fill(col); this._statusDot.stroke(scol);
            this._statusDot.shadowColor(col); this._statusDot.shadowBlur(on ? 6 : 2);
        }
        if (this._statusText) {
            this._statusText.text(on ? '得电' : '失电');
            this._statusText.fill(col);
        }
    }

    // ═══════════════════════════════════════════
    /** 切换线圈通断状态 */
    toggle() {
        if (this._animating) return;
        this._animDir   = this._energized ? -1 : 1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 线圈得电（阀芯切至工作位） */
    energize() {
        if (this._energized || this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 线圈失电（阀芯弹簧复位） */
    deEnergize() {
        if (!this._energized || this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 是否得电 */
    isEnergized()   { return this._energized; }

    /** P→A 是否导通 */
    isPAOpen()      { return this.normClose ? this._spoolPos > 0.5 : this._spoolPos < 0.5; }

    /** A→R 是否导通 */
    isAROpen()      { return this.normClose ? this._spoolPos < 0.5 : this._spoolPos > 0.5; }

    isAnimating()   { return this._animating; }
    getOpsCount()   { return this.opsCount; }

    update(state) {
        if (typeof state === 'boolean') {
            state ? this.energize() : this.deEnergize();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',       type: 'text'   },
            { label: '线圈电压 (V)',         key: 'coilV',       type: 'number' },
            { label: '介质',                key: 'medium',      type: 'text'   },
            { label: '额定压力 (MPa)',       key: 'ratedPress',  type: 'number' },
            { label: '常断型（1=N.C.）',    key: 'normClose',   type: 'number' },
            { label: '初始得电（1=是）',     key: 'initEnergized',type:'number' },
            { label: '动作时间 (s)',         key: 'animDur',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label       = cfg.label;
        if (cfg.coilV        !== undefined) this.coilVoltage = parseFloat(cfg.coilV)      || this.coilVoltage;
        if (cfg.medium       !== undefined) this.medium      = cfg.medium;
        if (cfg.ratedPress   !== undefined) this.ratedPress  = parseFloat(cfg.ratedPress) || this.ratedPress;
        if (cfg.normClose    !== undefined) this.normClose   = !!parseInt(cfg.normClose);
        if (cfg.animDur      !== undefined) this._animDur    = parseFloat(cfg.animDur)    || this._animDur;
        if (cfg.initEnergized !== undefined) {
            const want = !!parseInt(cfg.initEnergized);
            if (want !== this._energized) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this.group.destroyChildren();
        this._statusDot  = null;
        this._statusText = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}