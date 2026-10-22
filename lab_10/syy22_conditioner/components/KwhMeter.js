/**
 * KwhMeter — 感应式电能表（有功电能表）仿真组件
 *
 * ═══ 工作原理 ════════════════════════════════════════════════════════
 *  感应式电能表（ Induction Watt-hour Meter ）利用电磁感应原理测量
 *  交流电路的有功电能。核心结构由电压线圈、电流线圈和铝盘组成：
 *
 *  ── 磁路结构 ──────────────────────────────────────────────────────
 *    ① 上铁芯（倒山字形）
 *       - 中心柱上绕有电压线圈（细导线多匝数），产生磁通 Φᵤ ∝ U
 *       - 左右两柱构成磁路回路
 *       - 柱中心是转轴位置（从上到下贯穿）
 *
 *    ② 下铁芯（上开口 U 形，去掉中心柱）
 *       - 左右柱上各绕一个电流线圈（粗导线少匝数）
 *       - 两个电流线圈反向串联，使产生的磁通 Φᵢ 方向一致
 *       - 磁通 Φᵢ ∝ I
 *
 *    ③ 铝盘
 *       - 置于上下铁芯的气隙之间
 *       - 电压磁通 Φᵤ 和电流磁通 Φᵢ 分别穿过铝盘
 *       - 在铝盘中感应出涡流，涡流与磁通相互作用产生驱动力矩
 *
 *    ④ 制动磁铁（永久磁铁）
 *       - C 形结构，开口夹住铝盘
 *       - 铝盘转动时切割磁力线产生反电动势 → 制动力矩
 *       - 制动力矩 ∝ 转速 → 铝盘匀速转动时，转速 ∝ 有功功率
 *
 *  ── 转矩平衡 ──────────────────────────────────────────────────────
 *    驱动力矩：   T_d = k₁ · Φᵤ · Φᵢ · cosφ = k₂ · U · I · cosφ = k₂ · P
 *    制动力矩：   T_b = k₃ · n （n 为转速）
 *    平衡时：     T_d = T_b → n = (k₂/k₃) · P
 *    累计电能：   E = ∫ P·dt = (k₃/k₂) · ∫ n·dt = (k₃/k₂) · N（总转数）
 *
 *  ── 接线方式 ──────────────────────────────────────────────────────
 *    电流线圈串联于负载回路中（I+ → I-），电压线圈并联于负载两端
 *    （U+ → U-），使电能表同时响应负载电流和电压。
 *
 * ═══ 面板布局 ════════════════════════════════════════════════════════
 *  左侧（38%）：机械滚轮计数器
 *    ① 深色面板，顶部标题"电能表"
 *    ② 5 位滚轮计数器（左 3 位整数 + 小数点 + 右 2 位小数），单位 kWh
 *    ③ 底部显示实时有功功率
 *
 *  右侧（62%）：感应式电能表原理图
 *    ① 上铁芯（倒山字形）+ 中心柱电压线圈（标注 U）
 *    ② 下铁芯（U 形开口向上）+ 左右柱电流线圈（标注 I）
 *    ③ 电流回路虚线（红色）：I+ → 左线圈下端 → 左线圈上端 →
 *       右线圈上端 → 右线圈下端 → I-
 *    ④ 电压回路虚线（绿色）：U+ → 电压线圈下端 → 电压线圈上端 → U-
 *    ⑤ 铝盘（扁矩形侧视图），红色标记从左向右移动
 *    ⑥ 制动磁铁（C 形红块，标注 N/S）
 *    ⑦ 转轴（垂直虚线，从上到下贯穿）
 *    ⑧ 底部四个接线端子（I+/I-/U+/U-）
 *
 * ═══ 端口定义 ════════════════════════════════════════════════════════
 *  ip — I+（电流线圈正端）
 *  in — I-（电流线圈负端）
 *  up — U+（电压线圈正端）
 *  un — U-（电压线圈负端）
 *
 * ═══ 仿真特性 ════════════════════════════════════════════════════════
 *  类型注册为 'wattmeter'、special='WATTMETER'，由 CircuitSolver 自动
 *  在 I+/I- 间注入 0V 电压源测量电流，currentIdx 指向求解结果数组。
 *  tick(dt) 中逐帧计算 Vrms、Irms、有功功率，累加电能（kWh），
 *  铝盘转速与功率成正比，红色标记移动模拟盘片转动。
 */

