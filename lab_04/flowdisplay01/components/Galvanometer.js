import { BaseComponent } from './BaseComponent.js';

/**
 * 磁电式电流表（Moving-Coil Galvanometer）仿真组件
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  磁电式电流表（又称动圈式电流表）由以下部分组成：
 *
 *  1. 永久磁铁（Permanent Magnet）：U形蹄形磁铁，提供均匀径向磁场
 *     - N极：左侧极靴（红色）
 *     - S极：右侧极靴（蓝色）
 *  2. 圆柱铁芯（Iron Core）：固定在磁极间隙中，使磁场均匀分布
 *  3. 可动线圈（Moving Coil）：绕在铝框上，置于铁芯与极靴的环形气隙中
 *     - 线圈平面与磁场方向垂直时处于零位
 *     - 通电后因安培力（F = BIL）产生转矩
 *  4. 螺旋弹簧（Spiral Spring / Hair Spring）：
 *     - 产生与偏转角成正比的反转矩
 *     - 平衡时：转矩 = 弹簧力矩，即 BINAsinθ ≈ kθ（均匀磁场近似）
 *  5. 指针（Pointer）：固定在线圈轴上，在刻度盘前偏转
 *     - 正电流 → 右偏；反向电流 → 左偏
 *  6. 刻度盘（Scale）：弧形，标注偏转角度（−75° ～ +75°）
 *  7. 接线端子（Terminals）：A 端（+）、B 端（−），引出线圈两端
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  通电：线圈受安培力形成转矩，指针偏转
 *  平衡：安培力矩 = 弹簧复位力矩，指针静止在偏转角处
 *  断电：弹簧将指针拉回零位（带阻尼振荡）
 *
 *  物理模型：二阶弹簧-阻尼系统
 *    α̈ = (τ_ampere − K·α − D·α̇) / J
 *    τ_ampere ∝ current，K = 弹簧刚度，D = 阻尼系数，J = 转动惯量
 *
 *  动作过程带平滑物理仿真（二阶 ODE，Euler 积分，60fps tick）
 *
 * ── 绘制层次（从底到顶）──────────────────────────────────────
 *
 *  1. 底座 / 表壳
 *  2. 刻度盘弧线
 *  3. 永久磁铁（左右两块 + 极靴）
 *  4. 铁芯
 *  5. 螺旋弹簧（随角度变形）
 *  6. 线圈（随角度旋转）— 动态层
 *  7. 安培力矢量箭头（有电流时显示）— 动态层
 *  8. 指针 + 轴心
 *  9. 接线端子 + 引出线
 * 10. 标注文字
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_a — A 端（正极，左下）
 *  terminal_b — B 端（负极，右下）
 *
 * ── 额定参数 ─────────────────────────────────────────────────
 *  fullScaleCurrent  满偏电流 (μA / mA / A，单位由 unit 指定)
 *  internalResistance 内阻 (Ω)
 *  damping           阻尼系数（0.3 = 欠阻尼 | 0.707 = 临界 | 1.0+ = 过阻尼）
 */
