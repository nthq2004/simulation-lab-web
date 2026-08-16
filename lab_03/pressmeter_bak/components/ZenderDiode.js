import { BaseComponent } from './BaseComponent.js';

/**
 * 稳压二极管（齐纳二极管）仿真组件
 * （Zener Diode / Voltage Regulator Diode）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  稳压二极管采用标准 DO-35 玻璃封装，由以下部分组成：
 *
 *  1. 玻璃封装体（Glass Body）：圆柱形半透明玻璃管
 *     - 主体呈橙/琥珀色（典型稳压管外观）
 *     - 玻璃高光与折射纹理体现透明质感
 *  2. 阴极色环（Cathode Band）：封装体一端的黑色/深色标记环
 *     - 用于区分阴极（K）方向，与普通二极管相同
 *  3. 阳极引脚（Anode / A）：左侧引出线，正极
 *  4. 阴极引脚（Cathode / K）：右侧引出线，负极（靠近色环端）
 *  5. 内部结构示意：
 *     - P 型区（左半）/ N 型区（右半），以 PN 结界面分隔
 *     - 耗尽层（Depletion Layer）：结区中央窄带
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  ① 正向导通（Forward）：A 端电位 > K 端，Vak > Vf（≈0.7V）
 *     → 正常 PN 结导通，显示绿色正向导通指示
 *
 *  ② 反向截止（Reverse Blocking）：Vak < 0，|Vak| < Vz
 *     → 高阻截止，组件呈静态灰暗
 *
 *  ③ 齐纳击穿（Zener Breakdown）：Vak < 0，|Vak| ≥ Vz
 *     → 反向击穿导通，电压钳位在 Vz，显示蓝紫色击穿指示
 *     → 击穿状态下封装体内部出现雪崩辉光动画
 *
 *  三种状态均有对应的视觉指示和动态动画效果。
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  正向导通：封装体轻微绿色呼吸光晕（周期 1.2s）
 *  齐纳击穿：封装体内蓝紫色辉光 + 脉冲闪烁（周期 0.8s）
 *  状态切换：100ms 渐变过渡
 *  截止状态：静态半透明玻璃外观
 *
 * ── 电气符号参考 ──────────────────────────────────────────────
 *
 *  稳压二极管电路符号在普通二极管基础上，阴极两端各有一小折弯（Z 形），
 *  本组件在底部电路符号区同时绘制标准电路符号供参考。
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  anode   — 阳极 A（左侧引脚）
 *  cathode — 阴极 K（右侧引脚，色环端）
 */
export class ZenerDiode extends BaseComponent {

    // ── 工作状态枚举 ─────────────────────────
    static STATE = {
        BLOCKING:  'blocking',   // 反向截止
        FORWARD:   'forward',    // 正向导通
        BREAKDOWN: 'breakdown',  // 齐纳击穿
    };

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(120, config.height || 160);

        this.type    = 'zener_diode';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label        = config.label        || 'DZ';    // 位号
        this.vz           = config.vz           || 5.1;     // V 稳压值（击穿电压）
        this.vf           = config.vf           || 0.7;     // V 正向导通电压
        this.powerRating  = config.powerRating  || 0.5;     // W 额定功率
        this.izMax        = config.izMax        || 98;      // mA 最大稳压电流

        // ── 状态 ──
        const initState   = config.initState || ZenerDiode.STATE.BLOCKING;
        this._state       = initState;
        this._prevState   = initState;
        this._animating   = false;
        this._animT       = 0;
        this._animDur     = 0.10;       // s 过渡时长
        this._pulseT      = 0;          // 脉冲动画相位
        this._pulseSpeed  = 2 * Math.PI / 0.8;   // rad/s 击穿脉冲周期
        this._breathT     = 0;          // 正向呼吸相位
        this._breathSpeed = 2 * Math.PI / 1.2;   // rad/s
        this._glowIntensity = 0;        // 当前辉光强度 0~1

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 封装体（DO-35 圆柱，水平放置）
        this._bodyW  = W * 0.38;   // 玻璃管长度
        this._bodyH  = H * 0.18;   // 玻璃管直径
        this._cx     = W * 0.50;   // 中心 X
        this._cy     = H * 0.38;   // 中心 Y（引脚向下伸出）

        // 色环（阴极标记，靠右端）
        this._bandW  = this._bodyW * 0.10;
        this._bandX  = this._cx + this._bodyW/2 - this._bandW - this._bodyW*0.06;