import { BaseComponent } from './BaseComponent.js';

export class KwhMeter extends BaseComponent {
    // ═══════════════════════════════════════════════════
    // 构造与初始化
    // ═══════════════════════════════════════════════════

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(400, config.width  || 520);
        this.height = Math.max(240, config.height || 280);

        this.type    = 'wattmeter';
        this.special = 'WATTMETER';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.addPort(this._portIP.x, this._portIP.y, 'ip', 'wire', 'p');
        this.addPort(this._portIN.x, this._portIN.y, 'in', 'wire', 'n');
        this.addPort(this._portUP.x, this._portUP.y, 'up', 'wire', 'p');
        this.addPort(this._portUN.x, this._portUN.y, 'un', 'wire', 'n');

        // 用透明矩形覆盖组件范围以捕获点击
        const hitArea = new Konva.Rect({
            x: 0, y: 0, width: this.width, height: this.height,
            fill: 'transparent', listening: true,
        });
        hitArea.on('mousedown touchstart', () => { this._clicked = true; });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════════════
    // 几何尺寸计算
    // ═══════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        // 左右分界线：38% 给左侧计数器，62% 给右侧原理图
        this._divX = W * 0.38;
        // 外壳矩形
        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 6 };

        // ── 原理图区域及端子位置 ──────────────────────
        const rLeft = this._divX + 6;
        const rW = W - rLeft - 6;
        const rCx = rLeft + rW / 2;
        const pSpan = rW * 0.72;          // 端子分布跨度
        const pSp = pSpan / 3;             // 端子间距
        const pX0 = rCx - pSpan / 2;       // 最左端子 x
        this._portIP = { x: pX0, y: H - 2 };
        this._portIN = { x: pX0 + pSp, y: H - 2 };
        this._portUP = { x: pX0 + pSp * 2, y: H - 2 };
        this._portUN = { x: pX0 + pSpan, y: H - 2 };
        this._termCY = H - 14;             // 端子标签文字 y
        this._termLabels = [
            { x: this._portIP.x, y: H - 16, label: 'I+' },
            { x: this._portIN.x, y: H - 16, label: 'I-' },
            { x: this._portUP.x, y: H - 16, label: 'U+' },
            { x: this._portUN.x, y: H - 16, label: 'U-' },
        ];

        // ── 铁芯与线圈 ──────────────────────────────
        const pCy = H * 0.44;              // 原理图垂直中心
        this._pCx = rCx;
        this._pCy = pCy;

        const coreW = rW * 0.48;           // 铁芯总宽度
        const colW = 12;                   // 铁芯柱宽度
        const colH = H * 0.28;             // 铁芯柱长度（约占组件 1/4 高度）
        const yokeH = 8;                   // 轭铁厚度
        const gapV = Math.max(24, H * 0.05); // 上下铁芯之间气隙

        // 整个磁路结构总高 = 上柱 + 气隙 + 下柱 + 上下轭铁
        const structH = 2 * colH + gapV + 2 * yokeH;
        const structTop = pCy - structH / 2;

        // 上铁芯（倒山字形）：轭铁在上，三根柱向下延伸
        this._topCore = {
            yoke: { x: rCx - coreW / 2, y: structTop, w: coreW, h: yokeH },
            cols: [
                { x: rCx - coreW / 2, y: structTop + yokeH, w: colW, h: colH },
                { x: rCx - colW / 2, y: structTop + yokeH, w: colW, h: colH },
                { x: rCx + coreW / 2 - colW, y: structTop + yokeH, w: colW, h: colH },
            ],
        };

        // 下铁芯（U 形开口向上）：轭铁在下，左右两柱向上延伸
        const botYokeY = structTop + structH - yokeH;
        this._botCore = {
            yoke: { x: rCx - coreW / 2, y: botYokeY, w: coreW, h: yokeH },
            cols: [
                { x: rCx - coreW / 2, y: botYokeY - colH, w: colW, h: colH },
                { x: rCx + coreW / 2 - colW, y: botYokeY - colH, w: colW, h: colH },
            ],
        };

        // 电压线圈：绕在上铁芯中心柱上，略大于柱截面
        this._vCoil = {
            x: this._topCore.cols[1].x - 4,
            y: this._topCore.cols[1].y + 6,
            w: colW + 8,
            h: colH - 18,
        };

        // 两个电流线圈：分别绕在下铁芯左右柱上
        this._iCoils = [
            { x: this._botCore.cols[0].x - 4, y: this._botCore.cols[0].y + 12, w: colW + 8, h: colH - 18 },
            { x: this._botCore.cols[1].x - 4, y: this._botCore.cols[1].y + 12, w: colW + 8, h: colH - 18 },
        ];

        // ── 铝盘（侧视图：扁矩形） ──────────────────
        const diskH = Math.max(10, H * 0.040);
        const diskW = rW * 0.52;
        this._disk = {
            x: rCx - diskW / 2,
            y: pCy - diskH / 2,
            w: diskW,
            h: diskH,
        };

        // ── C 形制动磁铁（开口夹住铝盘左缘） ────────
        const bmBackX = this._disk.x - 22;   // 磁铁背部 x
        const bmBackW = 8;                    // 背部宽度
        const bmArmH = 9;                     // 上下臂高度
        const bmArmW = 14;                    // 上下臂伸出长度
        const bmTopArmY = pCy - diskH / 2 - bmArmH - 2; // 上臂 y
        const bmBotArmY = pCy + diskH / 2 + 2;           // 下臂 y
        this._brakeMag = {
            back:   { x: bmBackX, y: bmTopArmY, w: bmBackW, h: bmBotArmY - bmTopArmY + bmArmH },
            topArm: { x: bmBackX + bmBackW, y: bmTopArmY, w: bmArmW, h: bmArmH },
            botArm: { x: bmBackX + bmBackW, y: bmBotArmY, w: bmArmW, h: bmArmH },
        };

        // ── 转轴（从上到下贯穿的虚线） ──────────────
        this._axis = {
            x: rCx,
            y0: structTop + yokeH - 2,
            y1: botYokeY + yokeH + 2,
        };
    }

    // ═══════════════════════════════════════════════════
    // 仿真参数初始化
    // ═══════════════════════════════════════════════════

    _initParameters(config) {
        // CircuitSolver 赋值：电流求解结果在结果数组中的索引
        this.currentIdx = undefined;
        // CircuitSolver 赋值：当前瞬时电流值
        this.physCurrent = 0;

        // 环形缓冲区 — 用于计算 Vrms、Irms、有功功率
        this._bufLen = 200;
        this._bufV2 = new Float64Array(this._bufLen);
        this._bufI2 = new Float64Array(this._bufLen);
        this._bufP  = new Float64Array(this._bufLen);
        this._bufIdx = 0;
        this._bufCount = 0;
        this._sumV2 = 0;
        this._sumI2 = 0;
        this._sumP = 0;

        // 用户是否点击过组件（供工作流跳转判断）
        this._clicked = false;

        // 累计电能（kWh）
        this._energy = config.initialEnergy || 0;
        // 铝盘转动动画状态
        this._diskAngle = 0;    // 累计转角（弧度）
        this._diskSpeed = 0;    // 当前角速度（弧度/秒）
        // 转速系数：将功率（W）映射到角速度（rad/s）
        this._speedFactor = config.speedFactor || 0.02;
    }

    // ═══════════════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
    }

    // ═══════════════════════════════════════════════════
    // 静态部件绘制（仅构造时执行一次）
    // ═══════════════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawLeftPanel();
        this._drawRightPanel();
    }

    // ─── 外壳 ────────────────────────────────────────

    _drawFrame() {
        const f = this._frame;
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#e8e4da',
            stroke: '#908878', strokeWidth: 2,
            cornerRadius: f.rx,
        }));
    }

    // ─── 左侧：滚轮计数器面板 ──────────────────────

    _drawLeftPanel() {
        // 深色背景
        this._staticGroup.add(new Konva.Rect({
            x: this._frame.x + 2, y: this._frame.y + 2,
            width: this._divX - 4, height: this._frame.h - 4,
            fill: '#1a1a2e',
            cornerRadius: [this._frame.rx - 1, 0, 0, this._frame.rx - 1],
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x: 10, y: 6, width: this._divX - 20,
            text: '电能表',
            fontSize: 18, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#e0d8c0', align: 'center',
        }));

        // ── 5 位滚轮计数器 ──────────────────────────
        const lW = this._divX;
        const rollerW = 28, rollerH = 42, rollerGap = 3;
        const totalW = 5 * rollerW + 4 * rollerGap;
        const startX = (lW - totalW) / 2;
        this._rollerX = [];
        for (let i = 0; i < 5; i++) {
            this._rollerX.push(startX + i * (rollerW + rollerGap));
        }

        // 计数器窗口框
        this._staticGroup.add(new Konva.Rect({
            x: startX - 6, y: this.height * 0.28 - 4,
            width: totalW + 12, height: rollerH + 8,
            fill: '#0a0a1a',
            stroke: '#3a3a5a', strokeWidth: 1.5,
            cornerRadius: 3,
        }));

        // 每个滚轮的外框与刻度线
        for (let i = 0; i < 5; i++) {
            const rx = this._rollerX[i];
            const ry = this.height * 0.28;
            this._staticGroup.add(new Konva.Rect({
                x: rx, y: ry, width: rollerW, height: rollerH,
                fill: '#f8f4e8',
                stroke: '#4a4a6a', strokeWidth: 1,
                cornerRadius: 2,
            }));
            // 滚轮上的横纹（模拟机械滚轮的齿纹）
            for (let t = 1; t < 10; t++) {
                this._staticGroup.add(new Konva.Line({
                    points: [rx + 2, ry + t * rollerH / 10, rx + rollerW - 2, ry + t * rollerH / 10],
                    stroke: '#a5a5f1', strokeWidth: 0.3,
                }));
            }
        }

        // 小数点（位于第 3 与第 4 滚轮之间）
        const dpX = this._rollerX[2] + rollerW + rollerGap * 0.5;
        this._staticGroup.add(new Konva.Circle({
            x: dpX, y: this.height * 0.28 + rollerH - 10, radius: 2.5,
            fill: '#e0d8c0',
        }));

        // 单位 kWh
        this._staticGroup.add(new Konva.Text({
            x: 10, y: this.height * 0.28 + rollerH + 12,
            width: this._divX - 20,
            text: 'kWh',
            fontSize: 18, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#e0d8c0', align: 'center',
        }));

        // 实时有功功率显示
        this._pDisplayText = new Konva.Text({
            x: 10, y: this.height * 0.68,
            width: this._divX - 20,
            text: 'P = 0 W',
            fontSize: 18, fontFamily: 'Courier New',fontStyle:'bold',
            fill: 'rgb(6, 243, 85)', align: 'center',
        });
        this._staticGroup.add(this._pDisplayText);
    }

    // ─── 右侧：原理图 ──────────────────────────────

    _drawRightPanel() {
        const f = this._frame;
        const rLeft = this._divX + 1;
        this._staticGroup.add(new Konva.Rect({
            x: rLeft, y: f.y + 2,
            width: f.w - this._divX - f.x - 2, height: f.h - 4,
            fill: '#eef0f6',
            cornerRadius: [0, f.rx - 1, f.rx - 1, 0],
        }));

        this._drawIronCores();
        this._drawCoils();
        this._drawCurrentWiring();
        this._drawVoltageWiring();
        this._drawDiskStatic();
        this._drawBrakeMagnet();
        this._drawShaft();
        this._drawTerminals();
        this._drawLabels();
    }

    // ─── 铁芯 ──────────────────────────────────────

    _drawIronCores() {
        const drawCol = (col, fill, stroke) => {
            this._staticGroup.add(new Konva.Rect({
                x: col.x, y: col.y, width: col.w, height: col.h,
                fill, stroke, strokeWidth: 1.2,
            }));
        };

        const coreFill = '#8899b0';
        const coreStroke = '#506080';
        const yokeFill = '#7a8aa0';

        // 上轭铁 + 三柱
        const ty = this._topCore.yoke;
        this._staticGroup.add(new Konva.Rect({
            x: ty.x, y: ty.y, width: ty.w, height: ty.h,
            fill: yokeFill, stroke: coreStroke, strokeWidth: 1.2,
        }));
        this._topCore.cols.forEach(c => drawCol(c, coreFill, coreStroke));

        // 下轭铁 + 两柱
        const by = this._botCore.yoke;
        this._staticGroup.add(new Konva.Rect({
            x: by.x, y: by.y, width: by.w, height: by.h,
            fill: yokeFill, stroke: coreStroke, strokeWidth: 1.2,
        }));
        this._botCore.cols.forEach(c => drawCol(c, coreFill, coreStroke));
    }

    // ─── 线圈 ──────────────────────────────────────

    _drawCoils() {
        const drawCoil = (c) => {
            // 线圈骨架（半透明橙底 + 橙色边框）
            this._staticGroup.add(new Konva.Rect({
                x: c.x, y: c.y, width: c.w, height: c.h,
                fill: 'rgba(200,120,30,0.25)',
                stroke: '#c87828', strokeWidth: 1,
                cornerRadius: 1,
            }));
            // 绕组线条（水平线模拟匝数）
            const nTurns = Math.min(8, Math.floor(c.h / 8));
            for (let i = 1; i < nTurns; i++) {
                const ly = c.y + i * c.h / nTurns;
                this._staticGroup.add(new Konva.Line({
                    points: [c.x + 1, ly, c.x + c.w - 1, ly],
                    stroke: '#c06818', strokeWidth: 0.6,
                }));
            }
        };

        drawCoil(this._vCoil);
        this._iCoils.forEach(c => drawCoil(c));

        // 标注 U（电压线圈）
        this._staticGroup.add(new Konva.Text({
            x: this._vCoil.x + this._vCoil.w + 2,
            y: this._vCoil.y + 4,
            text: 'U', fontSize: 12, fontFamily: 'Arial',
            fill: '#c06818',
        }));

        // 标注 I（电流线圈）
        const ic = this._iCoils[0];
        this._staticGroup.add(new Konva.Text({
            x: ic.x + ic.w + 2,
            y: ic.y + 4,
            text: 'I', fontSize: 12, fontFamily: 'Arial',
            fill: '#c06818',
        }));
    }

    // ─── 电流回路布线 ──────────────────────────────

    _drawCurrentWiring() {
        const H = this.height;
        const st = '#b03020';
        const ty = H - 4;                     // 端子连接点 y
        const lc = this._iCoils[0];           // 左电流线圈
        const rc = this._iCoils[1];           // 右电流线圈
        const lcMx = lc.x + lc.w / 2;          // 左线圈中心 x
        const rcMx = rc.x + rc.w / 2;          // 右线圈中心 x

        // I+ → 左线圈下端
        this._staticGroup.add(new Konva.Line({
            points: [this._portIP.x, ty, this._portIP.x, lc.y + lc.h, lcMx, lc.y + lc.h],
            stroke: st, strokeWidth: 1.5, dash: [5, 3], lineCap: 'round',
        }));
        // 左线圈上端 → 右线圈上端（两线圈串联）
        this._staticGroup.add(new Konva.Line({
            points: [lcMx, lc.y, rcMx, rc.y],
            stroke: st, strokeWidth: 1.5, dash: [5, 3], lineCap: 'round',
        }));
        // 右线圈下端 → I-
        this._staticGroup.add(new Konva.Line({
            points: [rcMx, rc.y + rc.h, this._portIN.x, rc.y + rc.h, this._portIN.x, ty],
            stroke: st, strokeWidth: 1.5, dash: [5, 3], lineCap: 'round',
        }));
    }

    // ─── 电压回路布线 ──────────────────────────────

    _drawVoltageWiring() {
        const H = this.height;
        const st = '#1a7a2a';
        const ty = H - 4;
        const vc = this._vCoil;
        const vcMx = vc.x + vc.w / 2;          // 电压线圈中心 x

        // U+ → 电压线圈下端
        this._staticGroup.add(new Konva.Line({
            points: [this._portUP.x, ty, this._portUP.x, vc.y + vc.h, vcMx, vc.y + vc.h],
            stroke: st, strokeWidth: 1.5, dash: [5, 3], lineCap: 'round',
        }));
        // 电压线圈上端 → 右 → 下 → U-
        this._staticGroup.add(new Konva.Line({
            points: [vcMx, vc.y, this._portUN.x, vc.y, this._portUN.x, ty],
            stroke: st, strokeWidth: 1.5, dash: [5, 3], lineCap: 'round',
        }));
    }

    // ─── 铝盘（固定静态部分） ──────────────────────

    _drawDiskStatic() {
        const d = this._disk;
        this._diskGroupStatic = new Konva.Group({
            x: this._pCx,
            y: d.y + d.h / 2,
        });
        // 铝盘主体（侧视图：扁矩形）
        this._diskGroupStatic.add(new Konva.Rect({
            x: -d.w / 2, y: -d.h / 2,
            width: d.w, height: d.h,
            fill: '#d8d8e8',
            stroke: '#8888a0', strokeWidth: 1,
            cornerRadius: 1,
        }));
        // 转轴中心孔
        this._diskGroupStatic.add(new Konva.Circle({
            x: 0, y: 0, radius: 3.5,
            fill: '#b0b0c8', stroke: '#808098', strokeWidth: 1,
        }));
        this._staticGroup.add(this._diskGroupStatic);
    }

    // ─── C 形制动磁铁 ─────────────────────────────

    _drawBrakeMagnet() {
        const b = this._brakeMag;
        const fill = '#c84040';
        const stroke = '#882020';

        // 背部（垂直段）
        this._staticGroup.add(new Konva.Rect({
            x: b.back.x, y: b.back.y, width: b.back.w, height: b.back.h,
            fill, stroke, strokeWidth: 1, cornerRadius: 1,
        }));
        // 上臂（N 极）
        this._staticGroup.add(new Konva.Rect({
            x: b.topArm.x, y: b.topArm.y, width: b.topArm.w, height: b.topArm.h,
            fill, stroke, strokeWidth: 1, cornerRadius: [0, 2, 0, 0],
        }));
        // 下臂（S 极）
        this._staticGroup.add(new Konva.Rect({
            x: b.botArm.x, y: b.botArm.y, width: b.botArm.w, height: b.botArm.h,
            fill, stroke, strokeWidth: 1, cornerRadius: [0, 0, 2, 0],
        }));

        this._staticGroup.add(new Konva.Text({
            x: b.topArm.x + 2, y: b.topArm.y + 1,
            text: 'N', fontSize: 8, fontFamily: 'Arial',
            fill: '#fff',
        }));
        this._staticGroup.add(new Konva.Text({
            x: b.botArm.x + 2, y: b.botArm.y + 1,
            text: 'S', fontSize: 8, fontFamily: 'Arial',
            fill: '#fff',
        }));
    }

    // ─── 转轴（虚线） ──────────────────────────────

    _drawShaft() {
        const a = this._axis;
        this._staticGroup.add(new Konva.Line({
            points: [a.x, a.y0, a.x, a.y1],
            stroke: '#606060', strokeWidth: 1.5, dash: [4, 3],
        }));
        const arrLen = 20;
        this._staticGroup.add(new Konva.Arrow({
            points: [a.x, a.y1, a.x, a.y1 + arrLen],
            stroke: '#4060a0', strokeWidth: 2.5, fill: '#4060a0',
            pointerLength: 8, pointerWidth: 6,
            lineCap: 'round',
        }));        
    }

    // ─── 底部接线端子 ──────────────────────────────

    _drawTerminals() {
        const tR = 8;
        const tcy = this._termCY;
        const fs = 12;
        this._termLabels.forEach(td => {
            this._staticGroup.add(new Konva.Circle({
                x: td.x, y: tcy + 10, radius: tR,
                fill: '#e0d878', stroke: '#908030', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: td.x - 10, y: tcy + 10 + tR + 2,
                text: td.label, fontSize: fs, fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#381818', width: 20, align: 'center',
            }));
        });
    }

    // ─── 文字标注 ──────────────────────────────────

    _drawLabels() {
        // 原理图标题
        this._staticGroup.add(new Konva.Text({
            x: this._divX + 8, y: 4,
            text: '感应式电能表原理',
            fontSize: 15, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#383848',
        }));

        const diskCY = this._disk.y + this._disk.h / 2;
        // 制动磁铁标注
        this._staticGroup.add(new Konva.Text({
            x: this._brakeMag.back.x - 38, y: diskCY - 10,
            text: '制动\n电磁铁', fontSize: 12, fontFamily: 'Arial',
            fill: '#883030', width: 36, align: 'center',
        }));
        // 铝盘标注
        this._staticGroup.add(new Konva.Text({
            x: this._pCx + this._disk.w / 2 + 4, y: diskCY - 4,
            text: '铝盘', fontSize: 12, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#3868a0',
        }));
    }

    // ═══════════════════════════════════════════════════
    // 动态节点创建（每 frame 需更新的视觉元素）
    // ═══════════════════════════════════════════════════

    _createDynamicNodes() {
        this._createRollers();
        this._createDiskMarker();
    }

    // ─── 滚轮数字 ──────────────────────────────────

    _createRollers() {
        this._rollerTexts = [];
        for (let i = 0; i < 5; i++) {
            const rx = this._rollerX[i];
            const ry = this.height * 0.28;
            const txt = new Konva.Text({
                x: rx, y: ry + 6,
                width: 24, text: '0',
                fontSize: 26, fontFamily: 'Courier New', fontStyle: 'bold',
                fill: '#181818', align: 'center',
            });
            this._dynamicGroup.add(txt);
            this._rollerTexts.push(txt);
        }
    }

    // ─── 铝盘红色标记（平移模拟旋转） ──────────────

    _createDiskMarker() {
        const dh = this._disk.h;
        const dw = this._disk.w;
        const cx = this._pCx;
        const cy = this._disk.y + this._disk.h / 2;

        this._diskMarkerGroup = new Konva.Group({ x: cx, y: cy });
        this._diskMarker = new Konva.Rect({
            x: -dw / 2,
            y: -dh / 2 + 1,
            width: 3.5,
            height: dh - 2,
            fill: '#cc2020',
            cornerRadius: 1,
        });
        this._diskMarkerGroup.add(this._diskMarker);
        this._dynamicGroup.add(this._diskMarkerGroup);
    }

    // ═══════════════════════════════════════════════════
    // 状态更新
    // ═══════════════════════════════════════════════════

    /**
     * 更新滚轮显示
     * @param {number} energy - 累计电能（kWh）
     */
    _updateRollers(energy) {
        const val = Math.max(0, energy);
        const intPart = Math.floor(val);
        const decPart = Math.floor((val - intPart) * 100);

        const digits = [
            Math.floor(intPart / 100) % 10,  // 百位
            Math.floor(intPart / 10) % 10,   // 十位
            intPart % 10,                     // 个位
            Math.floor(decPart / 10) % 10,    // 十分位
            decPart % 10,                     // 百分位
        ];

        for (let i = 0; i < 5; i++) {
            if (this._rollerTexts[i]) {
                this._rollerTexts[i].text(String(digits[i]));
            }
        }
    }

    // ═══════════════════════════════════════════════════
    // tick 主循环（20fps，由 ControlSystem._tickAll 驱动）
    // ═══════════════════════════════════════════════════

    tick(dt) {
        if (!this.sys || !this.sys.voltageSolver) return;

        // ── 从电路求解器获取瞬时电压和电流 ───────────
        const solver = this.sys.voltageSolver;
        const ptc = solver.portToCluster;

        const hasV = ptc.has(`${this.id}_wire_up`) && ptc.has(`${this.id}_wire_un`);
        const hasI = ptc.has(`${this.id}_wire_ip`) && ptc.has(`${this.id}_wire_in`);

        let vInstant = 0, iInstant = 0;
        if (hasV) vInstant = solver.getPD(`${this.id}_wire_up`, `${this.id}_wire_un`) || 0;
        if (hasI && this.currentIdx !== undefined) iInstant = this.physCurrent || 0;

        // ── 更新环形缓冲区 ──────────────────────────
        const pInstant = vInstant * iInstant;
        const v2 = vInstant * vInstant;
        const i2 = iInstant * iInstant;

        this._sumV2 -= this._bufV2[this._bufIdx];
        this._bufV2[this._bufIdx] = v2;
        this._sumV2 += v2;
        this._sumI2 -= this._bufI2[this._bufIdx];
        this._bufI2[this._bufIdx] = i2;
        this._sumI2 += i2;
        this._sumP -= this._bufP[this._bufIdx];
        this._bufP[this._bufIdx] = pInstant;
        this._sumP += pInstant;

        this._bufIdx = (this._bufIdx + 1) % this._bufLen;
        if (this._bufCount < this._bufLen) this._bufCount++;

        // ── 计算有效值和有功功率 ────────────────────
        const cnt = this._bufCount;
        const vRms = hasV ? Math.sqrt(this._sumV2 / cnt) : 0;
        const iRms = hasI ? Math.sqrt(this._sumI2 / cnt) : 0;
        const pAvg = cnt > 0 ? (this._sumP / cnt) : 0;

        // ── 累计电能（dt = 0.02s/帧，结果转换为 kWh）──
        if (pAvg > 0.1) {
            // P(W) × 0.02(s) ÷ 3600000(s/h) = kWh
            this._energy += pAvg * 0.02 / 3600000;
        }

        // ── 铝盘转速动画 ────────────────────────────
        // 目标角速度与功率成正比，一阶低通滤波模拟机械惯性
        const targetSpeed = Math.abs(pAvg) * this._speedFactor;
        this._diskSpeed += (targetSpeed - this._diskSpeed) * Math.min(1, dt * 5);
        this._diskAngle += this._diskSpeed * dt;
        // 红色标记水平平移：将角度映射到 [-dw/2, +dw/2] 区间，超宽回绕
        if (this._diskMarker) {
            const dw = this._disk.w;
            const wrapX = ((this._diskAngle * dw / (2 * Math.PI)) % dw + dw) % dw - dw / 2;
            this._diskMarker.x(wrapX);
        }

        // ── 更新滚轮和功率显示 ──────────────────────
        this._updateRollers(this._energy);

        if (this._pDisplayText) {
            this._pDisplayText.text(pAvg >= 1 ? `P = ${pAvg.toFixed(0)} W` : 'P = 0 W');
        }

        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════
    // 配置对话框
    // ═══════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '初始电能 kWh', key: 'initialEnergy', type: 'number' },
            { label: '转速系数', key: 'speedFactor', type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.initialEnergy !== undefined) this._energy = parseFloat(cfg.initialEnergy) || 0;
        if (cfg.speedFactor !== undefined) this._speedFactor = parseFloat(cfg.speedFactor) || 0.02;
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