export class Galvanometer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this._initGroups();
        this.width  = Math.max(220, config.width  || 280);
        this.height = Math.max(260, config.height || 320);

        this.type    = 'galvanometer';
        this.special = 'none';
        this.cache   = 'fixed';   // 需要逐帧重绘

        // ── 额定参数 ──
        this.label             = config.label             || 'PA';
        this.fullScaleCurrent  = config.fullScaleCurrent  || 100;      // 满偏电流
        this.unit              = config.unit              || 'μA';     // 电流单位
        this.internalResistance= config.internalResistance|| 200;      // Ω
        this.maxAngleDeg       = config.maxAngleDeg       || 75;       // 最大偏转角(°)

        // ── 物理参数 ──
        this._springK  = config.springK  || 2.8;   // 弹簧刚度
        this._damping  = config.damping  || 0.85;  // 阻尼系数
        this._inertia  = config.inertia  || 1.2;   // 转动惯量

        // ── 状态 ──
        this._current      = 0;         // 当前电流（占满偏的比例，−1 ~ +1）
        this._targetCurrent= 0;
        this._pointerAngle = 0;         // 当前偏转角（rad）
        this._angularVel   = 0;         // 角速度（rad/s）
        this._maxAngle     = this.maxAngleDeg * Math.PI / 180;

        // ── 几何布局 ──
        const W = this.width, H = this.height;

        this._cx = W * 0.50;
        this._cy = H * 0.50;

        // 磁铁
        this._magnetW  = W * 0.18;
        this._magnetH  = H * 0.55;
        this._gapHalf  = W * 0.24;     // 气隙半宽

        // 铁芯
        this._ironR    = W * 0.135;

        // 线圈
        this._coilW    = W * 0.085;
        this._coilH    = H * 0.230;

        // 螺旋弹簧
        this._springR  = W * 0.100;

        // 指针
        this._pointerLen = H * 0.360;

        // 刻度盘弧半径
        this._scaleR   = H * 0.440;

        // 底座
        this._base = {
            x: W * 0.04, y: H * 0.88,
            w: W * 0.92, h: H * 0.09,
            rx: 4,
        };

        // ── 端子位置 ──
        const termY = this._base.y + this._base.h + 4;
        this._termAx = this._cx - W * 0.14;
        this._termBx = this._cx + W * 0.14;
        this._termY  = termY;

        this._init();

        this.addPort(this._termAx, termY, 'terminal_a', 'wire', 'A+');
        this.addPort(this._termBx, termY, 'terminal_b', 'wire', 'B−');
    }

    // ═══════════════════════════════════════════════════════════
    _init() {
        this._drawBase();
        this._drawScaleArc();
        this._drawMagnets();
        this._drawIronCore();
        this._drawStaticLabels();
        this._drawStatusIndicator();
        this._rebuildDynamic();
    }

    // ── 底座 / 表壳 ─────────────────────────────────────────
    _drawBase() {
        const W = this.width, H = this.height;
        const b = this._base;

        // 外壳背景
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.95,
            fill: '#1e1e22', stroke: '#2a2a30', strokeWidth: 1.5,
            cornerRadius: 8,
            shadowColor: '#000', shadowBlur: 6, shadowOffsetY: 3, shadowOpacity: 0.35,
        }));
        // 表面内嵌浅色区域（刻度盘背景）
        this._staticGroup.add(new Konva.Rect({
            x: W * 0.06, y: H * 0.04,
            width: W * 0.88, height: H * 0.80,
            fill: '#f5f3ec', stroke: '#c8c4b0', strokeWidth: 0.8,
            cornerRadius: 5,
        }));
        // 底座
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#2a2a2e', stroke: '#3a3a40', strokeWidth: 1.2,
            cornerRadius: b.rx,
        }));
        // 底座螺钉
        [0.20, 0.50, 0.80].forEach(fx => {
            const sx = b.x + b.w * fx;
            const sy = b.y + b.h / 2;
            const sr = W * 0.025;
            this._staticGroup.add(new Konva.Circle({ x: sx, y: sy, radius: sr, fill: '#888', stroke: '#555', strokeWidth: 0.8 }));
            this._staticGroup.add(new Konva.Line({ points: [sx-sr*0.6, sy, sx+sr*0.6, sy], stroke: '#444', strokeWidth: 1.1, lineCap: 'round' }));
            this._staticGroup.add(new Konva.Line({ points: [sx, sy-sr*0.6, sx, sy+sr*0.6], stroke: '#444', strokeWidth: 1.1, lineCap: 'round' }));
        });
    }

    // ── 刻度盘弧线 ───────────────────────────────────────────
    _drawScaleArc() {
        const cx = this._cx, cy = this._cy;
        const R  = this._scaleR;
        const maxDeg = this.maxAngleDeg;

        // 弧形背景条
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R - 8, outerRadius: R + 8,
            angle: maxDeg * 2,
            rotation: -(90 + maxDeg),
            fill: '#e0ddd0',
        }));

        // 刻度线 + 数字
        const ticks = [];
        for (let d = -maxDeg; d <= maxDeg; d += 5) ticks.push(d);
        const scaleGroup = new Konva.Group();

        ticks.forEach(deg => {
            const isMajor  = deg % 15 === 0;
            const isMid    = deg % 10 === 0 && !isMajor;
            const tLen     = isMajor ? 12 : (isMid ? 8 : 5);
            const rad      = (deg - 90) * Math.PI / 180;
            const x1 = cx + R * Math.cos(rad);
            const y1 = cy + R * Math.sin(rad);
            const x2 = cx + (R + tLen) * Math.cos(rad);
            const y2 = cy + (R + tLen) * Math.sin(rad);

            scaleGroup.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: isMajor ? '#444' : '#888',
                strokeWidth: isMajor ? 1.5 : 0.8,
            }));

            if (isMajor) {
                const lx = cx + (R + 22) * Math.cos(rad);
                const ly = cy + (R + 22) * Math.sin(rad);
                scaleGroup.add(new Konva.Text({
                    x: lx - 16, y: ly - 8, width: 32, height: 16,
                    text: String(deg),
                    fontSize: 9, fontStyle: 'bold', fill: '#444',
                    align: 'center', verticalAlign: 'middle',
                }));
            }
        });

        // 零刻度红线
        const zrad = -Math.PI / 2;
        scaleGroup.add(new Konva.Line({
            points: [
                cx + (R - 10) * Math.cos(zrad), cy + (R - 10) * Math.sin(zrad),
                cx + (R + 14) * Math.cos(zrad), cy + (R + 14) * Math.sin(zrad),
            ],
            stroke: '#e03030', strokeWidth: 1.8,
        }));

        // 单位标注
        scaleGroup.add(new Konva.Text({
            x: cx - 30, y: cy - R - 36, width: 60,
            text: this.unit, fontSize: 9, fill: '#555', align: 'center',
        }));

        this._staticGroup.add(scaleGroup);
    }

    // ── 永久磁铁（左右各一，带极靴）────────────────────────
    _drawMagnets() {
        const cx = this._cx, cy = this._cy;
        const mw = this._magnetW, mh = this._magnetH;
        const gp = this._gapHalf;

        // 左极（N）
        this._drawMagnetBody(cx - gp - mw, cy - mh / 2, mw, mh, 'N', true);
        // 右极（S）
        this._drawMagnetBody(cx + gp,      cy - mh / 2, mw, mh, 'S', false);

        // 磁场方向箭头（从N极到S极，气隙中）
        this._drawFieldArrows();
    }

    _drawMagnetBody(x, y, w, h, label, isN) {
        const brassN = ['#7a3030', '#c04040', '#e06060', '#b04040', '#7a3030'];
        const brassS = ['#303070', '#4060c0', '#6080e0', '#4060b0', '#303070'];
        const stops  = isN ? brassN : brassS;

        // 主体
        const body = new Konva.Rect({
            x, y, width: w, height: h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: w, y: 0 },
            fillLinearGradientColorStops: [
                0, stops[0], 0.25, stops[1], 0.55, stops[2], 0.80, stops[3], 1, stops[4],
            ],
            stroke: isN ? '#882020' : '#202080',
            strokeWidth: 1.2, cornerRadius: 4,
        });
        this._staticGroup.add(body);

        // 字母标注
        this._staticGroup.add(new Konva.Text({
            x, y: y + h / 2 - 12, width: w,
            text: label, fontSize: 18, fontStyle: 'bold',
            fill: '#fff', align: 'center',
            shadowColor: '#000', shadowBlur: 3, shadowOpacity: 0.4,
        }));

        // 极靴（内侧弧形）
        const poleH   = h * 0.28;
        const poleW   = w * 0.36;
        const poleX   = isN ? x + w - poleW : x;
        const poleCol = isN ? '#c83030' : '#3050c0';

        this._staticGroup.add(new Konva.Rect({
            x: poleX, y, width: poleW, height: poleH,
            fill: poleCol, stroke: isN ? '#902020' : '#203090',
            strokeWidth: 0.8, cornerRadius: isN ? [0,3,3,0] : [3,0,0,3],
        }));
        this._staticGroup.add(new Konva.Rect({
            x: poleX, y: y + h - poleH, width: poleW, height: poleH,
            fill: poleCol, stroke: isN ? '#902020' : '#203090',
            strokeWidth: 0.8, cornerRadius: isN ? [0,3,3,0] : [3,0,0,3],
        }));

        // 极靴标注
        this._staticGroup.add(new Konva.Text({
            x: x - (isN ? 0 : 4), y: y + h + 6, width: w + 4,
            text: isN ? 'N极' : 'S极',
            fontSize: 8, fill: isN ? '#c04040' : '#4060c0', align: 'center',
        }));
    }

    _drawFieldArrows() {
        const cx = this._cx, cy = this._cy;
        const gp = this._gapHalf;
        const mw = this._magnetW;
        const nLines = 5;

        for (let i = 0; i < nLines; i++) {
            const t  = (i / (nLines - 1)) - 0.5;
            const ay = cy + t * this._magnetH * 0.45;
            const x1 = cx - gp - mw * 0.05;
            const x2 = cx + gp + mw * 0.05;

            this._staticGroup.add(new Konva.Line({
                points: [x1, ay, x2, ay],
                stroke: 'rgba(180,60,120,0.20)',
                strokeWidth: 1.2,
            }));
            // 箭头头
            this._staticGroup.add(new Konva.Line({
                points: [x2 - 9, ay - 5, x2, ay, x2 - 9, ay + 5],
                stroke: 'rgba(180,60,120,0.25)',
                strokeWidth: 1.2, lineCap: 'round', lineJoin: 'round',
            }));
        }

        // 磁场标注
        this._staticGroup.add(new Konva.Text({
            x: cx - 20, y: cy + this._magnetH / 2 - 6,
            text: 'B', fontSize: 10, fontStyle: 'bold italic',
            fill: 'rgba(160,50,100,0.55)',
        }));
    }

    // ── 圆柱铁芯 ─────────────────────────────────────────────
    _drawIronCore() {
        const cx = this._cx, cy = this._cy;
        const r  = this._ironR;

        const grd = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: -r * 0.25, y: -r * 0.25 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.15,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, '#d0d0d0', 0.6, '#909090', 1, '#505050'],
            stroke: '#666', strokeWidth: 1,
        });
        this._staticGroup.add(grd);

        // 铁芯高光
        this._staticGroup.add(new Konva.Ellipse({
            x: cx - r * 0.28, y: cy - r * 0.28,
            radiusX: r * 0.22, radiusY: r * 0.15,
            fill: 'rgba(255,255,255,0.20)',
            rotation: -30,
        }));

        this._staticGroup.add(new Konva.Text({
            x: cx - 14, y: cy + r + 6, width: 28,
            text: '铁芯', fontSize: 8, fill: '#888', align: 'center',
        }));
    }

    // ── 静态标注 ─────────────────────────────────────────────
    _drawStaticLabels() {
        const W = this.width;

        // 位号 + 额定值
        this._staticGroup.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  ${this.fullScaleCurrent}${this.unit}  r=${this.internalResistance}Ω`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));

        // 端子标注
        this._staticGroup.add(new Konva.Text({
            x: this._termAx - 8, y: this._termY - 2,
            text: 'A+', fontSize: 8, fill: '#ef9a9a', fontStyle: 'bold',
        }));
        this._staticGroup.add(new Konva.Text({
            x: this._termBx + 2, y: this._termY - 2,
            text: 'B−', fontSize: 8, fill: '#90caf9', fontStyle: 'bold',
        }));

        // 接线端子实体
        [
            { x: this._termAx, col: '#ef9a9a' },
            { x: this._termBx, col: '#90caf9' },
        ].forEach(({ x, col }) => {
            this._staticGroup.add(new Konva.Rect({
                x: x - 7, y: this._termY + 8,
                width: 14, height: 10,
                fill: '#2a2a2e', stroke: col, strokeWidth: 1.2, cornerRadius: 2,
            }));
        });
    }

    // ── 状态指示 ─────────────────────────────────────────────
    _drawStatusIndicator() {
        const b  = this._base;
        const ix = b.x + 10, iy = b.y + b.h / 2;

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: '#ef5350', stroke: '#c62828', strokeWidth: 0.8,
            shadowColor: '#ef5350', shadowBlur: 2, shadowOpacity: 0.6,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text: '0', fontSize: 8, fontStyle: 'bold', fill: '#ef5350',
        });
        this._staticGroup.add(this._statusDot, this._statusText);
    }

    // ═══════════════════════════════════════════════════════════
    // 动态层（线圈 + 弹簧 + 指针 + 安培力箭头）
    // ═══════════════════════════════════════════════════════════

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        const angle = this._pointerAngle; // rad，正 = 右偏

        this._drawSpring(angle);
        this._drawCoil(angle);
        this._drawForceArrows(angle);
        this._drawPointer(angle);
        this._drawLeadWires(angle);
    }

    // ── 螺旋弹簧（盘绕形） ────────────────────────────────
    _drawSpring(angle) {
        const cx = this._cx, cy = this._cy;
        const R  = this._springR;
        const nTurns = 4;
        const tension = Math.abs(angle) / this._maxAngle;
        const color   = tension > 0.75
            ? '#d06010'
            : (tension > 0.4 ? '#1D9E75' : '#1D9E75');

        const points = [];
        const totalPts = nTurns * 60;
        for (let i = 0; i <= totalPts; i++) {
            const t = i / totalPts;
            const r = R * (0.55 + 0.45 * t);
            const a = -Math.PI / 2 + t * nTurns * Math.PI * 2 + angle * 0.55;
            points.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }

        this._dynamicGroup.add(new Konva.Line({
            points,
            stroke: color,
            strokeWidth: 1.4,
            lineJoin: 'round',
            lineCap:  'round',
            opacity:  0.4 + tension * 0.5,
        }));

        // 弹簧固定端小圆
        const aEnd = -Math.PI / 2 + angle * 0.55;
        const rx   = cx + R * 0.55 * Math.cos(aEnd);
        const ry   = cy + R * 0.55 * Math.sin(aEnd);
        this._dynamicGroup.add(new Konva.Circle({
            x: rx, y: ry, radius: 2.5, fill: color, opacity: 0.8,
        }));

        // 标注
        this._dynamicGroup.add(new Konva.Text({
            x: cx + R + 4,
            y: cy - R - 2,
            text: '螺旋弹簧', fontSize: 8, fill: '#666',
        }));
    }

    // ── 可动线圈 ─────────────────────────────────────────────
    _drawCoil(angle) {
        const cx = this._cx, cy = this._cy;
        const cw = this._coilW, ch = this._coilH;
        const I  = this._current;
        const coilOpacity = 0.5 + Math.min(0.5, Math.abs(I) * 0.6);

        const g = new Konva.Group({ x: cx, y: cy, rotation: angle * 180 / Math.PI });

        // 线圈铝框
        g.add(new Konva.Rect({
            x: -cw / 2, y: -ch / 2,
            width: cw, height: ch,
            fillLinearGradientStartPoint: { x: -cw / 2, y: 0 },
            fillLinearGradientEndPoint:   { x:  cw / 2, y: 0 },
            fillLinearGradientColorStops: [
                0, '#6a5520', 0.35, '#c8a040',
                0.65, '#e8c060', 1, '#6a5520',
            ],
            stroke: '#7a6528', strokeWidth: 0.8,
            cornerRadius: 2,
            opacity: coilOpacity,
        }));

        // 绕线匝数纹
        const lineGroup = new Konva.Group({ opacity: coilOpacity * 0.55 });
        for (let yy = -ch / 2 + 5; yy < ch / 2 - 3; yy += 4.5) {
            lineGroup.add(new Konva.Line({
                points: [-cw / 2 + 2, yy, cw / 2 - 2, yy],
                stroke: '#7a6528', strokeWidth: 0.7,
            }));
        }
        g.add(lineGroup);

        // 根部固定块（与铁芯轴连接）
        g.add(new Konva.Rect({
            x: -cw * 0.35, y: -cw * 0.8,
            width: cw * 0.70, height: cw * 1.6,
            fill: '#b89040', stroke: '#8a6820', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 电流方向指示（有电流时）
        if (Math.abs(I) > 0.05) {
            const dir = I > 0 ? 1 : -1;
            const arrColor = I > 0 ? '#E24B4A' : '#378ADD';
            const arrAlpha = Math.min(0.9, Math.abs(I) * 0.7 + 0.25);
            const arrLen   = ch * 0.25;
            const arrY     = ch / 2 - 14;

            // 左侧导线电流方向
            [[-cw / 2 + 3, dir], [cw / 2 - 3, -dir]].forEach(([xp, d]) => {
                const ya = d > 0 ? -arrY : arrY;
                const yb = d > 0 ? -(arrY - arrLen) : (arrY - arrLen);
                g.add(new Konva.Arrow({
                    points: [xp, ya, xp, yb],
                    stroke: arrColor, fill: arrColor,
                    strokeWidth: 1.5,
                    pointerLength: 6, pointerWidth: 5,
                    opacity: arrAlpha,
                }));
            });
        }

        // 导通发光（电流较大时）
        if (Math.abs(I) > 0.4) {
            g.add(new Konva.Rect({
                x: -cw / 2 - 2, y: -ch / 2 - 2,
                width: cw + 4, height: ch + 4,
                fill: I > 0 ? 'rgba(255,140,30,0.14)' : 'rgba(60,130,255,0.14)',
                cornerRadius: 3,
            }));
        }

        this._dynamicGroup.add(g);

        // 标注（线圈外侧）
        const labelAngle = angle - Math.PI / 2;
        const lx = cx + (this._ironR + cw) * Math.cos(labelAngle) - 16;
        const ly = cy + (this._ironR + cw) * Math.sin(labelAngle) - 6;
        this._dynamicGroup.add(new Konva.Text({
            x: cx - 14, y: cy - this._ironR - this._coilH / 2 - 18,
            text: '线圈', fontSize: 8, fill: '#888',
        }));
    }

    // ── 安培力矢量箭头 ────────────────────────────────────
    _drawForceArrows(angle) {
        const I = this._current;
        if (Math.abs(I) < 0.08) return;

        const cx  = this._cx, cy = this._cy;
        const cw  = this._coilW, ch = this._coilH;
        const dir = I > 0 ? 1 : -1;
        const len = (22 + Math.abs(I) * 18);
        const col = '#E24B4A';

        const g = new Konva.Group({
            x: cx, y: cy,
            rotation: angle * 180 / Math.PI,
            opacity: Math.min(0.9, Math.abs(I) * 0.8 + 0.2),
        });

        const topY = -ch / 2 + 8;
        const botY =  ch / 2 - 8;
        const xOff = cw / 2 + 6;

        // 顶部：向某方向（dir）
        g.add(new Konva.Arrow({
            points: [-dir * xOff, topY, -dir * (xOff + len), topY],
            stroke: col, fill: col, strokeWidth: 2,
            pointerLength: 7, pointerWidth: 6,
        }));
        // 底部：反向
        g.add(new Konva.Arrow({
            points: [dir * xOff, botY, dir * (xOff + len), botY],
            stroke: col, fill: col, strokeWidth: 2,
            pointerLength: 7, pointerWidth: 6,
        }));

        // F 标签
        g.add(new Konva.Text({
            x: -dir * (xOff + len) - 6,
            y: topY - 14,
            text: 'F', fontSize: 11, fontStyle: 'bold italic', fill: col,
        }));

        this._dynamicGroup.add(g);
    }

    // ── 指针 ─────────────────────────────────────────────────
    _drawPointer(angle) {
        const cx = this._cx, cy = this._cy;
        const PL = this._pointerLen;

        // 转换：angle 为绕 cy 的偏转，零位指向正上方（−π/2）
        const g = new Konva.Group({
            x: cx, y: cy,
            rotation: (angle - Math.PI / 2) * 180 / Math.PI,
        });

        // 指针杆
        g.add(new Konva.Line({
            points: [0, 14, 0, -PL + 10],
            stroke: '#a08020', strokeWidth: 3,
            lineCap: 'round',
        }));
        // 指针尖（细三角）
        g.add(new Konva.Line({
            points: [0, -PL, 3, -PL + 14, -3, -PL + 14],
            stroke: '#d4aa00', fill: '#d4aa00', strokeWidth: 0.5,
            closed: true,
        }));
        // 轻量尖高亮
        g.add(new Konva.Line({
            points: [0, -PL, 0.8, -PL + 8],
            stroke: 'rgba(255,255,200,0.6)', strokeWidth: 1, lineCap: 'round',
        }));
        // 平衡锤
        g.add(new Konva.Rect({
            x: -5, y: 8, width: 10, height: 13,
            fill: '#888', stroke: '#666', strokeWidth: 0.8, cornerRadius: 2,
        }));

        this._dynamicGroup.add(g);

        // 轴心
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 7,
            fillRadialGradientStartPoint:  { x: -2, y: -2 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: 1,
            fillRadialGradientEndRadius:   7,
            fillRadialGradientColorStops:  [0, '#e0e0e0', 1, '#888888'],
            stroke: '#888', strokeWidth: 0.8,
        }));
    }

    // ── 引出线（线圈端点到接线端子） ──────────────────────
    _drawLeadWires(angle) {
        const cx = this._cx, cy = this._cy;
        const cw = this._coilW, ch = this._coilH;
        const ta = this._termAx, tb = this._termBx;
        const ty = this._termY + 4;

        // 线圈在旋转后的端点（右下角 / 左下角，近似）
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        const ax0  = cx + (cw / 2) * cosA - (ch / 2) * sinA;
        const ay0  = cy + (cw / 2) * sinA + (ch / 2) * cosA;
        const bx0  = cx - (cw / 2) * cosA - (ch / 2) * sinA;
        const by0  = cy - (cw / 2) * sinA + (ch / 2) * cosA;

        // A端引线（红）
        this._dynamicGroup.add(new Konva.Line({
            points: [ax0, ay0, ax0, ay0 + 18, ta, ty - 18, ta, ty],
            stroke: '#E24B4A', strokeWidth: 1.5,
            lineCap: 'round', lineJoin: 'round',
            tension: 0.4,
        }));
        // B端引线（蓝）
        this._dynamicGroup.add(new Konva.Line({
            points: [bx0, by0, bx0, by0 + 18, tb, ty - 18, tb, ty],
            stroke: '#378ADD', strokeWidth: 1.5,
            lineCap: 'round', lineJoin: 'round',
            tension: 0.4,
        }));
    }

    // ═══════════════════════════════════════════════════════════
    // 物理仿真（二阶弹簧-阻尼-惯量模型）
    // ═══════════════════════════════════════════════════════════

    tick(dt) {
        this._tickPhysics(dt);
    
        this._refreshCache();
    }

    _tickPhysics(dt) {
        // 电流平滑跟随
        this._current += (this._targetCurrent - this._current) * Math.min(1, dt * 7);

        // 安培力矩（线性近似：τ_amp ∝ I·sin(90°−θ) ≈ I，均匀径向磁场）
        const targetAngle  = this._targetCurrent * this._maxAngle;
        const springTorque = -this._springK  * (this._pointerAngle - targetAngle);
        const dampTorque   = -this._damping  * this._angularVel;
        const netTorque    = springTorque + dampTorque;
        const angularAcc   = netTorque / this._inertia;

        this._angularVel   += angularAcc * dt;
        this._pointerAngle += this._angularVel * dt;

        // 硬限位
        if (this._pointerAngle >  this._maxAngle) {
            this._pointerAngle =  this._maxAngle;
            this._angularVel  *= -0.15;
        }
        if (this._pointerAngle < -this._maxAngle) {
            this._pointerAngle = -this._maxAngle;
            this._angularVel  *= -0.15;
        }

        this._rebuildDynamic();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const I   = this._targetCurrent;
        const deg = (this._pointerAngle * 180 / Math.PI).toFixed(1);
        const val = (I * this.fullScaleCurrent).toFixed(1);

        const active = Math.abs(I) > 0.02;
        if (this._statusDot) {
            this._statusDot.fill(active ? '#66bb6a' : '#ef5350');
            this._statusDot.stroke(active ? '#2e7d32' : '#c62828');
            this._statusDot.shadowColor(active ? '#66bb6a' : '#ef5350');
            this._statusDot.shadowBlur(active ? 5 : 2);
        }
        if (this._statusText) {
            this._statusText.text(active ? `${val}${this.unit}` : '0');
            this._statusText.fill(active ? '#66bb6a' : '#ef5350');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════

    /**
     * 设置电流（−1 ~ +1，相对满偏量）
     * @param {number} ratio  −1=满偏左，0=零位，+1=满偏右
     */
    setCurrent(ratio) {
        this._targetCurrent = Math.max(-1, Math.min(1, ratio));
        this._refreshCache();
    }

    /**
     * 设置电流（物理值）
     * @param {number} value  与 unit 对应的电流值（如 μA / mA）
     */
    setCurrentValue(value) {
        this.setCurrent(value / this.fullScaleCurrent);
    }

    /** 归零（缓慢弹回） */
    reset() {
        this._targetCurrent = 0;
        this._refreshCache();
    }

    /** 获取当前偏转角（度） */
    getAngleDeg()    { return this._pointerAngle * 180 / Math.PI; }

    /** 获取当前电流比例（−1 ~ +1） */
    getCurrentRatio(){ return this._current; }

    /** 获取当前电流物理值 */
    getCurrentValue(){ return this._current * this.fullScaleCurrent; }

    update(state) {
        if (typeof state === 'number') this.setCurrentValue(state);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',           key: 'label',              type: 'text'   },
            { label: '满偏电流',             key: 'fullScaleCurrent',   type: 'number' },
            { label: '电流单位(μA/mA/A)',    key: 'unit',               type: 'text'   },
            { label: '内阻 (Ω)',             key: 'internalResistance', type: 'number' },
            { label: '最大偏转角 (°)',       key: 'maxAngleDeg',        type: 'number' },
            { label: '弹簧刚度',             key: 'springK',            type: 'number' },
            { label: '阻尼系数',             key: 'damping',            type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)              this.label              = cfg.label;
        if (cfg.fullScaleCurrent)   this.fullScaleCurrent   = parseFloat(cfg.fullScaleCurrent);
        if (cfg.unit)               this.unit               = cfg.unit;
        if (cfg.internalResistance) this.internalResistance = parseFloat(cfg.internalResistance);
        if (cfg.maxAngleDeg)        this._maxAngle          = parseFloat(cfg.maxAngleDeg) * Math.PI / 180;
        if (cfg.springK)            this._springK           = parseFloat(cfg.springK);
        if (cfg.damping)            this._damping           = parseFloat(cfg.damping);
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}