import { BaseComponent } from './BaseComponent.js';

/**
 * 波登管压力表仿真组件
 * （Bourdon Tube Pressure Gauge）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  波登管压力表由以下部分组成：
 *
 *  1. 表壳（Case）：圆形金属外壳，保护内部机构
 *  2. 表盘（Dial）：白色刻度盘，印有量程刻度与单位
 *  3. 波登管（Bourdon Tube）：C形椭圆截面空心弹性管
 *     - 固定端（Inlet End）：焊接在底座接头处，通入被测流体
 *     - 自由端（Free Tip）：未固定，随压力变化产生弯曲位移
 *     - 工作原理：管内压力升高时，椭圆截面趋于圆形，
 *       管体沿弧长方向伸展，自由端向外偏移
 *  4. 连杆（Link）：将管端微小位移传递给扇形齿轮
 *  5. 扇形齿轮（Sector Gear）：放大并传递角位移，减小摩擦
 *  6. 小齿轮（Pinion）：与指针轴固连，由扇形齿轮驱动
 *  7. 游丝（Hair Spring）：消除齿轮间隙，保证回程线性
 *  8. 指针（Pointer）：固定在小齿轮轴上，指示压力读数
 *  9. 接头（Socket / Fitting）：下方螺纹接头，连接被测管路
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  升压过程：
 *    进气口压力↑ → 波登管自由端外偏 → 连杆推动扇形齿轮
 *    → 小齿轮正转 → 指针顺时针偏转
 *
 *  降压过程：
 *    压力↓ → 游丝弹力使管端回收 → 指针逆时针回零
 *
 *  仿真动画采用正弦缓动（ease in-out），时长可配置。
 *  管体颜色随压力线性从蓝（低压）渐变至橙红（高压）。
 *
 * ── 几何关系 ──────────────────────────────────────────────────
 *
 *  波登管弧心与表盘圆心偏置，C形管张角约 250°。
 *  管端最大位移 ≈ 管半径 × MAX_TIP_DEFL_RAD。
 *  连杆长度固定，通过杠杆比 SECTOR_R / PINION_R 放大角度，
 *  最终使指针在 0~270° 范围内偏转对应量程。
 *
 * ── 视角说明 ──────────────────────────────────────────────────
 *
 *  正视图（Front View）二维仿真，表盘朝向观察者，
 *  波登管、连杆、扇形齿轮均在表盘后方，以半透明方式叠加显示。
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_inlet — 进气口（接头底部中心，接被测管路）
 */
