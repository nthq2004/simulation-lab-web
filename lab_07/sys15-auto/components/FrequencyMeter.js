import { BaseComponent } from './BaseComponent.js';

/**
 * 指针式发电机频率表（Generator Frequency Meter）仿真组件
 *
 * ═══ 工作原理 ══════════════════════════════════════════════════
 *  采用【谐振电路差动式】原理（电动式频率表）：
 *
 *  核心：两个并联 LC 谐振支路，分别谐振于量程两端附近频率
 *    - 支路 A（L1-C1）：谐振频率 f_A = 45 Hz（低频侧灵敏）
 *    - 支路 B（L2-C2）：谐振频率 f_B = 55 Hz（高频侧灵敏）
 *    两支路电流差通过交叉线圈磁电系统驱动指针偏转：
 *      当 f=50Hz：I_A = I_B，指针居中（50Hz 刻度）
 *      当 f<50Hz：I_A > I_B，指针左偏（低频方向）
 *      当 f>50Hz：I_A < I_B，指针右偏（高频方向）
 *
 *  测量机构：交叉线圈式（比率表头）
 *    - 固定永磁铁产生非均匀磁场
 *    - 两套可动线圈互成约 60° 夹角，通入差动电流
 *    - 指针偏转角仅取决于两线圈电流之比，与电压幅值无关
 *    - 无游丝，断电后指针可停在任意位置
 *
 * ═══ 渲染优化原则 ══════════════════════════════════════════════
 *  1. 静态元素（表盘、刻度、LC支路图、磁路结构）仅 init 时绘制
 *  2. 动态元素（指针、电流波形、磁场线、数字读数）in-place 更新
 *  3. 左侧仪表区：表盘 + 指针 + 数字副显示
 *  4. 右侧原理区：LC差动电路图 + 交叉线圈磁场动画
 *
 * ═══ 分区说明 ══════════════════════════════════════════════════
 *  左半区（仪表界面）：
 *    - 铝合金面板背景，弧形刻度盘 45~55 Hz
 *    - 中心 50Hz 刻度居中，两侧对称展开
 *    - 磁电系比率计指针（无游丝，粗针）
 *    - 下方数字副显示（精度 0.1Hz）
 *    - 铭牌：量程、精度等级、型号
 *
 *  右半区（原理演示）：
 *    - 上部：差动 LC 谐振电路图
 *        输入端 → 并联双支路（L1C1 / L2C2）→ 整流 → 交叉线圈
 *    - 下部：交叉线圈磁场截面图
 *        永磁铁（弧形极靴）+ 两个可动线圈 + 指针位置
 *    - 动画：LC电流波形随频率变化；磁场线随线圈电流变化
 *
 * ═══ 端口 ══════════════════════════════════════════════════════
 *  L  — 火线输入（左侧中部）
 *  N  — 零线输入（左侧中下）
 *
 * ═══ 可配置参数 ════════════════════════════════════════════════
 *  label        : 位号（默认 'Hz'）
 *  frequency    : 当前频率 Hz（默认 50，范围 45~55）
 *  rangeMin     : 量程下限 Hz（默认 45）
 *  rangeMax     : 量程上限 Hz（默认 55）
 *  nominalFreq  : 额定频率 Hz（默认 50）
 *  ratedVoltage : 额定电压 V（默认 100）
 *  accuracy     : 精度等级（默认 '1.5'）
 *  animSpeed    : 指针动画速度（默认 2.5）
 */
