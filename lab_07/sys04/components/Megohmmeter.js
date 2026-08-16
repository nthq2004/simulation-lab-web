import { BaseComponent } from './BaseComponent.js';

/**
 * 摇表（兆欧表 / 绝缘电阻表，Megohmmeter / Megger）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  摇表（电工俗称"摇表"或"兆欧表"）是测量绝缘电阻的专用仪表，
 *  测量范围通常为 0～∞ MΩ（或 0.1 MΩ～10,000 MΩ）。
 *
 *  ── 手摇发电机式结构 ──────────────────────────────────────────────
 *  传统摇表内置一台手摇直流发电机（永磁式，额定输出 500V/1000V/2500V）：
 *    1. 摇动手柄 → 驱动发电机转子旋转 → 产生高压直流（约 120 r/min 时达额定电压）
 *    2. 高压直流施加于被测绝缘体两端
 *    3. 流过绝缘电阻的微弱电流（nA～μA 级）被测量机构检测
 *
 *  ── 比率型测量机构 ────────────────────────────────────────────────
 *  摇表表头采用"比率型磁电系"（流比计）而非普通磁电系：
 *    - 两个线圈（电流线圈 Ic 和电压线圈 Uv）同轴安装，无游丝
 *    - 电流线圈 Ic 串联 Rx（被测电阻），电流 I1 = U / Rx
 *    - 电压线圈 Uv 串联固定电阻 R0，电流 I2 = U / R0（固定）
 *    - 两线圈产生的力矩之比 = I1/I2 = R0/Rx
 *    - 指针偏转角 α = f(I1/I2) = f(R0/Rx)，与发电机电压无关！
 *    - 无游丝 → 断路（∞Ω）时指针指∞，短路（0Ω）时指针指0
 *
 *  ── 刻度特点 ──────────────────────────────────────────────────────
 *    - 非线性，反向刻度：左端为 ∞（断路），右端为 0（短路）
 *    - 低阻区（0 附近）刻度密集，高阻区（∞ 附近）刻度均匀
 *    - 测量范围：0 → ∞，中间位置约为量程额定值
 *
 *  ── 三端测量 ──────────────────────────────────────────────────────
 *    L（LINE/火线端）— 连接被测设备导体
 *    E（EARTH/地端）— 连接被测设备外壳/地
 *    G（GUARD/屏蔽端）— 消除表面漏电影响（高精度测量用）
 *
 * ═══ 渲染结构 ═════════════════════════════════════════════════════════
 *  左侧：操作与显示界面
 *    - 表壳（经典绿色/深绿色铸铁外壳，圆形表盘）
 *    - 圆形表盘：反向对数刻度（右→左：0，1，2，5，10，20，50，100，500，∞ MΩ）
 *    - 红色指针（比率型，无游丝，初始指向 ∞）
 *    - 手摇手柄（可点击旋转动画）
 *    - 测量状态指示（手柄旋转时显示高压警告）
 *    - L / E / G 三个接线端（底部）
 *
 *  右侧：原理结构剖面
 *    - 手摇发电机（永磁转子 + 电枢绕组 + 整流子）
 *    - 比率型表头（双线圈：Ic 电流线圈 + Uv 电压线圈，同轴交叉）
 *    - 串联电路：发电机 → R0（固定）→ Uv线圈 → 发电机
 *               发电机 → Ic线圈 → L端 → Rx（被测）→ E端 → 发电机
 *    - 永磁体磁场（蹄形磁铁截面）
 *    - 动态磁力线（旋转时显示）
 *    - 接线端 L / E / G（右侧底部）
 *
 * ═══ 端口 ════════════════════════════════════════════════════════════
 *  l  — L端（LINE，被测导体端，右侧底部）
 *  e  — E端（EARTH，接地端，右侧底部）
 *  g  — G端（GUARD，屏蔽端，右侧底部）
 *
 * ═══ 可配置参数 ══════════════════════════════════════════════════════
 *  label       : 仪表标识（默认 'MΩ'）
 *  voltage     : 发电机额定电压 V（默认 500，常用值：500/1000/2500）
 *  resistance  : 被测绝缘电阻 MΩ（默认 ∞，即 Infinity）
 *  cranking    : 是否正在摇动手柄（默认 false）
 *  rampTime    : 指针响应时间常数 s（默认 1.5）
 */
