import { BaseComponent } from './BaseComponent.js';

/**
 * 光耦合器（光电耦合器）仿真组件
 * （Optocoupler / Photocoupler）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  光耦合器是将发光器件与受光器件封装在同一壳体内的光电转换器件，
 *  典型型号参考 PC817 / 4N35 / TLP521 等 DIP-4 封装，由以下部分组成：
 *
 *  1. 封装外壳（DIP-4 Package）：黑色矩形环氧树脂壳体
 *     - 顶部半圆凹口（Pin-1 方向标记）
 *     - 两侧各 2 个引脚（共 4 脚）
 *
 *  2. 输入侧（电路 1 / 左侧）— 红外 LED（IR LED）
 *     - 引脚 1（阳极 A）：左上，正极
 *     - 引脚 2（阴极 K）：左下，负极
 *     - 红外发射管符号：带两条斜向辐射箭头的二极管三角形
 *     - 导通时发出红外辐射光束，内部光束动画
 *
 *  3. 输出侧（电路 2 / 右侧）— 光敏晶体管（Phototransistor）
 *     - 引脚 4（集电极 C）：右上
 *     - 引脚 3（发射极 E）：右下
 *     - NPN 光敏三极管符号：带两条斜向入射箭头的 BJT 符号
 *     - 接收到光信号后触发导通，集电极→发射极电流流通
 *
 *  4. 内部光耦通道（Optical Channel）：
 *     - 封装内部中央区域：光束传播路径可视化
 *     - 导通时：红外光束以橙红色粒子流动画呈现
 *     - 截止时：暗灰色无光状态
 *
 *  5. 电气隔离屏障（Isolation Barrier）：
 *     - 中央竖向虚线，体现输入/输出电气完全隔离
 *     - 标注隔离电压（Viso）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  ① 截止（OFF）：引脚 1-2 无电流 → IR LED 不亮 → 光敏管截止
 *     → 输出侧高阻，电路 2 断开
 *
 *  ② 导通（ON）：引脚 1-2 正向电流（If > 1mA）
 *     → IR LED 发射红外光 → 光敏管感光导通
 *     → 引脚 4-3 导通，集电极电流 Ic = CTR × If
 *
 *  CTR（电流传输比）= Ic / If × 100%，典型值 50%~300%
 *
 * ── 动画效果 ──────────────────────────────────────────────────
 *
 *  导通时：
 *    - IR LED 端橙红色发光晕（呼吸，周期 1.0s）
 *    - 内部光束粒子流动画（从左向右流动）
 *    - 光敏管端蓝白色受光晕
 *    - 输出侧导通绿色指示
 *  截止时：静态黑色封装，无内部光束
 *  切换：120ms 渐变过渡
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  pin1_anode    — 引脚 1，输入阳极 A（左上）
 *  pin2_cathode  — 引脚 2，输入阴极 K（左下）
 *  pin4_collector— 引脚 4，输出集电极 C（右上）
 *  pin3_emitter  — 引脚 3，输出发射极 E（右下）
 */
