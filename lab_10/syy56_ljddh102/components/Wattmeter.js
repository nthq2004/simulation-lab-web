import { BaseComponent } from './BaseComponent.js';

/**
 * 有功功率表（电动系功率表 / Wattmeter）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  功率表采用电动系（电动力系）测量机构，能同时响应电压与电流，
 *  因此可直接测量有功功率 P = U·I·cosφ。
 *
 *  ── 电动系测量机构 ────────────────────────────────────────────────
 *    结构由两组线圈组成：
 *    ① 固定线圈（电流线圈，Current Coil, CC）
 *       - 粗导线，少匝数（2~数匝）
 *       - 与负载串联，流过被测电流 I
 *       - 产生磁场 H1 ∝ I
 *
 *    ② 活动线圈（电压线圈，Voltage Coil, VC / Pressure Coil）
 *       - 细导线，多匝数（数百~数千匝）
 *       - 串联高内阻 Rv 后并联于被测电压两端，电流 Iv = U / (Rv + Rv_coil)
 *       - 置于固定线圈磁场中，因安培力而偏转
 *
 *    偏转力矩推导：
 *       F = Iv × dM/dα × Icc     (M 为互感，α 为偏转角)
 *       α 平衡时：T_驱动 = T_游丝
 *       → α ∝ Iv · Icc · cosφ ∝ U · I · cosφ = P（有功功率）
 *
 *    关键特性：
 *    - 刻度均匀（线性），与频率无关
 *    - cosφ < 0 时指针反偏（可按下"*"换向按钮或交换接线）
 *    - 量程：电压量程（并联 Rv）× 电流量程（串联/跨接）
 *    - 功率量程 = 电压量程 × 电流量程（非独立可选）
 *
 *  ── 接线方式 ──────────────────────────────────────────────────────
 *    电流线圈（CC）串入被测支路：± 两端
 *    电压线圈（VC）并联于电压两端：U± 两端
 *    "*" 端（发电机端）：CC 与 VC 的公共端，应连同侧
 *    → 两种接法：电流表前接（适合低阻负载），电流表后接（适合高阻负载）
 *
 *  ── 动态量 ────────────────────────────────────────────────────────
 *    驱动力矩 T_d ∝ I·U·cosφ = P
 *    反力矩（游丝）T_s = k·α
 *    平衡：α = (1/k)·P = S_P·P   (S_P 为仪表灵敏度)
 *    阻尼：空气阻尼翼片（铝制，位于活动线圈轴上）
 *
 * ═══ 渲染结构 ═════════════════════════════════════════════════════════
 *  左侧：仪表外观界面
 *    ① 米白色方形表壳（仿电工仪表面板）
 *    ② 圆弧形刻度盘
 *       - 主刻度：0 → 满量程（均匀线性）
 *       - 量程铭牌：电压量程 × 电流量程 = 功率量程
 *       - 红色超量程警戒弧（>90%）
 *       - 功率因数参考弧（cosφ = 0.5 / 0.8 / 1.0 对应的功率刻度位置）
 *    ③ 指针（随 P 偏转，配游丝动画）
 *    ④ 铭牌区：型号 D26-W，精度等级，频率范围
 *    ⑤ 接线端（底部，共 4 个）：
 *       I+（电流线圈正）/ I-（电流线圈负）/ U+（电压正/发电机端）/ U-（电压负）
 *    ⑥ "*"标记（发电机端标识，I+ 和 U+ 旁）
 *
 *  右侧：原理结构
 *    ① 固定线圈（电流线圈）横截面：上下两组矩形绕组
 *       - 显示电流方向符号（⊙/⊗）
 *       - 匝间绝缘线条
 *    ② 活动线圈（电压线圈）：中央菱形框，可绕轴旋转
 *       - 偏转角随功率变化
 *    ③ 转轴 + 游丝（螺旋弹簧）
 *    ④ 阻尼翼片（铝质，位于轴两侧）
 *    ⑤ 磁力线（固定线圈产生，动态显示）
 *    ⑥ 安培力箭头（活动线圈受力）
 *    ⑦ 等效接线图（右下角，显示 CC/VC 接法与 Rv）
 *    ⑧ 接线端 I+ / I- / U+ / U-（底部）
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  ip   — I+（电流线圈正端，右侧底部）
 *  in   — I-（电流线圈负端，右侧底部）
 *  up   — U+（电压线圈正/发电机端，右侧底部）
 *  un   — U-（电压线圈负端，右侧底部）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  power      : 被测有功功率 W（默认 0）
 *  maxPower   : 满量程功率 W（默认 500）
 *  voltRange  : 电压量程 V（默认 250）
 *  currRange  : 电流量程 A（默认 2）
 *  cosphi     : 功率因数（默认 1.0，用于原理图动画显示）
 *  rampTime   : 指针响应时间常数 s（默认 0.4）
 *  accuracy   : 精度等级字符串（默认 '1.0'）
 */