export class Megohmmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 460);
        this.height = Math.max(190, config.height || 580);

        this.type    = 'megohm';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:      this.label,
            voltage:    this._ratedVoltage,
            resistance: this._targetR,
            cranking:   this._cranking,
            rampTime:   this._rampTime,
        };

        // ── 端口（右侧底边）──────────────────────────────
        this.addPort(this._portL.x, this._portL.y, 'l', 'wire', 'p');
        this.addPort(this._portE.x, this._portE.y, 'e', 'wire', 'n');
    }

    // ═══════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._divX = W * 0.55;
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 8 };

        // ── 左侧：表盘 ────────────────────────────────
        const lW  = this._divX;
        const fCx = lW * 0.50;
        const fCy = H * 0.63;
        const fR  = Math.min(lW * 0.49, H * 0.45);
        this._face = { cx: fCx, cy: fCy, r: fR };

        // 指针角度（Konva：0°=右，顺时针正）
        // 摇表刻度：右端=0Ω，左端=∞，扫过 170°
        this._angleZero    = 355;   // 0 Ω 时（右上）
        this._angleInf     = 185;   // ∞ Ω 时（左上）
        this._angleSweep   = 170;   // 总扫过角度

        // 手柄位置（表盘右侧）
        this._crankCenter = { x: lW * 0.50, y: H * 0.22 };
        this._crankR      = Math.min(lW * 0.18, H * 0.15);

        // 接线端（左侧面板底部）
        const termY   = H * 0.99;
        const termSpL = lW * 0.22;
        this._faceTermL = { x: fCx - termSpL, y: termY };
        this._faceTermE = { x: fCx,            y: termY };
        this._faceTermG = { x: fCx + termSpL,  y: termY };

        // ── 右侧：原理图 ───────────────────────────────
        const rLeft = this._divX + W * 0.12;
        const rW    = W - rLeft - W * 0.022;
        const rCx   = rLeft + rW * 0.50;

        // 发电机（上半区）
        const genCx = rLeft + rW * 0.32;
        const genCy = H * 0.22;
        const         genR  = Math.min(rW * 0.50, H * 0.34);
        this._gen   = { cx: genCx, cy: genCy, r: genR };

        // 比率表头（下半区）
        const headCx = rLeft + rW * 0.32;
        const headCy = H * 0.60;
        const headR  = Math.min(rW * 0.48, H * 0.31);
        this._head   = { cx: headCx, cy: headCy, r: headR };

        // 接线端（右侧底部）— L 在右，E 在左
        const ptY     = H - 4;
        const ptSpL   = rW * 0.22;
        const ptBaseX = rLeft + rW * 0.32;
        this._termE = { x: ptBaseX - ptSpL,  y: ptY - H * 0.09 };
        this._termL = { x: ptBaseX + ptSpL,  y: ptY - H * 0.09 };
        // 端口
        this._portL = { x: this._termL.x, y: H - 2 };
        this._portE = { x: this._termE.x, y: H - 2 };

        // 新位置变量（供 R0/R1 定位用）
        const hr_ = Math.min(rW * 0.48, H * 0.31);
        const d_  = hr_ * 0.90 * 0.5 * 0.707;
        const off_ = hr_ * 0.10;
        const uvBotX = headCx - d_;
        const uvBotY = headCy + d_ + off_;
        const icBotX = headCx + d_;
        const icBotY = headCy + d_ + off_;

        // 固定电阻 R0（Uv 下端下方、圆外）
        const rY = headCy + headR + H * 0.06;
        this._r0Box = {
            x: uvBotX - rW * 0.04,
            y: rY,
            w: rW * 0.08,
            h: H * 0.04,
        };

        // 固定电阻 R1（Ic 下端下方、圆外）
        this._r1Box = {
            x: icBotX - rW * 0.04,
            y: rY,
            w: rW * 0.08,
            h: H * 0.04,
        };

        // 被测电阻符号保留旧定义，不再绘制（兼容引用）
        this._rxBox = {
            x: rLeft + rW * 0.70,
            y: H * 0.48,
            w: rW * 0.24,
            h: H * 0.12,
        };
    }

    // ═══════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        this.label         = config.label    || 'MΩ';
        this._ratedVoltage = config.voltage  !== undefined ? parseFloat(config.voltage) : 500;
        this._rampTime     = config.rampTime !== undefined ? parseFloat(config.rampTime) : 1.5;

        // 被测电阻（MΩ），Infinity 表示断路（∞）
        const rCfg = config.resistance;
        if (rCfg === undefined || rCfg === null) {
            // 未指定时随机初始停留阻值
            const stops = [5, 10, 20, 50, 100];
            this._targetR = stops[Math.floor(Math.random() * stops.length)];
        } else {
            this._targetR = (rCfg === 'Infinity') ? Infinity : parseFloat(rCfg);
        }
        this._currentR = this._targetR;

        this._cranking     = !!config.cranking;   // 是否在摇动
        this._crankAngle   = 0;                    // 手柄当前角度（度）
        this._genAngle     = 0;                    // 发电机转子角度
        this._hvActive     = false;                // 高压是否建立

        // 指针角度（初始指向上）
        this._needleAngle  = -90;

        this._warnFlash    = 0;                    // 高压警告闪烁计时
        this._stopValue    = null;                  // 停止后随机停留阻值
    }

    /**
     * 将绝缘电阻值（MΩ）映射到指针 Konva 角度
     * 刻度：反向对数律
     *   R=0       → angleZero (330°，右端)
     *   R=∞       → angleInf  (210°，左端)
     *   R=额定中值 → 中间
     */
    _rToAngle(r) {
        if (!isFinite(r) || r >= 1000) return this._angleInf;
        if (r <= 0) return this._angleZero;

        const s = 2.4;
        const scale = 1 + 1000 * s;
        const frac = Math.log10(1 + s * r) / Math.log10(scale);
        const clampedFrac = Math.max(0, Math.min(1, frac));
        return this._angleZero - clampedFrac * this._angleSweep;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawDivider();
        this._drawFaceStatic();
        this._drawPrincipleStatic();
    }

    _drawFrame() {
        const f = this._frame;
        // 深绿色铸铁表壳
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#b4c3b4',
            stroke: '#849284',
            strokeWidth: 2,
            cornerRadius: f.rx,
        }));
        // 顶部光泽
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: f.w - 4, height: f.h * 0.08,
            fill: 'rgba(255,255,255,0.06)',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    _drawDivider() {
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 10, this._divX, this._frame.y + this._frame.h - 10],
            stroke: '#c0c0b0', strokeWidth: 1, dash: [5, 4],
        }));
    }

    // ─────────────────────────────────────────────────
    // 左侧表盘（外观）
    // ─────────────────────────────────────────────────

    _drawFaceStatic() {
        const { cx, cy, r } = this._face;
        const W = this.width, H = this.height;
        const f = this._frame;

        // 左侧面板（深绿色，仿铸铁）
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 2, y: f.y + 2,
            width: this._divX - f.x - 3, height: f.h - 4,
            fill: '#778477',
            cornerRadius: [f.rx - 1, 0, 0, f.rx - 1],
        }));

        // 表盘金属环（外）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r + 7,
            fillLinearGradientStartPoint: { x: -(r+7), y: -(r+7) },
            fillLinearGradientEndPoint:   { x:  (r+7), y:  (r+7) },
            fillLinearGradientColorStops: [0, '#707870', 0.5, '#d0d8d0', 1, '#606860'],
            stroke: '#404840', strokeWidth: 1.5,
        }));

        // 表盘面（奶白色）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#f4f0e4',
            stroke: '#c8c4b0', strokeWidth: 1,
        }));

        // 表盘内径暗晕
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillRadialGradientStartPoint:  { x: 0, y: 0 },
            fillRadialGradientEndPoint:    { x: 0, y: 0 },
            fillRadialGradientStartRadius: r * 0.55,
            fillRadialGradientEndRadius:   r,
            fillRadialGradientColorStops:  [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0.08)'],
            listening: false,
        }));

        // ── 刻度（压缩对数，20M 居中，500M 近 ∞，1000M = ∞） ──
        const majorVals = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, Infinity];
        const majorLabels = ['0', '1', '2', '5', '10', '20', '50', '100', '200', '500', '∞'];

        // 绘制导轨弧
        this._drawFaceArc(cx, cy, r * 0.94,
            Math.min(this._angleInf, this._angleZero),
            Math.max(this._angleInf, this._angleZero),
            '#404040', 1.2);

        // 主刻度
        const outerR = r * 0.94;
        const fs = Math.max(6, r * 0.11);
        majorVals.forEach((v, i) => {
            const angDeg = this._rToAngle(v);
            const angRad = angDeg * Math.PI / 180;
            const innerR = r * 0.76;

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + innerR * Math.cos(angRad), cy + innerR * Math.sin(angRad),
                ],
                stroke: '#202020', strokeWidth: 1.6, lineCap: 'round',
            }));

            const labelR = r * 0.72;
            this._staticGroup.add(new Konva.Text({
                x: cx + labelR * Math.cos(angRad) - fs * 1.2,
                y: cy + labelR * Math.sin(angRad) - fs * 0.3,
                text: majorLabels[i],
                fontSize: fs, fontFamily: 'Arial',
                fill: '#1a1a1a',
                align: 'center', width: fs * 2.4,
            }));
        });

        // 辅助刻度（小格）
        const minorVals = [0.5, 3, 4, 7, 8, 9, 15, 30, 40, 70, 80, 90, 150, 300, 400, 700, 800];
        minorVals.forEach(v => {
            const angDeg = this._rToAngle(v);
            const angRad = angDeg * Math.PI / 180;
            const inR = r * 0.84;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + outerR * Math.cos(angRad), cy + outerR * Math.sin(angRad),
                    cx + inR    * Math.cos(angRad), cy + inR    * Math.sin(angRad),
                ],
                stroke: '#606060', strokeWidth: 0.8, lineCap: 'round',
            }));
        });

        // 刻度单位
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.75, y: cy - r * 0.05,
            text: 'MΩ',
            fontSize: Math.max(9, r * 0.175), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#cc2010', width: r * 1.5, align: 'center',
        }));

        // 铭牌区（表盘上部）
        const plateW = r * 1.30, plateH = r * 0.28;
        const plateX = cx - plateW / 2, plateY = cy - r * 0.58;
        this._staticGroup.add(new Konva.Rect({
            x: plateX, y: plateY+100, width: plateW, height: plateH+10,
            fill: '#ece8d8', stroke: '#b0aa90', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: plateX + 3, y: plateY + 103,
            text: `ZC-7  ${this._ratedVoltage}V  绝缘电阻表`,
            fontSize: Math.max(7, r * 0.145), fontFamily: 'Arial',
            fill: '#202020', width: plateW - 6, align: 'center',
        }));

        // 中心轴（静态底座）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.055,
            fill: '#b0a880', stroke: '#807860', strokeWidth: 1,
        }));

        // ── 手摇手柄底座 ──────────────────────────────
        const { x: ckx, y: cky } = this._crankCenter;
        const ckR = this._crankR;

        this._staticGroup.add(new Konva.Circle({
            x: ckx, y: cky, radius: ckR + 4,
            fill: '#2a3a2a', stroke: '#506050', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: ckx, y: cky, radius: ckR * 0.30,
            fill: '#808070', stroke: '#606060', strokeWidth: 1,
        }));

        // 手柄标注
        this._staticGroup.add(new Konva.Text({
            x: ckx - ckR * 2.5, y: cky + ckR + 5,
            text: '手摇手柄', fontSize: Math.max(15, ckR * 0.35),
            fontFamily: 'Arial', fill: '#02fc62', width: ckR * 5, align: 'center',
        }));

        // ── 左侧接线端（L / E / G） ───────────────────
        const tR = Math.max(8, this.width * 0.016);
        const termDefs = [
            { pos: this._faceTermL, label: 'L', color: '#e83020' },
            { pos: this._faceTermE, label: 'E', color: '#208020' },
            { pos: this._faceTermG, label: 'G', color: '#c07010' },
        ];
        termDefs.forEach(td => {
            this._drawTerminal(td.pos.x, td.pos.y, tR, td.label, td.color);
            // 标注（正下方）
            this._staticGroup.add(new Konva.Text({
                x: td.pos.x - tR * 1.5, y: td.pos.y + tR + 2,
                text: td.label,
                fontSize: Math.max(12, tR * 0.90), fontFamily: 'Arial', fontStyle: 'bold',
                fill: td.color, width: tR * 3, align: 'center',
            }));
        });
    }

    /** 绘制弧线（折线模拟） */
    _drawFaceArc(cx, cy, radius, startDeg, endDeg, stroke, sw) {
        const steps = Math.max(20, Math.abs(endDeg - startDeg) / 2);
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

    // ─────────────────────────────────────────────────
    // 右侧原理结构（静态）
    // ─────────────────────────────────────────────────

    _drawPrincipleStatic() {
        const W = this.width, H = this.height;
        const f = this._frame;

        // 右侧面板背景（浅色原理图风格）
        this._staticGroup.add(new Konva.Rect({
            x: this._divX + 1, y: f.y + 2,
            width: W - this._divX - f.x - 2, height: f.h - 4,
            fill: '#f5f2e8',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._drawGeneratorStatic();
        this._drawRatioHeadStatic();
        this._drawR0();
        this._drawR1();
        this._drawCircuitWires();
        this._drawRightTerminals();
    }

    /** 发电机结构（N 上 / S 下，左侧负极 / 右侧正极输出） */
    _drawGeneratorStatic() {
        const { cx, cy, r } = this._gen;

        // 定子外壳（圆形）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#d8d4c8', 0.5, '#e8e4d8', 1, '#d8d4c8'],
            stroke: '#a09888', strokeWidth: 2,
        }));

        // 永磁体（N 上 / S 下）
        const mW = r * 0.62, mH = r * 0.20;
        [{ dy: -r * 0.78, label: 'N', c: '#3040c0' }, { dy: r * 0.78 - mH, label: 'S', c: '#c02030' }]
        .forEach(m => {
            this._staticGroup.add(new Konva.Rect({
                x: cx - mW / 2, y: cy + m.dy,
                width: mW, height: mH,
                fill: m.c, stroke: '#202020', strokeWidth: 1, cornerRadius: 2,
            }));
            this._staticGroup.add(new Konva.Text({
                x: cx - mW / 2, y: cy + m.dy - 3,
                text: m.label,
                fontSize: Math.max(8, mW * 0.45), fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#ffffff', width: mW, align: 'center',
            }));
        });

        // 电枢绕组（中央椭圆）
        this._staticGroup.add(new Konva.Ellipse({
            x: cx, y: cy,
            radiusX: r * 0.36, radiusY: r * 0.52,
            fill: '#e8d4b0',
            stroke: '#b09868', strokeWidth: 1.5,
        }));

        // 左侧负极输出端子（−）
        const tR = Math.max(4, r * 0.065);
        this._staticGroup.add(new Konva.Circle({
            x: cx - r * 0.68, y: cy, radius: tR,
            fill: '#4080e0', stroke: '#2050a0', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - r * 0.68 - 12, y: cy + tR + 2,
            text: '−', fontSize: Math.max(18, r * 0.16),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#70b0ff',
        }));

        // 右侧正极输出端子（+）
        this._staticGroup.add(new Konva.Circle({
            x: cx + r * 0.68, y: cy, radius: tR,
            fill: '#e05030', stroke: '#b03010', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx + r * 0.68 +4, y: cy + tR + 2,
            text: '+', fontSize: Math.max(18, r * 0.16),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#ff8060',
        }));

        // 发电机标注
        this._staticGroup.add(new Konva.Text({
            x: cx - r, y: cy - r - 16,
            text: '手摇发电机',
            fontSize: Math.max(10, r * 0.22), fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#505050', width: r * 2,  align: 'center',
        }));
    }

    /** 比率型表头 — 双线圈窄条交叉 ±45° */
    _drawRatioHeadStatic() {
        const { cx, cy, r } = this._head;

        // 永磁体外壳
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#e0dcd0',
            stroke: '#a09888', strokeWidth: 2,
        }));

        // 磁极（N/S，左右）
        const mpW = r * 0.20, mpH = r * 0.55;
        [{ dx: -r * 0.72, label: 'N', c: '#5070d0' }, { dx: r * 0.72 - mpW, label: 'S', c: '#d05050' }]
        .forEach(m => {
            this._staticGroup.add(new Konva.Rect({
                x: cx + m.dx, y: cy - mpH / 2,
                width: mpW, height: mpH,
                fill: m.c, stroke: '#202020', strokeWidth: 1, cornerRadius: 2,
            }));
        });

        // 气隙 + 圆柱铁心
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.55,
            fill: '#e8e4d8',
            stroke: '#b0a898', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.28,
            fill: '#d0ccc0',
            stroke: '#a09888', strokeWidth: 1,
        }));

        // 转轴（中心）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy + r * 0.10, radius: r * 0.09,
            fill: '#c8b858', stroke: '#a08820', strokeWidth: 1.5,
        }));

        // 线圈标注
        const lfs = Math.max(14, r * 0.20);
        this._staticGroup.add(new Konva.Text({
            x: cx - r*1.2 , y: cy -  r *1.2,
            text: 'Ic（电流线圈）', fontSize: Math.max(14, lfs * 0.72),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#cc3020',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx + r * 0.3, y: cy  - r * 1.2,
            text: 'Uv（电压线圈）', fontSize: Math.max(14, lfs * 0.72),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#8d7806',
        }));

        // 表头标注
        this._staticGroup.add(new Konva.Text({
            x: cx - r, y: cy + r + 5,
            text: '比率型表头',
            fontSize: Math.max(12, r * 0.20), fontFamily: 'Arial',fontStyle: 'bold',
            fill: '#505050', width: r * 2, align: 'center',
        }));
    }

    /** 固定电阻 R0（小矩形） */
    _drawR0() {
        const { x, y, w, h } = this._r0Box;
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#d8e0cc', stroke: '#608050', strokeWidth: 1.5, cornerRadius: 1,
        }));
    }

    /** 固定电阻 R1（小矩形） */
    _drawR1() {
        const { x, y, w, h } = this._r1Box;
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#e0ccd0', stroke: '#a05060', strokeWidth: 1.5, cornerRadius: 1,
        }));
    }

    /** 电路连接导线 */
    _drawCircuitWires() {
        const { cx: gx, cy: gy, r: gr } = this._gen;
        const { cx: hx, cy: hy, r: hr } = this._head;
        const { x: r0x, y: r0y, w: r0w, h: r0h } = this._r0Box;
        const { x: r1x, y: r1y, w: r1w, h: r1h } = this._r1Box;

        // 发电机左右输出端子坐标
        const gLeft  = gx - gr * 0.68;
        const gRight = gx + gr * 0.68;

        // 线圈连接点偏移（cH/2 * sin45°）
        const d = hr * 0.90 * 0.5 * 0.707; // ≈ hr * 0.318
        const coilOffY = hr * 0.10;

        // ── 1) Gen-（左侧）→ 直下 → E 接线柱 ────────
        this._staticGroup.add(new Konva.Line({
            points: [gLeft, gy, gLeft, this._termE.y, this._termE.x, this._termE.y],
            stroke: '#4080e0', strokeWidth: 2.2, lineJoin: 'round', listening: false,
        }));

        // ── 2) Gen+（右侧）→ 向下至分叉点 ────────────
        const juncY = gy + (hy - gy) * 0.35;
        this._staticGroup.add(new Konva.Line({
            points: [gRight, gy, gRight, juncY],
            stroke: '#e05030', strokeWidth: 2.2, listening: false,
        }));
        // 分叉点标记
        this._staticGroup.add(new Konva.Circle({
            x: gRight, y: juncY, radius: 3,
            fill: '#e05030', listening: false,
        }));

        // ── 3) 分支 A（黄色）：分叉点 → Uv 上端 → 下端 → R0 → E ────
        const uvTopX = hx + d, uvTopY = hy - d + coilOffY;
        const uvBotX = hx - d, uvBotY = hy + d + coilOffY;
        this._staticGroup.add(new Konva.Line({
            points: [gRight, juncY, uvTopX, juncY, uvTopX, uvTopY],
            stroke: '#d4c020', strokeWidth: 1.8, lineJoin: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: uvTopX, y: uvTopY, radius: 2.5, fill: '#d4c020', listening: false,
        }));
        // Uv 下端 → 直下 → R0 → 直下 → E
        this._staticGroup.add(new Konva.Line({
            points: [uvBotX, uvBotY, uvBotX, r0y],
            stroke: '#d4c020', strokeWidth: 1.8, listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: uvBotX, y: uvBotY, radius: 2.5, fill: '#d4c020', listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [uvBotX, r0y + r0h, uvBotX, this._termE.y, this._termE.x, this._termE.y],
            stroke: '#d4c020', strokeWidth: 1.8, lineJoin: 'round', listening: false,
        }));

        // ── 4) 分支 B（红色）：分叉点 → Ic 上端 → 下端 → R1 → L ────
        const icTopX = hx - d, icTopY = hy - d + coilOffY;
        const icBotX = hx + d, icBotY = hy + d + coilOffY;
        this._staticGroup.add(new Konva.Line({
            points: [gRight, juncY, icTopX, juncY, icTopX, icTopY],
            stroke: '#e05030', strokeWidth: 1.8, lineJoin: 'round', listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: icTopX, y: icTopY, radius: 2.5, fill: '#e05030', listening: false,
        }));
        // Ic 下端 → 直下 → R1 → 至 L
        this._staticGroup.add(new Konva.Line({
            points: [icBotX, icBotY, icBotX, r1y],
            stroke: '#e05030', strokeWidth: 1.8, listening: false,
        }));
        this._staticGroup.add(new Konva.Circle({
            x: icBotX, y: icBotY, radius: 2.5, fill: '#e05030', listening: false,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [icBotX, r1y + r1h, icBotX, this._termL.y, this._termL.x, this._termL.y],
            stroke: '#e05030', strokeWidth: 1.8, lineJoin: 'round', listening: false,
        }));

        // ── 标注 ──
        const hvFs = Math.max(12, this.width * 0.018);
        this._staticGroup.add(new Konva.Text({
            x: gx + 10, y: gy  -24,
            text: `${this._ratedVoltage}V 直流高压`,
            fontSize: hvFs, fontFamily: 'Arial', fill: '#037726',
        }));
        const lfs2 = Math.max(16, this.width * 0.016);
        this._staticGroup.add(new Konva.Text({
            x: this._termL.x - 45, y: this._termL.y + 24,
            text: '至 Rx', fontSize: lfs2, fontFamily: 'Arial',
            fill: '#cc5030', fontStyle: 'bold',
        }));
    }

    /** 右侧接线端（L / E / G） */
    _drawRightTerminals() {
        const tR = Math.max(5, this.width * 0.016);
        const termDefs = [
            { pos: this._termL, label: 'L', color: '#e83020' },
            { pos: this._termE, label: 'E', color: '#40c040' },
        ];
        termDefs.forEach(td => {
            this._drawTerminal(td.pos.x, td.pos.y, tR, td.label, td.color);
            // 标注
            // 引线到底边端口
            this._staticGroup.add(new Konva.Line({
                points: [td.pos.x, td.pos.y + tR, td.pos.x, this.height - 2],
                stroke: td.color, strokeWidth: 1.8,
            }));
        });
    }

    /** 绘制接线柱（黄铜螺柱） */
    _drawTerminal(x, y, r, sign, color) {
        this._staticGroup.add(new Konva.Circle({
            x, y, radius: r,
            fillLinearGradientStartPoint: { x: -r, y: -r },
            fillLinearGradientEndPoint:   { x:  r, y:  r },
            fillLinearGradientColorStops: [0, '#c8b050', 0.5, '#e8d080', 1, '#a09040'],
            stroke: '#807030', strokeWidth: 3,
        }));
    }

    // ═══════════════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createCrankHandle();
        this._createGenRotor();
        this._createHeadPointer();
        this._createCoils();
        this._createHvWarning();
        this._createResistanceDisplay();
        this._createSparkGroup();
    }

    /** 指针（左侧表盘） */
    _createNeedle() {
        const { cx, cy, r } = this._face;
        const needleLen = r * 0.82;
        const tailLen   = r * 0.12;

        this._needleGroup = new Konva.Group({ x: cx, y: cy, rotation: this._needleAngle });

        // 针身
        this._needleGroup.add(new Konva.Line({
            points: [-tailLen, 0, needleLen * 0.88, 0],
            stroke: '#dd1808', strokeWidth: 2.2, lineCap: 'round',
        }));
        // 针尖三角
        this._needleGroup.add(new Konva.Line({
            points: [needleLen * 0.68, -1.8, needleLen * 0.88, 0, needleLen * 0.68, 1.8],
            closed: true, fill: '#dd1808', stroke: '#dd1808', strokeWidth: 0.5,
        }));
        // 配重
        this._needleGroup.add(new Konva.Rect({
            x: -tailLen - 5, y: -2.2, width: 7, height: 4.4,
            fill: '#aa1006', cornerRadius: 1,
        }));

        this._dynamicGroup.add(this._needleGroup);

        // 中心轴帽
        this._dynamicGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 0.056,
            fillLinearGradientStartPoint: { x: -3, y: -3 },
            fillLinearGradientEndPoint:   { x:  3, y:  3 },
            fillLinearGradientColorStops: [0, '#f0e060', 0.5, '#c8a838', 1, '#908020'],
            stroke: '#706018', strokeWidth: 1, listening: false,
        }));
    }

    /** 手摇手柄（左侧，可点击） */
    _createCrankHandle() {
        const { x: ckx, y: cky } = this._crankCenter;
        const ckR = this._crankR;

        this._crankGroup = new Konva.Group({ x: ckx, y: cky, rotation: this._crankAngle });

        // 曲柄臂
        this._crankGroup.add(new Konva.Rect({
            x: 0, y: -3,
            width: ckR * 1.10, height: 6,
            fill: '#808878',
            stroke: '#606860', strokeWidth: 1, cornerRadius: 3,
        }));

        // 手柄握持球
        this._crankGroup.add(new Konva.Circle({
            x: ckR * 1.10, y: 0, radius: ckR * 0.32,
            fill: '#c8b870',
            stroke: '#a09050', strokeWidth: 1,
        }));

        this._dynamicGroup.add(this._crankGroup);
    }

    /** 发电机转子（右侧原理图） */
    _createGenRotor() {
        const { cx, cy, r } = this._gen;

        this._genRotorGroup = new Konva.Group({ x: cx, y: cy, rotation: this._genAngle });

        // 电枢绕组（旋转椭圆）
        this._genRotorGroup.add(new Konva.Ellipse({
            x: 0, y: 0,
            radiusX: r * 0.36, radiusY: r * 0.52,
            fill: 'transparent',
            stroke: '#e0a840', strokeWidth: 2,
        }));

        // 绕组方向线（十字）
        this._genRotorGroup.add(new Konva.Line({
            points: [-r * 0.36, 0, r * 0.36, 0],
            stroke: '#c09030', strokeWidth: 1.5, lineCap: 'round',
        }));
        this._genRotorGroup.add(new Konva.Line({
            points: [0, -r * 0.52, 0, r * 0.52],
            stroke: '#c09030', strokeWidth: 1.5, lineCap: 'round',
        }));

        // 磁力线（4条，随转子旋转）
        for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * Math.PI * 2;
            const x0 = r * 0.18 * Math.cos(ang), y0 = r * 0.18 * Math.sin(ang);
            const x1 = r * 0.45 * Math.cos(ang), y1 = r * 0.45 * Math.sin(ang);
            this._genRotorGroup.add(new Konva.Line({
                points: [x0, y0, x1, y1],
                stroke: 'rgba(255,220,60,0.50)', strokeWidth: 1,
                lineCap: 'round', listening: false,
            }));
        }

        this._dynamicGroup.add(this._genRotorGroup);
    }

    /** 表头内指针（右侧原理图，与左侧表盘同步） */
    _createHeadPointer() {
        const { cx, cy, r } = this._head;

        this._headPointerGroup = new Konva.Group({ x: cx, y: cy, rotation: -90 });

        // 黑色指针（含三角针尖）
        const needleLen = r * 1.40;
        this._headPointerGroup.add(new Konva.Line({
            points: [-r * 0.08, 0, needleLen * 0.85, 0],
            stroke: '#1a1a1a', strokeWidth: 2.5, lineCap: 'round',
        }));
        this._headPointerGroup.add(new Konva.Line({
            points: [needleLen * 0.70, -2.8, needleLen * 0.90, 0, needleLen * 0.70, 2.8],
            closed: true, fill: '#1a1a1a', stroke: '#1a1a1a', strokeWidth: 0.5,
        }));

        // 中心轴
        this._headPointerGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: r * 0.07,
            fill: '#e8d060', stroke: '#b09820', strokeWidth: 1,
        }));

        this._dynamicGroup.add(this._headPointerGroup);
    }

    /** 高压警告叠加层（摇动时闪烁） */
    _createHvWarning() {
        const { cx, cy, r } = this._face;

        this._hvWarningText = new Konva.Text({
            x: cx - r * 0.80, y: cy + r * 1.15,
            text: '⚡ 高压危险！勿触 ⚡',
            fontSize: Math.max(8, r * 0.165),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ff3010',
            width: r * 1.60, align: 'center',
            visible: false,
        });
        this._dynamicGroup.add(this._hvWarningText);
    }

    /** 电气火花（右侧 Rx 两端，测量中动画） */
    _createSparkGroup() {
        this._sparkGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._sparkGroup);
    }

    /** 阻值数字显示 */
    _createResistanceDisplay() {
        const { cx, cy, r } = this._face;
        const fs = Math.max(9, r * 0.19);

        this._rText = new Konva.Text({
            x: cx - r * 0.70,
            y: cy + r * 0.70,
            text: '∞ MΩ',
            fontSize: fs, fontFamily: 'Courier New', fontStyle: 'bold',
            fill: '#40e080',
            width: r * 1.40, align: 'center',
        });
        this._dynamicGroup.add(this._rText);
    }

    /** 双窄条线圈（动态闪烁用） */
    _createCoils() {
        const { cx, cy, r } = this._head;
        const cW = r * 0.12, cH = r * 0.90;
        const coilOffY = r * 0.10;

        // Uv 电压线圈（深黄色，右倾 45°）
        this._uvCoilNode = new Konva.Group();
        this._uvCoilNode.add(new Konva.Rect({
            x: cx - cW / 2 + 5, y: cy + coilOffY,
            width: cW, height: cH,
            fill: 'rgba(160,120,15,0.80)',
            stroke: '#b08810', strokeWidth: 1.5,
            rotation: 45,
            offsetX: cW / 2, offsetY: cH / 2,
        }));
        for (let i = 0; i < 6; i++) {
            const t = (i + 1) / 7;
            const ly = cy + coilOffY - cH / 2 + cH * t;
            const dx = (ly - cy - coilOffY) * 0.707;
            const dy = (ly - cy - coilOffY) * 0.707;
            const cx2 = cx + dx, cy2 = cy + coilOffY + dy;
            const halfW = cW * 0.45;
            this._uvCoilNode.add(new Konva.Line({
                points: [cx2 - halfW * 0.707, cy2 + halfW * 0.707,
                         cx2 + halfW * 0.707, cy2 - halfW * 0.707],
                stroke: 'rgba(255,255,255,0.15)', strokeWidth: 0.8, listening: false,
            }));
        }

        // Ic 电流线圈（深红色，左倾 45°）
        this._icCoilNode = new Konva.Group();
        this._icCoilNode.add(new Konva.Rect({
            x: cx - cW / 2 + 5, y: cy + coilOffY,
            width: cW, height: cH,
            fill: 'rgba(140,28,10,0.80)',
            stroke: '#a02010', strokeWidth: 1.5,
            rotation: -45,
            offsetX: cW / 2, offsetY: cH / 2,
        }));
        for (let i = 0; i < 6; i++) {
            const t = (i + 1) / 7;
            const ly = cy + coilOffY - cH / 2 + cH * t;
            const dx = (ly - cy - coilOffY) * 0.707;
            const dy = (ly - cy - coilOffY) * 0.707;
            const cx2 = cx - dx, cy2 = cy + coilOffY + dy;
            const halfW = cW * 0.45;
            this._icCoilNode.add(new Konva.Line({
                points: [cx2 - halfW * 0.707, cy2 - halfW * 0.707,
                         cx2 + halfW * 0.707, cy2 + halfW * 0.707],
                stroke: 'rgba(255,255,255,0.15)', strokeWidth: 0.8, listening: false,
            }));
        }

        this._dynamicGroup.add(this._uvCoilNode);
        this._dynamicGroup.add(this._icCoilNode);
    }

    // ═══════════════════════════════════════════════════
    // 交互绑定（点击手柄切换摇动状态）
    // ═══════════════════════════════════════════════════

    _bindInteraction() {
        const { x: ckx, y: cky } = this._crankCenter;
        const ckR = this._crankR;

        const hit = new Konva.Circle({
            x: ckx, y: cky, radius: ckR * 1.8, fill: 'transparent',
        });
        hit.on('click tap', () => {
            this._cranking = !this._cranking;
            if (!this._cranking) this._hvActive = false;
        });
        hit.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hit.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hit);
    }

    // ═══════════════════════════════════════════════════
    // 动态更新
    // ═══════════════════════════════════════════════════

    _updateDynamic(dt) {
        const v   = this._currentR;
        const tau = Math.max(0.1, this._rampTime);
        const a   = 1 - Math.exp(-dt / tau);

        if (this._cranking) {
            // 指针平滑跟随目标角度（取最短路径）
            const target = this._rToAngle(v);
            let diff = target - this._needleAngle;
            if (diff > 180) diff -= 360;
            else if (diff < -180) diff += 360;
            this._needleAngle += diff * a;
        } else {
            // 停止后指向停留阻值对应角度（不再归零）
            const target = isFinite(v) ? this._rToAngle(v) : -90;
            let diff = target - this._needleAngle;
            if (diff > 180) diff -= 360;
            else if (diff < -180) diff += 360;
            this._needleAngle += diff * a;
        }

        this._needleGroup.rotation(this._needleAngle);
        this._headPointerGroup.rotation(this._needleAngle);

        // 2) 手柄旋转（摇动时持续转）
        this._crankGroup.rotation(this._crankAngle);

        // 3) 发电机转子
        this._genRotorGroup.rotation(this._genAngle);

        // 4) 线圈闪烁：<10M → Ic 闪（电流线圈工作），≥10M → Uv 闪（电压线圈工作）
        const rxLow = isFinite(v) && v < 10;
        const flashOn = this._cranking && (Math.floor(this._warnFlash * 5) % 2 === 0);
        const dim = 0.12, bright = 0.75;
        if (this._cranking && rxLow) {
            this._icCoilNode.opacity(flashOn ? bright : dim);
            this._uvCoilNode.opacity(dim);
        } else if (this._cranking) {
            this._icCoilNode.opacity(dim);
            this._uvCoilNode.opacity(flashOn ? bright : dim);
        } else {
            this._icCoilNode.opacity(dim);
            this._uvCoilNode.opacity(dim);
        }

        // 5) 高压警告闪烁
        const showWarn = this._cranking && this._hvActive && (Math.floor(this._warnFlash * 3) % 2 === 0);
        this._hvWarningText.visible(showWarn);

        // 6) 测量火花（高压激励时在 Rx 两端）
        this._sparkGroup.destroyChildren();
        if (this._cranking && this._hvActive && isFinite(v) && v < 5000) {
            this._drawSparks();
        }

        // 7) 阻值数字
        if (!this._cranking) {
            this._rText.text('— MΩ');
            this._rText.fill('#606870');
        } else if (!isFinite(v) || v >= 1e6) {
            this._rText.text('∞ MΩ');
            this._rText.fill('#40e080');
        } else {
            this._rText.text(`${v >= 1000 ? (v / 1000).toFixed(1) + 'G' : v.toFixed(v < 10 ? 1 : 0)} MΩ`);
            this._rText.fill('#40e080');
        }
    }

    /** 绘制 L / E 端子间微弱放电火花（代替原 Rx 火花） */
    _drawSparks() {
        const positions = [
            { x: this._termL.x, y: this._termL.y },
            { x: this._termE.x, y: this._termE.y },
        ];
        positions.forEach(p => {
            for (let i = 0; i < 2; i++) {
                const len = 3 + Math.random() * 6;
                const ang = (Math.random() - 0.5) * Math.PI;
                this._sparkGroup.add(new Konva.Line({
                    points: [p.x, p.y,
                             p.x + len * Math.cos(ang),
                             p.y + len * Math.sin(ang)],
                    stroke: `rgba(255,${180 + Math.floor(Math.random() * 75)},30,${0.4 + Math.random() * 0.6})`,
                    strokeWidth: 0.8 + Math.random() * 0.6,
                    lineCap: 'round', listening: false,
                }));
            }
        });
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环
    // ═══════════════════════════════════════════════════

    tick(dt) {
        if (this._cranking) {
            this._stopValue = null;  // 下次停止重新随机

            // 手柄旋转：120 r/min → 720°/s
            this._crankAngle = (this._crankAngle + 720 * dt) % 360;
            this._genAngle   = (this._genAngle   + 1440 * dt) % 360;  // 转子2倍速（减速比）

            // 高压建立延迟（约 0.5s 后达到额定电压）
            this._hvActive = true;
            this._warnFlash += dt;

            // 从电路求解器获取 L-E 间等效电阻（Ω → MΩ）
            try {
                const rOhm = this.sys.voltageSolver._getEquivalentResistanceFromPorts(this.id, 'l', 'e');
                this._targetR = (isFinite(rOhm) && rOhm >= 0) ? rOhm / 1e6 : Infinity;
            } catch (_) {
                this._targetR = Infinity;
            }
        } else {
            // 停止摇动：随机停留阻值
            if (this._stopValue === null) {
                const stops = [5, 10, 20, 50, 100];
                this._stopValue = stops[Math.floor(Math.random() * stops.length)];
            }
            this._targetR = this._stopValue;
            this._warnFlash = 0;
        }

        // 指针平滑跟随目标电阻（有惯性）
        const tau   = Math.max(0.1, this._rampTime);
        const alpha = 1 - Math.exp(-dt / tau);
        if (isFinite(this._targetR) && isFinite(this._currentR)) {
            this._currentR += (this._targetR - this._currentR) * alpha;
        } else if (!isFinite(this._targetR)) {
            this._currentR = isFinite(this._currentR)
                ? this._currentR + (50000 - this._currentR) * alpha
                : Infinity;
            if (this._currentR > 9000) this._currentR = Infinity;
        } else {
            this._currentR = this._targetR;
        }

        this._updateDynamic(dt);
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════

    /** 设置被测绝缘电阻（MΩ），Infinity 表示断路 */
    setResistance(r) {
        if (r === Infinity || r === 'Infinity' || r === null) {
            this._targetR = Infinity;
        } else {
            this._targetR = Math.max(0, parseFloat(r) || 0);
        }
    }

    /** 启动/停止手摇 */
    setCranking(on) {
        this._cranking = !!on;
        if (!on) this._hvActive = false;
        if (on) this._stopValue = null;
    }

    isCranking()     { return this._cranking; }
    getResistance()  { return this._currentR; }

    update(state) {
        // state 可以是 {resistance, cranking} 对象，或直接是阻值
        if (typeof state === 'object' && state !== null) {
            if (state.resistance !== undefined) this.setResistance(state.resistance);
            if (state.cranking   !== undefined) this.setCranking(state.cranking);
        } else {
            this.setResistance(state);
        }
    }

    // ═══════════════════════════════════════════════════
    // 配置界面
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '仪表标识',              key: 'label',      type: 'text'   },
            { label: '额定电压 V（500/1000/2500）', key: 'voltage', type: 'number' },
            { label: '被测电阻 MΩ（Infinity=∞）',  key: 'resistance', type: 'text' },
            { label: '是否摇动（true/false）', key: 'cranking',   type: 'text'   },
            { label: '响应时间常数 s',         key: 'rampTime',   type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label      !== undefined) this.label          = cfg.label;
        if (cfg.voltage    !== undefined) this._ratedVoltage  = parseFloat(cfg.voltage) || 500;
        if (cfg.rampTime   !== undefined) this._rampTime      = parseFloat(cfg.rampTime) || 1.5;
        if (cfg.resistance !== undefined) this.setResistance(cfg.resistance);
        if (cfg.cranking   !== undefined) this.setCranking(cfg.cranking === 'true' || cfg.cranking === true);

        this.config = { ...this.config, ...cfg };

        this._recalcGeometry();
        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._interactGroup.destroyChildren();
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
        this._refreshCache?.();
    }

    destroy() {
        super.destroy?.();
    }
}
