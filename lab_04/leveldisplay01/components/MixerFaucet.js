import { BaseComponent } from './BaseComponent.js';

/**
 * 单柄冷热混合水龙头仿真组件
 * （Single-Lever Mixer Faucet with Temperature Control）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  本组件模拟一只标准的单柄混合龙头（卫生间/厨房台盆款），正视图。
 *  单柄控制两个独立自由度，与真实产品完全对应：
 *
 *  ┌─────────────────────────────────────────────────────┐
 *  │  把手左右方向  →  调节冷热比例（温度）                │
 *  │    最左  = 纯冷水（蓝色，5°C）                       │
 *  │    正中  = 冷热各半（40°C）                          │
 *  │    最右  = 纯热水（红色，65°C）                      │
 *  │                                                     │
 *  │  把手前后方向  →  调节流量（开/关）                   │
 *  │    最后（竖直向上）= 完全关闭                        │
 *  │    向前倾斜 90°  = 完全打开                          │
 *  └─────────────────────────────────────────────────────┘
 *
 *  在正视图 2D 投影中：
 *    - 左右平移把手 = 调温（-90°~+90°，中心为中温）
 *    - 把手本体倾斜角（俯仰角）= 调流（0°=关，90°=全开）
 *
 * ── 各部件 ────────────────────────────────────────────────────
 *
 *  1. 底座法兰盘（Base Flange）
 *     圆形不锈钢法兰，固定于台面，中央有进水立管
 *
 *  2. 龙头本体/鹅颈管（Spout Body）
 *     立管 → 鹅颈弯弧 → 出水横管，不锈钢拉丝质感
 *     出水口位于横管末端
 *
 *  3. 把手底座（Handle Base / Cartridge Cap）
 *     立管顶端的圆形陶瓷阀芯盖，可左右转动
 *     颜色随温度从蓝→紫→红渐变
 *
 *  4. 把手杆（Handle Lever）
 *     从阀芯盖延伸出的长杆，有防滑纹路
 *     - 左右平移：拖拽把手杆端部左右移动，驱动底座转动调温
 *     - 把手杆倾角（屏幕视角投影）：拖拽把手杆上下移动，改变流量
 *     - 双击把手杆：快速全开/全关切换（300ms 缓动）
 *
 *  5. 温度 + 流量 LCD 显示屏（Panel Display）
 *     贴在底座法兰前方的数字面板：
 *     - 上行：出水温度（°C），颜色随温度变化（蓝→绿→橙→红）
 *     - 下行：流量（L/min）
 *     - 关闭时显示 "--"
 *
 *  6. 温度色带（Temperature Band）
 *     把手底座外侧弧形色带，从蓝到红，当前温度处有白色指示齿
 *
 *  7. 出水水柱（Water Stream）
 *     - 流量 = 0 时无水
 *     - 水柱颜色随温度实时变化：
 *         冷（< 25°C）：纯蓝色
 *         温（25~45°C）：青绿色
 *         热（45~60°C）：橙色
 *         烫（> 60°C）：红色
 *     - 多层半透明贝塞尔曲线 + 水滴粒子 + 侧向飞溅
 *     - 大流量时有底部水花粒子
 *
 * ── 把手交互详解 ─────────────────────────────────────────────
 *
 *  拖拽把手杆（任意位置）：
 *    鼠标/触点相对把手底座中心的极坐标：
 *      · 水平分量 → 温度角 _tempAngle（-90°~+90°）
 *      · 垂直分量 → 流量角 _flowAngle（0°~90°）
 *
 *  硬限位：
 *    温度角：-90°（纯冷）~ +90°（纯热）
 *    流量角：0°（关）~ 90°（全开）
 *
 *  双击把手杆：全开/全关切换，缓动 250ms
 *
 * ── 温度计算 ─────────────────────────────────────────────────
 *
 *  coldTemp = 5°C，hotTemp = 65°C（可配置）
 *  混合比 ratio = (_tempAngle + 90) / 180   → 0(纯冷)~1(纯热)
 *  出水温度 = coldTemp + ratio × (hotTemp - coldTemp)
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_cold  — 冷水进口（底座左下）
 *  terminal_hot   — 热水进口（底座右下）
 *  terminal_out   — 出水口（出水管末端向下）
 */