export class Optocoupler extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(180, config.width  || 240);
        this.height = Math.max(160, config.height || 200);

        this.type    = 'optocoupler';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label       = config.label       || 'PC817';
        this.ctr         = config.ctr         || 100;    // % 电流传输比
        this.viso        = config.viso        || 5000;   // V 隔离电压
        this.ifMax       = config.ifMax       || 50;     // mA 输入最大电流
        this.vceMax      = config.vceMax      || 35;     // V 输出最大电压

        // ── 状态 ──
        this._on          = config.initOn === true;      // 默认截止
        this._animating   = false;
        this._animT       = 0;
        this._animDur     = 0.12;                        // s 过渡时长
        this._animDir     = 1;                           // +1=导通，-1=截止
        this._breathT     = 0;
        this._breathSpeed = 2 * Math.PI / 1.0;          // rad/s
        this._beamPhase   = 0;                           // 光束粒子动画相位
        this._beamSpeed   = 3.5;                         // 粒子流速（rad/s 等效）
        this._intensity   = this._on ? 1.0 : 0.0;       // 当前发光强度

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 封装体（DIP-4，黑色矩形）
        this._pkgX  = W * 0.22;
        this._pkgY  = H * 0.15;
        this._pkgW  = W * 0.56;
        this._pkgH  = H * 0.60;

        // 封装体中心
        this._cx    = this._pkgX + this._pkgW / 2;
        this._cy    = this._pkgY + this._pkgH / 2;

        // 引脚几何
        this._pinLen  = W * 0.18;   // 外伸引脚长度
        this._pinW    = H * 0.022;  // 引脚线宽
        this._pinGapY = this._pkgH * 0.42; // 上下引脚间距（中心间距/2）

        // 内部符号区域
        this._ledCx  = this._cx - this._pkgW * 0.24;  // IR LED 符号中心 X
        this._trCx   = this._cx + this._pkgW * 0.20;  // 光敏管符号中心 X
        this._symCy  = this._cy;                       // 符号中心 Y

        this._lastTs  = null;
        this._animId  = null;

        this._init();

        // ── 端口（引脚末端） ──
        const pinOutX_L = this._pkgX - this._pinLen - 2;
        const pinOutX_R = this._pkgX + this._pkgW + this._pinLen + 2;
        const pin1Y = this._cy - this._pinGapY;
        const pin2Y = this._cy + this._pinGapY;

        this.addPort(pinOutX_L, pin1Y, 'pin1_anode',     'wire', '1A');
        this.addPort(pinOutX_L, pin2Y, 'pin2_cathode',   'wire', '2K');
        this.addPort(pinOutX_R, pin1Y, 'pin4_collector', 'wire', '4C');
        this.addPort(pinOutX_R, pin2Y, 'pin3_emitter',   'wire', '3E');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawSideLabels();         // 电路 1 / 电路 2 标注
        this._drawGlowLayer();          // 辉光（动态，最底层）
        this._drawPins();               // 外部引脚
        this._drawPackage();            // 封装外壳
        this._drawIsolationBarrier();   // 隔离屏障虚线
        this._drawIrLedSymbol();        // IR LED 电路符号
        this._drawPhototransistorSymbol(); // 光敏晶体管符号
        this._drawBeamLayer();          // 内部光束（动态）
        this._drawPinNumbers();         // 引脚编号
        this._drawLabel();              // 位号
        this._drawStatusIndicator();    // 状态指示
        this._startAnimation();
    }

    // ── 电路 1 / 电路 2 侧边标注 ─────────────
    _drawSideLabels() {
        const W = this.width, H = this.height;
        const pkgX = this._pkgX, pkgW = this._pkgW;
        const cy = this._cy;

        // 电路 1（左）虚线框
        this.group.add(new Konva.Rect({
            x: 2, y: cy - this._pinGapY - 16,
            width: pkgX - 6, height: this._pinGapY * 2 + 32,
            stroke: '#43a047', strokeWidth: 1.2,
            dash: [5, 4], cornerRadius: 4,
            fill: 'rgba(67,160,71,0.04)',
        }));
        this.group.add(new Konva.Text({
            x: 2, y: cy - 8,
            text: '电路 1', fontSize: 9, fill: '#43a047',
            width: pkgX - 6, align: 'center',
        }));

        // 电路 2（右）虚线框
        const rx = pkgX + pkgW + 6;
        this.group.add(new Konva.Rect({
            x: rx, y: cy - this._pinGapY - 16,
            width: W - rx - 2, height: this._pinGapY * 2 + 32,
            stroke: '#1e88e5', strokeWidth: 1.2,
            dash: [5, 4], cornerRadius: 4,
            fill: 'rgba(30,136,229,0.04)',
        }));
        this.group.add(new Konva.Text({
            x: rx, y: cy - 8,
            text: '电路 2', fontSize: 9, fill: '#1e88e5',
            width: W - rx - 2, align: 'center',
        }));
    }

    // ── 辉光层（动态，最底层）────────────────
    _drawGlowLayer() {
        this._glowGroup = new Konva.Group();
        this.group.add(this._glowGroup);
        this._rebuildGlow();
    }

    _rebuildGlow() {
        this._glowGroup.destroyChildren();
        const br = this._intensity;
        if (br <= 0.01) return;

        const ledCx = this._ledCx, trCx = this._trCx, cy = this._symCy;
        const r = this._pkgH * 0.22;

        // IR LED 端橙红辉光
        this._glowGroup.add(new Konva.Circle({
            x: ledCx, y: cy, radius: r * (1.0 + 0.5 * br),
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * (1.0 + 0.5 * br),
            fillRadialGradientColorStops:  [
                0,   this._rgba('#ff7020', 0.45 * br),
                0.5, this._rgba('#ff4800', 0.18 * br),
                1,   this._rgba('#ff4800', 0),
            ],
        }));

        // 光敏管端蓝白受光晕
        this._glowGroup.add(new Konva.Circle({
            x: trCx, y: cy, radius: r * (0.8 + 0.3 * br),
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndRadius:   r * (0.8 + 0.3 * br),
            fillRadialGradientColorStops:  [
                0,   this._rgba('#80c8ff', 0.35 * br),
                0.5, this._rgba('#4090ff', 0.12 * br),
                1,   this._rgba('#4090ff', 0),
            ],
        }));
    }

    // ── 外部引脚 ─────────────────────────────
    _drawPins() {
        const pkgX  = this._pkgX, pkgW  = this._pkgW;
        const cy    = this._cy;
        const pinH  = this._pinGapY;
        const pinL  = this._pinLen;
        const pW    = this._pinW;
        const pin1Y = cy - pinH;
        const pin2Y = cy + pinH;

        const metalGrad = (isHoriz) => isHoriz ? {
            fillLinearGradientStartPoint: { x: 0, y: -pW },
            fillLinearGradientEndPoint:   { x: 0, y:  pW },
            fillLinearGradientColorStops: [0,'#7a8088', 0.5,'#d0d4d8', 1,'#7a8088'],
        } : {
            fillLinearGradientStartPoint: { x: -pW, y: 0 },
            fillLinearGradientEndPoint:   { x:  pW, y: 0 },
            fillLinearGradientColorStops: [0,'#7a8088', 0.5,'#d0d4d8', 1,'#7a8088'],
        };

        // 左侧引脚（pin1 上, pin2 下）
        [pin1Y, pin2Y].forEach(py => {
            this.group.add(new Konva.Rect({
                x: pkgX - pinL, y: py - pW/2,
                width: pinL, height: pW,
                ...metalGrad(true),
                stroke: '#606468', strokeWidth: 0.4,
            }));
        });

        // 右侧引脚（pin4 上, pin3 下）
        [pin1Y, pin2Y].forEach(py => {
            this.group.add(new Konva.Rect({
                x: pkgX + pkgW, y: py - pW/2,
                width: pinL, height: pW,
                ...metalGrad(true),
                stroke: '#606468', strokeWidth: 0.4,
            }));
        });

        // 引脚末端圆头
        const allPins = [
            { x: pkgX - pinL, y: pin1Y },
            { x: pkgX - pinL, y: pin2Y },
            { x: pkgX + pkgW + pinL, y: pin1Y },
            { x: pkgX + pkgW + pinL, y: pin2Y },
        ];
        allPins.forEach(({ x, y }) => {
            this.group.add(new Konva.Circle({
                x, y, radius: pW * 1.3,
                fill: '#b8bcc0', stroke: '#8a8e92', strokeWidth: 0.5,
            }));
        });
    }

    // ── 封装外壳（DIP-4 黑色矩形）────────────
    _drawPackage() {
        const px = this._pkgX, py = this._pkgY;
        const pw = this._pkgW, ph = this._pkgH;

        // 外壳主体（黑色环氧）
        this.group.add(new Konva.Rect({
            x: px, y: py, width: pw, height: ph,
            fillLinearGradientStartPoint: { x: 0,  y: 0  },
            fillLinearGradientEndPoint:   { x: pw, y: ph },
            fillLinearGradientColorStops: [
                0, '#2c2c30', 0.45, '#1a1a1e', 0.55, '#1a1a1e', 1, '#28282c',
            ],
            stroke: '#3a3a40', strokeWidth: 1.2,
            cornerRadius: 3,
            shadowColor: '#000', shadowBlur: 6, shadowOffsetY: 2, shadowOpacity: 0.35,
        }));

        // 顶部高光（金属质感）
        this.group.add(new Konva.Rect({
            x: px + 2, y: py + 2, width: pw - 4, height: ph * 0.06,
            fill: 'rgba(255,255,255,0.07)', cornerRadius: [3, 3, 0, 0],
        }));

        // Pin-1 定位凹口（左上角半圆）
        this.group.add(new Konva.Arc({
            x: px + pw * 0.5, y: py,
            innerRadius: 0, outerRadius: pw * 0.07,
            angle: 180, rotation: 0,
            fill: '#111114', stroke: '#2a2a2e', strokeWidth: 0.8,
        }));

        // 封装体顶部型号丝印
        this.group.add(new Konva.Text({
            x: px, y: py + ph * 0.08,
            width: pw, text: this.label,
            fontSize: Math.max(8, pw * 0.095), fontStyle: 'bold',
            fill: '#c8d0d8', align: 'center',
        }));

        // 封装体底部参数丝印
        this.group.add(new Konva.Text({
            x: px, y: py + ph * 0.82,
            width: pw,
            text: `CTR ${this.ctr}%`,
            fontSize: 8, fill: '#7a8590', align: 'center',
        }));
    }

    // ── 电气隔离屏障 ─────────────────────────
    _drawIsolationBarrier() {
        const cx = this._cx;
        const py = this._pkgY, ph = this._pkgH;

        // 隔离虚线（中央竖线）
        this.group.add(new Konva.Line({
            points: [cx, py + ph*0.14, cx, py + ph*0.86],
            stroke: '#455a64',
            strokeWidth: 1.0,
            dash: [4, 3],
            lineCap: 'round',
        }));

        // 隔离电压标注
        this.group.add(new Konva.Text({
            x: cx - 20, y: py + ph * 0.88,
            width: 40, text: `${this.viso}V`,
            fontSize: 7, fill: '#546e7a', align: 'center',
        }));
        this.group.add(new Konva.Text({
            x: cx - 20, y: py + ph * 0.94,
            width: 40, text: 'ISO',
            fontSize: 6.5, fill: '#455a64', align: 'center',
        }));
    }

    // ── IR LED 电路符号 ───────────────────────
    _drawIrLedSymbol() {
        const cx = this._ledCx, cy = this._symCy;
        const r  = this._pkgH * 0.18;   // 三角形尺寸参考半径
        const lw = 1.3;

        const col = '#d4785a';  // 红外 LED 颜色（橙红）

        // 竖向引线（连接封装顶底到引脚）
        this.group.add(new Konva.Line({
            points: [cx, cy - r*1.6, cx, cy - r],
            stroke: col, strokeWidth: lw, lineCap: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [cx, cy + r, cx, cy + r*1.6],
            stroke: col, strokeWidth: lw, lineCap: 'round',
        }));

        // 连接到引脚的水平线
        const pin1Y = cy - this._pinGapY;
        const pin2Y = cy + this._pinGapY;
        this.group.add(new Konva.Line({
            points: [this._pkgX, pin1Y, cx, pin1Y, cx, cy - r*1.6],
            stroke: col, strokeWidth: lw, lineCap: 'round', lineJoin: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [this._pkgX, pin2Y, cx, pin2Y, cx, cy + r*1.6],
            stroke: col, strokeWidth: lw, lineCap: 'round', lineJoin: 'round',
        }));

        // 二极管三角形（向下指：阳极在上）
        this.group.add(new Konva.Line({
            points: [cx - r, cy - r, cx + r, cy - r, cx, cy + r, cx - r, cy - r],
            closed: true,
            fill: this._rgba('#c06840', 0.20),
            stroke: col, strokeWidth: lw,
        }));

        // 阴极横线
        this.group.add(new Konva.Line({
            points: [cx - r*1.1, cy + r, cx + r*1.1, cy + r],
            stroke: col, strokeWidth: lw + 0.4, lineCap: 'round',
        }));

        // 两条辐射箭头（红外光线，右上斜 45°）
        const arrowBase = { x: cx + r*0.7, y: cy - r*0.1 };
        for (let i = 0; i < 2; i++) {
            const offset = i * r * 0.55;
            const ax1 = arrowBase.x + offset * 0.3;
            const ay1 = arrowBase.y - offset;
            const ax2 = ax1 + r * 0.75;
            const ay2 = ay1 - r * 0.75;
            // 箭头线段
            this.group.add(new Konva.Line({
                points: [ax1, ay1, ax2, ay2],
                stroke: col, strokeWidth: 1.0, lineCap: 'round',
            }));
            // 箭头头部（小三角）
            const angle = -Math.PI / 4;
            const hw = r * 0.18;
            this.group.add(new Konva.Line({
                points: [
                    ax2, ay2,
                    ax2 - hw * Math.cos(angle - 0.5), ay2 - hw * Math.sin(angle - 0.5),
                    ax2 - hw * Math.cos(angle + 0.5), ay2 - hw * Math.sin(angle + 0.5),
                    ax2, ay2,
                ],
                closed: true,
                fill: col, stroke: col, strokeWidth: 0.5,
            }));
        }

        // 'IR LED' 标注
        this.group.add(new Konva.Text({
            x: cx - 18, y: cy + r*1.65,
            text: 'IR LED', fontSize: 7.5, fill: '#8a9098', fontStyle: 'bold',
        }));
    }

    // ── 光敏晶体管符号 ────────────────────────
    _drawPhototransistorSymbol() {
        const cx = this._trCx, cy = this._symCy;
        const r  = this._pkgH * 0.18;
        const lw = 1.3;
        const col = '#5a8ad4';  // 蓝色（光敏管）

        const pin4Y = cy - this._pinGapY;
        const pin3Y = cy + this._pinGapY;

        // 集电极连线（引脚 4 → 符号顶）
        this.group.add(new Konva.Line({
            points: [this._pkgX + this._pkgW, pin4Y, cx, pin4Y, cx, cy - r],
            stroke: col, strokeWidth: lw, lineCap: 'round', lineJoin: 'round',
        }));

        // 发射极连线（符号底 → 引脚 3）
        this.group.add(new Konva.Line({
            points: [cx, cy + r, cx, pin3Y, this._pkgX + this._pkgW, pin3Y],
            stroke: col, strokeWidth: lw, lineCap: 'round', lineJoin: 'round',
        }));

        // 圆形外壳
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 1.05,
            stroke: col, strokeWidth: lw,
            fill: this._rgba('#2040a0', 0.10),
        }));

        // 基极竖线（BJT 基极，无引脚连接，仅绘制内部线）
        this.group.add(new Konva.Line({
            points: [cx - r*0.55, cy - r*0.65, cx - r*0.55, cy + r*0.65],
            stroke: col, strokeWidth: lw + 0.4, lineCap: 'round',
        }));

        // 集电极斜线（从基极线上端 → 集电极引线）
        this.group.add(new Konva.Line({
            points: [cx - r*0.55, cy - r*0.38, cx, cy - r*0.8],
            stroke: col, strokeWidth: lw, lineCap: 'round',
        }));

        // 发射极斜线（带箭头，NPN 方向向外）
        this.group.add(new Konva.Line({
            points: [cx - r*0.55, cy + r*0.38, cx, cy + r*0.8],
            stroke: col, strokeWidth: lw, lineCap: 'round',
        }));
        // 发射极箭头（NPN，向右下）
        const eAngle = Math.PI / 4 + 0.15;
        const hw = r * 0.22;
        this.group.add(new Konva.Line({
            points: [
                cx, cy + r*0.80,
                cx - hw * Math.cos(eAngle - 0.45), cy + r*0.80 - hw * Math.sin(eAngle - 0.45),
                cx - hw * Math.cos(eAngle + 0.45), cy + r*0.80 - hw * Math.sin(eAngle + 0.45),
                cx, cy + r*0.80,
            ],
            closed: true, fill: col, stroke: col, strokeWidth: 0.5,
        }));

        // 两条入射光箭头（左上斜 → 基极方向）
        const arBase = { x: cx - r*1.05, y: cy - r*0.35 };
        for (let i = 0; i < 2; i++) {
            const offset = i * r * 0.50;
            const ax1 = arBase.x - r * 0.55;
            const ay1 = arBase.y - offset - r * 0.10;
            const ax2 = arBase.x + r * 0.05;
            const ay2 = arBase.y - offset * 0.1 + r * 0.15;
            this.group.add(new Konva.Line({
                points: [ax1, ay1, ax2, ay2],
                stroke: '#ff9040', strokeWidth: 1.0, lineCap: 'round',
            }));
            const aAngle = Math.atan2(ay2 - ay1, ax2 - ax1);
            const ahw = r * 0.17;
            this.group.add(new Konva.Line({
                points: [
                    ax2, ay2,
                    ax2 - ahw * Math.cos(aAngle - 0.45), ay2 - ahw * Math.sin(aAngle - 0.45),
                    ax2 - ahw * Math.cos(aAngle + 0.45), ay2 - ahw * Math.sin(aAngle + 0.45),
                    ax2, ay2,
                ],
                closed: true, fill: '#ff9040', stroke: '#ff9040', strokeWidth: 0.5,
            }));
        }

        // '光晶体管' 标注
        this.group.add(new Konva.Text({
            x: cx - 22, y: cy + r*1.65,
            text: '光晶体管', fontSize: 7.5, fill: '#8a9098', fontStyle: 'bold',
        }));
    }

    // ── 内部光束粒子层（动态）────────────────
    _drawBeamLayer() {
        this._beamGroup = new Konva.Group();
        this.group.add(this._beamGroup);
        this._rebuildBeam();
    }

    _rebuildBeam() {
        this._beamGroup.destroyChildren();
        const br = this._intensity;
        if (br <= 0.01) return;

        const x1  = this._ledCx + this._pkgH * 0.20;   // 光束起点 X
        const x2  = this._trCx  - this._pkgH * 0.20;   // 光束终点 X
        const cy  = this._symCy;
        const beamW = this._pkgH * 0.06;                // 光束半宽

        // 光束通道底色（中心渐变条带）
        this._beamGroup.add(new Konva.Rect({
            x: x1, y: cy - beamW,
            width: x2 - x1, height: beamW * 2,
            fillLinearGradientStartPoint: { x: 0, y: -beamW },
            fillLinearGradientEndPoint:   { x: 0, y:  beamW },
            fillLinearGradientColorStops: [
                0,   this._rgba('#ff6820', 0),
                0.3, this._rgba('#ff7030', 0.14 * br),
                0.5, this._rgba('#ffaa60', 0.22 * br),
                0.7, this._rgba('#ff7030', 0.14 * br),
                1,   this._rgba('#ff6820', 0),
            ],
        }));

        // 粒子流（根据 _beamPhase 偏移，形成流动感）
        const particleCount = 6;
        const beamLen = x2 - x1;
        for (let i = 0; i < particleCount; i++) {
            // 每颗粒子沿光束方向匀速移动，用相位取模实现循环
            const t = ((i / particleCount) + this._beamPhase) % 1.0;
            const px = x1 + t * beamLen;
            const py = cy + (Math.sin(t * Math.PI * 4 + i) * beamW * 0.35);
            const alpha = Math.sin(t * Math.PI) * 0.80 * br;  // 首尾淡入淡出
            const pr    = beamW * (0.4 + 0.3 * Math.sin(t * Math.PI));
            this._beamGroup.add(new Konva.Circle({
                x: px, y: py, radius: Math.max(0.5, pr),
                fill: this._rgba('#ffcc80', alpha),
                shadowColor: '#ff9040',
                shadowBlur: pr * 2,
                shadowOpacity: alpha * 0.6,
            }));
        }
    }

    // ── 引脚编号 ─────────────────────────────
    _drawPinNumbers() {
        const pkgX = this._pkgX, pkgW = this._pkgW;
        const cy   = this._cy, pinH = this._pinGapY;
        const pin1Y = cy - pinH, pin2Y = cy + pinH;
        const fz    = 9;
        const col   = '#90a4ae';

        // 左侧
        this.group.add(new Konva.Text({
            x: pkgX + 4, y: pin1Y - 12,
            text: '1', fontSize: fz, fontStyle: 'bold', fill: col,
        }));
        this.group.add(new Konva.Text({
            x: pkgX + 4, y: pin2Y + 4,
            text: '2', fontSize: fz, fontStyle: 'bold', fill: col,
        }));

        // 右侧
        this.group.add(new Konva.Text({
            x: pkgX + pkgW - 12, y: pin1Y - 12,
            text: '4', fontSize: fz, fontStyle: 'bold', fill: col,
        }));
        this.group.add(new Konva.Text({
            x: pkgX + pkgW - 12, y: pin2Y + 4,
            text: '3', fontSize: fz, fontStyle: 'bold', fill: col,
        }));

        // 引脚功能标注（A / K / C / E）
        const fnFz = 8;
        this.group.add(new Konva.Text({ x: pkgX - this._pinLen - 14, y: pin1Y - 5,
            text: 'A', fontSize: fnFz, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: pkgX - this._pinLen - 12, y: pin2Y - 5,
            text: 'K', fontSize: fnFz, fontStyle: 'bold', fill: '#ef9a9a' }));
        this.group.add(new Konva.Text({ x: pkgX + pkgW + this._pinLen + 4, y: pin1Y - 5,
            text: 'C', fontSize: fnFz, fontStyle: 'bold', fill: '#90caf9' }));
        this.group.add(new Konva.Text({ x: pkgX + pkgW + this._pinLen + 4, y: pin2Y - 5,
            text: 'E', fontSize: fnFz, fontStyle: 'bold', fill: '#90caf9' }));
    }

    // ── 位号标注 ─────────────────────────────
    _drawLabel() {
        const H = this.height;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: this.width,
            text: `${this.label}  CTR=${this.ctr}%  Viso=${this.viso}V`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
        // 底部组件名称
        this.group.add(new Konva.Text({
            x: 0, y: H - 16, width: this.width,
            text: '光耦合器', fontSize: 10, fontStyle: 'bold',
            fill: '#607d8b', align: 'center',
        }));
    }

    // ── 状态指示 ─────────────────────────────
    _drawStatusIndicator() {
        const ix = this._cx - 8;
        const iy = this._pkgY + this._pkgH * 0.50;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 3.5,
            fill:        this._on ? '#66bb6a' : '#455a64',
            stroke:      this._on ? '#2e7d32' : '#37474f',
            strokeWidth: 0.8,
            shadowColor: this._on ? '#66bb6a' : 'transparent',
            shadowBlur:  this._on ? 5 : 0,
            shadowOpacity: 0.9,
        });
        this._statusText = new Konva.Text({
            x: ix + 6, y: iy - 5,
            text: this._on ? 'ON' : 'OFF',
            fontSize: 7.5, fontStyle: 'bold',
            fill: this._on ? '#66bb6a' : '#546e7a',
        });
        this.group.add(this._statusDot, this._statusText);
    }

    // ── 点击交互 ─────────────────────────────
    _bindInteraction() {
        // 点击封装体切换导通 / 截止
        const hitTarget = this.group.findOne('Rect');
        hitTarget && hitTarget.on('click tap', () => this.toggle());

        // 更精确：绑定封装主体矩形
        this.group.getChildren().forEach(node => {
            if (node instanceof Konva.Rect &&
                node.width() === this._pkgW && node.height() === this._pkgH) {
                node.on('click tap', () => this.toggle());
                node.listening(true);
            }
        });
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        this._bindInteraction();
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickAnimation(dt);
            }
            this._lastTs = ts;
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() {
        if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
    }

    _tickAnimation(dt) {
        let dirty = false;

        // ── 开关过渡 ──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._on        = this._animDir > 0;
            }
            const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            this._intensity = this._animDir > 0 ? ease : (1 - ease);
            dirty = true;
        }

        // ── 呼吸 + 光束粒子（导通状态）──
        if (this._on && !this._animating) {
            this._breathT  += dt * this._breathSpeed;
            if (this._breathT > 2 * Math.PI) this._breathT -= 2 * Math.PI;
            this._intensity = 0.75 + 0.25 * Math.sin(this._breathT);

            this._beamPhase += dt * this._beamSpeed * 0.12;
            if (this._beamPhase > 1) this._beamPhase -= 1;
            dirty = true;
        }

        // ── 截止归零 ──
        if (!this._on && !this._animating && this._intensity > 0) {
            this._intensity = 0;
            dirty = true;
        }

        if (dirty) {
            this._rebuildGlow();
            this._rebuildBeam();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _updateStatus() {
        const on = this._on || (this._animating && this._animDir > 0 && this._intensity > 0.1);
        if (this._statusDot) {
            this._statusDot.fill(on ? '#66bb6a' : '#455a64');
            this._statusDot.stroke(on ? '#2e7d32' : '#37474f');
            this._statusDot.shadowColor(on ? '#66bb6a' : 'transparent');
            this._statusDot.shadowBlur(on ? 5 : 0);
        }
        if (this._statusText) {
            this._statusText.text(on ? 'ON' : 'OFF');
            this._statusText.fill(on ? '#66bb6a' : '#546e7a');
        }
    }

    // ═══════════════════════════════════════════
    /** 切换导通 / 截止 */
    toggle() {
        if (this._animating) return;
        this._animDir   = this._on ? -1 : 1;
        this._animT     = 0;
        this._animating = true;
        this._refreshCache();
    }

    /** 导通（输入侧加电）*/
    turnOn() {
        if (this._on || this._animating) return;
        this._animDir = 1; this._animT = 0; this._animating = true;
        this._refreshCache();
    }

    /** 截止（输入侧断电）*/
    turnOff() {
        if (!this._on || this._animating) return;
        this._animDir = -1; this._animT = 0; this._animating = true;
        this._refreshCache();
    }

    isOn()        { return this._on; }
    isAnimating() { return this._animating; }

    update(state) {
        if (typeof state === 'boolean') state ? this.turnOn() : this.turnOff();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '型号/位号',       key: 'label',       type: 'text'   },
            { label: '电流传输比 CTR(%)',key: 'ctr',         type: 'number' },
            { label: '隔离电压 (V)',     key: 'viso',        type: 'number' },
            { label: '输入电流 If (mA)', key: 'ifMax',       type: 'number' },
            { label: '输出电压 Vce (V)', key: 'vceMax',      type: 'number' },
            { label: '初始状态（通=1）', key: 'initOn',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.label  = cfg.label  || this.label;
        this.ctr    = parseFloat(cfg.ctr)    || this.ctr;
        this.viso   = parseFloat(cfg.viso)   || this.viso;
        this.ifMax  = parseFloat(cfg.ifMax)  || this.ifMax;
        this.vceMax = parseFloat(cfg.vceMax) || this.vceMax;
        if (cfg.initOn !== undefined) {
            const wantOn = !!parseInt(cfg.initOn);
            if (wantOn !== this._on) this.toggle();
        }
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }

    // ── 颜色工具 ─────────────────────────────
    _rgba(hex, alpha) {
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    }
}