export class Wattmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 470);
        this.height = Math.max(200, config.height || 240);

        this.type    = 'wattmeter';
        this.special = 'WATTMETER';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            power:     this._targetP,
            maxPower:  this.maxPower,
            voltRange: this._voltRange,
            currRange: this._currRange,
            cosφ:      this._cosφ,
            rampTime:  this._rampTime,
            accuracy:  this._accuracy,
        };

        // ── 端口（右侧面板底部） ─────────────────────────
        this.addPort(this._portIP.x, this._portIP.y, 'ip', 'wire', 'p');
        this.addPort(this._portIN.x, this._portIN.y, 'in', 'wire', 'n');
        this.addPort(this._portUP.x, this._portUP.y, 'up', 'wire', 'p');
        this.addPort(this._portUN.x, this._portUN.y, 'un', 'wire', 'n');
    }

    // ═══════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._divX  = W * 0.50;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        // ── 左侧：仪表盘 ──────────────────────────────
        const lW  = this._divX;
        const fCx = lW * 0.50;
        const fCy = H  * 0.48;
        const fR  = Math.min(lW * 0.48, H * 0.46);
        this._face = { cx: fCx, cy: fCy, r: fR };

        // 指针扫描角度：左端=0W(165°) → 右端=满量程(375°=15°)，共210°
        this._angleStart = 165;
        this._angleSweep = 210;

        // ── 右侧：原理结构 ─────────────────────────────
        const rLeft = this._divX + 6;
        const rW    = W - rLeft + 36;
        const rCx   = rLeft + rW * 0.44;
        const rCy   = H * 0.48;

        // 固定线圈（定子电流线圈，上下两组）
        const ccW = rW * 0.52, ccH = H * 0.10;
        const ccSep = H * 0.26;
        this._ccTop = {
            x: rCx - ccW / 2, y: rCy - ccSep - ccH / 2,
            w: ccW, h: ccH,
        };
        this._ccBot = {
            x: rCx - ccW / 2, y: rCy + ccSep - ccH / 2,
            w: ccW, h: ccH,
        };

        // 固定线圈绕线端（左端进、右端出）
        this._ccTopL = { x: this._ccTop.x, y: this._ccTop.y + ccH / 2 };
        this._ccTopR = { x: this._ccTop.x + ccW, y: this._ccTop.y + ccH / 2 };
        this._ccBotL = { x: this._ccBot.x, y: this._ccBot.y + ccH / 2 };
        this._ccBotR = { x: this._ccBot.x + ccW, y: this._ccBot.y + ccH / 2 };

        // 活动线圈（转子电压线圈，矩形）
        const vcW = rW * 0.18, vcH = H * 0.22;
        this._vc = { cx: rCx, cy: rCy, w: vcW, h: vcH };

        // 转轴
        this._shaft = {
            x: rCx,
            y0: this._ccTop.y - 12,
            y1: this._ccBot.y + ccH + 12,
        };

        // 端口（底边）
        const pSpan = rW * 0.72;
        const pSp   = pSpan / 3;
        const pX0   = rCx - pSpan / 2;
        this._portIP = { x: pX0,        y: H - 2 };
        this._portIN = { x: pX0 + pSp,  y: H - 2 };
        this._portUP = { x: pX0 + pSp*2, y: H - 2 };
        this._portUN = { x: pX0 + pSpan, y: H - 2 };

        // 限流电阻 Rv 位置（U+ 上方，垂直放置）
        this._rvPos = { cx: this._portUP.x, cy: H - 14 - rW * 0.10 };

        // 游丝（顶部的螺旋弹簧）
        this._springPos = { cx: rCx, cy: this._ccTop.y - 16 };

        // 接线端子标注位置
        const tY = H - 16;
        this._termCY = H - 14; // 端子圆中心 y
        this._termLabels = [
            { x: this._portIP.x, y: tY, label: 'I+' },
            { x: this._portIN.x, y: tY, label: 'I-' },
            { x: this._portUP.x, y: tY, label: 'U+' },
            { x: this._portUN.x, y: tY, label: 'U-' },
        ];
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this._voltRange = config.voltRange !== undefined ? parseFloat(config.voltRange) : 250;
        this._currRange = config.currRange !== undefined ? parseFloat(config.currRange) : 2;
        this.maxPower   = config.maxPower  !== undefined ? parseFloat(config.maxPower)  :
                          this._voltRange * this._currRange;
        this._cosφ      = config.cosφ      !== undefined ? parseFloat(config.cosφ)      : 1.0;
        this._accuracy  = config.accuracy  || '1.0';
        this._rampTime  = config.rampTime  !== undefined ? parseFloat(config.rampTime)  : 0.4;

        this._targetP   = config.power     !== undefined ? parseFloat(config.power)     : 0;
        this._currentP  = this._targetP;
        this.currentIdx = undefined;
        this.physCurrent = 0;

        this._needleAngle = this._powerToAngle(this._currentP);

        // 活动线圈偏转角（原理图，0°=垂直，正=顺时针）
        this._vcAngle = 0;

        // 磁场动画相位
        this._fieldPhase = 0;
    }

    _powerToAngle(p) {
        const frac = Math.max(0, Math.min(1, p / this.maxPower));
        return this._angleStart + frac * this._angleSweep;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawFaceStatic();
        this._drawPrincipleStatic();
    }

    // ─── 外框 ────────────────────────────────────────

    _drawFrame() {
        const f = this._frame;
        // 浅米色工程塑料外壳
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#d6d0be',
            stroke: '#908878', strokeWidth: 2,
            cornerRadius: f.rx,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: f.w - 4, height: f.h * 0.07,
            fill: 'rgba(255,255,255,0.18)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    // ─── 左侧仪表盘 ──────────────────────────────────

    _drawFaceStatic() {
        const { cx, cy, r } = this._face;
        const f = this._frame;
        const lW = this._divX;

        // 左侧面板（浅黄米色）
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: lW - f.x - 3, height: f.h - 4,
            fill: '#ece8d8',
            cornerRadius: [f.rx - 1, 0, 0, f.rx - 1],
        }));

        // 表盘金属环
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 6,
            fillLinearGradientStartPoint: { x: -(r+6), y: -(r+6) },
            fillLinearGradientEndPoint:   { x:  (r+6), y:  (r+6) },
            fillLinearGradientColorStops: [0, '#888080', 0.5, '#d0c8c0', 1, '#706868'],
            stroke: '#504848', strokeWidth: 1.5,
        }));

        // 表盘底色（奶白）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#f6f2e4',
            stroke: '#ccc4b0', strokeWidth: 1,
        }));

        // 内暗晕
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.52,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.08)'],
            listening: false,
        }));

        // ── 刻度 ──────────────────────────────────────
        const majorDiv  = 5;
        const minorPerMajor = 5;
        const totalMinor = majorDiv * minorPerMajor;
        const outerR = r * 0.94;

        for (let i = 0; i <= totalMinor; i++) {
            const frac   = i / totalMinor;
            const angDeg = this._angleStart + frac * this._angleSweep;
            const angRad = angDeg * Math.PI / 180;
            const isMajor  = (i % minorPerMajor === 0);
            const isMedium = (i % minorPerMajor === Math.floor(minorPerMajor / 2));
            const innerR   = isMajor ? r * 0.74 : (isMedium ? r * 0.82 : r * 0.88);
            const sw       = isMajor ? 1.7 : 0.85;
            const col      = isMajor ? '#181818' : '#606060';

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + innerR * Math.cos(angRad), cy + innerR * Math.sin(angRad),
                ],
                stroke: col, strokeWidth: sw, lineCap: 'round', listening: false,
            }));

            if (isMajor) {
                const pVal = Math.round(frac * this.maxPower);
                const labelR = r * 0.60;
                const fs     = Math.max(7, r * 0.140);
                this._staticGroup.add(new Konva.Text({
                    x: cx + labelR * Math.cos(angRad) - fs * 1.1,
                    y: cy + labelR * Math.sin(angRad) - fs * 0.6,
                    text: String(pVal),
                    fontSize: fs, fontFamily: 'Arial', fill: '#181818',
                    align: 'center', width: fs * 2.6,
                }));
            }
        }

        // 刻度导轨弧
        this._drawFaceArc(cx, cy, outerR, this._angleStart, this._angleStart + this._angleSweep, '#282818', 1.2);

        // 超量程警戒弧（最后 10%，红色）
        this._drawFaceArc(cx, cy, outerR,
            this._angleStart + this._angleSweep * 0.90,
            this._angleStart + this._angleSweep,
            'rgba(210,30,10,0.35)', 5.5);

        // ── 量程显示（功率指示上方） ────────────────────
        const pW = r * 1.30, pH = r * 0.22;
        const pX = cx - pW / 2, pY = cy + r * 0.28;
        this._staticGroup.add(new Konva.Rect({
            x: pX, y: pY, width: pW, height: pH,
            fill: '#e8e2d0', stroke: '#b0a890', strokeWidth: 0.8, cornerRadius: 2,
        }));
        const pFs = Math.max(8, r * 0.150);
        this._staticGroup.add(new Konva.Text({
            x: pX + 2, y: pY + pH - pFs - 2,
            text: `0 ~ ${this.maxPower} W`,
            fontSize: pFs, fontFamily: 'Arial', fontStyle: 'bold', fill: '#381818',
            width: pW - 4, align: 'center',
        }));

        // 单位
        const uFs = Math.max(9, r * 0.175);
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.60, y: cy + r * 0.06,
            text: 'W',
            fontSize: uFs, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#cc2010', width: r * 1.20, align: 'center',
        }));

        // 中心轴底座
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fill: '#c0b878', stroke: '#908848', strokeWidth: 1,
        }));
    }

    _drawFaceArc(cx, cy, radius, startDeg, endDeg, stroke, sw) {
        const steps = Math.max(24, Math.abs(endDeg - startDeg) / 2);
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const a = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
            pts.push(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
        }
        this._staticGroup.add(new Konva.Line({
            points: pts, stroke, strokeWidth: sw,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
    }

    // ─── 右侧原理结构（静态） ─────────────────────────

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;

        // 右侧面板背景（浅蓝灰）
        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#eaecf4',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._drawFixedCoils();
        this._drawDashedCurrentPath();
        this._drawDashedVoltagePath();
        this._drawResistorRv();
        this._drawShaft();
        this._drawTerminals();
    }

    /** 固定线圈（定子电流线圈，上下两组，用粗线表示少而粗的几匝） */
    _drawFixedCoils() {
        const turnCount = 4;
        const turnW = Math.max(4, this._ccTop.w * 0.06);
        [this._ccTop, this._ccBot].forEach((cc, idx) => {
            const { x, y, w, h } = cc;
            const isTop = idx === 0;

            // 线圈骨架（淡蓝灰背景）
            this._staticGroup.add(new Konva.Rect({
                x, y, width: w, height: h,
                fill: '#d8e0ee',
                stroke: '#8090b0', strokeWidth: 1,
                cornerRadius: 2,
            }));

            // 粗匝线（少而粗的几匝，从顶部到底部垂直走线，象征绕组截面）
            for (let t = 0; t < turnCount; t++) {
                const tx = x + w * (0.10 + t * 0.22);
                const tw = turnW;
                this._staticGroup.add(new Konva.Rect({
                    x: tx - tw / 2, y: y + 3,
                    width: tw, height: h - 6,
                    fill: '#c87830',
                    stroke: '#a05018',
                    strokeWidth: 0.8,
                    cornerRadius: 1,
                }));
                // 匝间连线（水平细线，表示每匝的端部连接）
                if (t < turnCount - 1) {
                    const nextTx = x + w * (0.10 + (t + 1) * 0.22);
                    this._staticGroup.add(new Konva.Line({
                        points: [tx + tw / 2, y + h / 2, nextTx - tw / 2, y + h / 2],
                        stroke: '#a05820', strokeWidth: 1.2,
                        listening: false,
                    }));
                }
            }

            // 电流方向符号（⊙/⊗）
            const symR = h * 0.28;
            const syms = isTop
                ? [{ dx: w * 0.15, out: true }, { dx: w * 0.85, out: false }]
                : [{ dx: w * 0.15, out: false }, { dx: w * 0.85, out: true }];
            syms.forEach(s => {
                const sx = x + s.dx, sy = y + h / 2;
                this._staticGroup.add(new Konva.Circle({
                    x: sx, y: sy, radius: symR,
                    fill: '#e8f0f8', stroke: '#3050a0', strokeWidth: 1.2,
                }));
                if (s.out) {
                    this._staticGroup.add(new Konva.Circle({
                        x: sx, y: sy, radius: symR * 0.28,
                        fill: '#d03020',
                    }));
                } else {
                    const dl = symR * 0.55;
                    this._staticGroup.add(new Konva.Line({
                        points: [sx - dl, sy - dl, sx + dl, sy + dl],
                        stroke: '#d03020', strokeWidth: 1.4, lineCap: 'round',
                    }));
                    this._staticGroup.add(new Konva.Line({
                        points: [sx + dl, sy - dl, sx - dl, sy + dl],
                        stroke: '#d03020', strokeWidth: 1.4, lineCap: 'round',
                    }));
                }
            });
        });
    }

    /** 电流线圈的虚线接线路径：I+ → 上线圈左 → 上线圈右 → 下线圈右 → 下线圈左 → I- */
    _drawDashedCurrentPath() {
        const ip = this._portIP;
        const inn = this._portIN;
        const tL = this._ccTopL, tR = this._ccTopR;
        const bL = this._ccBotL, bR = this._ccBotR;
        const tcy = this._termCY;
        const st = '#b03020';

        // I+ → 上线圈左
        this._staticGroup.add(new Konva.Line({
            points: [ip.x, tcy, ip.x, tL.y, tL.x, tL.y],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        // 上线圈右 → 下线圈右（串联）
        this._staticGroup.add(new Konva.Line({
            points: [tR.x, tR.y, tR.x, bR.y],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        // 下线圈左 → I-
        this._staticGroup.add(new Konva.Line({
            points: [bL.x, bL.y, bL.x, tcy, inn.x, tcy],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
    }

    /** 电压线圈的虚线接线路径：U+ → Rv（垂直）→ 活动线圈底部，活动线圈顶部 → U- */
    _drawDashedVoltagePath() {
        const up = this._portUP;
        const un = this._portUN;
        const vc = this._vc;
        const rv = this._rvPos;
        const tcy = this._termCY;
        const rh = 18;
        const st = '#207030';

        // U+ → Rv 底部（紧邻，极短）
        this._staticGroup.add(new Konva.Line({
            points: [up.x, tcy, rv.cx, rv.cy + rh / 2 + 6],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        // Rv 顶部 → 活动线圈底部（上→左）
        this._staticGroup.add(new Konva.Line({
            points: [rv.cx, rv.cy - rh / 2 - 6, rv.cx, vc.cy + vc.h / 2, vc.cx, vc.cy + vc.h / 2],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
        // 活动线圈顶部 → 右 → 下 → U-
        this._staticGroup.add(new Konva.Line({
            points: [vc.cx, vc.cy - vc.h / 2, un.x, vc.cy - vc.h / 2, un.x, tcy],
            stroke: st, strokeWidth: 1.5, dash: [6, 4], lineCap: 'round',
        }));
    }

    /** 限流电阻 Rv（垂直矩形电阻，底部连接 U+，顶部连接活动线圈底部） */
    _drawResistorRv() {
        const { cx, cy } = this._rvPos;
        const rw = 10, rh = 18;

        // 下引出线（来自 U+）
        this._staticGroup.add(new Konva.Line({
            points: [cx, cy + rh / 2, cx, cy + rh / 2 + 6],
            stroke: '#207030', strokeWidth: 1.5, listening: false,
        }));
        // 上引出线（去活动线圈底部）
        this._staticGroup.add(new Konva.Line({
            points: [cx, cy - rh / 2, cx, cy - rh / 2 - 6],
            stroke: '#207030', strokeWidth: 1.5, listening: false,
        }));

        // 矩形电阻框
        this._staticGroup.add(new Konva.Rect({
            x: cx - rw / 2, y: cy - rh / 2,
            width: rw, height: rh,
            fill: '#e0e8f0', stroke: '#207030', strokeWidth: 2,
        }));

        // Rv 标注
        const fs = Math.max(8, this.width * 0.018);
        this._staticGroup.add(new Konva.Text({
            x: cx - 10, y: cy + 7,
            text: 'Rv', fontSize: fs, fontFamily: 'Arial', fontStyle: 'italic',
            fill: '#207030', width: 20, align: 'center',
        }));
    }

    /** 转轴（垂直穿越两组线圈和活动线圈） */
    _drawShaft() {
        const { x, y0, y1 } = this._shaft;
        // 主轴（虚线，从上到下）
        this._staticGroup.add(new Konva.Line({
            points: [x, y0, x, y1],
            stroke: '#707070', strokeWidth: 1.8, dash: [5, 3], lineCap: 'round',
        }));
        // 轴承支点
        [y0 + 4, y1 - 4].forEach(py => {
            this._staticGroup.add(new Konva.Rect({
                x: x - 4, y: py - 3, width: 8, height: 6,
                fill: '#b0a870', stroke: '#808050', strokeWidth: 1, cornerRadius: 2,
            }));
        });
    }

    /** 底部接线端子（圆点 + 文字标注 + 同名端 *） */
    _drawTerminals() {
        const tR = Math.max(10, this.width * 0.012);
        const tcy = this._termCY;
        const fs = Math.max(14, this.width * 0.016);
        const labelY = tcy + 10;

        this._termLabels.forEach(td => {
            const cx = td.x;
            // 端子圆
            this._staticGroup.add(new Konva.Circle({
                x: cx, y: tcy+12, radius: tR,
                fill: '#e0d878', stroke: '#908030', strokeWidth: 1,
            }));
            // 文字标注
            this._staticGroup.add(new Konva.Text({
                x: cx - 32, y: labelY,
                text: td.label, fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#381818', width: 24, align: 'center',
            }));
            // 同名端 *（仅 I+ 和 U+）
            if (td.label === 'I+' || td.label === 'U+') {
                this._staticGroup.add(new Konva.Text({
                    x: cx - 18, y: tcy - tR ,
                    text: '*', fontSize: fs + 12, fontFamily: 'Arial',
                    fill: '#c02020', width: 20, align: 'center',
                }));
            }
        });
    }

    // ═══════════════════════════════════════════════════
    // 动态节点（一次创建，tick 中 in-place 更新）
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createHairspringLeft();
        this._createPointerShaft();
        this._createVoltCoil();
        this._createAmpereForceArrows();
        this._createPowerDisplay();
    }

    /** 仪表指针（左侧表盘） */
    _createNeedle() {
        const { cx, cy, r } = this._face;
        const needleLen = r * 0.86;
        const tailLen   = r * 0.14;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        this._needleGroup.add(new Konva.Line({
            points: [-tailLen, 0, needleLen * 0.90, 0],
            stroke: '#cc2010', strokeWidth: 2.3, lineCap: 'round',
        }));
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.68, -2.0, needleLen * 0.90, 0, needleLen * 0.68, 2.0],
            closed: true, fill: '#cc2010', stroke: '#cc2010', strokeWidth: 0.5,
        }));
        this._needleGroup.add(new Konva.Rect({
            x: -tailLen - 5, y: -2.2, width: 7, height: 4.4,
            fill: '#aa1008', cornerRadius: 1,
        }));

        this._dynamicGroup.add(this._needleGroup);

        // 金色中心轴帽
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.058,
            fillLinearGradientStartPoint: { x: -3, y: -3 },
            fillLinearGradientEndPoint:   { x:  3, y:  3 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a838', 1, '#908020'],
            stroke: '#706018', strokeWidth: 1, listening: false,
        }));
    }

    /** 游丝（左侧，随指针偏转） */
    _createHairspringLeft() {
        const { cx, cy, r } = this._face;

        this._hairspringGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        const turns = 2.5, steps = 80;
        const r0 = r * 0.065, r1 = r * 0.185;
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t   = i / steps;
            const ang = t * turns * 2 * Math.PI - Math.PI / 2;
            const rad = r0 + (r1 - r0) * t;
            pts.push(rad * Math.cos(ang), rad * Math.sin(ang));
        }
        this._hairspringGroup.add(new Konva.Line({
            points: pts, stroke: '#9080c0', strokeWidth: 0.8,
            lineCap: 'round', lineJoin: 'round', listening: false,
        }));
        this._dynamicGroup.add(this._hairspringGroup);
    }

    /** 活动线圈（电压线圈，转子，矩形对称框架，随功率偏转） */
    _createVoltCoil() {
        const { cx, cy, w, h } = this._vc;

        this._vcGroup = new Konva.Group({ x: cx, y: cy, rotation: 0 });

        // 矩形线圈框（代表电压线圈绕组）
        const hw = w / 2, hh = h / 2;
        this._vcGroup.add(new Konva.Line({
            points: [-hw, -hh, hw, -hh, hw, hh, -hw, hh],
            closed: true,
            fill: 'rgba(200,120,20,0.30)',
            stroke: '#c87828', strokeWidth: 2,
        }));

        // 内部细匝线（水平方向多匝，表示电压线圈的多匝细线）
        const turnCount = 8;
        for (let i = 1; i < turnCount; i++) {
            const ry = -hh + (i / turnCount) * h;
            this._vcGroup.add(new Konva.Line({
                points: [-hw + 3, ry, hw - 3, ry],
                stroke: '#c07820', strokeWidth: 0.6, listening: false,
            }));
        }

        // 上下引出线（虚线，表示与外部回路连接）
        this._vcGroup.add(new Konva.Line({
            points: [0, -hh, 0, -hh - 10],
            stroke: '#c87828', strokeWidth: 1.5, dash: [4, 3], listening: false,
        }));
        this._vcGroup.add(new Konva.Line({
            points: [0, hh, 0, hh + 10],
            stroke: '#c87828', strokeWidth: 1.5, dash: [4, 3], listening: false,
        }));

        // 中心轴点（金色）
        this._vcGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 4,
            fill: '#d0c060', stroke: '#a09040', strokeWidth: 1,
        }));

        this._dynamicGroup.add(this._vcGroup);
    }

    /** 转轴指针（与左侧指针同长、同向转动） */
    _createPointerShaft() {
        const rCx = this._shaft.x;
        const rCy = this._vc.cy;
        const len = this._face.r * 0.86;

        this._pointerGroup = new Konva.Group({ x: rCx, y: rCy, rotation: 0 });

        // 指针主体（与左侧同长度，指向右侧，与左侧表针同向旋转）
        this._pointerGroup.add(new Konva.Line({
            points: [0, 0, len, 0],
            stroke: '#cc2010', strokeWidth: 2, lineCap: 'round',
        }));
        // 指针尖端三角
        this._pointerGroup.add(new Konva.Line({
            points: [len * 0.75, -2.5, len, 0, len * 0.75, 2.5],
            closed: true,
            fill: '#cc2010', stroke: '#cc2010', strokeWidth: 0.5,
        }));

        this._dynamicGroup.add(this._pointerGroup);
    }

    /** 力矩弯箭头（活动线圈所受驱动力矩） */
    _createAmpereForceArrows() {
        this._forceGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._forceGroup);
    }

    /** 功率数字显示（左侧表盘内） */
    _createPowerDisplay() {
        const { cx, cy, r } = this._face;
        const fs = Math.max(9, r * 0.195);

        this._pText = new Konva.Text({
            x: cx - r * 0.68,
            y: cy + r * 0.52,
            text: '0.0 W',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#204060',
            width: r * 1.36, align: 'center',
        });
        this._dynamicGroup.add(this._pText);
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    _updateDynamic() {
        const p = this._currentP;
        const frac = Math.max(0, Math.min(1, p / this.maxPower));

        // 1) 左侧表盘指针
        this._needleAngle = this._powerToAngle(p);
        this._needleGroup.rotation(this._needleAngle);

        // 2) 左侧游丝（随指针）
        this._hairspringGroup.rotation(this._needleAngle);

        // 3) 活动线圈（转子电压线圈）偏转（最大 ±40°）
        this._vcAngle = (frac - 0.5) * 80;
        this._vcGroup.rotation(this._vcAngle);

        // 4) 转轴指针（与左侧同向）
        this._pointerGroup.rotation(this._needleAngle);

        // 5) 安培力符号（⊙/⊗ 方向随相位翻转）
        this._updateForceArrows(frac);

        // 6) 功率数字
        this._pText.text(`${p.toFixed(1)} W`);
    }

    /** 电流方向符号动画（固定线圈上的⊙/⊗依相位翻转） */
    _updateForceArrows(strength) {
        this._forceGroup.destroyChildren();
        // 固定线圈电流方向符号更新由 Konva Group 重绘实现
        // 方向由当前相位的正负决定
        const sign = Math.sin(this._fieldPhase) >= 0 ? 1 : -1;
        if (strength < 0.05 || sign === 0) return;

        // 上下线圈中间的磁场方向指示箭头（从 N 到 S）
        const { cx, cy, w, h } = this._vc;
        const topY = this._ccTop.y + this._ccTop.h;
        const botY = this._ccBot.y;
        const alpha = Math.min(0.80, strength * 0.50 + 0.15);

        // 垂直方向的大箭头（磁场方向，从上线圈到下线圈）
        const midX = cx;
        const midY = (topY + botY) / 2;
        const arrowLen = (botY - topY) * 0.35;
        this._forceGroup.add(new Konva.Arrow({
            points: [midX, midY - arrowLen * sign, midX, midY + arrowLen * sign],
            fill: `rgba(40,80,200,${alpha})`,
            stroke: `rgba(40,80,200,${alpha})`,
            strokeWidth: 2.5, pointerLength: 10, pointerWidth: 7, listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        // ── 从电路自计算瞬时功率 ──────────────────────────────
        if (this.sys && this.sys.voltageSolver && this.currentIdx !== undefined) {
            const solver = this.sys.voltageSolver;
            const vInstant = solver.getPD(`${this.id}_wire_up`, `${this.id}_wire_un`);
            const iInstant = this.physCurrent || 0;
            const pInstant = vInstant * iInstant;

            if (!this._pBuf) {
                this._pBuf = new Float64Array(200);
                this._pIdx = 0;
                this._pCount = 0;
                this._pSum = 0;
            }
            const buf = this._pBuf;
            const idx = this._pIdx;
            this._pSum -= buf[idx];
            buf[idx] = pInstant;
            this._pSum += buf[idx];
            this._pIdx = (idx + 1) % buf.length;
            if (this._pCount < buf.length) this._pCount++;
            const avgP = this._pCount > 0 ? (this._pSum / this._pCount) : 0;
            this._targetP = Math.max(0, Math.min(this.maxPower * 1.15, avgP));
        }

        const tau   = Math.max(0.05, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        this._currentP += (this._targetP - this._currentP) * alpha;

        // 磁场动画相位（50Hz 交流激励）
        this._fieldPhase = (this._fieldPhase + dt * 2 * Math.PI * 50) % (2 * Math.PI);

        this._updateDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    /** 设置被测有功功率（W） */
    setPower(p) {
        this._targetP = Math.max(0, Math.min(this.maxPower * 1.15, parseFloat(p) || 0));
    }

    /** 设置功率因数（用于原理图显示） */
    setCosφ(v) { this._cosφ = Math.max(-1, Math.min(1, parseFloat(v) || 1)); }

    getPower()   { return this._currentP; }
    getCosφ()    { return this._cosφ; }

    update(state) {
        if (typeof state === 'object' && state !== null) {
            if (state.power  !== undefined) this.setPower(state.power);
            if (state.cosφ   !== undefined) this.setCosφ(state.cosφ);
        } else {
            this.setPower(state);
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '有功功率 W',                key: 'power',     type: 'number' },
            { label: '满量程功率 W',              key: 'maxPower',  type: 'number' },
            { label: '电压量程 V',                key: 'voltRange', type: 'number' },
            { label: '电流量程 A',                key: 'currRange', type: 'number' },
            { label: '功率因数 cosφ（0~1）',      key: 'cosφ',      type: 'number' },
            { label: '响应时间常数 s',            key: 'rampTime',  type: 'number' },
            { label: '精度等级（如 1.0）',        key: 'accuracy',  type: 'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.voltRange !== undefined) this._voltRange = parseFloat(cfg.voltRange) || 250;
        if (cfg.currRange !== undefined) this._currRange = parseFloat(cfg.currRange) || 2;
        if (cfg.maxPower  !== undefined) this.maxPower   = parseFloat(cfg.maxPower)  || (this._voltRange * this._currRange);
        if (cfg.cosφ      !== undefined) this.setCosφ(cfg.cosφ);
        if (cfg.rampTime  !== undefined) this._rampTime  = parseFloat(cfg.rampTime)  || 0.4;
        if (cfg.accuracy  !== undefined) this._accuracy  = cfg.accuracy;
        if (cfg.power     !== undefined) this.setPower(cfg.power);

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