export class GeneratorFrequencyMeter extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 500);
        this.height = Math.max(160, config.height || 420);

        this.type    = 'INSTRUMENT';
        this.special = 'FREQ_METER_GEN';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            id: this.id,
            label:        this.label,
            frequency:    this._frequency,
            rangeMin:     this._rangeMin,
            rangeMax:     this._rangeMax,
            nominalFreq:  this._nominalFreq,
            ratedVoltage: this.ratedVoltage,
            accuracy:     this.accuracy,
            animSpeed:    this._animSpeed,
        };

        // 端口
        this.addPort(this._portL.x, this._portL.y, 'L', 'wire', 'p');
        this.addPort(this._portN.x, this._portN.y, 'N', 'wire', 'n');
    }

    // ═══════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._divX = W * 0.50;

        this._frame = { x: 2, y: 2, w: W - 4, h: H - 4, rx: 5 };

        // ── 左侧表盘区 ──
        const lCX = W * 0.25;
        const lCY = H * 0.52;
        const dialR = Math.min(W * 0.22, H * 0.40);

        this._dial = {
            cx: lCX, cy: lCY,
            R: dialR,
            arcStartDeg: 210,   // 刻度弧起始角（左下，对应 rangeMin）
            arcEndDeg:   -30,   // 刻度弧结束角（右下，对应 rangeMax）
            totalDeg:    240,   // 总弧度
        };

        // 指针轴心
        this._pivotX = lCX;
        this._pivotY = lCY;

        // 数字副显示区
        this._digitBox = {
            x: lCX - dialR * 0.55,
            y: lCY + dialR * 0.52,
            w: dialR * 1.1,
            h: H * 0.12,
        };

        // ── 右侧原理图区 ──
        const rX = this._divX + 8;
        const rW = W - rX - 6;
        const rH = H - 12;
        const rY = 8;

        this._schm = { x: rX, y: rY, w: rW, h: rH };

        // LC电路图区（上半）
        this._lcArea = {
            x: rX, y: rY,
            w: rW, h: rH * 0.52,
        };

        // 交叉线圈截面图区（下半）
        this._coilArea = {
            x: rX, y: rY + rH * 0.55,
            w: rW, h: rH * 0.42,
        };

        // 端口
        this._portL = { x: 2, y: H * 0.42 };
        this._portN = { x: 2, y: H * 0.58 };
    }

    // ═══════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'Hz';
        this.ratedVoltage = config.ratedVoltage !== undefined ? config.ratedVoltage : 100;
        this.accuracy     = config.accuracy     || '1.5';
        this._rangeMin    = config.rangeMin     !== undefined ? config.rangeMin    : 45;
        this._rangeMax    = config.rangeMax     !== undefined ? config.rangeMax    : 55;
        this._nominalFreq = config.nominalFreq  !== undefined ? config.nominalFreq : 50;
        this._animSpeed   = config.animSpeed    !== undefined ? config.animSpeed   : 2.5;
        this.function     = config.function     || '发电机频率表';

        const initFreq    = config.frequency    !== undefined ? config.frequency   : 50;
        this._frequency   = Math.max(this._rangeMin, Math.min(this._rangeMax, initFreq));

        // 指针目标角度（-1~+1 → 量程）
        this._targetAngle = this._freqToAngle(this._frequency);
        this._curAngle    = this._targetAngle;

        // LC谐振参数（用于原理演示）
        this._fA = this._rangeMin + (this._nominalFreq - this._rangeMin) * 0.5;  // 45+2.5=47.5Hz
        this._fB = this._nominalFreq + (this._rangeMax - this._nominalFreq) * 0.5; // 52.5Hz

        // 动画时间累计
        this._animTime = 0;

        // 磁场线动画相位
        this._fieldPhase = 0;

        // 电路驱动频率检测
    }

    // 频率 → 指针偏转角度（度，以12点方向为0，顺时针为正）
    _freqToAngle(f) {
        const { arcStartDeg, totalDeg } = this._dial;
        const t = (f - this._rangeMin) / (this._rangeMax - this._rangeMin);
        // arcStartDeg=210（左下），totalDeg=240，顺时针到-30（右下）
        // 使用 Konva 旋转：0°=右，顺时针为正
        // 指针基准朝上（-90°），所以：
        // t=0 → 210-90=120° Konva → 但我们用 needle rotation
        // 用以12点为0的角度：t=0 → -120°, t=1 → +120°
        return -120 + t * 240;
    }

    // LC谐振支路电流（归一化，0~1）
    _lcCurrentA(f) {
        // 支路A谐振于fA，f越接近fA电流越大
        const df = (f - this._fA) / (this._nominalFreq - this._rangeMin);
        return 1 / (1 + df * df * 4);
    }
    _lcCurrentB(f) {
        const df = (f - this._fB) / (this._rangeMax - this._nominalFreq);
        return 1 / (1 + df * df * 4);
    }

    // ═══════════════════════════════════════════
    // 主初始化
    // ═══════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    // ═══════════════════════════════════════════
    // 静态部件
    // ═══════════════════════════════════════════

    _drawStaticParts() {
        this._drawFrame();
        this._drawDivider();
        this._drawDialFace();
        this._drawDialScale();
        this._drawLabel();
        this._drawNameplate();
        this._drawLCCircuitStatic();
        this._drawCoilSectionStatic();
        this._drawPortLabels();
    }

    _drawFrame() {
        const f = this._frame;
        // 主框
        this._staticGroup.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#f5f5f5',
            stroke: '#c0c0c0',
            strokeWidth: 1.5,
            cornerRadius: f.rx,
        }));
        // 顶部标题条
        this._staticGroup.add(new Konva.Rect({
            x: f.x + 1, y: f.y + 1, width: f.w - 2, height: this.height * 0.09 || 16,
            fill: '#e0e0e0',
            cornerRadius: [f.rx, f.rx, 0, 0],
        }));
    }

    _drawDivider() {
        this._staticGroup.add(new Konva.Line({
            points: [this._divX, this._frame.y + 8, this._divX, this._frame.y + this._frame.h - 8],
            stroke: '#d0d0d0',
            strokeWidth: 1,
            dash: [3, 3],
        }));
    }

    _drawDialFace() {
        const { cx, cy, R } = this._dial;

        // 表盘外圈（铝合金拉丝感）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R + 6,
            fillRadialGradientStartPoint: { x: -R * 0.3, y: -R * 0.3 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientEndRadius:  R + 6,
            fillRadialGradientColorStops: [0, '#e0e0e0', 0.6, '#d0d0d0', 1, '#b0b0b0'],
            stroke: '#999999', strokeWidth: 1.5,
        }));

        // 表盘面（深米色/象牙色）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R,
            fillRadialGradientStartPoint: { x: -R * 0.2, y: -R * 0.3 },
            fillRadialGradientStartRadius: 0,
            fillRadialGradientEndPoint:   { x: 0, y: 0 },
            fillRadialGradientEndRadius:  R,
            fillRadialGradientColorStops: [0, '#f0ede4', 0.7, '#e8e4d8', 1, '#d8d3c4'],
        }));

        // 内圈装饰线
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: R * 0.92,
            stroke: '#d0c8b8', strokeWidth: 0.5,
            fill: 'transparent',
        }));

        // 轴心孔
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: 4,
            fill: '#999', stroke: '#bbb', strokeWidth: 1,
        }));

        // 数字副显示底框
        const db = this._digitBox;
        this._staticGroup.add(new Konva.Rect({
            x: db.x, y: db.y, width: db.w, height: db.h,
            fill: '#e8e8e8', stroke: '#cccccc', strokeWidth: 1,
            cornerRadius: 2,
        }));
    }

    _drawDialScale() {
        const { cx, cy, R, arcStartDeg, totalDeg } = this._dial;
        const steps = 10; // 45~55, 每格1Hz
        const freqMin = this._rangeMin, freqMax = this._rangeMax;
        const nomF = this._nominalFreq;

        for (let i = 0; i <= steps; i++) {
            const f = freqMin + i * (freqMax - freqMin) / steps;
            const t = i / steps;
            // Konva角度：arcStartDeg（210°对应左下）顺时针 totalDeg
            // 转换：Konva 0°=右，我们弧从左下开始
            // Math angle: arcStartDeg 在标准数学坐标（逆时针）= 210°左下
            // Konva rotation: 顺时针，所以 startDeg=210 实际是标准-210=-150°
            const angleDeg = arcStartDeg - t * totalDeg; // 从210逐渐减到210-240=-30
            const rad = angleDeg * Math.PI / 180;
            const isMajor = (i % 2 === 0);
            const isNominal = Math.abs(f - nomF) < 0.01;

            const outerR = R * 0.92;
            const innerR = isNominal ? R * 0.68 : (isMajor ? R * 0.72 : R * 0.80);
            const tickColor = isNominal ? '#e85020' : (isMajor ? '#2a2a2a' : '#5a5a5a');

            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + Math.cos(rad) * innerR,
                    cy - Math.sin(rad) * innerR,
                    cx + Math.cos(rad) * outerR,
                    cy - Math.sin(rad) * outerR,
                ],
                stroke: tickColor,
                strokeWidth: isNominal ? 2 : (isMajor ? 1.5 : 0.8),
            }));

            // 主刻度标数字
            if (isMajor) {
                const labelR = R * 0.60;
                this._staticGroup.add(new Konva.Text({
                    x: cx + Math.cos(rad) * labelR - 10,
                    y: cy - Math.sin(rad) * labelR - 7,
                    width: 20, height: 14,
                    text: f.toFixed(0),
                    fontSize: Math.max(8, R * 0.13),
                    fontFamily: 'Arial',
                    fontStyle: 'bold',
                    fill: isNominal ? '#c84010' : '#222',
                    align: 'center',
                }));
            }
        }

        // 中间半格刻度（每0.5Hz一个小格，辅助判读）
        for (let i = 0; i < steps; i++) {
            const t = (i + 0.5) / steps;
            const angleDeg = arcStartDeg - t * totalDeg;
            const rad = angleDeg * Math.PI / 180;
            this._staticGroup.add(new Konva.Line({
                points: [
                    cx + Math.cos(rad) * R * 0.86,
                    cy - Math.sin(rad) * R * 0.86,
                    cx + Math.cos(rad) * R * 0.92,
                    cy - Math.sin(rad) * R * 0.92,
                ],
                stroke: '#666',
                strokeWidth: 0.7,
            }));
        }

        // 刻度弧线（底弧）
        const arcPts = [];
        for (let i = 0; i <= 60; i++) {
            const t = i / 60;
            const angleDeg = arcStartDeg - t * totalDeg;
            const rad = angleDeg * Math.PI / 180;
            arcPts.push(cx + Math.cos(rad) * R * 0.92, cy - Math.sin(rad) * R * 0.92);
        }
        this._staticGroup.add(new Konva.Line({
            points: arcPts,
            stroke: '#444', strokeWidth: 0.5,
        }));

        // "Hz" 单位文字
        this._staticGroup.add(new Konva.Text({
            x: cx - 16, y: cy - R * 0.28,
            width: 32, height: 16,
            text: 'Hz',
            fontSize: Math.max(10, R * 0.16),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#333',
            align: 'center',
        }));

        // 额定频率红色三角标记
        {
            const nomT = (nomF - freqMin) / (freqMax - freqMin);
            const angleDeg = arcStartDeg - nomT * totalDeg;
            const rad = angleDeg * Math.PI / 180;
            const markerR = R * 0.86;
            const tipX = cx + Math.cos(rad) * markerR;
            const tipY = cy - Math.sin(rad) * markerR;
            const perpRad = rad + Math.PI / 2;
            const size = R * 0.06;
            this._staticGroup.add(new Konva.Line({
                points: [
                    tipX, tipY,
                    tipX - Math.cos(perpRad) * size + Math.cos(rad) * size * 2,
                    tipY + Math.sin(perpRad) * size - Math.sin(rad) * size * 2,
                    tipX + Math.cos(perpRad) * size + Math.cos(rad) * size * 2,
                    tipY - Math.sin(perpRad) * size - Math.sin(rad) * size * 2,
                ],
                closed: true,
                fill: '#e82020',
                stroke: '#a01010',
                strokeWidth: 0.5,
            }));
        }
    }

    _drawLabel() {
        const { cx, cy, R } = this._dial;
        // 仪表型号
        this._staticGroup.add(new Konva.Text({
            x: cx - R, y: cy + R * 0.10,
            width: R * 2, height: 16,
            text: 'D72-HZ',
            fontSize: Math.max(7, R * 0.13),
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: '#444',
            align: 'center',
        }));
    }

    _drawNameplate() {
        const { cx, cy, R } = this._dial;
        const npY = cy + R * 0.26;
        this._staticGroup.add(new Konva.Text({
            x: cx - R * 0.8, y: npY,
            width: R * 1.6, height: 12,
            text: `${this._rangeMin}~${this._rangeMax}Hz  ${this.ratedVoltage}V`,
            fontSize: Math.max(6, R * 0.105),
            fontFamily: 'Arial',
            fill: '#555',
            align: 'center',
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - R * 0.8, y: npY + 13,
            width: R * 1.6, height: 11,
            text: `精度 ${this.accuracy}级  交叉线圈式`,
            fontSize: Math.max(5, R * 0.095),
            fontFamily: 'Arial',
            fill: '#666',
            align: 'center',
        }));
    }

    _drawPortLabels() {
        [
            { p: this._portL, t: 'L' },
            { p: this._portN, t: 'N' },
        ].forEach(({ p, t }) => {
        this._staticGroup.add(new Konva.Circle({
            x: p.x + 6, y: p.y, radius: 4,
            fill: t === 'L' ? '#cc5533' : '#3366cc',
            stroke: '#888', strokeWidth: 0.8,
        }));
        this._staticGroup.add(new Konva.Text({
            x: p.x + 12, y: p.y - 6,
            text: t,
            fontSize: 9,
            fontFamily: 'Arial',
            fontStyle: 'bold',
            fill: t === 'L' ? '#cc5533' : '#3366cc',
        }));
        });
    }

    // ─── 右侧：LC差动电路图（静态骨架） ──────────────────────────

    _drawLCCircuitStatic() {
        const { x, y, w, h } = this._lcArea;

        // 区域背景
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#ffffff', stroke: '#b0b0b0', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x, y: y + 2, width: w, height: 20,
            text: 'LC 差动谐振电路',
            fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#336699', align: 'center',
        }));

        // 几何布局
        const cX = x + w * 0.5;
        const inputY  = y + h * 0.22;   // 输入端
        const junctY  = y + h * 0.30;   // 分叉点
        const midY    = y + h * 0.62;   // LC中部
        const joinY   = y + h * 0.80;   // 汇合点
        const outY    = y + h * 0.93;   // 输出端（去线圈）
        const leftX   = x + w * 0.25;
        const rightX  = x + w * 0.75;

        // 输入竖线
        this._staticGroup.add(new Konva.Line({
            points: [cX, inputY, cX, junctY],
            stroke: '#445566', strokeWidth: 1.5,
        }));

        // 输入端子符号
        this._staticGroup.add(new Konva.Text({
            x: cX - 28, y: inputY - 16,
            text: '~  U', fontSize: 14,
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#445566',
        }));

        // 分叉横线
        this._staticGroup.add(new Konva.Line({
            points: [leftX, junctY, rightX, junctY],
            stroke: '#445566', strokeWidth: 1.5,
        }));

        // 左支路 L1 (电感线圈符号)
        this._drawInductorSymbol(leftX, junctY, midY * 0.80 + y * 0.20, '#ccaa33', 'L₁');
        // 左支路 C1 (电容符号)
        this._drawCapacitorSymbol(leftX, midY * 0.80 + y * 0.20, midY, '#ccaa33', 'C₁');

        // 右支路 L2
        this._drawInductorSymbol(rightX, junctY, midY * 0.80 + y * 0.20, '#3399bb', 'L₂');
        // 右支路 C2
        this._drawCapacitorSymbol(rightX, midY * 0.80 + y * 0.20, midY, '#3399bb', 'C₂');

        // 谐振频率标注
        this._staticGroup.add(new Konva.Text({
            x: leftX - 38, y: midY - 1,
            text: `f₁≈${this._fA.toFixed(1)}Hz`,
            fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#ccaa33',
        }));
        this._staticGroup.add(new Konva.Text({
            x: rightX - 8, y: midY - 1,
            text: `f₂≈${this._fB.toFixed(1)}Hz`,
            fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#3399bb',
        }));

        // 整流器符号（两个小三角）
        const rectY = midY + 20;
        [-1, 1].forEach((side, idx) => {
            const rx = idx === 0 ? leftX : rightX;
            this._staticGroup.add(new Konva.Line({
                points: [rx, rectY, rx - 5, rectY + 7, rx + 5, rectY + 7],
                closed: true,
                fill: '#dd8833', stroke: '#bb6622', strokeWidth: 1,
            }));
            this._staticGroup.add(new Konva.Line({
                points: [rx - 5, rectY + 7, rx + 5, rectY + 7],
                stroke: '#bb6622', strokeWidth: 2,
            }));
        });
        // 整流标注
        this._staticGroup.add(new Konva.Text({
            x: cX - 16, y: rectY - 2,
            text: '整流', fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold', fill: '#aa6622',
        }));

        // 汇合线
        this._staticGroup.add(new Konva.Line({
            points: [leftX, rectY + 8, leftX, joinY, cX, joinY],
            stroke: '#445566', strokeWidth: 1.3,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [rightX, rectY + 8, rightX, joinY, cX, joinY],
            stroke: '#445566', strokeWidth: 1.3,
        }));

        // 输出线 → 交叉线圈
        this._staticGroup.add(new Konva.Line({
            points: [cX, joinY, cX, outY],
            stroke: '#445566', strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cX - 22, y: outY - 3,
            text: '→线圈', fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold', fill: '#556677',
        }));

        // 保存关键坐标供动态电流波形使用
        this._lcGeom = { leftX, rightX, junctY, midY, x, y, w, h };
    }

    /** 绘制电感符号（竖向）— 3 个半圆弧 */
    _drawInductorSymbol(x, y1, y2, color, label) {
        const n = 3;
        const segH = (y2 - y1) / n;
        const r = segH * 0.46;
        const gap = segH - r * 2;
        const topLead = gap * 0.5;
        // 顶部引线
        this._staticGroup.add(new Konva.Line({
            points: [x, y1, x, y1 + topLead],
            stroke: color, strokeWidth: 1.8,
        }));
        for (let i = 0; i < n; i++) {
            const arcY = y1 + topLead + i * segH + r;
            this._staticGroup.add(new Konva.Arc({
                x, y: arcY,
                innerRadius: 0, outerRadius: r,
                angle: 180, rotation: -90,
                fill: 'transparent',
                stroke: color, strokeWidth: 1.8,
            }));
        }
        // 底部引线
        this._staticGroup.add(new Konva.Line({
            points: [x, y2 - topLead, x, y2],
            stroke: color, strokeWidth: 1.8,
        }));
        // 标签
        this._staticGroup.add(new Konva.Text({
            x: x + r + 2, y: (y1 + y2) / 2 - 8,
            text: label, fontSize: 14,
            fontFamily: 'Arial', fontStyle: 'bold', fill: color,
        }));
    }

    /** 绘制电容符号（竖向） */
    _drawCapacitorSymbol(x, y1, y2, color, label) {
        const midY = (y1 + y2) / 2;
        const platW = 10;
        this._staticGroup.add(new Konva.Line({
            points: [x, y1, x, midY - 4],
            stroke: color, strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x - platW, midY - 4, x + platW, midY - 4],
            stroke: color, strokeWidth: 2.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x - platW, midY + 4, x + platW, midY + 4],
            stroke: color, strokeWidth: 2.5,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [x, midY + 4, x, y2],
            stroke: color, strokeWidth: 1.5,
        }));
        this._staticGroup.add(new Konva.Text({
            x: x + 5, y: midY - 10,
            text: label, fontSize: 14,
            fontFamily: 'Arial', fontStyle: 'bold', fill: color,
        }));
    }

    // ─── 右侧：交叉线圈截面图（静态骨架） ───────────────────────

    _drawCoilSectionStatic() {
        const { x, y, w, h } = this._coilArea;

        // 背景
        this._staticGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#ffffff', stroke: '#b0b0b0', strokeWidth: 1,
            cornerRadius: 3,
        }));

        // 标题
        this._staticGroup.add(new Konva.Text({
            x, y: y + 2, width: w, height: 20,
            text: '交叉线圈测量机构（截面）',
            fontSize: 14, fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#336699', align: 'center',
        }));

        const cx = x + w / 2;
        const cy = y + h * 0.56;
        const outerR = Math.min(w, h) * 0.38;
        const innerR = outerR * 0.42;

        // 保存截面圆心供动态绘制
        this._sectionCenter = { cx, cy, outerR, innerR };

        // 永磁铁极靴（N/S弧形）
        // N极（上方）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: outerR * 0.82, outerRadius: outerR,
            angle: 160, rotation: -80,
            fill: '#cc3322', stroke: '#991111', strokeWidth: 1.2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 5, y: cy - outerR * 0.90,
            text: 'N', fontSize: 14, fontFamily: 'Arial',
            fontStyle: 'bold', fill: '#ffffff',
        }));

        // S极（下方）
        this._staticGroup.add(new Konva.Arc({
            x: cx, y: cy,
            innerRadius: outerR * 0.82, outerRadius: outerR,
            angle: 160, rotation: 100,
            fill: '#3366cc', stroke: '#2244aa', strokeWidth: 1.2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 5, y: cy + outerR * 0.80,
            text: 'S', fontSize: 14, fontFamily: 'Arial',
            fontStyle: 'bold', fill: '#ffffff',
        }));

        // 圆形气隙
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: outerR * 0.80,
            fill: '#f5f5f5', stroke: '#bbbbbb', strokeWidth: 0.8,
        }));

        // 铁心（偏心圆柱）
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy + outerR * 0.12,
            radius: innerR,
            fill: '#d8d8d8', stroke: '#aaaaaa', strokeWidth: 1,
        }));

        // 线圈A横截面（左上方固定绕组标志 × ·）
        this._drawCoilCrossSection(cx - outerR * 0.50, cy - outerR * 0.22, '#bb9933', 'A');
        // 线圈B横截面（右上方）
        this._drawCoilCrossSection(cx + outerR * 0.50, cy - outerR * 0.22, '#3399bb', 'B');

        // 标注
        this._staticGroup.add(new Konva.Text({
            x: x + 2, y: y + h - 18,
            text: '无游丝·比率型·断电后指针自由停留',
            fontSize: 14, fontFamily: 'Arial',
            fill: '#888888',
        }));
    }

    /** 线圈截面符号（小圆+×或·） */
    _drawCoilCrossSection(cx, cy, color, name) {
        const r = 6;
        this._staticGroup.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: 'transparent', stroke: color, strokeWidth: 1.5,
        }));
        // × 代表电流流入
        this._staticGroup.add(new Konva.Line({
            points: [cx - r * 0.6, cy - r * 0.6, cx + r * 0.6, cy + r * 0.6],
            stroke: color, strokeWidth: 1.2,
        }));
        this._staticGroup.add(new Konva.Line({
            points: [cx + r * 0.6, cy - r * 0.6, cx - r * 0.6, cy + r * 0.6],
            stroke: color, strokeWidth: 1.2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: cx - 4, y: cy + r + 3,
            text: name, fontSize: 14,
            fontFamily: 'Arial', fontStyle: 'bold', fill: color,
        }));
    }

    // ═══════════════════════════════════════════
    // 动态节点
    // ═══════════════════════════════════════════

    _createDynamicNodes() {
        this._createNeedle();
        this._createDigitDisplay();
        this._createLCCurrentBars();
        this._createFieldLines();
        this._createCoilArrow();
    }

    /** 指针（比率计式，无游丝，短粗） */
    _createNeedle() {
        const { cx, cy, R } = this._dial;

        this._needleGroup = new Konva.Group({ x: cx, y: cy });

        // 配重（尾部）
        this._needleGroup.add(new Konva.Line({
            points: [0, 0, 0, R * 0.22],
            stroke: '#555', strokeWidth: 4,
            lineCap: 'round',
        }));

        // 主针身
        this._needleGroup.add(new Konva.Line({
            points: [0, 0, 0, -R * 0.82],
            stroke: '#cc2020',
            strokeWidth: 2,
            lineCap: 'round',
        }));

        // 针尖细线
        this._needleGroup.add(new Konva.Line({
            points: [0, -R * 0.82, 0, -R * 0.90],
            stroke: '#ff4040',
            strokeWidth: 1,
            lineCap: 'round',
        }));

        // 轴心盖（小圆）
        this._needleGroup.add(new Konva.Circle({
            x: 0, y: 0, radius: 5,
            fill: '#888', stroke: '#aaa', strokeWidth: 1,
        }));

        this._needleGroup.rotation(this._curAngle);
        this._dynamicGroup.add(this._needleGroup);
    }

    /** 数字副显示 */
    _createDigitDisplay() {
        const db = this._digitBox;
        this._digitText = new Konva.Text({
            x: db.x, y: db.y + 2,
            width: db.w, height: db.h - 4,
            text: this._frequency.toFixed(1) + ' Hz',
            fontSize: Math.max(9, db.h * 0.55),
            fontFamily: 'Courier New',
            fontStyle: 'bold',
            fill: '#226622',
            align: 'center',
            verticalAlign: 'middle',
        });
        this._dynamicGroup.add(this._digitText);
    }

    /** LC电流对比柱（动态） */
    _createLCCurrentBars() {
        if (!this._lcGeom) return;
        const { leftX, rightX, y, h } = this._lcGeom;
        const barY  = y + h * 0.15;
        const barH  = h * 0.58;

        // 左支路电流柱（黄色）
        this._barA = new Konva.Rect({
            x: leftX - 5, y: barY,
            width: 10, height: barH * 0.5,
            fill: 'rgba(200,160,40,0.65)',
            stroke: '#ccaa33', strokeWidth: 1,
        });

        // 右支路电流柱（青色）
        this._barB = new Konva.Rect({
            x: rightX - 5, y: barY,
            width: 10, height: barH * 0.5,
            fill: 'rgba(40,170,210,0.65)',
            stroke: '#3399bb', strokeWidth: 1,
        });

        this._dynamicGroup.add(this._barA);
        this._dynamicGroup.add(this._barB);
    }

    /** 磁场线（交叉线圈截面，动态随电流变化） */
    _createFieldLines() {
        this._fieldLineGroup = new Konva.Group({ listening: false });
        this._dynamicGroup.add(this._fieldLineGroup);
    }

    /** 转子（可动线圈）指示箭头 */
    _createCoilArrow() {
        if (!this._sectionCenter) return;
        const { cx, cy, outerR, innerR } = this._sectionCenter;

        this._coilArrowGroup = new Konva.Group({ x: cx, y: cy });

        // 可动线圈骨架（用细线表示，随频率偏转）
        const armLen = innerR + (outerR * 0.80 - innerR) * 0.5;
        this._coilArrowGroup.add(new Konva.Line({
            points: [0, -armLen, 0, armLen],
            stroke: '#e87030',
            strokeWidth: 1.5,
            lineCap: 'round',
        }));
        // 箭头头
        this._coilArrowGroup.add(new Konva.Line({
            points: [0, -armLen, -3, -armLen + 5, 3, -armLen + 5],
            closed: true,
            fill: '#e87030',
        }));

        this._coilArrowGroup.rotation(this._curAngle);
        this._dynamicGroup.add(this._coilArrowGroup);
    }

    // ═══════════════════════════════════════════
    // 交互
    // ═══════════════════════════════════════════

    _bindInteraction() {
        // 点击左侧表盘区域切换测试频率（演示用）
        const { cx, cy, R } = this._dial;
        const hitArea = new Konva.Circle({
            x: cx, y: cy,
            radius: R,
            fill: 'transparent',
        });
        hitArea.on('click tap', () => {
            // 循环步进频率：45→47→49→50→51→53→55→45
            const steps = [45, 47, 49, 50, 51, 53, 55];
            const curIdx = steps.findIndex(v => Math.abs(v - this._frequency) < 0.6);
            const nextIdx = (curIdx + 1) % steps.length;
            this.setFrequency(steps[nextIdx]);
        });
        hitArea.on('mouseenter', () => { document.body.style.cursor = 'pointer'; });
        hitArea.on('mouseleave', () => { document.body.style.cursor = 'default'; });
        this._interactGroup.add(hitArea);
    }

    // ═══════════════════════════════════════════
    // tick
    // ═══════════════════════════════════════════

    tick(dt) {
        this._animTime += dt;
        this._fieldPhase += dt * 2.0;

        // 通过电路拓扑读取连接交流电源的频率
        this._updateFreqFromCircuit();

        let dirty = false;

        // 指针平滑跟随
        const targetA = this._freqToAngle(this._frequency);
        const diff = targetA - this._curAngle;
        if (Math.abs(diff) > 0.05) {
            this._curAngle += diff * Math.min(1, this._animSpeed * dt);
            dirty = true;
        }

        if (dirty || Math.floor(this._fieldPhase * 2) !== Math.floor((this._fieldPhase - dt * 2) * 2)) {
            this._updateDynamic();
            this.markDirty();
        }

        this._refreshIfDirty();
    }

    _updateDynamic() {
        const f = this._frequency;

        // 1) 指针旋转
        this._needleGroup.rotation(this._curAngle);
        if (this._coilArrowGroup) this._coilArrowGroup.rotation(this._curAngle);

        // 2) 数字显示
        this._digitText.text(f.toFixed(1) + ' Hz');

        // 3) LC 电流柱
        const iA = this._lcCurrentA(f);
        const iB = this._lcCurrentB(f);
        if (this._barA && this._barB && this._lcGeom) {
            const barH = this._lcGeom.h * 0.58;
            this._barA.height(barH * iA);
            this._barA.y(this._lcGeom.y + this._lcGeom.h * 0.15 + barH * (1 - iA));
            this._barB.height(barH * iB);
            this._barB.y(this._lcGeom.y + this._lcGeom.h * 0.15 + barH * (1 - iB));
        }

        // 4) 磁场线（动态，随电流差变化）
        this._updateFieldLines(iA, iB);
    }

    _updateFieldLines(iA, iB) {
        if (!this._sectionCenter) return;
        this._fieldLineGroup.destroyChildren();

        const { cx, cy, outerR, innerR } = this._sectionCenter;
        const diff = iA - iB;  // 正值：指针左偏（低频）；负值：右偏（高频）
        const numLines = 5;

        for (let i = 0; i < numLines; i++) {
            const t = (i + 0.5) / numLines;
            // 磁场线从 N 极到 S 极，弯曲程度随差动电流变化
            const baseAngle = -80 + t * 160; // N极范围
            const rad = baseAngle * Math.PI / 180;

            // 磁场线起点（N极内壁）
            const r1 = outerR * 0.81;
            const x1 = cx + Math.cos(rad) * r1;
            const y1 = cy + Math.sin(rad) * r1;

            // 磁场线终点（S极内壁）
            const endAngle = (baseAngle + 180);
            const endRad = endAngle * Math.PI / 180;
            const x2 = cx + Math.cos(endRad) * r1;
            const y2 = cy + Math.sin(endRad) * r1;

            // 控制点（偏移随差动电流）
            const midOff = diff * outerR * 0.3;
            const ctrl1X = cx + midOff * 0.5 + Math.cos(rad + Math.PI / 2) * outerR * 0.3;
            const ctrl1Y = cy + Math.cos(rad) * outerR * 0.3;

            const alpha = 0.3 + 0.4 * Math.abs(Math.sin(this._fieldPhase + i * 0.8));
            this._fieldLineGroup.add(new Konva.Line({
                points: [x1, y1, ctrl1X, ctrl1Y, x2, y2],
                tension: 0.4,
                stroke: `rgba(120,180,255,${alpha})`,
                strokeWidth: 0.8,
                listening: false,
            }));
        }
    }

    // ═══════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════

    setFrequency(f) {
        this._frequency = Math.max(this._rangeMin, Math.min(this._rangeMax, f));
        this._targetAngle = this._freqToAngle(this._frequency);
        this.markDirty();
    }

    getFrequency() { return this._frequency; }

    update(state) {
        const f = parseFloat(state);
        if (!isNaN(f)) this.setFrequency(f);
    }

    _updateFreqFromCircuit() {
        const sv = this.sys?.voltageSolver;
        if (!sv) return;
        const myCluster = sv.portToCluster.get(`${this.id}_wire_L`);
        if (myCluster === undefined) return;
        // 遍历所有设备，找同一簇上的 ac_source
        for (const dev of sv.rawDevices) {
            if (dev.type === 'ac_source' && dev.isOn) {
                for (const p of dev.ports) {
                    const pc = sv.portToCluster.get(p.id);
                    if (pc === myCluster) {
                        const raw = parseFloat(dev.frequency);
                        if (!isNaN(raw) && raw >= 1) {
                            this._frequency = Math.max(this._rangeMin, Math.min(this._rangeMax, raw));
                        }
                        return;
                    }
                }
            }
        }
    }

    getConfigFields() {
        return [
            { label: '位号/名称',      key: 'label',        type: 'text'   },
            { label: '当前频率 (Hz)',   key: 'frequency',    type: 'number' },
            { label: '量程下限 (Hz)',   key: 'rangeMin',     type: 'number' },
            { label: '量程上限 (Hz)',   key: 'rangeMax',     type: 'number' },
            { label: '额定频率 (Hz)',   key: 'nominalFreq',  type: 'number' },
            { label: '额定电压 (V)',    key: 'ratedVoltage', type: 'number' },
            { label: '精度等级',        key: 'accuracy',     type: 'text'   },
            { label: '指针动画速度',    key: 'animSpeed',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label        !== undefined) this.label        = cfg.label;
        if (cfg.ratedVoltage !== undefined) this.ratedVoltage = parseFloat(cfg.ratedVoltage);
        if (cfg.accuracy     !== undefined) this.accuracy     = cfg.accuracy;
        if (cfg.animSpeed    !== undefined) this._animSpeed   = parseFloat(cfg.animSpeed);
        if (cfg.rangeMin     !== undefined) this._rangeMin    = parseFloat(cfg.rangeMin);
        if (cfg.rangeMax     !== undefined) this._rangeMax    = parseFloat(cfg.rangeMax);
        if (cfg.nominalFreq  !== undefined) this._nominalFreq = parseFloat(cfg.nominalFreq);

        if (cfg.frequency !== undefined) {
            this.setFrequency(parseFloat(cfg.frequency));
        }

        this.config = { ...this.config, ...cfg };

        this._staticGroup.destroyChildren();
        this._dynamicGroup.destroyChildren();
        this._recalcGeometry();
        this._initParameters({ ...this.config });
        this._drawStaticParts();
        this._createDynamicNodes();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}