        // 引脚
        this._pinH   = H * 0.28;   // 引脚竖直段长度
        this._pinW   = W * 0.022;  // 引脚线宽


        this._init();

        // ── 端口 ──
        const portY = this._cy + this._bodyH/2 + this._pinH + 4;
        this.addPort(
            this._cx - this._bodyW/2,
            portY,
            'anode', 'wire', 'A'
        );
        this.addPort(
            this._cx + this._bodyW/2,
            portY,
            'cathode', 'wire', 'K'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawGlowLayer();          // 最底层：辉光（动态）
        this._drawPins();               // 引脚
        this._drawBody();               // 玻璃封装主体
        this._drawInternalStructure();  // 内部 PN 结示意
        this._drawCathodeBand();        // 阴极色环（最上层固定件）
        this._drawBodyHighlights();     // 玻璃高光
        this._drawSchematicSymbol();    // 电路符号（底部参考）
        this._drawLabel();              // 位号与参数
        this._drawStatusIndicator();    // 状态指示
        
    }

    // ── 辉光层（最底层，动态）────────────────
    _drawGlowLayer() {
        this._glowGroup = new Konva.Group();
        this.group.add(this._glowGroup);
        this._rebuildGlow();
    }

    _rebuildGlow() {
        this._glowGroup.destroyChildren();
        const intensity = this._glowIntensity;
        if (intensity <= 0.01) return;

        const cx = this._cx, cy = this._cy;
        const bW = this._bodyW, bH = this._bodyH;

        const isBreakdown = this._state === ZenerDiode.STATE.BREAKDOWN;
        const isForward   = this._state === ZenerDiode.STATE.FORWARD;

        const glowColor = isBreakdown ? '#7040ff' : '#40ff80';
        const glowR     = bH * (isBreakdown ? 2.2 : 1.6) * intensity;

        // 外层椭圆光晕（沿封装体轴向拉伸）
        this._glowGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: bW * 0.65 * (0.7 + 0.3 * intensity),
            radiusY: glowR,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   glowR,
            fillRadialGradientColorStops:  [
                0,   this._hexToRgba(glowColor, 0.35 * intensity),
                0.5, this._hexToRgba(glowColor, 0.12 * intensity),
                1,   this._hexToRgba(glowColor, 0),
            ],
        }));

        // 击穿时：内部雪崩辉光条纹
        if (isBreakdown && intensity > 0.2) {
            const stripeCount = 3;
            for (let i = 0; i < stripeCount; i++) {
                const sx = cx - bW * 0.30 + (bW * 0.60 / (stripeCount - 1)) * i;
                const brightness = 0.15 + 0.25 * Math.sin(this._pulseT + i * 1.2);
                this._glowGroup.add(new Konva.Line({
                    points: [sx, cy - bH * 0.35, sx + bW * 0.05, cy + bH * 0.35],
                    stroke: this._hexToRgba('#a060ff', Math.max(0, brightness) * intensity),
                    strokeWidth: bW * 0.035,
                    lineCap: 'round',
                }));
            }
        }
    }

    // ── 引脚（镀锡铜线）─────────────────────
    _drawPins() {
        const cx   = this._cx;
        const cy   = this._cy;
        const bW   = this._bodyW;
        const bH   = this._bodyH;
        const pinH = this._pinH;
        const pinW = this._pinW;

        const pinGradH = {
            fillLinearGradientStartPoint: { x: 0, y: -pinW },
            fillLinearGradientEndPoint:   { x: 0, y:  pinW },
            fillLinearGradientColorStops: [0,'#8a9098', 0.5,'#d8dce0', 1,'#8a9098'],
        };

        // 阳极引脚（左，水平段 + 竖直段）
        const axL = cx - bW/2;
        // 水平延伸
        this.group.add(new Konva.Rect({
            x: axL - bW * 0.18, y: cy - pinW/2,
            width: bW * 0.18, height: pinW,
            ...pinGradH,
            stroke: '#707880', strokeWidth: 0.4,
        }));
        // 竖直段
        this.group.add(new Konva.Rect({
            x: axL - bW*0.18 - pinW/2, y: cy,
            width: pinW, height: pinH,
            fillLinearGradientStartPoint: { x: -pinW, y: 0 },
            fillLinearGradientEndPoint:   { x:  pinW, y: 0 },
            fillLinearGradientColorStops: [0,'#8a9098', 0.5,'#d8dce0', 1,'#8a9098'],
            stroke: '#707880', strokeWidth: 0.4,
        }));

        // 阴极引脚（右，水平段 + 竖直段）
        const axR = cx + bW/2;
        this.group.add(new Konva.Rect({
            x: axR, y: cy - pinW/2,
            width: bW * 0.18, height: pinW,
            ...pinGradH,
            stroke: '#707880', strokeWidth: 0.4,
        }));
        this.group.add(new Konva.Rect({
            x: axR + bW*0.18 - pinW/2, y: cy,
            width: pinW, height: pinH,
            fillLinearGradientStartPoint: { x: -pinW, y: 0 },
            fillLinearGradientEndPoint:   { x:  pinW, y: 0 },
            fillLinearGradientColorStops: [0,'#8a9098', 0.5,'#d8dce0', 1,'#8a9098'],
            stroke: '#707880', strokeWidth: 0.4,
        }));

        // 引脚末端焊点（小圆）
        [axL - bW*0.18 - pinW/2, axR + bW*0.18 - pinW/2].forEach(px => {
            this.group.add(new Konva.Circle({
                x: px + pinW/2, y: cy + pinH + 3,
                radius: pinW * 1.4,
                fill: '#c8ccd0', stroke: '#909498', strokeWidth: 0.5,
            }));
        });
    }

    // ── 玻璃封装主体 ─────────────────────────
    _drawBody() {
        const cx = this._cx, cy = this._cy;
        const bW = this._bodyW, bH = this._bodyH;

        // ── 阴影（底部投影）──
        this.group.add(new Konva.Ellipse({
            x: cx + 2, y: cy + bH/2 + 2,
            radiusX: bW * 0.45, radiusY: bH * 0.18,
            fill: 'rgba(0,0,0,0.20)',
        }));

        // ── 玻璃管主体（圆角矩形 + 两端半圆）──
        // 主矩形（橙琥珀色半透明玻璃）
        this._bodyRect = new Konva.Rect({
            x: cx - bW/2, y: cy - bH/2,
            width: bW, height: bH,
            fillLinearGradientStartPoint: { x: 0, y: -bH/2 },
            fillLinearGradientEndPoint:   { x: 0, y:  bH/2 },
            fillLinearGradientColorStops: [
                0,    '#d07830',
                0.20, '#e89840',
                0.42, '#f0b060',
                0.58, '#e89840',
                0.78, '#c06820',
                1,    '#a05010',
            ],
            stroke: '#8a4810', strokeWidth: 1.0,
        });
        this.group.add(this._bodyRect);

        // 左端半圆
        this.group.add(new Konva.Arc({
            x: cx - bW/2, y: cy,
            innerRadius: 0, outerRadius: bH/2,
            angle: 180, rotation: 90,
            fillLinearGradientStartPoint: { x: -bH/2, y: 0 },
            fillLinearGradientEndPoint:   { x:  bH/2, y: 0 },
            fillLinearGradientColorStops: [0,'#a05010', 0.5,'#d07030', 1,'#a05010'],
            stroke: '#8a4810', strokeWidth: 1.0,
        }));

        // 右端半圆
        this.group.add(new Konva.Arc({
            x: cx + bW/2, y: cy,
            innerRadius: 0, outerRadius: bH/2,
            angle: 180, rotation: 270,
            fillLinearGradientStartPoint: { x: -bH/2, y: 0 },
            fillLinearGradientEndPoint:   { x:  bH/2, y: 0 },
            fillLinearGradientColorStops: [0,'#a05010', 0.5,'#c86820', 1,'#a05010'],
            stroke: '#8a4810', strokeWidth: 1.0,
        }));
    }

    // ── 内部 PN 结示意 ────────────────────────
    _drawInternalStructure() {
        const cx = this._cx, cy = this._cy;
        const bW = this._bodyW, bH = this._bodyH;
        const pad = bH * 0.18;   // 内边距

        // P 区（左半，轻微玫红色调，半透明）
        this.group.add(new Konva.Rect({
            x: cx - bW/2 + pad, y: cy - bH/2 + pad,
            width: bW/2 - pad*1.2, height: bH - pad*2,
            fill: 'rgba(200, 80, 60, 0.12)',
            cornerRadius: [2, 0, 0, 2],
        }));

        // N 区（右半，轻微蓝色调，半透明）
        this.group.add(new Konva.Rect({
            x: cx + pad*0.2, y: cy - bH/2 + pad,
            width: bW/2 - pad*1.2, height: bH - pad*2,
            fill: 'rgba(60, 100, 200, 0.12)',
            cornerRadius: [0, 2, 2, 0],
        }));

        // 耗尽层（结区，中央窄带）
        this.group.add(new Konva.Rect({
            x: cx - bW*0.025, y: cy - bH/2 + pad,
            width: bW * 0.05, height: bH - pad*2,
            fill: 'rgba(80, 60, 20, 0.22)',
        }));

        // P / N 区标注文字
        this.group.add(new Konva.Text({
            x: cx - bW/2 + pad + 2, y: cy - 5,
            text: 'P', fontSize: Math.max(7, bH*0.38), fontStyle: 'bold',
            fill: 'rgba(200,100,80,0.55)',
        }));
        this.group.add(new Konva.Text({
            x: cx + bW*0.08, y: cy - 5,
            text: 'N', fontSize: Math.max(7, bH*0.38), fontStyle: 'bold',
            fill: 'rgba(80,120,200,0.55)',
        }));
    }

    // ── 阴极色环 ─────────────────────────────
    _drawCathodeBand() {
        const cy  = this._cy;
        const bH  = this._bodyH;
        const bX  = this._bandX;
        const bW  = this._bandW;

        // 色环主体（深灰黑）
        this.group.add(new Konva.Rect({
            x: bX, y: cy - bH/2 - 0.5,
            width: bW, height: bH + 1,
            fill: '#1a1a20',
            stroke: '#0a0a10', strokeWidth: 0.5,
        }));

        // 色环高光线（增加立体感）
        this.group.add(new Konva.Line({
            points: [bX + bW*0.30, cy - bH/2 + 1, bX + bW*0.30, cy + bH/2 - 1],
            stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1, lineCap: 'round',
        }));
    }

    // ── 玻璃高光与折射纹理 ───────────────────
    _drawBodyHighlights() {
        const cx = this._cx, cy = this._cy;
        const bW = this._bodyW, bH = this._bodyH;

        // 顶部主高光条（强反射）
        this.group.add(new Konva.Rect({
            x: cx - bW*0.38, y: cy - bH/2 + 1,
            width: bW * 0.76, height: bH * 0.20,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bW*0.76, y: 0 },
            fillLinearGradientColorStops: [
                0,   'rgba(255,255,255,0)',
                0.2, 'rgba(255,255,255,0.32)',
                0.5, 'rgba(255,255,255,0.40)',
                0.8, 'rgba(255,255,255,0.28)',
                1,   'rgba(255,255,255,0)',
            ],
            cornerRadius: [1, 1, 0, 0],
        }));

        // 次级高光（中部细线，玻璃折射感）
        this.group.add(new Konva.Line({
            points: [cx - bW*0.30, cy - bH*0.10, cx + bW*0.28, cy - bH*0.10],
            stroke: 'rgba(255,220,160,0.18)', strokeWidth: 1.5, lineCap: 'round',
        }));

        // 底部暗影弧（增加管状立体感）
        this.group.add(new Konva.Rect({
            x: cx - bW*0.40, y: cy + bH/2 - bH*0.22,
            width: bW * 0.80, height: bH * 0.20,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: bW*0.80, y: 0 },
            fillLinearGradientColorStops: [
                0,   'rgba(0,0,0,0)',
                0.3, 'rgba(0,0,0,0.18)',
                0.7, 'rgba(0,0,0,0.18)',
                1,   'rgba(0,0,0,0)',
            ],
        }));
    }

    // ── 电路符号（底部参考区）────────────────
    _drawSchematicSymbol() {
        const W  = this.width, H = this.height;
        const sx = W * 0.50;   // 符号中心 X
        const sy = H * 0.80;   // 符号区 Y
        const r  = Math.min(W, H) * 0.068;  // 三角形半尺寸

        // 背景区域（虚线框）
        this.group.add(new Konva.Rect({
            x: W*0.10, y: sy - r*1.6,
            width: W*0.80, height: r*3.2,
            stroke: '#37474f', strokeWidth: 0.6,
            dash: [3, 3], cornerRadius: 3,
            fill: 'rgba(255,255,255,0.02)',
        }));

        // ── 符号引线（左右水平线）──
        this.group.add(new Konva.Line({
            points: [W*0.12, sy, sx - r, sy],
            stroke: '#78909c', strokeWidth: 1.2, lineCap: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [sx + r, sy, W*0.88, sy],
            stroke: '#78909c', strokeWidth: 1.2, lineCap: 'round',
        }));

        // ── 三角形（二极管箭头）──
        this.group.add(new Konva.Line({
            points: [sx - r, sy - r, sx - r, sy + r, sx + r, sy, sx - r, sy - r],
            closed: true,
            fill: 'rgba(100,140,180,0.25)',
            stroke: '#78909c', strokeWidth: 1.2,
        }));

        // ── 稳压管阴极（Z 形折弯线）──
        // 普通二极管是竖线；稳压管两端各有反向折弯（Z 字）
        const lx = sx + r;
        const zLen = r * 0.55;
        this.group.add(new Konva.Line({
            points: [
                lx - zLen, sy - r,          // 上折弯（向左）
                lx,         sy - r,
                lx,         sy + r,          // 竖线
                lx + zLen, sy + r,           // 下折弯（向右）
            ],
            stroke: '#78909c', strokeWidth: 1.5,
            lineJoin: 'round', lineCap: 'round',
        }));

        // ── 符号标注 ──
        this.group.add(new Konva.Text({
            x: W*0.12, y: sy - r*1.55,
            text: `Vz = ${this.vz}V`, fontSize: 7.5, fill: '#546e7a',
        }));
        this.group.add(new Konva.Text({
            x: W*0.10, y: sy + r*1.15, width: W*0.80,
            text: 'Zener Symbol', fontSize: 7, fill: '#455a64', align: 'center',
        }));

        // A / K 标注
        this.group.add(new Konva.Text({
            x: W*0.12, y: sy - 5,
            text: 'A', fontSize: 8, fontStyle: 'bold', fill: '#ef9a9a',
        }));
        this.group.add(new Konva.Text({
            x: W*0.82, y: sy - 5,
            text: 'K', fontSize: 8, fontStyle: 'bold', fill: '#90caf9',
        }));
    }

    // ── 位号与参数标注 ────────────────────────
    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  Vz=${this.vz}V  ${this.powerRating}W`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 引脚标注
        const portY = this._cy + this._bodyH/2 + this._pinH + 6;
        this.group.add(new Konva.Text({
            x: this._cx - this._bodyW/2 - 18, y: portY,
            text: 'A', fontSize: 8, fill: '#ef9a9a', fontStyle: 'bold',
        }));
        this.group.add(new Konva.Text({
            x: this._cx + this._bodyW/2 + 6, y: portY,
            text: 'K', fontSize: 8, fill: '#90caf9', fontStyle: 'bold',
        }));
    }

    // ── 状态指示（右上角）────────────────────
    _drawStatusIndicator() {
        const ix = this.width - 14;
        const iy = this._cy - this._bodyH;

        const { dotFill, dotStroke, dotShadow, dotBlur, labelText, labelFill } =
            this._getStatusStyle();

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: dotFill, stroke: dotStroke, strokeWidth: 0.8,
            shadowColor: dotShadow, shadowBlur: dotBlur, shadowOpacity: 0.9,
        });
        this._statusText = new Konva.Text({
            x: ix - 28, y: iy + 6,
            text: labelText, fontSize: 8, fontStyle: 'bold',
            fill: labelFill, align: 'right', width: 26,
        });
        this.group.add(this._statusDot, this._statusText);
    }

    _getStatusStyle() {
        switch (this._state) {
            case ZenerDiode.STATE.FORWARD:
                return { dotFill:'#66bb6a', dotStroke:'#2e7d32',
                         dotShadow:'#66bb6a', dotBlur:6,
                         labelText:'正向', labelFill:'#66bb6a' };
            case ZenerDiode.STATE.BREAKDOWN:
                return { dotFill:'#9060ff', dotStroke:'#5020cc',
                         dotShadow:'#9060ff', dotBlur:8,
                         labelText:'击穿', labelFill:'#9060ff' };
            default:
                return { dotFill:'#546e7a', dotStroke:'#37474f',
                         dotShadow:'transparent', dotBlur:0,
                         labelText:'截止', labelFill:'#546e7a' };
        }
    }

    // ── 点击交互 ─────────────────────────────
    _bindInteraction() {
        // 点击封装体循环切换三种状态
        this._bodyRect && this._bodyRect.on('click tap', () => this.cycleState());
        this._bodyRect && this._bodyRect.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        let dirty = false;

        // ── 状态切换过渡 ──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            const target = (this._state !== ZenerDiode.STATE.BLOCKING) ? 1.0 : 0.0;
            const from   = (this._prevState !== ZenerDiode.STATE.BLOCKING) ? 1.0 : 0.0;
            this._glowIntensity = from + (target - from) * ease;
            dirty = true;
        }

        // ── 击穿脉冲动画 ──
        if (this._state === ZenerDiode.STATE.BREAKDOWN && !this._animating) {
            this._pulseT += dt * this._pulseSpeed;
            if (this._pulseT > 2 * Math.PI) this._pulseT -= 2 * Math.PI;
            this._glowIntensity = 0.70 + 0.30 * Math.sin(this._pulseT);
            dirty = true;
        }

        // ── 正向呼吸动画 ──
        if (this._state === ZenerDiode.STATE.FORWARD && !this._animating) {
            this._breathT += dt * this._breathSpeed;
            if (this._breathT > 2 * Math.PI) this._breathT -= 2 * Math.PI;
            this._glowIntensity = 0.55 + 0.20 * Math.sin(this._breathT);
            dirty = true;
        }

        // ── 截止时归零 ──
        if (this._state === ZenerDiode.STATE.BLOCKING && !this._animating) {
            if (this._glowIntensity > 0) { this._glowIntensity = 0; dirty = true; }
        }

        if (dirty) {
            this._rebuildGlow();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _updateStatus() {
        const style = this._getStatusStyle();
        if (this._statusDot) {
            this._statusDot.fill(style.dotFill);
            this._statusDot.stroke(style.dotStroke);
            this._statusDot.shadowColor(style.dotShadow);
            this._statusDot.shadowBlur(style.dotBlur);
        }
        if (this._statusText) {
            this._statusText.text(style.labelText);
            this._statusText.fill(style.labelFill);
        }
    }

    // ═══════════════════════════════════════════
    /** 循环切换状态：截止 → 正向 → 击穿 → 截止 */
    cycleState() {
        const order = [
            ZenerDiode.STATE.BLOCKING,
            ZenerDiode.STATE.FORWARD,
            ZenerDiode.STATE.BREAKDOWN,
        ];
        const idx = order.indexOf(this._state);
        this.setState(order[(idx + 1) % order.length]);
    }

    /** 设置到指定状态 */
    setState(state) {
        if (this._state === state) return;
        this._prevState = this._state;
        this._state     = state;
        this._animT     = 0;
        this._animating = true;
        this._breathT   = 0;
        this._pulseT    = 0;
        this._refreshCache();
    }

    /** 正向导通 */
    setForward()   { this.setState(ZenerDiode.STATE.FORWARD);   }

    /** 反向截止 */
    setBlocking()  { this.setState(ZenerDiode.STATE.BLOCKING);  }

    /** 齐纳击穿 */
    setBreakdown() { this.setState(ZenerDiode.STATE.BREAKDOWN); }

    /** 查询当前状态 */
    getState()      { return this._state; }
    isForward()     { return this._state === ZenerDiode.STATE.FORWARD;   }
    isBlocking()    { return this._state === ZenerDiode.STATE.BLOCKING;  }
    isBreakdown()   { return this._state === ZenerDiode.STATE.BREAKDOWN; }
    isAnimating()   { return this._animating; }

    update(state) {
        if (typeof state === 'string') this.setState(state);
        else if (typeof state === 'boolean') state ? this.setForward() : this.setBlocking();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',      key: 'label',        type: 'text'   },
            { label: '稳压值 Vz (V)',   key: 'vz',           type: 'number' },
            { label: '额定功率 (W)',    key: 'powerRating',  type: 'number' },
            { label: '最大电流 (mA)',   key: 'izMax',        type: 'number' },
            { label: '初始状态',        key: 'initState',    type: 'select',
              options: Object.values(ZenerDiode.STATE) },
        ];
    }

    onConfigUpdate(cfg) {
        this.label       = cfg.label       || this.label;
        this.vz          = parseFloat(cfg.vz)          || this.vz;
        this.powerRating = parseFloat(cfg.powerRating) || this.powerRating;
        this.izMax       = parseFloat(cfg.izMax)       || this.izMax;
        if (cfg.initState && Object.values(ZenerDiode.STATE).includes(cfg.initState)) {
            this.setState(cfg.initState);
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }

    // ═══════════════════════════════════════════
    // ── 颜色工具方法 ──────────────────────────

    _hexToRgba(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    }
}