export class BourdonTube extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width = Math.max(180, config.width || 220);
        this.height = Math.max(220, config.height || 260);

        this.type = 'bourdon_tube';
        this.cache = 'fixed';

        // ── 仪表参数 ──
        this.label = config.label || 'PI';      // 位号
        this.rangeMax = config.rangeMax || 100;       // 量程上限（kPa）
        this.rangeUnit = config.rangeUnit || 'kPa';     // 单位
        this.dialDivs = config.dialDivs || 10;        // 刻度主分格数

        // ── 压力状态 ──
        this._pressure = config.initPressure || 0;      // 当前仿真压力（kPa）
        this._animating = false;
        this._animT = 0;       // 动画进度 0~1
        this._animDur = config.animDur || 0.8;         // s
        this._pressFrom = 0;       // 动画起始压力
        this._pressTo = 0;       // 动画目标压力
        this.opsCount = config.initOps || 0;

        // ── 几何常量（所有坐标相对组件左上角）──
        const W = this.width, H = this.height;

        // 表盘圆心、半径
        this._cx = W * 0.50;
        this._cy = H * 0.46;
        this._R = Math.min(W, H) * 0.40;   // 表盘外圆半径

        // 接头（表壳底部正下方）
        this._socketX = this._cx;
        this._socketY = this._cy + this._R + 4;
        this._socketW = this._R * 0.28;
        this._socketH = H * 0.14;

        // 波登管弧圆心（偏置于表盘圆心左下方）
        this._tubeCx = this._cx + this._R * 0.08;
        this._tubeCy = this._cy + this._R * 0.02;
        this._tubeR = this._R * 0.68;      // 波登管弧半径（中性线）

        // 波登管 C 形弧：从固定端角度扫到自由端角度
        // 角度定义：数学坐标系（x右为0°，逆时针为正）
        // 固定端位于底部（对应接头位置）
        this._tubeAngFixed = -Math.PI * 0.55;   // 约 -99°，指向右下（接头侧）
        this._tubeAngFree0 = -Math.PI * 0.55 + Math.PI * 1.50; // 零压时自由端角度（扫 270°）

        // 自由端最大偏转量（弧度），对应满量程（小幅旋转保持刻度读数正确）
        this._maxTipDefl = Math.PI * 0.05;

        // 曲率变化系数：满量程时管半径放大比例（模拟管体展直）
        // 0.08 为小幅变形，产生约 11px 管端位移
        this._curveScale = 0.08;

        // 连杆、齿轮（传动机构，位于表盘中下部）
        this._sectorPivotX = this._cx + this._R * 0.06;
        this._sectorPivotY = this._cy + this._R * 0.18;
        this._sectorR = this._R * 0.32;    // 扇形齿轮半径
        this._pinionR = this._R * 0.085;   // 小齿轮半径
        this._linkLen = this._R * 0.38;    // 连杆长度

        // 游丝（显示在小齿轮附近）
        this._hairCx = this._cx;
        this._hairCy = this._cy;

        // 指针轴即表盘圆心（小齿轮轴）
        this._needlePivotX = this._cx;
        this._needlePivotY = this._cy;
        this._needleLen = this._R * 0.85;
        this._needleTail = this._R * 0.18;

        // 表盘刻度角范围：-225° ~ +45°（SVG角度，顺时针为正，从x轴量）
        // 对应：0 kPa = -225°（即 135°，左偏下），满量程 = +45°（右偏上）
        this._dialAngStart = 225;   // 起始角（度），相对 SVG 坐标顺时针
        this._dialAngEnd = 315;   // 总扫角（度）


        this._init();

        // 端口：进气口（接头底部中心）
        this.addPort(
            this._socketX,
            this._socketY + this._socketH + 4,
            'i', 'pipe', 'in'
        );
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawCase();
        this._drawDial();
        this._drawSocket();
        this._drawMechanismLayer();     // 动态层：波登管 + 连杆 + 齿轮
        this._drawNeedleLayer();        // 动态层：指针
        this._drawBezel();
        this._drawCenterCap();
        this._drawLabel();
        this._drawComponentLabels();
        this._drawStatusIndicator();

    }

    // ── 表壳（仅外圈环 + 极淡底色）────────────────────────────
    _drawCase() {
        const cx = this._cx, cy = this._cy, R = this._R;

        // 极淡内部底色（仅略深于白纸，使机构有背景衬托但不会遮住）
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R - 2,
            fill: '#f5f4f0',
        }));

        // 外圈阴影
        this.group.add(new Konva.Circle({
            x: cx + 2, y: cy + 3, radius: R + 6,
            fill: 'rgba(0,0,0,0.10)',
        }));
        // 金属外圈环（用 Ring 仅画外圈，中心透明露出内部底色）
        this.group.add(new Konva.Ring({
            x: cx, y: cy,
            innerRadius: R - 4, outerRadius: R + 6,
            fillLinearGradientStartPoint: { x: -(R + 6), y: -(R + 6) },
            fillLinearGradientEndPoint: { x: (R + 6), y: (R + 6) },
            fillLinearGradientColorStops: [
                0, '#b8b8be',
                0.3, '#a0a0a8',
                0.6, '#888890',
                1, '#787880',
            ],
            stroke: '#c0c0c8', strokeWidth: 1,
        }));
        // 外圈高光弧
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R + 1, outerRadius: R + 7,
            angle: 80, rotation: -200,
            fill: 'rgba(255,255,255,0.20)',
        }));
    }

    // ── 表盘（极简刻度，突出内部机构）────────────────────────
    _drawDial() {
        const cx = this._cx, cy = this._cy, R = this._R;

        // ── 刻度线（淡化处理）──
        const divs = this.dialDivs;          // 主分格数（默认10）
        const subDivs = 5;                        // 每主格细分
        const totalTicks = divs * subDivs;

        for (let i = 0; i <= totalTicks; i++) {
            const frac = i / totalTicks;
            const angDeg = -(this._dialAngStart) + this._dialAngEnd * frac;
            const angRad = angDeg * Math.PI / 180;
            const isMajor = (i % subDivs === 0);
            const isMid = (i % subDivs === Math.floor(subDivs / 2));

            const rOuter = R * 0.94;
            const rInner = isMajor ? R * 0.80 : (isMid ? R * 0.86 : R * 0.90);
            const sw = isMajor ? 1.2 : 0.6;

            // 仅用灰色，不加红色（淡化处理）
            const col = isMajor ? '#889098' : '#b0b8c0';

            this.group.add(new Konva.Line({
                points: [
                    cx + rOuter * Math.cos(angRad),
                    cy + rOuter * Math.sin(angRad),
                    cx + rInner * Math.cos(angRad),
                    cy + rInner * Math.sin(angRad),
                ],
                stroke: col, strokeWidth: sw, lineCap: 'round',
            }));

            // 主刻度数字（淡化）
            if (isMajor) {
                const val = Math.round((i / totalTicks) * this.rangeMax);
                const rTxt = R * 0.70;
                this.group.add(new Konva.Text({
                    x: cx + rTxt * Math.cos(angRad) - 12,
                    y: cy + rTxt * Math.sin(angRad) - 6,
                    width: 24, height: 12,
                    text: String(val),
                    fontSize: Math.max(6, R * 0.085),
                    fill: '#889098',
                    align: 'center', verticalAlign: 'middle',
                }));
            }
        }

        // 量程单位（淡化）
        this.group.add(new Konva.Text({
            x: cx - R * 0.28, y: cy + R * 0.28,
            width: R * 0.56, height: 12,
            text: this.rangeUnit,
            fontSize: Math.max(6, R * 0.080),
            fill: '#a0a8b0', align: 'center',
        }));
    }

    // ── 接头（表底螺纹接口）──────────────────────────────────
    _drawSocket() {
        const sx = this._socketX, sy = this._socketY;
        const sw = this._socketW, sh = this._socketH;

        // 接头主体（黄铜色）
        this.group.add(new Konva.Rect({
            x: sx - sw / 2, y: sy,
            width: sw, height: sh * 0.65,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: sw, y: 0 },
            fillLinearGradientColorStops: [
                0, '#7a6a28',
                0.25, '#c8a842',
                0.55, '#e0c060',
                0.80, '#b08030',
                1, '#7a6a28',
            ],
            stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 六角螺母头（简化为梯形）
        this.group.add(new Konva.Rect({
            x: sx - sw * 0.65, y: sy + sh * 0.60,
            width: sw * 1.30, height: sh * 0.40,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: sw * 1.30, y: 0 },
            fillLinearGradientColorStops: [
                0, '#8a7030',
                0.5, '#d4aa48',
                1, '#8a7030',
            ],
            stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 2,
        }));

        // 螺纹纹路（3条细横线）
        for (let i = 0; i < 3; i++) {
            const ty = sy + sh * 0.12 + i * sh * 0.16;
            this.group.add(new Konva.Line({
                points: [sx - sw / 2 + 1, ty, sx + sw / 2 - 1, ty],
                stroke: 'rgba(80,60,20,0.35)', strokeWidth: 0.6,
            }));
        }
    }

    // ── 动态层：波登管 + 传动机构 ────────────────────────────
    _drawMechanismLayer() {
        this._mechGroup = new Konva.Group();
        this.group.add(this._mechGroup);
        this._rebuildMechanism();
    }

    _rebuildMechanism() {
        this._mechGroup.destroyChildren();
        const p = this._pressure;
        const frac = Math.max(0, Math.min(1, p / this.rangeMax));

        // ── 计算管端几何（包含曲率变化）──
        const { tipX, tipY, tipAng, lkX, lkY, sectorAng, curveR } = this._calcGeometry(frac);

        // ── 绘制波登管（C形弧，使用曲率变化后的半径）──
        this._drawBourdontube(frac, tipX, tipY, tipAng, curveR);

        // ── 绘制连杆 ──
        this._drawLink(tipX, tipY, lkX, lkY);

        // ── 绘制扇形齿轮 ──
        this._drawSectorGear(sectorAng);

        // ── 绘制游丝 ──
        this._drawHairSpring(frac);

        // ── 扇形齿轮转角弧 ──
        if (frac > 0.02) {
            const spx = this._sectorPivotX, spy = this._sectorPivotY;
            const sR = this._sectorR;
            const geo0 = this._calcGeometry(0);
            const aStart = geo0.sectorAng;
            const aEnd = sectorAng;
            const arcSteps = 16;
            const arcPts = [];
            for (let i = 0; i <= arcSteps; i++) {
                const t = i / arcSteps;
                const a = aStart + (aEnd - aStart) * t;
                arcPts.push(spx + sR * 1.25 * Math.cos(-a));
                arcPts.push(spy + sR * 1.25 * Math.sin(-a));
            }
            this._mechGroup.add(new Konva.Line({
                points: arcPts,
                stroke: 'rgba(255,200,80,0.30)',
                strokeWidth: 1.2, lineCap: 'round',
            }));
        }
    }

    // 核心几何：给定压力分数，返回管端坐标、连杆端坐标、扇形角
    // 变形机制：曲率变化（管半径增大）= 管体展直 + 小角度旋转
    _calcGeometry(frac) {
        const tcx = this._tubeCx, tcy = this._tubeCy;
        const tR = this._tubeR;
        const angF = this._tubeAngFixed;
        const ang0 = this._tubeAngFree0;
        const defl = frac * this._maxTipDefl;

        // 曲率变化：管半径随压力增大（模拟管体展直）
        const curveR = tR * (1 + frac * this._curveScale);

        // 自由端角度 = 初始角度 + 小角度旋转
        const tipAng = ang0 + defl;

        // 自由端坐标（在增大后的弧上）
        const tipX = tcx + curveR * Math.cos(tipAng);
        const tipY = tcy - curveR * Math.sin(tipAng);   // SVG y轴向下

        // 连杆方向：垂直于管端切线，偏向内侧
        const tangAng = tipAng + Math.PI / 2;
        const lkX = tipX + this._linkLen * Math.cos(tangAng + 0.20);
        const lkY = tipY - this._linkLen * Math.sin(tangAng + 0.20);

        // 扇形齿轮转角（由连杆端点相对扇形轴心的方位决定）
        const spx = this._sectorPivotX, spy = this._sectorPivotY;
        const sectorAng = Math.atan2(-(lkY - spy), lkX - spx);

        return { tipX, tipY, tipAng, lkX, lkY, sectorAng, curveR };
    }

    _drawBourdontube(frac, tipX, tipY, tipAng, curveR) {
        const tcx = this._tubeCx, tcy = this._tubeCy;
        const tR = this._tubeR;
        const angF = this._tubeAngFixed;
        const ang0 = this._tubeAngFree0;
        const defl = frac * this._maxTipDefl;
        const tipAngCur = ang0 + defl;

        // ── 用曲率变化后的半径计算当前管体的壁厚与弧径 ──
        const wallCur = curveR * 0.085;
        const rOuterCur = curveR + wallCur;
        const rInnerCur = curveR - wallCur;

        // ── 零压管用原始半径 ──
        const wall0 = tR * 0.085;
        const rOuter0 = tR + wall0;

        // 将数学角度转为 SVG arc 参数（返回纯数字）
        const toSVG = (r, a) => ({
            x: tcx + r * Math.cos(a),
            y: tcy - r * Math.sin(a),
        });

        // 当前管体端点（曲率变化后的半径）
        const sfO = toSVG(rOuterCur, angF);
        const stO = toSVG(rOuterCur, tipAngCur);
        const sfI = toSVG(rInnerCur, angF);
        const stI = toSVG(rInnerCur, tipAngCur);

        // ── 零压管端位置参考（虚线轮廓，使用原始半径）──
        if (frac > 0.03) {
            const sfO0 = toSVG(rOuter0, angF);
            const stOG = toSVG(rOuter0, ang0);
            const fmt = (p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
            const ghostPath = `M${fmt(sfO0)} A${rOuter0},${rOuter0} 0 1,0 ${fmt(stOG)}`;
            this._mechGroup.add(new Konva.Path({
                data: ghostPath, name: 'ghost-path',
                fill: 'rgba(200, 216, 224, 0.1)', stroke: 'rgba(100,200,255,0.50)',
                strokeWidth: 2, dash: [6, 4],
            }));
        }

        // ── 管体填充（曲率变化后的形状）──
        const r = Math.round(80 + frac * 170);
        const g = Math.round(160 - frac * 100);
        const b = Math.round(230 - frac * 190);
        const wallFill = `rgb(${r},${g},${b})`;

        // SVG arc: 从固定端到自由端，沿外弧走
        const outerArc = `M${sfO.x},${sfO.y} A${rOuterCur},${rOuterCur} 0 1,0 ${stO.x},${stO.y}`;
        const innerArc = `L${stI.x},${stI.y} A${rInnerCur},${rInnerCur} 0 1,1 ${sfI.x},${sfI.y} Z`;
        this._mechGroup.add(new Konva.Path({
            data: outerArc + innerArc,
            fill: wallFill,
            stroke: frac >= 0.80 ? '#d05030' : '#3a7ab8',
            strokeWidth: 2.5,
            shadowColor: frac >= 0.80 ? 'rgba(220,80,40,0.4)' : 'rgba(60,130,200,0.3)',
            shadowBlur: 8, shadowOpacity: 0.5,
        }));

        // ── 管端封闭端盖 ──
        const tipCol = frac >= 0.80 ? '#e06040' : '#4a8ac8';
        this._mechGroup.add(new Konva.Line({
            points: [stO.x, stO.y, stI.x, stI.y],
            stroke: tipCol, strokeWidth: 3, lineCap: 'round',
        }));

        // ── 曲率半径指示线（显示 R → R' 的变化）──
        if (frac > 0.05) {
            // 弧心中点到管体中点的方向
            const midAng = (angF + tipAngCur) / 2;
            // 原始半径指示线（从弧心到原始管体）
            const r0EndX = tcx + (rOuter0 - 2) * Math.cos(midAng);
            const r0EndY = tcy - (rOuter0 - 2) * Math.sin(midAng);
            // 当前半径指示线（延长至当前管体）
            const rCurEndX = tcx + (rOuterCur - 2) * Math.cos(midAng);
            const rCurEndY = tcy - (rOuterCur - 2) * Math.sin(midAng);

            this._mechGroup.add(new Konva.Line({
                points: [tcx, tcy, rCurEndX, rCurEndY],
                stroke: 'rgba(255,255,100,0.35)',
                strokeWidth: 1.2, dash: [3, 4],
            }));
            this._mechGroup.add(new Konva.Text({
                x: tcx + (rOuterCur + 6) * Math.cos(midAng) - 14,
                y: tcy - (rOuterCur + 6) * Math.sin(midAng) - 6,
                text: `R${frac > 0.5 ? "'" : ''}`, fontSize: 8,
                fill: 'rgba(255,255,100,0.50)', fontStyle: 'bold',
            }));
        }

        // ── 管端位移箭头（从零压位置指向当前位置）──
        if (frac > 0.05) {
            const geo0 = this._calcGeometry(0);
            const dx = tipX - geo0.tipX;
            const dy = tipY - geo0.tipY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 3) {
                // 位移连线
                this._mechGroup.add(new Konva.Line({
                    points: [geo0.tipX, geo0.tipY, tipX, tipY],
                    stroke: '#ffa726', strokeWidth: 2.5, lineCap: 'round',
                    dash: [5, 4],
                }));
                // 箭头（在管端侧画小三角）
                const ang = Math.atan2(-dy, dx);
                const arrLen = 9;
                for (const sign of [-1, 1]) {
                    this._mechGroup.add(new Konva.Line({
                        points: [
                            tipX, tipY,
                            tipX - arrLen * Math.cos(ang + sign * 0.45),
                            tipY + arrLen * Math.sin(ang + sign * 0.45),
                        ],
                        stroke: '#ffa726', strokeWidth: 2.5, lineCap: 'round',
                    }));
                }
                // 位移数值（放在箭头中部上方）
                this._mechGroup.add(new Konva.Text({
                    x: (geo0.tipX + tipX) / 2 - 22,
                    y: (geo0.tipY + tipY) / 2 - 18,
                    text: `位移 ${dist.toFixed(1)}px`,
                    fontSize: 9, fill: '#ffa726', fontStyle: 'bold',
                }));
            }
        }

        // ── 管端高光 ──
        const hlR = wallCur * 0.60;
        this._mechGroup.add(new Konva.Ellipse({
            x: (tcx + tR * Math.cos(angF)), y: (tcy - tR * Math.sin(angF)),
            radiusX: hlR, radiusY: hlR * 1.8,
            fill: '#a0c8e8', stroke: '#6090b8', strokeWidth: 1, opacity: 0.9,
        }));
        this._mechGroup.add(new Konva.Ellipse({
            x: tipX, y: tipY,
            radiusX: hlR, radiusY: hlR * 1.8,
            fill: '#b0d8f0', stroke: '#70a8d0', strokeWidth: 1, opacity: 0.9,
        }));

        // ── 压力流体粒子（在曲率变化后的管腔中心线上分布）──
        if (frac > 0.05) {
            const steps = 12;
            for (let i = 0; i < steps; i++) {
                const fi = i / steps;
                const angPt = angF + (tipAngCur - angF) * fi;
                const px = tcx + curveR * Math.cos(angPt);
                const py = tcy - curveR * Math.sin(angPt);
                const alpha = 0.25 + 0.65 * Math.sin(fi * Math.PI);
                this._mechGroup.add(new Konva.Circle({
                    x: px, y: py,
                    radius: wallCur * 0.50,
                    fill: `rgba(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)},${alpha})`,
                }));
            }
        }
    }

    _drawLink(tipX, tipY, lkX, lkY) {
        // 连杆线段（加粗加亮）
        this._mechGroup.add(new Konva.Line({
            points: [tipX, tipY, lkX, lkY],
            stroke: '#90b8d8', strokeWidth: 2.5, lineCap: 'round',
        }));
        // 铰接销（两端小圆）
        [{ x: tipX, y: tipY }, { x: lkX, y: lkY }].forEach(pt => {
            this._mechGroup.add(new Konva.Circle({
                x: pt.x, y: pt.y, radius: 3.5,
                fill: '#c8d8e8', stroke: '#7898b8', strokeWidth: 1,
            }));
        });
    }

    _drawSectorGear(sectorAng) {
        const spx = this._sectorPivotX, spy = this._sectorPivotY;
        const sR = this._sectorR;

        // 扇形范围：以 sectorAng 为中心，±0.55 rad
        const halfAng = 0.55;

        // 扇形体（加亮）
        this._mechGroup.add(new Konva.Wedge({
            x: spx, y: spy,
            radius: sR,
            angle: (halfAng * 2) * 180 / Math.PI,
            rotation: -(sectorAng + halfAng) * 180 / Math.PI,
            fill: 'rgba(100,160,220,0.35)',
            stroke: '#7090c0', strokeWidth: 1.5,
        }));

        // 齿（7颗，沿弧均匀分布，加亮）
        const teethN = 7;
        for (let i = 0; i <= teethN; i++) {
            const a = (sectorAng - halfAng) + (i / teethN) * halfAng * 2;
            const rx = spx + sR * Math.cos(-a);
            const ry = spy + sR * Math.sin(-a);   // y轴翻转
            const tx = spx + (sR + 5) * Math.cos(-a);
            const ty = spy + (sR + 5) * Math.sin(-a);
            this._mechGroup.add(new Konva.Line({
                points: [rx, ry, tx, ty],
                stroke: '#88a8d8', strokeWidth: 2.0, lineCap: 'round',
            }));
        }

        // 轴心圆
        this._mechGroup.add(new Konva.Circle({
            x: spx, y: spy, radius: 3.5,
            fill: '#586878', stroke: '#8098b8', strokeWidth: 1,
        }));
    }

    _drawHairSpring(frac) {
        const cx = this._hairCx, cy = this._hairCy;
        const turns = 2.5;
        const r0 = this._R * 0.04;
        const r1 = this._R * 0.12;
        const pts = [];
        const steps = 80;

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const ang = t * turns * Math.PI * 2 + frac * 0.8;   // 随压力微旋
            const r = r0 + (r1 - r0) * t;
            pts.push(cx + r * Math.cos(ang));
            pts.push(cy + r * Math.sin(ang));
        }

        this._mechGroup.add(new Konva.Line({
            points: pts,
            stroke: 'rgba(160,200,240,0.75)', strokeWidth: 1.0,
            lineCap: 'round', lineJoin: 'round',
            tension: 0.4,
        }));
    }

    // ── 动态层：指针 ──────────────────────────────────────────
    _drawNeedleLayer() {
        this._needleGroup = new Konva.Group();
        this.group.add(this._needleGroup);
        this._rebuildNeedle();
    }

    _rebuildNeedle() {
        this._needleGroup.destroyChildren();
        const frac = Math.max(0, Math.min(1, this._pressure / this.rangeMax));

        // 指针角度：0 → -225°（SVG顺时针），满量程 → -225°+315°= +90°
        // 用 SVG rotation（以 cx,cy 为中心）
        const needleAngDeg = -(this._dialAngStart) + this._dialAngEnd * frac;
        const needleAngRad = needleAngDeg * Math.PI / 180;

        const cx = this._needlePivotX, cy = this._needlePivotY;
        const nLen = this._needleLen, nTail = this._needleTail;
        const nW = this._R * 0.025;

        // 指针尖端、尾端坐标
        const nx1 = cx + nLen * Math.cos(needleAngRad);
        const ny1 = cy + nLen * Math.sin(needleAngRad);
        const nx2 = cx - nTail * Math.cos(needleAngRad);
        const ny2 = cy - nTail * Math.sin(needleAngRad);

        // 侧翼点（菱形指针）
        const perpAng = needleAngRad + Math.PI / 2;
        const wx = nW * Math.cos(perpAng);
        const wy = nW * Math.sin(perpAng);
        // 宽点在1/4处
        const mxPos = cx + (nLen * 0.12) * Math.cos(needleAngRad);
        const myPos = cy + (nLen * 0.12) * Math.sin(needleAngRad);

        const col = frac >= 0.80 ? '#e04030' : frac >= 0.60 ? '#e09020' : '#e02010';

        // 指针阴影
        this._needleGroup.add(new Konva.Line({
            points: [nx2 + 1.5, ny2 + 1.5, nx1 + 1.5, ny1 + 1.5],
            stroke: 'rgba(0,0,0,0.20)', strokeWidth: 3, lineCap: 'round',
        }));

        // 指针主体（多边形，有宽腰）
        this._needleGroup.add(new Konva.Line({
            points: [
                nx2, ny2,
                mxPos + wx, myPos + wy,
                nx1, ny1,
                mxPos - wx, myPos - wy,
            ],
            closed: true,
            fill: col,
            stroke: frac >= 0.80 ? '#c02020' : '#c01008',
            strokeWidth: 0.8,
        }));

        // 指针高光
        this._needleGroup.add(new Konva.Line({
            points: [
                mxPos + wx * 0.3, myPos + wy * 0.3,
                nx1, ny1,
            ],
            stroke: 'rgba(255,180,160,0.30)', strokeWidth: 1.5, lineCap: 'round',
        }));

        // ── 小齿轮齿（显示齿轮传动，加亮）───────────────────
        const pinionR = this._R * 0.055;
        const teethN = 14;
        for (let i = 0; i < teethN; i++) {
            const a = (i / teethN) * Math.PI * 2 + needleAngRad * 0.15;
            const ir = pinionR + 1;
            const or = pinionR + 4.5;
            this._needleGroup.add(new Konva.Line({
                points: [
                    cx + ir * Math.cos(a), cy + ir * Math.sin(a),
                    cx + or * Math.cos(a), cy + or * Math.sin(a),
                ],
                stroke: '#7898c8', strokeWidth: 1.5, lineCap: 'round',
            }));
        }

        // ── 指针转角弧标注 ──
        if (frac > 0.02) {
            const arcR = nLen * 0.50;
            const startA = -(this._dialAngStart) * Math.PI / 180;
            const endA = needleAngRad;
            const arcSteps = 20;
            const arcPts = [];
            for (let i = 0; i <= arcSteps; i++) {
                const t = i / arcSteps;
                const a = startA + (endA - startA) * t;
                arcPts.push(cx + arcR * Math.cos(a));
                arcPts.push(cy + arcR * Math.sin(a));
            }
            this._needleGroup.add(new Konva.Line({
                points: arcPts,
                stroke: 'rgba(255,200,50,0.35)',
                strokeWidth: 1.5, lineCap: 'round',
            }));
        }
    }

    // ── 压圈（表盖边框）──────────────────────────────────────
    _drawBezel() {
        const cx = this._cx, cy = this._cy, R = this._R;
        // 外压圈
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 5,
            fill: 'transparent',
            stroke: '#5a5a62', strokeWidth: 2.5,
        }));
        // 内压圈
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 2,
            fill: 'transparent',
            stroke: '#3a3a40', strokeWidth: 1,
        }));
        // 压圈高光
        this.group.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: R + 3, outerRadius: R + 6,
            angle: 100, rotation: -220,
            fill: 'rgba(255,255,255,0.10)',
        }));
    }

    // ── 中心轴帽 ─────────────────────────────────────────────
    _drawCenterCap() {
        const cx = this._cx, cy = this._cy;
        const r = this._R * 0.055;
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#3a3840', stroke: '#5a5860', strokeWidth: 1,
        }));
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.40,
            fill: '#7a7888',
        }));
    }

    // ── 位号标注 ─────────────────────────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: 20, width: W,
            text: `${this.label}  0 ~ ${this.rangeMax} ${this.rangeUnit}`,
            fontSize: 12, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 工作原理标注（中文，重点突出传动链）─────────────────
    _drawComponentLabels() {
        const cx = this._cx, cy = this._cy, R = this._R;
        const W = this.width;
        const H = this.height;

        // ── 底部工作原理说明 ──
        const labelY = this._socketY + this._socketH + 16;

        this.group.add(new Konva.Text({
            x: R * 0.20, y: labelY-60,
            width: W - R * 0.50,
            text: '压力→波登管变形→连杆→扇形齿轮→小齿轮→指针偏转',
            fontSize: 12, fill: '#37474F', align: 'center', fontStyle: 'bold',
        }));

    }

    // ── 状态指示（表壳底部）─────────────────────────────────
    _drawStatusIndicator() {
        const cx = this._cx, cy = this._cy, R = this._R;
        const ix = cx - R * 0.70;
        const iy = cy + R * 0.65;

        const frac = this._pressure / this.rangeMax;
        // 压力读数
        this._readout = new Konva.Text({
            x: cx - R * 0.35, y: iy +20,
            width: R * 0.70,
            text: `${this._pressure.toFixed(1)} ${this.rangeUnit}`,
            fontSize: 12, fontStyle: 'bold',
            fill: frac >= 0.80 ? '#ef5350' : '#4a5a64',
            align: 'center',
        });
        this.group.add(this._readout);
    }

    // ── 点击区域 ─────────────────────────────────────────────
    _bindInteraction() {
        // 点击表盘：压力步进 +10
        this.group.on('click tap', () => this.step());
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        if (!this._animating) return;

        this._animT += dt / this._animDur;
        if (this._animT >= 1) {
            this._animT = 1;
            this._animating = false;
            this._pressure = this._pressTo;
        }

        // 正弦缓动（ease in-out），模拟弹性管的弹性响应
        const ease = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
        this._pressure = this._pressFrom + (this._pressTo - this._pressFrom) * ease;

        this._rebuildMechanism();
        this._rebuildNeedle();
        this._updateStatus();
        this._refreshCache();
    }

    _updateStatus() {
        const frac = this._pressure / this.rangeMax;
        if (this._readout) {
            this._readout.text(`${this._pressure.toFixed(1)} ${this.rangeUnit}`);
            this._readout.fill(frac >= 0.80 ? '#ef5350' : '#4a5a64');
        }
    }

    // ═══════════════════════════════════════════
    /** 施加目标压力（kPa），带动画过渡 */
    applyPressure(value) {
        const target = Math.max(0, Math.min(this.rangeMax, value));
        if (Math.abs(target - this._pressure) < 0.01) return;
        this._pressFrom = this._pressure;
        this._pressTo = target;
        this._animT = 0;
        this._animating = true;
        this.opsCount++;
        this._refreshCache();
    }

    /** 压力步进 +10%量程（点击时调用） */
    step() {
        if (this._animating) return;
        const step = this.rangeMax * 0.10;
        const next = this._pressure + step > this.rangeMax
            ? 0
            : this._pressure + step;
        this.applyPressure(next);
    }

    /** 归零（带动画） */
    zero() {
        this.applyPressure(0);
    }

    /** 当前压力值（kPa） */
    getPressure() { return this._pressure; }

    /** 是否处于过压状态 */
    isOverPressure() { return this._pressure / this.rangeMax >= 0.80; }

    isAnimating() { return this._animating; }
    getOpsCount() { return this.opsCount; }

    update(state) {
        if (typeof state === 'number') {
            this.applyPressure(state);
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称', key: 'label', type: 'text' },
            { label: '量程上限', key: 'rangeMax', type: 'number' },
            { label: '单位', key: 'rangeUnit', type: 'text' },
            { label: '刻度主分格数', key: 'dialDivs', type: 'number' },
            { label: '当前压力', key: 'initPressure', type: 'number' },
            { label: '动作时间 (s)', key: 'animDur', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label !== undefined) this.label = cfg.label;
        if (cfg.rangeUnit !== undefined) this.rangeUnit = cfg.rangeUnit;
        if (cfg.rangeMax !== undefined) this.rangeMax = parseFloat(cfg.rangeMax) || this.rangeMax;
        if (cfg.dialDivs !== undefined) this.dialDivs = parseInt(cfg.dialDivs) || this.dialDivs;
        if (cfg.animDur !== undefined) this._animDur = parseFloat(cfg.animDur) || this._animDur;
        if (cfg.initPressure !== undefined) {
            const p = parseFloat(cfg.initPressure);
            if (!isNaN(p)) this.applyPressure(p);
        }
        this.config = { ...this.config, ...cfg };

        // 重建静态层（量程变化需重绘刻度盘）
        this.group.destroyChildren();
        this._readout = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}