export class MixerFaucet extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(300, config.height || 360);

        this.type    = 'mixer_faucet';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──
        this.label    = config.label    || 'MF';
        this.maxFlow  = config.maxFlow  || 8;     // L/min
        this.coldTemp = config.coldTemp || 5;     // °C
        this.hotTemp  = config.hotTemp  || 65;    // °C

        // ── 状态 ──
        // 温度轴：-90°（纯冷）~ 0°（混合）~ +90°（纯热）
        this._tempAngle   = config.initTempAngle ?? 0;
        // 流量轴：0°（关闭）~ 90°（全开）
        this._flowAngle   = config.initFlowAngle ?? 0;

        // 缓动目标
        this._targetTempAngle = this._tempAngle;
        this._targetFlowAngle = this._flowAngle;

        // 拖拽状态
        this._dragging        = false;
        this._dragStartPos    = { x: 0, y: 0 };
        this._dragStartTemp   = 0;
        this._dragStartFlow   = 0;

        // 双击
        this._lastClickTs = 0;

        // 派生量（每帧计算）
        this._flow    = 0;   // 0~1
        this._outTemp = this.coldTemp;   // °C

        // 粒子
        this._drops = [];


        this._calcGeometry();
        this._init();

        // ── 端口 ──
        const g = this._geo;
        this.addPort(g.flangeCX - g.flangeR * 0.52, this.height,   'terminal_cold', 'wire', 'CW');
        this.addPort(g.flangeCX + g.flangeR * 0.52, this.height,   'terminal_hot',  'wire', 'HW');
        this.addPort(g.spoutTipX,                   g.spoutTipY+8, 'terminal_out',  'wire', 'OUT');
    }

    // ═══════════════════════════════════════════
    _calcGeometry() {
        const W = this.width, H = this.height;
        const g = {};

        // ── 法兰 ──
        g.flangeCX = W * 0.40;
        g.flangeCY = H * 0.82;
        g.flangeR  = W * 0.19;
        g.flangeRy = H * 0.038;

        // ── 立管 ──
        g.pipeW    = W * 0.088;
        g.pipeTopY = H * 0.30;
        g.pipeBotY = g.flangeCY - g.flangeRy;

        // ── 鹅颈弯弧 ──
        g.bendSX = g.flangeCX;  g.bendSY = g.pipeTopY;
        g.bc1X   = g.flangeCX;  g.bc1Y   = g.pipeTopY - H * 0.05;
        g.bc2X   = g.flangeCX + W * 0.24;
        g.bc2Y   = g.pipeTopY - H * 0.08;
        g.bendEX = g.flangeCX + W * 0.36;
        g.bendEY = g.pipeTopY + H * 0.04;

        // ── 出水横管 ──
        g.spoutTipX = g.flangeCX + W * 0.50;
        g.spoutTipY = g.pipeTopY + H * 0.105;

        // ── 出水水柱起点 ──
        g.streamX = g.spoutTipX + W * 0.008;
        g.streamY = g.spoutTipY + H * 0.010;

        // ── 阀芯盖（把手底座），立管顶部 ──
        g.capCX = g.flangeCX;
        g.capCY = g.pipeTopY - H * 0.055;
        g.capR  = W * 0.100;   // 半径

        // ── 把手杆起点（从盖中心向上偏） ──
        // 把手杆在正视图中：根部固定在 capCX,capCY，向上伸展
        // 左右平移 → 温度  /  上下倾斜 → 流量
        g.leverLen  = H * 0.200;   // 把手杆总长
        g.leverW    = W * 0.038;   // 把手杆宽度
        // 根部连接点
        g.leverRootX = g.capCX;
        g.leverRootY = g.capCY - g.capR * 0.15;

        // ── 温度色带弧（盖外侧）──
        g.bandR  = g.capR + W * 0.060;
        g.bandCX = g.capCX;
        g.bandCY = g.capCY;

        // ── LCD 面板（法兰前方底部区域）──
        g.lcdX = g.flangeCX - W * 0.175;
        g.lcdY = g.flangeCY + g.flangeRy + H * 0.025;
        g.lcdW = W * 0.350;
        g.lcdH = H * 0.080;

        this._geo = g;
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawFlange();
        this._drawSpout();
        this._drawTempBand();
        this._drawCapBase();
        this._buildLeverGroup();
        this._drawLCDPanel();
        this._drawParticleLayer();
        this._drawPortLabels();
        this._drawComponentLabel();
        this._bindDrag();
        
        this._recalcState();
    }

    // ── 法兰底座 ─────────────────────────────
    _drawFlange() {
        const g = this._geo;

        // 台面投影阴影
        this.group.add(new Konva.Ellipse({
            x: g.flangeCX + 4, y: g.flangeCY + 7,
            radiusX: g.flangeR * 1.08, radiusY: g.flangeRy * 0.85,
            fill: 'rgba(0,0,0,0.15)',
        }));

        // 法兰主体
        this.group.add(new Konva.Ellipse({
            x: g.flangeCX, y: g.flangeCY,
            radiusX: g.flangeR, radiusY: g.flangeRy,
            fillLinearGradientStartPoint: { x: -g.flangeR, y: 0 },
            fillLinearGradientEndPoint:   { x:  g.flangeR, y: 0 },
            fillLinearGradientColorStops: [
                0,'#7a8290', 0.18,'#b8c0ca', 0.42,'#e0e6ee',
                0.62,'#ccd4dc', 0.85,'#a8b0ba', 1,'#6e7680',
            ],
            stroke: '#6a7280', strokeWidth: 1.2,
        }));
        // 高光
        this.group.add(new Konva.Ellipse({
            x: g.flangeCX - g.flangeR*0.10, y: g.flangeCY - g.flangeRy*0.28,
            radiusX: g.flangeR*0.52, radiusY: g.flangeRy*0.32,
            fill: 'rgba(255,255,255,0.30)',
        }));
        // 内圈线
        this.group.add(new Konva.Ellipse({
            x: g.flangeCX, y: g.flangeCY,
            radiusX: g.flangeR*0.80, radiusY: g.flangeRy*0.70,
            fill: 'transparent',
            stroke: 'rgba(255,255,255,0.18)', strokeWidth: 0.8,
        }));
        // 螺钉
        [-g.flangeR*0.60, g.flangeR*0.60].forEach(dx => {
            this.group.add(new Konva.Circle({
                x: g.flangeCX+dx, y: g.flangeCY,
                radius: g.flangeR*0.075,
                fill: '#8a9098', stroke: '#60686e', strokeWidth: 0.6,
            }));
            [0, 1].forEach(d => {
                this.group.add(new Konva.Line({
                    points: [
                        g.flangeCX+dx - g.flangeR*0.05, g.flangeCY - g.flangeR*0.05,
                        g.flangeCX+dx + g.flangeR*0.05, g.flangeCY + g.flangeR*0.05,
                    ],
                    stroke: '#506070', strokeWidth: 0.7, rotation: d*90,
                    offsetX: g.flangeCX+dx, offsetY: g.flangeCY,
                }));
            });
        });
    }

    // ── 龙头管体 ─────────────────────────────
    _drawSpout() {
        const g = this._geo, pw = g.pipeW;

        // ── 立管 ──
        this.group.add(new Konva.Rect({
            x: g.flangeCX - pw/2, y: g.pipeTopY,
            width: pw, height: g.pipeBotY - g.pipeTopY,
            fillLinearGradientStartPoint: { x: 0,  y: 0 },
            fillLinearGradientEndPoint:   { x: pw, y: 0 },
            fillLinearGradientColorStops: [
                0,'#7a8290', 0.18,'#b8bec8', 0.42,'#dde4ec',
                0.62,'#cdd4dc', 0.82,'#aab2ba', 1,'#6e7480',
            ],
            stroke: '#6a7280', strokeWidth: 1,
        }));
        this.group.add(new Konva.Line({
            points: [g.flangeCX - pw*0.22, g.pipeTopY+4, g.flangeCX - pw*0.22, g.pipeBotY-4],
            stroke: 'rgba(255,255,255,0.32)', strokeWidth: 1.2, lineCap: 'round',
        }));

        // ── 鹅颈弧（三层：阴影→主体→高光）──
        const bendPath = `M ${g.bendSX} ${g.bendSY} C ${g.bc1X} ${g.bc1Y} ${g.bc2X} ${g.bc2Y} ${g.bendEX} ${g.bendEY}`;
        [
            { w: pw + 3.0, color: '#6a7280' },
            { w: pw,       color: '#c0c8d2' },
        ].forEach(({ w, color }) => {
            this.group.add(new Konva.Path({
                data: bendPath, stroke: color, strokeWidth: w,
                fill: 'transparent', lineCap: 'round',
            }));
        });
        this.group.add(new Konva.Path({
            data: `M ${g.bendSX - pw*0.28} ${g.bendSY} C ${g.bc1X - pw*0.24} ${g.bc1Y - pw*0.36} ${g.bc2X - pw*0.18} ${g.bc2Y - pw*0.30} ${g.bendEX - pw*0.14} ${g.bendEY}`,
            stroke: 'rgba(255,255,255,0.28)', strokeWidth: pw*0.26,
            fill: 'transparent', lineCap: 'round',
        }));

        // ── 出水横管 ──
        [
            { w: pw+3.0, color: '#6a7280' },
            { w: pw,     color: '#c0c8d2' },
        ].forEach(({ w, color }) => {
            this.group.add(new Konva.Line({
                points: [g.bendEX, g.bendEY, g.spoutTipX, g.spoutTipY],
                stroke: color, strokeWidth: w, lineCap: 'round',
            }));
        });
        this.group.add(new Konva.Line({
            points: [g.bendEX - pw*0.22, g.bendEY - pw*0.22, g.spoutTipX - pw*0.22, g.spoutTipY - pw*0.22],
            stroke: 'rgba(255,255,255,0.28)', strokeWidth: pw*0.25, lineCap: 'round',
        }));

        // ── 出水口端面 ──
        const ang = Math.atan2(g.spoutTipY - g.bendEY, g.spoutTipX - g.bendEX);
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        this.group.add(new Konva.Line({
            points: [
                g.spoutTipX + nx*pw*0.56, g.spoutTipY + ny*pw*0.56,
                g.spoutTipX - nx*pw*0.56, g.spoutTipY - ny*pw*0.56,
            ],
            stroke: '#505860', strokeWidth: 2.2, lineCap: 'round',
        }));
        this._spoutHole = new Konva.Circle({
            x: g.spoutTipX, y: g.spoutTipY,
            radius: pw * 0.30,
            fill: '#1a2030', stroke: '#3a4050', strokeWidth: 0.8,
        });
        this.group.add(this._spoutHole);
    }

    // ── 温度色带（盖外环弧形，180°扇面）──
    _drawTempBand() {
        const g   = this._geo;
        const seg = 36;  // 分段数

        // 绘制从 -90°(左,蓝) → +90°(右,红) 的彩色渐变弧
        for (let i = 0; i < seg; i++) {
            const a1  = (-90 + (180/seg) * i)     * Math.PI / 180;
            const a2  = (-90 + (180/seg) * (i+1)) * Math.PI / 180;
            const t   = i / (seg - 1);  // 0~1
            const r   = Math.round(40  + t * 215);
            const gr  = Math.round(120 - t * 80);
            const b   = Math.round(220 - t * 190);
            // 每段绘为一个小扇形
            const pts = [];
            const steps = 4;
            for (let s = 0; s <= steps; s++) {
                const a = a1 + (a2-a1) * s/steps;
                pts.push(g.bandCX + Math.cos(a)*g.bandR, g.bandCY + Math.sin(a)*g.bandR);
            }
            for (let s = steps; s >= 0; s--) {
                const a = a1 + (a2-a1) * s/steps;
                pts.push(g.bandCX + Math.cos(a)*(g.bandR-5), g.bandCY + Math.sin(a)*(g.bandR-5));
            }
            this.group.add(new Konva.Line({
                points: pts, closed: true,
                fill: `rgb(${r},${gr},${b})`, stroke: 'none', strokeWidth: 0,
                opacity: 0.75,
            }));
        }

        // 色带边框
        this.group.add(new Konva.Arc({
            x: g.bandCX, y: g.bandCY,
            innerRadius: g.bandR - 5.5, outerRadius: g.bandR + 0.5,
            angle: 180, rotation: -180,
            fill: 'transparent',
            stroke: 'rgba(255,255,255,0.15)', strokeWidth: 0.8,
        }));

        // 温度指示齿（白色小三角，随 tempAngle 移动）
        this._tempIndicator = new Konva.RegularPolygon({
            x: g.bandCX + Math.cos(this._tempAngle * Math.PI/180) * (g.bandR - 2),
            y: g.bandCY + Math.sin(this._tempAngle * Math.PI/180) * (g.bandR - 2),
            sides: 3, radius: 4,
            fill: '#ffffff',
            rotation: this._tempAngle + 90,
            shadowColor: '#fff', shadowBlur: 4, shadowOpacity: 0.6,
        });
        this.group.add(this._tempIndicator);

        // 左右端标注
        [
            { ang: -90, label: '冷', color: '#64b5f6' },
            { ang:  90, label: '热', color: '#ef9a9a' },
        ].forEach(({ ang, label, color }) => {
            const rad = ang * Math.PI / 180;
            this.group.add(new Konva.Text({
                x: g.bandCX + Math.cos(rad)*(g.bandR+8) - 8,
                y: g.bandCY + Math.sin(rad)*(g.bandR+8) - 6,
                width: 16, text: label,
                fontSize: 8.5, fontStyle: 'bold',
                fill: color, align: 'center',
            }));
        });
    }

    // ── 阀芯盖（把手底座圆盘）────────────────
    _drawCapBase() {
        const g = this._geo;

        // 阀芯盖外侧阴影
        this.group.add(new Konva.Circle({
            x: g.capCX+2, y: g.capCY+3,
            radius: g.capR,
            fill: 'rgba(0,0,0,0.20)',
        }));

        // 阀芯盖主体（颜色随温度变化）
        this._capShape = new Konva.Circle({
            x: g.capCX, y: g.capCY,
            radius: g.capR,
            fillRadialGradientStartPoint:  { x: -g.capR*0.25, y: -g.capR*0.25 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientEndRadius:   g.capR,
            fillRadialGradientColorStops:  this._capGradientStops(),
            stroke: '#505860', strokeWidth: 1.2,
            shadowColor: '#000', shadowBlur: 6, shadowOpacity: 0.30,
        });
        this.group.add(this._capShape);

        // 盖面环纹（同心圆装饰）
        [0.55, 0.78].forEach(r => {
            this.group.add(new Konva.Circle({
                x: g.capCX, y: g.capCY,
                radius: g.capR * r,
                fill: 'transparent',
                stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1,
            }));
        });

        // 顶部高光
        this.group.add(new Konva.Ellipse({
            x: g.capCX - g.capR*0.12, y: g.capCY - g.capR*0.30,
            radiusX: g.capR*0.42, radiusY: g.capR*0.26,
            fill: 'rgba(255,255,255,0.20)',
        }));

        // 中心螺钉盖
        this.group.add(new Konva.Circle({
            x: g.capCX, y: g.capCY, radius: g.capR*0.16,
            fill: '#8090a0', stroke: '#607080', strokeWidth: 0.8,
        }));
    }

    _capGradientStops() {
        const c = this._tempToColor(this._outTemp, 0.55);
        return [0, c.light, 0.5, c.mid, 1, c.dark];
    }

    _updateCapColor() {
        if (this._capShape) {
            this._capShape.fillRadialGradientColorStops(this._capGradientStops());
        }
    }

    // ── 把手杆（可动组）────────────────────────
    _buildLeverGroup() {
        const g  = this._geo;
        // 把手组：以阀芯盖中心为原点，整体左右平移（温度）
        // 杆本身相对组内做俯仰旋转（流量）
        this._leverGroup = new Konva.Group({
            x: g.leverRootX,
            y: g.leverRootY,
        });

        this._buildLeverInner();
        this.group.add(this._leverGroup);
    }

    _buildLeverInner() {
        const g   = this._geo;
        const len = g.leverLen;
        const lw  = g.leverW;

        // 把手"俯仰"组（在 leverGroup 内，绕根部旋转模拟前后倾斜）
        // flowAngle=0 → 竖直（关）, flowAngle=90 → 水平倒向前（全开）
        // 在正视图中，"向前倾"投影为"向下倾"，旋转角即 flowAngle
        this._pitchGroup = new Konva.Group({ rotation: this._flowAngle });

        // 杆身主体（向上伸出）
        this._leverRect = new Konva.Rect({
            x: -lw/2, y: -len,
            width: lw, height: len,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: lw, y: 0 },
            fillLinearGradientColorStops: [
                0,'#6a7280', 0.22,'#a8b0ba', 0.45,'#d8e0e8',
                0.68,'#c0c8d2', 0.88,'#8a9298', 1,'#5e6470',
            ],
            stroke: '#505860', strokeWidth: 0.8,
            cornerRadius: [lw/2, lw/2, lw*0.3, lw*0.3],
        });
        this._pitchGroup.add(this._leverRect);

        // 防滑刻纹（横向线，均匀分布）
        const notchCount = 10;
        for (let i = 0; i < notchCount; i++) {
            const ny = -len * 0.22 - (len * 0.62 / notchCount) * i;
            this._pitchGroup.add(new Konva.Line({
                points: [-lw*0.42, ny, lw*0.42, ny],
                stroke: 'rgba(0,0,0,0.18)', strokeWidth: 0.9,
            }));
        }

        // 高光线
        this._pitchGroup.add(new Konva.Line({
            points: [-lw*0.24, -len*0.95, -lw*0.24, -len*0.15],
            stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1, lineCap: 'round',
        }));

        // 把手顶端圆头
        this._pitchGroup.add(new Konva.Circle({
            x: 0, y: -len,
            radius: lw * 0.70,
            fillRadialGradientStartPoint: { x: -lw*0.2, y: -lw*0.2 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: { x: 0, y: 0 },
            fillRadialGradientEndRadius: lw*0.70,
            fillRadialGradientColorStops: [0,'#d8e0e8', 0.5,'#a8b0ba', 1,'#686e78'],
            stroke: '#505860', strokeWidth: 0.8,
        }));

        this._leverGroup.add(this._pitchGroup);
    }

    _updateLeverTransform() {
        const g = this._geo;
        // 温度角 → 把手组左右偏移
        // 把手根部横向位移 = sin(tempAngle) × capR × 0.6
        const tempRad  = this._tempAngle * Math.PI / 180;
        const offsetX  = Math.sin(tempRad) * g.capR * 0.85;
        this._leverGroup.x(g.leverRootX + offsetX);

        // 流量角 → 俯仰旋转（关=0°竖直，开=90°向右倒）
        if (this._pitchGroup) {
            this._pitchGroup.rotation(this._flowAngle);
        }
    }

    _updateTempIndicator() {
        const g   = this._geo;
        const rad = this._tempAngle * Math.PI / 180;
        if (this._tempIndicator) {
            this._tempIndicator.x(g.bandCX + Math.cos(rad) * (g.bandR - 2));
            this._tempIndicator.y(g.bandCY + Math.sin(rad) * (g.bandR - 2));
            this._tempIndicator.rotation(this._tempAngle + 90);
        }
    }

    // ── LCD 面板 ─────────────────────────────
    _drawLCDPanel() {
        const g = this._geo;

        // 面板外框
        this.group.add(new Konva.Rect({
            x: g.lcdX-2, y: g.lcdY-2,
            width: g.lcdW+4, height: g.lcdH+4,
            fill: '#0a0e14', stroke: '#2a3040', strokeWidth: 1,
            cornerRadius: 4,
        }));
        // 面板背景
        this._lcdBg = new Konva.Rect({
            x: g.lcdX, y: g.lcdY,
            width: g.lcdW, height: g.lcdH,
            fill: '#0d1e2e', cornerRadius: 3,
        });
        this.group.add(this._lcdBg);

        // 上行：温度
        this._lcdTempText = new Konva.Text({
            x: g.lcdX + 6, y: g.lcdY + g.lcdH*0.08,
            width: g.lcdW * 0.62,
            text: '--',
            fontSize: g.lcdH * 0.55,
            fontFamily: 'Courier New, monospace',
            fontStyle: 'bold',
            fill: '#00e5cc',
        });
        this.group.add(this._lcdTempText);

        // °C 单位
        this._lcdUnit = new Konva.Text({
            x: g.lcdX + g.lcdW*0.60, y: g.lcdY + g.lcdH*0.08,
            width: g.lcdW*0.20, text: '°C',
            fontSize: g.lcdH*0.28, fill: '#00b4ae',
        });
        this.group.add(this._lcdUnit);

        // 下行：流量
        this._lcdFlowText = new Konva.Text({
            x: g.lcdX + 6, y: g.lcdY + g.lcdH*0.65,
            width: g.lcdW - 10,
            text: '',
            fontSize: g.lcdH * 0.28,
            fill: '#6090a0',
        });
        this.group.add(this._lcdFlowText);

        // LCD 反光
        this.group.add(new Konva.Rect({
            x: g.lcdX+3, y: g.lcdY+3,
            width: g.lcdW*0.35, height: g.lcdH*0.30,
            fill: 'rgba(255,255,255,0.04)', cornerRadius: 1,
        }));
    }

    _updateLCD() {
        if (!this._lcdTempText) return;
        const on   = this._flow > 0.005;
        const temp = this._outTemp;
        const col  = on ? this._tempToColor(temp, 1).main : '#1a3a3a';

        this._lcdBg.fill(on ? '#0d1e2e' : '#080d12');
        this._lcdTempText.text(on ? Math.round(temp).toString() : '--');
        this._lcdTempText.fill(col);
        this._lcdUnit.fill(on ? this._tempToColor(temp, 1).dim : '#1a3a3a');
        this._lcdFlowText.text(
            on ? `${(this._flow * this.maxFlow).toFixed(1)} L/min` : ''
        );
    }

    // ── 粒子层 ────────────────────────────────
    _drawParticleLayer() {
        this._streamGroup = new Konva.Group();
        this.group.add(this._streamGroup);
    }

    // ── 铭牌与端子标注 ──────────────────────
    _drawPortLabels() {
        const g = this._geo, W = this.width, H = this.height;
        [
            { x: g.flangeCX - g.flangeR*0.68, y: H-14, t: 'CW', c: '#90caf9' },
            { x: g.flangeCX + g.flangeR*0.42, y: H-14, t: 'HW', c: '#ef9a9a' },
            { x: g.spoutTipX - 10,            y: g.spoutTipY+10, t: 'OUT', c: '#80cbc4' },
        ].forEach(({ x, y, t, c }) => {
            this.group.add(new Konva.Text({
                x, y, text: t, fontSize: 7.5, fontStyle: 'bold', fill: c,
            }));
        });
    }

    _drawComponentLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  单柄冷热混合水龙头  最大 ${this.maxFlow} L/min`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ═══════════════════════════════════════════
    // 拖拽交互
    _bindDrag() {
        const g = this._geo;

        const getPointerAngleAndDist = (stagePos) => {
            // 相对于阀芯盖中心的坐标
            const dx = stagePos.x - g.leverRootX;
            const dy = stagePos.y - g.leverRootY;
            return { dx, dy };
        };

        this._pitchGroup.on('mousedown touchstart', (e) => {
            if (!this._pitchGroup) return;
            const stage = this._pitchGroup.getStage();
            if (!stage) return;
            const pos = stage.getPointerPosition();
            if (!pos) return;
            this._dragging      = true;
            this._dragStartPos  = { x: pos.x, y: pos.y };
            this._dragStartTemp = this._tempAngle;
            this._dragStartFlow = this._flowAngle;
            e.cancelBubble = true;
        });

        const onMove = () => {
            if (!this._dragging) return;
            const stage = this._pitchGroup?.getStage?.();
            if (!stage) return;
            const pos = stage.getPointerPosition();
            if (!pos) return;

            // 水平位移 → 温度（每 1px ≈ 0.6°）
            const dxPx = pos.x - this._dragStartPos.x;
            const dyPx = pos.y - this._dragStartPos.y;

            const newTemp = Math.max(-90, Math.min(90,
                this._dragStartTemp + dxPx * 0.55
            ));
            // 垂直位移 → 流量（向下拖 = 开，每 1px ≈ 0.7°）
            const newFlow = Math.max(0, Math.min(90,
                this._dragStartFlow + dyPx * 0.60
            ));

            this._targetTempAngle = newTemp;
            this._targetFlowAngle = newFlow;
            this._refreshCache();
        };

        const onUp = () => { this._dragging = false; };

        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', onMove);
            window.addEventListener('touchmove', onMove, { passive: true });
            window.addEventListener('mouseup',   onUp);
            window.addEventListener('touchend',  onUp);
        }

        // 双击：快速切换全开/全关
        this._pitchGroup.on('click tap', () => {
            const now = Date.now();
            if (now - this._lastClickTs < 300) {
                this._targetFlowAngle = this._flowAngle < 45 ? 90 : 0;
                this._lastClickTs = 0;
            } else {
                this._lastClickTs = now;
            }
        });

        this._pitchGroup.listening(true);
    }

    // ═══════════════════════════════════════════
    // 状态计算
    _recalcState() {
        this._flow    = this._flowAngle / 90;   // 0~1
        const ratio   = (this._tempAngle + 90) / 180;  // 0(冷)~1(热)
        this._outTemp = this.coldTemp + ratio * (this.hotTemp - this.coldTemp);
    }

    // ═══════════════════════════════════════════
    // 水流渲染
    _renderStream(dt) {
        const g    = this._geo;
        const flow = this._flow;
        const W    = this.width, H = this.height;
        this._streamGroup.destroyChildren();
        if (flow < 0.005) return;

        const sx = g.streamX, sy = g.streamY;
        const streamW  = flow * g.pipeW * 0.58;
        const streamH  = H * 0.86 - sy;
        const tempRatio = (this._outTemp - this.coldTemp) / (this.hotTemp - this.coldTemp);
        const wCol = this._tempToWaterColor(tempRatio);

        // 主水柱（三层）
        [
            { wf: 0.38, a: 0.82 },
            { wf: 0.72, a: 0.55 },
            { wf: 1.00, a: 0.28 },
        ].forEach(({ wf, a }) => {
            const w  = streamW * wf;
            const wb = Math.sin((this._lastTs||0)*0.003) * streamW * 0.10 * flow;
            this._streamGroup.add(new Konva.Path({
                data: [
                    `M ${sx-w/2+wb} ${sy}`,
                    `C ${sx-w/2+wb*1.2} ${sy+streamH*0.35}`,
                    `  ${sx-w/2+wb*0.7} ${sy+streamH*0.65}`,
                    `  ${sx-w/2+wb*0.4} ${sy+streamH}`,
                    `L ${sx+w/2+wb*0.4} ${sy+streamH}`,
                    `C ${sx+w/2+wb*0.7} ${sy+streamH*0.65}`,
                    `  ${sx+w/2+wb*1.2} ${sy+streamH*0.35}`,
                    `  ${sx+w/2+wb} ${sy}`,
                    'Z',
                ].join(' '),
                fill: `rgba(${wCol.r},${wCol.g},${wCol.b},${a})`,
            }));
        });

        // 高光
        this._streamGroup.add(new Konva.Line({
            points: [sx - streamW*0.20, sy, sx - streamW*0.16, sy+streamH*0.80],
            stroke: 'rgba(255,255,255,0.50)', strokeWidth: streamW*0.13,
            lineCap: 'round', opacity: Math.min(1, flow*1.5),
        }));

        // 出水口光晕
        this._streamGroup.add(new Konva.Ellipse({
            x: sx, y: sy-1,
            radiusX: streamW*2.0 + flow*g.pipeW*0.35,
            radiusY: streamW*0.55,
            fillRadialGradientStartPoint: {x:0,y:0},
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint: {x:0,y:0},
            fillRadialGradientEndRadius: streamW*2.2,
            fillRadialGradientColorStops: [
                0, `rgba(${wCol.r},${wCol.g},${wCol.b},${0.18+flow*0.12})`,
                1, `rgba(${wCol.r},${wCol.g},${wCol.b},0)`,
            ],
        }));

        // 粒子生成
        const spawnN = Math.floor(flow * 14 * dt + Math.random() * flow * 8 * dt);
        for (let i = 0; i < spawnN; i++) {
            this._drops.push({
                x: sx + (Math.random()-0.5)*streamW*0.8,
                y: sy + streamH + Math.random()*3,
                vx: (Math.random()-0.5)*flow*2.5,
                vy: flow*1.2 + Math.random()*1.5,
                r: 0.7 + Math.random()*(1.0 + flow*1.8),
                life: 0.5 + Math.random()*0.6,
                maxLife: 0.5 + Math.random()*0.6,
            });
        }
        // 大流量侧向飞溅
        if (flow > 0.50 && Math.random() < flow * 0.35) {
            for (let i = 0; i < 3; i++) {
                const side = Math.random() < 0.5 ? -1 : 1;
                this._drops.push({
                    x: sx + side*streamW*0.35, y: sy+streamH-2,
                    vx: side*(1.2 + Math.random()*flow*3.0),
                    vy: -Math.random()*1.5,
                    r: 0.5+Math.random()*1.0,
                    life: 0.35+Math.random()*0.25,
                    maxLife: 0.35+Math.random()*0.25,
                });
            }
        }

        // 渲染粒子
        this._drops = this._drops.filter(d => d.life > 0);
        this._drops.forEach(d => {
            d.x  += d.vx * dt * 60;
            d.y  += d.vy * dt * 60;
            d.vy += 0.09 * dt * 60;
            d.life -= dt;
            if (d.x < 0 || d.x > W || d.y > H) { d.life = 0; return; }
            const a = Math.min(0.85, (d.life/d.maxLife)*0.9);
            this._streamGroup.add(new Konva.Circle({
                x: d.x, y: d.y, radius: d.r,
                fill: `rgba(${wCol.r},${wCol.g},${wCol.b},${a.toFixed(2)})`,
            }));
        });

        // 出水口内孔颜色
        if (this._spoutHole) {
            this._spoutHole.fill(`rgba(${Math.round(wCol.r*0.5)},${Math.round(wCol.g*0.5)},${Math.round(wCol.b*0.5)},${0.4+flow*0.4})`);
        }
    }

    // ── 颜色辅助 ─────────────────────────────
    // 返回根据温度插值的颜色对象（用于 cap 渐变）
    _tempToColor(temp, opacityScale) {
        const t = Math.max(0, Math.min(1, (temp - this.coldTemp) / (this.hotTemp - this.coldTemp)));
        // 冷→蓝，中→青绿，热→橙，烫→红
        let r, gr, b;
        if (t < 0.33) {
            const s = t / 0.33;
            r = Math.round(40  + s*60);  gr = Math.round(120 + s*60);  b = Math.round(220 - s*40);
        } else if (t < 0.66) {
            const s = (t-0.33)/0.33;
            r = Math.round(100 + s*130); gr = Math.round(180 - s*60);  b = Math.round(180 - s*120);
        } else {
            const s = (t-0.66)/0.34;
            r = Math.round(230 + s*20);  gr = Math.round(120 - s*100); b = Math.round(60  - s*50);
        }
        return {
            main:  `rgb(${r},${gr},${b})`,
            light: `rgba(${Math.min(255,r+60)},${Math.min(255,gr+60)},${Math.min(255,b+60)},${opacityScale})`,
            mid:   `rgba(${r},${gr},${b},${opacityScale})`,
            dark:  `rgba(${Math.max(0,r-60)},${Math.max(0,gr-60)},${Math.max(0,b-60)},${opacityScale})`,
            dim:   `rgba(${r},${gr},${b},0.6)`,
        };
    }

    // 水流颜色（含温度变化）
    _tempToWaterColor(t) {
        t = Math.max(0, Math.min(1, t));
        if (t < 0.30) {
            const s = t/0.30;
            return { r: Math.round(80+s*40), g: Math.round(160+s*20), b: Math.round(230-s*30) };
        } else if (t < 0.60) {
            const s = (t-0.30)/0.30;
            return { r: Math.round(120+s*110), g: Math.round(180-s*40), b: Math.round(200-s*100) };
        } else {
            const s = (t-0.60)/0.40;
            return { r: Math.round(230+s*20), g: Math.round(140-s*100), b: Math.round(100-s*70) };
        }
    }

    // ═══════════════════════════════════════════
    // 主循环
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnim(ts, dt);
    }
    _tickAnim(ts, dt) {
        // 缓动
        const ease = Math.min(1, dt * 9);
        this._tempAngle += (this._targetTempAngle - this._tempAngle) * ease;
        this._flowAngle += (this._targetFlowAngle - this._flowAngle) * ease;

        this._recalcState();
        this._updateLeverTransform();
        this._updateTempIndicator();
        this._updateCapColor();
        this._updateLCD();
        this._renderStream(dt);
        this._refreshCache();
    }

    // ═══════════════════════════════════════════
    // 公开 API

    /** 设置温度角 -90°(冷) ~ +90°(热) */
    setTempAngle(angle) {
        this._targetTempAngle = Math.max(-90, Math.min(90, angle));
    }

    /** 设置流量角 0°(关) ~ 90°(全开) */
    setFlowAngle(angle) {
        this._targetFlowAngle = Math.max(0, Math.min(90, angle));
    }

    /** 直接设置出水温度（自动换算温度角） */
    setTargetTemp(temp) {
        const ratio = (temp - this.coldTemp) / (this.hotTemp - this.coldTemp);
        this.setTempAngle(-90 + ratio * 180);
    }

    /** 设置流量比例 0~1 */
    setFlow(ratio) { this.setFlowAngle(ratio * 90); }

    /** 全开 */
    fullOpen()  { this._targetFlowAngle = 90; }

    /** 全关 */
    fullClose() { this._targetFlowAngle = 0; }

    getFlow()    { return this._flow; }
    getOutTemp() { return this._outTemp; }
    getTempAngle(){ return this._tempAngle; }
    getFlowAngle(){ return this._flowAngle; }
    getFlowLMin(){ return this._flow * this.maxFlow; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.flow     !== undefined) this.setFlow(state.flow);
            if (state.temp     !== undefined) this.setTargetTemp(state.temp);
            if (state.tempAngle!== undefined) this.setTempAngle(state.tempAngle);
            if (state.flowAngle!== undefined) this.setFlowAngle(state.flowAngle);
        } else if (typeof state === 'boolean') {
            state ? this.fullOpen() : this.fullClose();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',          type: 'text'   },
            { label: '最大流量 (L/min)',    key: 'maxFlow',        type: 'number' },
            { label: '冷水温度 (°C)',       key: 'coldTemp',       type: 'number' },
            { label: '热水温度 (°C)',       key: 'hotTemp',        type: 'number' },
            { label: '初始温度角 (-90~90)', key: 'initTempAngle',  type: 'number' },
            { label: '初始流量角 (0~90)',   key: 'initFlowAngle',  type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)         this.label    = cfg.label;
        if (cfg.maxFlow)       this.maxFlow  = parseFloat(cfg.maxFlow);
        if (cfg.coldTemp)      this.coldTemp = parseFloat(cfg.coldTemp);
        if (cfg.hotTemp)       this.hotTemp  = parseFloat(cfg.hotTemp);
        if (cfg.initTempAngle !== undefined) this.setTempAngle(parseFloat(cfg.initTempAngle));
        if (cfg.initFlowAngle !== undefined) this.setFlowAngle(parseFloat(cfg.initFlowAngle));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}