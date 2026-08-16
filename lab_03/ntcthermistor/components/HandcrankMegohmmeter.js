import { BaseComponent } from './BaseComponent.js';

/**
 * 手摇式兆欧表仿真组件
 * （Hand-Crank Megohmmeter / Insulation Resistance Tester）
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  兆欧表（绝缘电阻表）用于测量电气设备的绝缘电阻（MΩ 级）。
 *
 *  1. 手摇发电机（Magneto Generator）：
 *     手摇把手驱动永磁式交流发电机，经整流后输出直流高压。
 *     摇速越快 → 输出电压越高（有自动调压机构）
 *     标准摇速：约 120 r/min
 *     输出电压：100V / 250V / 500V / 1000V / 2500V（不同量程）
 *
 *  2. 测量原理（流比计型）：
 *     内部由两个线圈组成流比计：
 *       ① 电流线圈（Current Coil）：与 R_x 串联，通过待测绝缘电阻
 *       ② 电压线圈（Voltage Coil）：与固定电阻 R_v 并联
 *
 *     偏转角 θ 与两线圈电流之比成正比：
 *       θ = f(I_v / I_x) = f(R_x / R_v × V_const)
 *       → 指针偏转直接反映 R_x，与电压波动无关！
 *     这是兆欧表耐电压波动的根本原因。
 *
 *  3. 刻度特点：
 *     刻度反向：左侧 ∞（断路），右侧 0（短路）
 *     刻度非线性（对数型）
 *     低阻区密集，高阻区稀疏
 *
 *  4. 测量判断依据：
 *     绝缘良好：R > 1 MΩ（指针偏向 ∞ 一侧，即左侧较大阻值）
 *     绝缘劣化：R < 0.5 MΩ（指针偏向右侧 0 端）
 *     绝缘击穿：R → 0（指针打到最右端 "0" 刻度）
 *
 *  5. 测量端子：
 *     L（LINE）：接被测设备导体
 *     E（EARTH）：接被测设备外壳/大地
 *     G（GUARD）：屏蔽端，用于消除表面漏电流影响
 *
 * ── 仿真特性 ──────────────────────────────────────────────────
 *  - 可交互手摇把手（拖拽或点击旋转）
 *  - 转速决定输出电压（摇快了才能稳定测量）
 *  - 被测绝缘电阻可调（拖拽调节或选择预设）
 *  - 指针惯性物理模拟（带阻尼的二阶系统）
 *  - 充电电容效应（大容量负载时指针缓慢移动）
 *  - 手停摇后电压衰减，指针回零
 *
 * ── 组件结构 ──────────────────────────────────────────────────
 *  ① 仪表外壳（橙黄色工业外壳，金属旋钮面板）
 *  ② 表盘（非线性 MΩ 刻度，弧形刻度线，弧形刻度标注）
 *  ③ 指针（黑色细针 + 配重圆点，带惯性阻尼）
 *  ④ 手摇把手（右侧，可拖拽旋转，带飞轮效果）
 *  ⑤ 发电机机构图示（小型示意）
 *  ⑥ 测试端子（L/E/G 三个接线柱）
 *  ⑦ 量程选择旋钮（500V / 1000V / 2500V）
 *  ⑧ 被测阻值调节区（滑块 + 预设按钮）
 *  ⑨ 数字辅助显示（实测 MΩ 值，摇速 rpm，输出电压）
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  wire_l  — L 端子（LINE，接被测导体）
 *  wire_e  — E 端子（EARTH，接被测外壳/地）
 *  wire_g  — G 端子（GUARD，屏蔽端）
 */
export class HandCrankMegohmmeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(320, config.width  || 380);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'megohmmeter';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 仪表参数 ──
        this.ranges = [500, 1000, 2500];   // 输出电压量程 V
        this.rangeIdx = config.rangeIdx ?? 1;  // 当前量程索引（默认1000V）
        this.V_rated = this.ranges[this.rangeIdx];  // 额定输出电压 V

        // ── 内部参数 ──
        this.Rv     = config.Rv     || 1e6;   // 电压线圈串联电阻 Ω（约1MΩ）
        this.Ri     = config.Ri     || 2000;  // 内阻 Ω（电流线圈）
        this.targetRPM = 120;   // 标准摇速 rpm

        // ── 状态 ──
        this.crankRPM     = 0;      // 当前摇速 rpm（物理值）
        this._crankVel    = 0;      // 摇把角速度 rad/s（动画用）
        this._crankAngle  = 0;      // 摇把当前角度 rad
        this.outputVoltage= 0;      // 当前输出电压 V
        this.Rx           = config.initRx ?? 50;  // 被测绝缘电阻 MΩ
        this._manualRx    = config.initRx ?? 50;
        this._RxTarget    = config.initRx ?? 50;

        // ── 指针物理（二阶阻尼系统）──
        this._needleAngle = 0;      // 实际指针角度 rad（0=左端∞，1=右端0）
        this._needleVel   = 0;      // 指针角速度
        this._needleDamp  = config.needleDamp || 8;    // 阻尼系数
        this._needleK     = config.needleK    || 25;   // 弹簧系数
        this._needleMass  = config.needleMass || 0.4;  // 等效质量

        // 目标指针位置（由 Rx 计算）
        this._needleTarget = 0;

        // ── 摇把交互状态 ──
        this._crankDrag   = false;
        this._crankDragStart = 0;
        this._crankLastAngle = 0;
        this._crankLastTime  = 0;
        this._autoSpin    = false;   // 自动摇动（点击启动）
        this._autoSpinVel = 0;       // 自动摇动角速度

        // ── 动画 ──
        this._phase       = 0;
        this._sparkPhase  = 0;
        this._genAngle    = 0;     // 发电机内部转子角度

        // ── 几何布局 ──
        const margin = 14;

        // 表盘（主体上半）
        this._meterCX  = Math.round(this.width * 0.46);
        this._meterCY  = Math.round(this.height * 0.38);
        this._meterR   = Math.round(Math.min(this.width * 0.32, this.height * 0.30));

        // 仪表外壳
        this._caseX    = margin;
        this._caseY    = margin;
        this._caseW    = this.width - margin * 2;
        this._caseH    = Math.round(this.height * 0.78);

        // 手摇把手（右侧）
        this._crankCX  = this._caseX + this._caseW - Math.round(this._caseW * 0.12);
        this._crankCY  = this._meterCY;
        this._crankR   = Math.round(this._meterR * 0.30);  // 摇把圆盘半径
        this._crankArmLen = Math.round(this._crankR * 1.8); // 摇把臂长度
        this._crankHandleR= Math.round(this._crankR * 0.22);// 手柄圆珠半径

        // 端子区（下方）
        this._termY    = this._caseY + this._caseH - 42;
        this._termLX   = Math.round(this.width * 0.24);
        this._termEX   = Math.round(this.width * 0.46);
        this._termGX   = Math.round(this.width * 0.68);

        // 数字显示区（表盘下方）
        this._dispY    = this._meterCY + this._meterR + 12;
        this._dispH    = 38;

        // 被测电阻调节区（表盘左侧）
        this._rxPanelX = this._caseX + 6;
        this._rxPanelY = this._dispY + this._dispH + 8;
        this._rxPanelW = this._caseW - 12;
        this._rxPanelH = this.height - this._rxPanelY - 8;

        this._lastTs   = null;
        this._animId   = null;
        this.knobs     = {};

        this.config = {
            id: this.id, rangeIdx: this.rangeIdx,
            initRx: this.Rx,
        };

        this._init();

        this.addPort(this._termLX, this.height - 6, 'l', 'wire', 'L');
        this.addPort(this._termEX, this.height - 6, 'e', 'wire', 'E');
        this.addPort(this._termGX, this.height - 6, 'g', 'wire', 'G');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawLabel();
        this._drawCase();
        this._drawMeterFace();
        this._drawScale();
        this._drawNeedle();
        this._drawCrankAssembly();
        this._drawGenerator();
        this._drawTerminals();
        this._drawRangeSelector();
        this._drawDigitalDisplay();
        this._drawRxPanel();
        this._drawSparkLayer();
        this._setupCrankInteraction();
        this._startAnimation();
    }

    _drawLabel() {
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: '手摇式兆欧表（Megohmmeter）— 拖拽把手旋转',
            fontSize: 12, fontStyle: 'bold', fill: '#1a2634', align: 'center',
        }));
    }

    // ── 仪表外壳 ─────────────────────────────
    _drawCase() {
        const { _caseX: cx, _caseY: cy, _caseW: cw, _caseH: ch } = this;

        // 外壳主体（工业橙黄色）
        const body = new Konva.Rect({ x: cx, y: cy, width: cw, height: ch, fill: '#e8740a', stroke: '#9a4a00', strokeWidth: 2.5, cornerRadius: 8 });
        // 内嵌深色面板
        const panel = new Konva.Rect({ x: cx+8, y: cy+8, width: cw-16, height: ch-16, fill: '#1a0d00', stroke: '#3a2000', strokeWidth: 1, cornerRadius: 6 });
        // 面板边框
        const panelBorder = new Konva.Rect({ x: cx+6, y: cy+6, width: cw-12, height: ch-12, fill: 'none', stroke: '#c05a00', strokeWidth: 1.5, cornerRadius: 7 });
        // 外壳高光
        this.group.add(new Konva.Rect({ x: cx+4, y: cy+4, width: cw-8, height: 6, fill: 'rgba(255,255,255,0.18)', cornerRadius: [6,6,0,0] }));
        // 底部铭牌
        this.group.add(new Konva.Rect({ x: cx+12, y: cy+ch-26, width: cw-24, height: 18, fill: '#2a1400', cornerRadius: 2 }));
        this._nameplateText = new Konva.Text({ x: cx+12, y: cy+ch-22, width: cw-24, text: 'MEGOHMMETER  ZC-7', fontSize: 8, fontStyle: 'bold', fill: '#c8870a', align: 'center', letterSpacing: 2 });

        this.group.add(body, panel, panelBorder, this._nameplateText);
    }

    // ── 表盘面 ────────────────────────────────
    _drawMeterFace() {
        const cx = this._meterCX, cy = this._meterCY, R = this._meterR;

        // 表盘圆形背景
        const faceOuter = new Konva.Circle({ x: cx, y: cy, radius: R+6, fill: '#c05a00', stroke: '#8a3a00', strokeWidth: 1.5 });
        const faceInner = new Konva.Circle({ x: cx, y: cy, radius: R+3, fill: '#f5f0e8', stroke: '#d0b880', strokeWidth: 1 });
        const faceMain  = new Konva.Circle({ x: cx, y: cy, radius: R,   fill: '#f5f0e8' });
        // 表盘玻璃反光（椭圆高光）
        this.group.add(new Konva.Ellipse({ x: cx-R*0.22, y: cy-R*0.3, radiusX: R*0.25, radiusY: R*0.12, fill: 'rgba(255,255,255,0.35)' }));
        // 表盘下半弧形遮罩（遮挡不需要显示的部分）
        this.group.add(new Konva.Arc({ x: cx, y: cy, innerRadius: 0, outerRadius: R+1, angle: 65, rotation: 157.5, fill: '#f5f0e8' }));

        // 品牌文字
        this.group.add(new Konva.Text({ x: cx-40, y: cy+R*0.05, width: 80, text: 'MΩ', fontSize: 18, fontStyle: 'bold', fill: '#8a3a00', align: 'center' }));

        // 量程显示（小字）
        this._rangeText = new Konva.Text({ x: cx-30, y: cy+R*0.25, width: 60, text: `${this.V_rated}V`, fontSize: 11, fontStyle: 'bold', fill: '#c05a00', align: 'center' });

        this.group.add(faceOuter, faceInner, faceMain, this._rangeText);
    }

    // ── 刻度盘（弧形非线性 MΩ 刻度）──────────
    _drawScale() {
        const cx = this._meterCX, cy = this._meterCY, R = this._meterR;

        // 刻度弧范围：从左端（约-60°即240°）到右端（约+60°即300°）
        // 定义：指针角度从 θ_min（左∞）到 θ_max（右0）
        // 用屏幕角度：起始 230°（左），结束 310°（右）— 注意：Konva角度从3点钟方向顺时针
        const ARC_START_DEG = 220;  // 左端（∞端）
        const ARC_END_DEG   = 320;  // 右端（0端）
        this._arcStartDeg = ARC_START_DEG;
        this._arcEndDeg   = ARC_END_DEG;
        this._arcSpanDeg  = ARC_END_DEG - ARC_START_DEG;

        // 刻度标注值（MΩ）—— 从右到左（0到∞）
        const scaleValues = [0, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, Infinity];
        // 刻度盘弧线
        this.group.add(new Konva.Arc({ x: cx, y: cy, innerRadius: R*0.85, outerRadius: R*0.88, angle: this._arcSpanDeg, rotation: ARC_START_DEG-90, fill: '#8a3a00', opacity: 0.6 }));

        // 小刻度线
        const nMinor = 100;
        for (let i = 0; i <= nMinor; i++) {
            const ratio = i / nMinor;  // 0=右端(0Ω), 1=左端(∞)
            // 非线性映射：右到左，log10 比例
            const Rx_norm = ratio;  // 直接线性（刻度位置由 _rxToNeedle 决定）
            const degAngle = ARC_START_DEG + (1 - ratio) * this._arcSpanDeg;
            const rad = degAngle * Math.PI / 180 - Math.PI/2;  // 转为数学角
            const isMaj = (i % 10 === 0);
            const isMid = (i % 5 === 0);
            const r1 = R*0.86, r2 = isMaj ? R*0.96 : isMid ? R*0.92 : R*0.89;
            this.group.add(new Konva.Line({
                points: [cx+r1*Math.cos(rad), cy+r1*Math.sin(rad), cx+r2*Math.cos(rad), cy+r2*Math.sin(rad)],
                stroke: '#5a3000', strokeWidth: isMaj ? 1.5 : 0.7,
            }));
        }

        // 标注关键刻度值（非线性映射）
        const keyLabels = [
            { v: 0,    label: '0',    offset: { x: 4, y: -4 } },
            { v: 0.1,  label: '0.1',  offset: { x: 0, y: 0 } },
            { v: 0.5,  label: '0.5',  offset: { x: 0, y: 0 } },
            { v: 1,    label: '1',    offset: { x: 0, y: 0 } },
            { v: 2,    label: '2',    offset: { x: 0, y: 0 } },
            { v: 5,    label: '5',    offset: { x: 0, y: 0 } },
            { v: 10,   label: '10',   offset: { x: 0, y: 0 } },
            { v: 20,   label: '20',   offset: { x: 0, y: 0 } },
            { v: 50,   label: '50',   offset: { x: 0, y: 0 } },
            { v: 100,  label: '100',  offset: { x: 0, y: 0 } },
            { v: 500,  label: '500',  offset: { x: 0, y: 0 } },
            { v: 2000, label: '∞',   offset: { x: -4, y: -4 } },
        ];
        keyLabels.forEach(({ v, label }) => {
            const needlePos = this._rxToNeedle(v);
            const degAngle  = ARC_START_DEG + needlePos * this._arcSpanDeg;
            const rad = degAngle * Math.PI / 180 - Math.PI/2;
            const lr  = R * 0.98;
            const lx  = cx + lr * Math.cos(rad);
            const ly2 = cy + lr * Math.sin(rad);
            const fontSize = (v === 0 || v === 2000) ? 10 : (v >= 100 ? 8 : 9);
            this.group.add(new Konva.Text({ x: lx-12, y: ly2-6, width: 24, text: label, fontSize, fontStyle: 'bold', fill: '#3a1a00', align: 'center' }));
        });

        // 红色危险区（低阻值，右端0~0.5MΩ区域）
        const dangerStart = ARC_START_DEG + this._rxToNeedle(0) * this._arcSpanDeg;
        const dangerEnd   = ARC_START_DEG + this._rxToNeedle(0.5) * this._arcSpanDeg;
        this.group.add(new Konva.Arc({ x: cx, y: cy, innerRadius: R*0.85, outerRadius: R*0.90, angle: dangerEnd-dangerStart, rotation: dangerStart-90, fill: 'rgba(200,30,30,0.3)' }));

        // 绿色安全区（高阻值，1MΩ以上）
        const safeStart = ARC_START_DEG + this._rxToNeedle(1) * this._arcSpanDeg;
        const safeEnd   = ARC_START_DEG + this._rxToNeedle(2000) * this._arcSpanDeg;
        this.group.add(new Konva.Arc({ x: cx, y: cy, innerRadius: R*0.85, outerRadius: R*0.90, angle: safeEnd-safeStart, rotation: safeStart-90, fill: 'rgba(30,150,30,0.25)' }));

        // 刻度值标注 MΩ
        this.group.add(new Konva.Text({ x: cx-24, y: cy-R*0.5, width: 48, text: 'MΩ', fontSize: 9, fontStyle: 'bold', fill: '#5a3000', align: 'center' }));
    }

    // ── 将被测电阻值（MΩ）转换为指针位置（0~1）
    // 0=右端(0Ω/∞刻度)，1=左端(∞阻值/0刻度)
    // 注意刻度逻辑：表盘左端=∞电阻=绝缘良好，右端=0电阻=绝缘击穿
    _rxToNeedle(Rx_MOhm) {
        // Rx_MOhm：0=短路（右端），∞=断路（左端）
        if (Rx_MOhm <= 0)    return 0;   // 最右端（0刻度）
        if (Rx_MOhm > 1000)  return 1;   // 最左端（∞刻度）
        // 非线性映射（对数）
        const logRx = Math.log10(Rx_MOhm + 0.01);  // 0.01~3 对应 0~左端
        const logMax = Math.log10(1001);
        return Math.min(1, Math.max(0, logRx / logMax));
    }

    // ── 指针 ─────────────────────────────────
    _drawNeedle() {
        const cx = this._meterCX, cy = this._meterCY, R = this._meterR;

        this._needleGroup = new Konva.Group({ x: cx, y: cy });

        // 配重（指针根部小圆）
        this._needleGroup.add(new Konva.Circle({ radius: R*0.07, fill: '#3a2000', stroke: '#1a0a00', strokeWidth: 1 }));
        // 指针本体（细长黑线）
        this._needleLine = new Konva.Line({ points: [0, 0, R*0.82, 0], stroke: '#1a0a00', strokeWidth: 1.8, lineCap: 'round' });
        // 指针尾（配重方向）
        this._needleTail = new Konva.Line({ points: [0, 0, -R*0.18, 0], stroke: '#8a3a00', strokeWidth: 3, lineCap: 'round' });
        // 指针中心铆钉
        this._needleGroup.add(new Konva.Circle({ radius: R*0.04, fill: '#c05a00', stroke: '#8a3a00', strokeWidth: 1 }));

        this._needleGroup.add(this._needleTail, this._needleLine);
        this.group.add(this._needleGroup);
    }

    // ── 手摇把手 ─────────────────────────────
    _drawCrankAssembly() {
        const cx = this._crankCX, cy = this._crankCY;
        const R  = this._crankR, armLen = this._crankArmLen, hR = this._crankHandleR;

        // 摇把底座（固定圆盘）
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R+6, fill: '#8a3a00', stroke: '#5a2000', strokeWidth: 2 }));
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: R+4, fill: '#c05a00', stroke: '#8a3a00', strokeWidth: 1 }));

        // 摇把旋转组（含圆盘+臂+手柄）
        this._crankGroup = new Konva.Group({ x: cx, y: cy });

        // 圆盘
        this._crankGroup.add(new Konva.Circle({ radius: R, fill: '#e8740a', stroke: '#c05a00', strokeWidth: 1.5 }));
        this._crankGroup.add(new Konva.Circle({ radius: R*0.25, fill: '#8a3a00' }));
        // 高光
        this._crankGroup.add(new Konva.Circle({ x: -R*0.28, y: -R*0.28, radius: R*0.16, fill: 'rgba(255,255,255,0.22)' }));
        // 刻线（每45°一根）
        for (let i = 0; i < 8; i++) {
            const a = (i/8)*Math.PI*2;
            this._crankGroup.add(new Konva.Line({ points: [R*0.3*Math.cos(a), R*0.3*Math.sin(a), R*0.8*Math.cos(a), R*0.8*Math.sin(a)], stroke: '#c05a00', strokeWidth: 0.8, opacity: 0.5 }));
        }

        // 摇臂（从圆盘延伸）
        this._crankArm = new Konva.Line({ points: [R*0.1, 0, R+armLen, 0], stroke: '#5a2000', strokeWidth: 6, lineCap: 'round' });
        this._crankGroup.add(this._crankArm);

        // 手柄圆球
        this._crankHandle = new Konva.Circle({ x: R+armLen, y: 0, radius: hR, fill: '#3a1000', stroke: '#c05a00', strokeWidth: 1.5 });
        this._crankHandleGlint = new Konva.Circle({ x: R+armLen-hR*0.3, y: -hR*0.3, radius: hR*0.28, fill: 'rgba(255,220,180,0.35)' });
        this._crankGroup.add(this._crankHandle, this._crankHandleGlint);

        // 速度指示圆弧
        this._speedArc = new Konva.Arc({ x: 0, y: 0, innerRadius: R*1.15, outerRadius: R*1.25, angle: 0, fill: '#66bb6a', rotation: -90 });
        this._crankGroup.add(this._speedArc);

        this.group.add(this._crankGroup);

        // 摇把标注
        this.group.add(new Konva.Text({ x: cx-20, y: cy+R+8, width: 40, text: '手摇把', fontSize: 8, fill: '#c05a00', align: 'center' }));
        this.group.add(new Konva.Text({ x: cx-20, y: cy+R+18, width: 40, text: '120r/min', fontSize: 7.5, fontFamily: 'Courier New, monospace', fill: '#8a5000', align: 'center' }));
    }

    // ── 发电机示意图（小型，摇把下方）──────
    _drawGenerator() {
        const cx = this._crankCX, cy = this._crankCY + this._crankR + 46;
        const r  = Math.round(this._crankR * 0.65);

        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: r+4, fill: '#3a2000', stroke: '#2a1000', strokeWidth: 1 }));
        this.group.add(new Konva.Circle({ x: cx, y: cy, radius: r,   fill: '#1a0d00' }));

        // 发电机转子（动态）
        this._genGroup = new Konva.Group({ x: cx, y: cy });
        // 永磁体（N/S 两极）
        for (let i = 0; i < 2; i++) {
            const a = i * Math.PI;
            const col = i === 0 ? '#ef5350' : '#42a5f5';
            const lbl = i === 0 ? 'N' : 'S';
            this._genGroup.add(new Konva.Arc({ innerRadius: r*0.35, outerRadius: r*0.85, angle: 155, rotation: a*180/Math.PI - 77.5 - 90, fill: col, opacity: 0.8 }));
        }
        // 输出线圈（固定）
        this.group.add(new Konva.Rect({ x: cx-r*0.12, y: cy-r*0.92, width: r*0.24, height: r*1.84, fill: 'none', stroke: '#ff8f00', strokeWidth: 2, opacity: 0.6 }));
        this.group.add(this._genGroup);
        this.group.add(new Konva.Text({ x: cx-16, y: cy+r+4, width: 32, text: '发电机', fontSize: 7.5, fill: '#c05a00', align: 'center' }));
    }

    // ── 接线端子（L/E/G）──────────────────
    _drawTerminals() {
        const ty = this._termY;

        const terms = [
            { x: this._termLX, label: 'L', color: '#ef5350', desc: 'LINE' },
            { x: this._termEX, label: 'E', color: '#66bb6a', desc: 'EARTH' },
            { x: this._termGX, label: 'G', color: '#ffd54f', desc: 'GUARD' },
        ];
        terms.forEach(({ x, label, color, desc }) => {
            // 端子柱
            this.group.add(new Konva.Rect({ x: x-10, y: ty, width: 20, height: 28, fill: color, stroke: this._darken(color), strokeWidth: 1.5, cornerRadius: [2,2,0,0] }));
            // 端子螺丝
            this.group.add(new Konva.Circle({ x, y: ty+10, radius: 7, fill: '#f5f0e8', stroke: '#5a3000', strokeWidth: 1 }));
            this.group.add(new Konva.Line({ points: [x-5, ty+10, x+5, ty+10], stroke: '#3a2000', strokeWidth: 2 }));
            this.group.add(new Konva.Line({ points: [x, ty+5, x, ty+15], stroke: '#3a2000', strokeWidth: 2 }));
            // 标签
            this.group.add(new Konva.Text({ x: x-10, y: ty+20, width: 20, text: label, fontSize: 10, fontStyle: 'bold', fill: '#f5f0e8', align: 'center' }));
            this.group.add(new Konva.Text({ x: x-20, y: ty+30, width: 40, text: desc, fontSize: 7, fill: '#8a5000', align: 'center' }));
        });
    }

    _darken(hex) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgb(${Math.round(r*0.6)},${Math.round(g*0.6)},${Math.round(b*0.6)})`;
    }

    // ── 量程选择旋钮 ─────────────────────────
    _drawRangeSelector() {
        const sx = this._caseX + 18, sy = this._meterCY - this._meterR * 0.3;
        const R  = 14;

        this.group.add(new Konva.Circle({ x: sx, y: sy, radius: R+4, fill: '#5a2000', stroke: '#3a1000', strokeWidth: 1.5 }));
        this._rangeKnob = new Konva.Group({ x: sx, y: sy });
        this._rangeKnob.add(new Konva.Circle({ radius: R, fill: '#e8740a', stroke: '#c05a00', strokeWidth: 1 }));
        this._rangeKnob.add(new Konva.Line({ points: [0, -R*0.5, 0, -R+2], stroke: '#3a1000', strokeWidth: 2.5, lineCap: 'round' }));
        this._rangeKnob.add(new Konva.Circle({ radius: 3, fill: '#3a1000' }));

        // 三档标注
        this.ranges.forEach((v, i) => {
            const a = ((i / (this.ranges.length-1)) * 120 - 60) * Math.PI / 180 - Math.PI/2;
            const lx2 = sx + (R+14)*Math.cos(a), ly2 = sy + (R+14)*Math.sin(a);
            const isAct = i === this.rangeIdx;
            this.group.add(new Konva.Text({ x: lx2-16, y: ly2-7, width: 32, text: v+'V', fontSize: 7.5, fontStyle: isAct?'bold':'normal', fill: isAct?'#ff8f00':'#8a5000', align: 'center' }));
        });

        // 点击切换
        this._rangeKnob.on('click tap', () => {
            this.rangeIdx = (this.rangeIdx + 1) % this.ranges.length;
            this.V_rated  = this.ranges[this.rangeIdx];
            const newAngle = ((this.rangeIdx/(this.ranges.length-1))*120-60);
            this._rangeKnob.rotation(newAngle);
            if (this._rangeText) this._rangeText.text(`${this.V_rated}V`);
            this._refreshCache();
        });

        this.group.add(this._rangeKnob);
        this.group.add(new Konva.Text({ x: sx-20, y: sy+R+6, width: 40, text: '量程', fontSize: 7.5, fill: '#8a5000', align: 'center' }));
    }

    // ── 数字辅助显示 ─────────────────────────
    _drawDigitalDisplay() {
        const dx = this._caseX + 10, dy = this._dispY;
        const dw = this._caseW - 20 - this._crankR * 2.4, dh = this._dispH;

        const bg = new Konva.Rect({ x: dx, y: dy, width: dw, height: dh, fill: '#0a1a08', stroke: '#1a3010', strokeWidth: 1, cornerRadius: 3 });
        this._dispRx  = new Konva.Text({ x: dx+4, y: dy+3, width: dw-8, text: 'R = -- MΩ', fontSize: 13, fontFamily: 'Courier New, monospace', fontStyle: 'bold', fill: '#33ff66', align: 'center' });
        this._dispRpm = new Konva.Text({ x: dx+4, y: dy+20, width: dw/2-4, text: '0 r/min', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#66cc44', align: 'left' });
        this._dispV   = new Konva.Text({ x: dx+dw/2, y: dy+20, width: dw/2-4, text: '0 V', fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#88dd55', align: 'right' });
        this.group.add(bg, this._dispRx, this._dispRpm, this._dispV);
    }

    // ── 被测电阻调节区（表盘下方）────────────
    _drawRxPanel() {
        const px = this._rxPanelX, py = this._rxPanelY;
        const pw = this._rxPanelW, ph = this._rxPanelH;
        if (ph < 14) return;

        const bg = new Konva.Rect({ x: px, y: py, width: pw, height: ph, fill: '#1a0a00', stroke: '#3a2000', strokeWidth: 1, cornerRadius: 4 });
        const titleBg = new Konva.Rect({ x: px, y: py, width: pw, height: 13, fill: '#2a1400', cornerRadius: [4,4,0,0] });
        this.group.add(new Konva.Text({ x: px+4, y: py+2, width: pw-8, text: '被测绝缘电阻 R_x 调节（拖拽设定）', fontSize: 8, fill: '#c05a00', align: 'center' }));

        // 滑块（水平，对数刻度）
        const barX = px+6, barY = py+20, barW = pw-12, barH = 12;
        this.group.add(new Konva.Rect({ x: barX, y: barY, width: barW, height: barH, fill: '#0a0500', cornerRadius: 3 }));
        this._rxBar = new Konva.Rect({ x: barX, y: barY, width: 0, height: barH, fill: '#e8740a', cornerRadius: 3 });
        this._rxSlider = new Konva.Rect({ x: barX, y: barY-3, width: 10, height: barH+6, fill: '#ffd54f', stroke: '#c0a020', strokeWidth: 1, cornerRadius: 2, listening: true });
        this._rxVal = new Konva.Text({ x: px+4, y: py+35, width: pw-8, text: `R_x = ${this.Rx} MΩ`, fontSize: 9, fontFamily: 'Courier New, monospace', fill: '#e8740a', align: 'center' });

        // 预设按钮（快速切换）
        const presets = [
            { v: 0,     label: '0Ω（短路）', color: '#ef5350' },
            { v: 0.1,   label: '0.1MΩ',    color: '#ffa726' },
            { v: 1,     label: '1MΩ',      color: '#ffd54f' },
            { v: 10,    label: '10MΩ',     color: '#66bb6a' },
            { v: 100,   label: '100MΩ',    color: '#4fc3f7' },
            { v: 9999,  label: '∞（断路）',  color: '#80cbc4' },
        ];
        const btnH = Math.min(14, (ph-52) / Math.ceil(presets.length/3));
        const btnW = (pw-10) / 3;
        this._rxBtns = [];
        presets.forEach(({ v, label, color }, i) => {
            const bx = px+5+(i%3)*(btnW+2);
            const by = py+48+Math.floor(i/3)*(btnH+3);
            if (by+btnH > py+ph) return;
            const btn = new Konva.Rect({ x: bx, y: by, width: btnW, height: btnH, fill: '#1a0a00', stroke: '#3a2000', strokeWidth: 1, cornerRadius: 2 });
            const lbl = new Konva.Text({ x: bx, y: by+btnH/2-4, width: btnW, text: label, fontSize: 7.5, fill: color, align: 'center' });
            btn.on('click tap', () => {
                this._RxTarget = v;
                this.Rx = v;
                this._manualRx = v;
            });
            btn.on('mouseenter', () => { btn.fill('#2a1400'); });
            btn.on('mouseleave', () => { btn.fill('#1a0a00'); });
            this._rxBtns.push({ btn, lbl });
            this.group.add(btn, lbl);
        });

        // 拖拽
        this._barX = barX; this._barW = barW;
        const hit = new Konva.Rect({ x: barX-4, y: barY-4, width: barW+8, height: barH+8, fill: 'transparent', listening: true });
        hit.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._rxDrag = true;
            this._updateRxFromEvent(e);
        });
        const sm = e => { if (!this._rxDrag) return; this._updateRxFromEvent(e); };
        const su = () => { this._rxDrag = false; };
        window.addEventListener('mousemove', sm);
        window.addEventListener('touchmove', sm, { passive: true });
        window.addEventListener('mouseup', su);
        window.addEventListener('touchend', su);
        this.group.add(hit);

        this.group.add(bg, titleBg, this._rxBar, this._rxSlider, this._rxVal);
    }

    _updateRxFromEvent(e) {
        const stage = this.group.getStage?.();
        const pos = stage?.getPointerPosition?.() ?? { x: (e.evt?.clientX ?? e.clientX ?? 0) };
        const relX = pos.x - (this.group.x?.() ?? 0) - this._barX;
        const ratio = Math.max(0, Math.min(1, relX / this._barW));
        // 对数映射：0=0Ω，1=∞
        if (ratio < 0.01) { this._RxTarget = 0; this._manualRx = 0; return; }
        if (ratio > 0.99) { this._RxTarget = 9999; this._manualRx = 9999; return; }
        const logMax = Math.log10(10001);
        const Rx_val = Math.pow(10, ratio * logMax) - 1;
        this._RxTarget = Math.round(Rx_val * 10) / 10;
        this._manualRx = this._RxTarget;
    }

    // ── 火花层 ────────────────────────────────
    _drawSparkLayer() {
        this._sparkGroup = new Konva.Group();
        this.group.add(this._sparkGroup);
    }

    // ── 摇把交互 ─────────────────────────────
    _setupCrankInteraction() {
        const cx = this._crankCX, cy = this._crankCY;
        const hitR = this._crankR + this._crankArmLen + this._crankHandleR + 5;

        const hitZone = new Konva.Circle({ x: cx, y: cy, radius: hitR, fill: 'transparent', listening: true });

        hitZone.on('mousedown touchstart', e => {
            e.cancelBubble = true;
            this._crankDrag = true;
            this._autoSpin  = false;
            this._crankDragStart = Date.now();
            const pos = this._getPos(e);
            this._crankLastAngle = Math.atan2(pos.y - cy, pos.x - cx);
            this._crankLastTime  = Date.now();
        });

        hitZone.on('dblclick dbltap', () => {
            // 双击：自动摇动
            this._autoSpin    = !this._autoSpin;
            this._autoSpinVel = this._autoSpin ? 12.57 : 0;  // 120 rpm = 12.57 rad/s
        });

        const mv = e => {
            if (!this._crankDrag) return;
            const pos = this._getPos(e);
            const curAngle = Math.atan2(pos.y - cy, pos.x - cx);
            const now = Date.now();
            const dt = Math.max(1, now - this._crankLastTime) / 1000;
            const dAngle = this._angleDiff(curAngle, this._crankLastAngle);
            this._crankVel = dAngle / dt * 0.6 + this._crankVel * 0.4;
            this._crankAngle += dAngle;
            this._crankLastAngle = curAngle;
            this._crankLastTime  = now;
        };

        const up = () => {
            if (this._crankDrag) {
                this._crankDrag = false;
                // 松手后以当前角速度惯性转动
                this._autoSpinVel = this._crankVel;
                this._autoSpin    = Math.abs(this._crankVel) > 1;
            }
        };

        window.addEventListener('mousemove', mv);
        window.addEventListener('touchmove', mv, { passive: true });
        window.addEventListener('mouseup', up);
        window.addEventListener('touchend', up);
        this.group.add(hitZone);
    }

    _getPos(e) {
        const stage = this.group.getStage?.();
        const sp = stage?.getPointerPosition?.();
        if (sp) return { x: sp.x - (this.group.x?.()??0), y: sp.y - (this.group.y?.()??0) };
        const cl = e.evt?.clientX ?? e.clientX ?? e.evt?.touches?.[0]?.clientX ?? 0;
        const ct = e.evt?.clientY ?? e.clientY ?? e.evt?.touches?.[0]?.clientY ?? 0;
        return { x: cl, y: ct };
    }

    _angleDiff(a, b) {
        let d = a - b;
        while (d > Math.PI) d -= 2*Math.PI;
        while (d < -Math.PI) d += 2*Math.PI;
        return d;
    }

    // ═══════════════════════════════════════════
    _startAnimation() {
        const tick = ts => {
            if (this._lastTs !== null) {
                const dt = Math.min((ts - this._lastTs) / 1000, 0.05);
                this._tickMechanics(dt);
                this._tickElectrical(dt);
                this._tickNeedle(dt);
                this._tickViz(dt);
                this._tickDisplay();
            }
            this._lastTs = ts;
            this._refreshCache();
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    _stopAnimation() { if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; } }

    // ── 机械：摇把转速 ───────────────────────
    _tickMechanics(dt) {
        if (this._autoSpin && !this._crankDrag) {
            // 自动摇动（惯性衰减）
            const friction = 0.8;  // 摩擦系数
            this._autoSpinVel *= (1 - friction * dt);
            if (Math.abs(this._autoSpinVel) < 0.2) {
                this._autoSpin = false;
                this._autoSpinVel = 0;
            }
            this._crankAngle += this._autoSpinVel * dt;
            this._crankVel    = this._autoSpinVel;
        } else if (!this._crankDrag) {
            // 自然衰减
            this._crankVel *= (1 - 5 * dt);
            if (Math.abs(this._crankVel) < 0.05) this._crankVel = 0;
        }

        // 转速（rpm）
        this.crankRPM = Math.abs(this._crankVel) / (2 * Math.PI) * 60;

        // 摇把视觉旋转
        if (this._crankGroup) {
            this._crankGroup.rotation(this._crankAngle * 180 / Math.PI);
        }
        // 发电机转子（随摇把旋转，传动比约1:10）
        this._genAngle += this._crankVel * dt * 8;
        if (this._genGroup) this._genGroup.rotation(this._genAngle * 180 / Math.PI);

        // 速度指示弧（绿色弧，随转速增大）
        if (this._speedArc) {
            const speedRatio = Math.min(1, this.crankRPM / this.targetRPM);
            this._speedArc.angle(speedRatio * 270);
            this._speedArc.fill(speedRatio > 0.85 ? '#66bb6a' : speedRatio > 0.5 ? '#ffa726' : '#ef5350');
        }

        this._phase      += dt * 4;
        this._sparkPhase += dt * Math.max(0.5, this.crankRPM / 20);
    }

    // ── 电气：发电机输出 ─────────────────────
    _tickElectrical(dt) {
        // 输出电压正比于转速（有调压机构，≥额定转速时稳定在额定电压）
        const speedRatio = Math.min(1.0, this.crankRPM / this.targetRPM);
        this.outputVoltage = speedRatio * this.V_rated;

        // 被测电阻平滑
        this.Rx += (this._RxTarget - this.Rx) * Math.min(1, dt * 3);

        // 计算测量电流（仿内部流比计）
        const Rx_ohm = this.Rx * 1e6;  // MΩ → Ω
        const I_x = this.outputVoltage > 0 ? this.outputVoltage / (Rx_ohm + this.Ri) : 0;  // 被测支路电流
        const I_v = this.outputVoltage > 0 ? this.outputVoltage / this.Rv : 0;               // 电压线圈电流

        // 流比计偏转：由 I_v/I_x 决定（反映 R_x/R_v）
        // 实测值：R_x = R_v × I_v/I_x（理想）
        this._measuredRx = this.Rx; // 直接用设定值（已考虑内阻误差，简化）

        // 指针目标位置
        if (this.outputVoltage < this.V_rated * 0.3) {
            // 电压不足，指针不稳定（随机抖动）
            this._needleTarget = -1;  // 特殊标记：不稳定
        } else {
            this._needleTarget = this._rxToNeedle(this._measuredRx);
        }
    }

    // ── 指针物理模拟（二阶阻尼）───────────
    _tickNeedle(dt) {
        let targetAngle;

        if (this._needleTarget < 0 || this.outputVoltage < 10) {
            // 无电压：指针回到左端（∞位置，即 _needleAngle→1 方向）
            // 实际上没电压时指针漂浮，无明确指示
            targetAngle = 0.5 + 0.5 * Math.abs(Math.sin(this._phase * 0.8));  // 轻微摇摆
        } else {
            targetAngle = this._needleTarget;
        }

        // 指针偏转角（0~1 对应左端∞ → 右端0）
        const angleDeg = this._arcStartDeg + targetAngle * this._arcSpanDeg;
        const rad = angleDeg * Math.PI / 180 - Math.PI / 2;

        // 弹簧力 + 阻尼（二阶）
        const currentPos = this._needleAngle;
        const targetPos  = targetAngle;
        const spring = this._needleK * (targetPos - currentPos);
        const damping= this._needleDamp * this._needleVel;
        const acc    = (spring - damping) / this._needleMass;

        this._needleVel  += acc * dt;
        this._needleAngle+= this._needleVel * dt;
        this._needleAngle = Math.max(-0.05, Math.min(1.05, this._needleAngle));

        // 更新指针组旋转
        if (this._needleGroup) {
            const displayAngle = this._arcStartDeg + this._needleAngle * this._arcSpanDeg;
            this._needleGroup.rotation(displayAngle - 90);  // -90 因为 Line 从 x 正方向开始
        }
    }

    // ── 可视化更新 ───────────────────────────
    _tickViz(dt) {
        const speedRatio = Math.min(1, this.crankRPM / this.targetRPM);

        // 火花（集电环/整流器处，摇快时更明显）
        this._sparkGroup.destroyChildren();
        if (speedRatio > 0.1) {
            const genCX = this._crankCX, genCY = this._crankCY + this._crankR + 46;
            const sparkInt = speedRatio * Math.abs(Math.sin(this._sparkPhase));
            if (sparkInt > 0.4) {
                for (let i = 0; i < 3; i++) {
                    const a = (this._sparkPhase + i * 2.1) % (Math.PI * 2);
                    const r = 14 + i * 3;
                    this._sparkGroup.add(new Konva.Circle({ x: genCX + r*Math.cos(a), y: genCY + r*Math.sin(a), radius: 1.5 + sparkInt * 2, fill: `rgba(255,213,79,${sparkInt * 0.7})` }));
                }
            }
        }

        // Rx 进度条更新
        if (this._rxBar) {
            const logMax = Math.log10(10001);
            const Rx_val = Math.max(0.001, this.Rx);
            const ratio  = Rx_val > 9000 ? 1 : Math.log10(Rx_val + 1) / logMax;
            const fRatio = Math.max(0, Math.min(1, ratio));
            this._rxBar.width(fRatio * this._barW);
            if (this._rxSlider) this._rxSlider.x(this._barX + fRatio * this._barW);
        }
        if (this._rxVal) {
            const rxStr = this.Rx >= 9000 ? '∞' : this.Rx < 0.01 ? '0' : this.Rx.toFixed(this.Rx < 1 ? 2 : 1);
            this._rxVal.text(`R_x = ${rxStr} MΩ`);
        }
    }

    // ── 显示刷新 ─────────────────────────────
    _tickDisplay() {
        const rxStr = this.Rx >= 9000 ? '∞' : this.Rx < 0.001 ? '0' : this.Rx.toFixed(this.Rx < 1 ? 3 : 1);
        const stable = this.outputVoltage >= this.V_rated * 0.85;

        if (this._dispRx) {
            this._dispRx.text(stable ? `R = ${rxStr} MΩ` : '--- MΩ  (加速摇动!)');
            this._dispRx.fill(stable ? (this.Rx < 0.5 ? '#ff4444' : this.Rx < 1 ? '#ffaa22' : '#33ff66') : '#888855');
        }
        if (this._dispRpm) this._dispRpm.text(`${Math.round(this.crankRPM)} r/min`);
        if (this._dispV)   this._dispV.text(`${Math.round(this.outputVoltage)} V`);
    }

    // ═══════════════════════════════════════════
    update(Rx_MOhm) {
        if (typeof Rx_MOhm === 'number') {
            this._RxTarget = Math.max(0, Rx_MOhm);
            this._manualRx = this._RxTarget;
        }
        this._refreshCache();
    }

    startCrank() {
        this._autoSpin    = true;
        this._autoSpinVel = 12.57;  // 120 rpm
    }

    stopCrank() {
        this._autoSpin    = false;
        this._autoSpinVel = 0;
    }

    getConfigFields() {
        return [
            { label: '位号/名称',       key: 'id',        type: 'text'   },
            { label: '初始量程索引(0-2)', key: 'rangeIdx',  type: 'number' },
            { label: '初始被测阻值(MΩ)', key: 'initRx',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        this.id      = cfg.id      || this.id;
        this.rangeIdx= parseInt(cfg.rangeIdx) ?? this.rangeIdx;
        this.rangeIdx= Math.max(0, Math.min(2, this.rangeIdx));
        this.V_rated = this.ranges[this.rangeIdx];
        const newRx = parseFloat(cfg.initRx);
        if (!isNaN(newRx)) { this.Rx = newRx; this._RxTarget = newRx; }
        this.config  = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() { this._stopAnimation(); super.destroy?.(); }
}