import { BaseComponent } from './BaseComponent.js';

/**
 * 温度继电器仿真组件
 * （Temperature Relay / Thermal Relay）
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  温度继电器是一种当被测温度达到整定值时自动动作的保护器件，
 *  广泛用于电机过热保护、锅炉超温保护、变压器温控等场合。
 *  本仿真为双金属片式温度继电器，由以下部分组成：
 *
 *  1. 外壳（Housing）
 *     黑色酚醛/尼龙工程塑料，矩形盒体，防护等级 IP40
 *
 *  2. 双金属片（Bimetal Strip）— 核心感温元件
 *     由膨胀系数不同的两种金属（铜合金 + 因瓦合金）热轧复合而成
 *     - 常温：片体平直，动触点与常闭静触点接触（NC 回路导通）
 *     - 升温：膨胀系数大的一侧（上层铜合金）伸长更多，
 *       双金属片向下弯曲，推动动触点组件
 *     - 动作温度（Tset）：双金属片产生足够弯曲，
 *       翻转机构（Snap Action）使动触点瞬间从 NC 切换到 NO
 *       - NC（常闭，Normal Close）触点断开
 *       - NO（常开，Normal Open）触点闭合
 *     - 复位：冷却后双金属片弹回，手动或自动复位（可配置）
 *
 *  3. 触点组（Contact Assembly）
 *     - 动触点（Moving Contact）：固定在双金属片自由端
 *     - NC 静触点（Normally Closed）：常温时与动触点接触
 *     - NO 静触点（Normally Open）：超温时与动触点接触
 *     - 公共端（COM）：动触点引出端
 *
 *  4. 整定旋钮（Set Knob）
 *     调节双金属片初始预应力，设置动作温度 Tset（30~150 °C 可调）
 *
 *  5. 复位按钮（Reset Button）
 *     手动复位（超温动作后须人工按压复位，或配置自动复位）
 *
 *  6. 温度指示窗口（Temperature Window）
 *     正面透明小窗，显示当前仿真温度读数
 *
 *  7. 接线端子（Terminals）：COM / NC / NO 三组，底部引出
 *
 * ── 动作逻辑 ──────────────────────────────────────────────────
 *
 *  升温过程（T < Tset）：
 *    双金属片随温度升高逐渐弯曲，动触点缓慢位移，
 *    NC 触点压力减小（仿真：动触点颜色由绿→橙）
 *
 *  动作（T ≥ Tset）：
 *    翻转机构触发，动触点瞬间切换（150ms 动画）：
 *    - NC 断开（NC 触点从绿色变灰，接触处橙弧消失）
 *    - NO 闭合（NO 触点变绿，出现接触橙光）
 *    - 双金属片弯曲到最大形变（向下弯曲最大角度）
 *    - 状态指示灯：绿→红（报警）
 *
 *  复位（T 降至 Treset 以下，或手动复位）：
 *    触点切回初始状态，双金属片回直（200ms 动画）
 *
 *  仿真动画：
 *    - 双金属片弯曲形变：贝塞尔曲线，弯曲量随温度线性增大
 *    - 动触点随双金属片自由端连续位移
 *    - 触点切换时有微小电弧粒子（仿 knifeswitch.js _drawArcEffect）
 *    - 温度数字实时显示，整定值刻度标线
 *    - 点击"升温/降温"按钮或调用 setTemperature() 改变温度
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  terminal_com — 公共端（COM，动触点引出）
 *  terminal_nc  — 常闭端（NC，Normal Close）
 *  terminal_no  — 常开端（NO，Normal Open）
 */
export class TemperatureRelay extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(160, config.width  || 200);
        this.height = Math.max(200, config.height || 250);

        this.type    = 'temperature_relay';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 额定参数 ──
        this.label      = config.label     || 'KT';    // 位号
        this.tSet       = config.tSet      || 80;      // °C，动作整定温度
        this.tReset     = config.tReset    || 65;      // °C，自动复位温度（< tSet）
        this.tMin       = config.tMin      || 20;      // °C，量程下限
        this.tMax       = config.tMax      || 150;     // °C，量程上限
        this.autoReset  = config.autoReset !== false;  // 自动复位（默认 true）
        this.ratedV     = config.ratedV    || 250;     // V
        this.ratedI     = config.ratedI    || 5;       // A

        // ── 状态 ──
        this._temp      = config.initTemp  || 20;      // °C，当前仿真温度
        this._tripped   = false;                        // 是否已动作（超温触发）
        this._animating = false;
        this._animT     = 0;
        this._animDir   = 1;                            // +1 触发，-1 复位
        this._animDur   = 0.15;                         // s，触点切换动画时长
        this._stripBend = 0;                            // 双金属片弯曲量 0~1

        // 温度变化动画（拨动温度时的平滑过渡）
        this._tempAnimating = false;
        this._tempFrom      = this._temp;
        this._tempTo        = this._temp;
        this._tempAnimT     = 0;
        this._tempAnimDur   = 0.6;                      // s

        // 操作计数
        this.opsCount   = config.initOps  || 0;


        // ── 几何尺寸（相对 width/height）──
        const W = this.width, H = this.height;

        // 外壳
        this._body = {
            x: W * 0.06, y: H * 0.05,
            w: W * 0.88, h: H * 0.72,
            rx: 5,
        };

        // 底座接线区（外壳下方）
        this._base = {
            x: W * 0.06, y: H * 0.05 + H * 0.72,
            w: W * 0.88, h: H * 0.15,
            rx: 3,
        };

        // 内腔（外壳内，双金属片 + 触点所在区域）
        this._inner = {
            x: this._body.x + 8,
            y: this._body.y + 8,
            w: this._body.w - 16,
            h: this._body.h - 16,
        };

        // 双金属片固定端（左侧中上部，固定在外壳内壁）
        this._stripFixX = this._inner.x + this._inner.w * 0.08;
        this._stripFixY = this._inner.y + this._inner.h * 0.35;
        // 双金属片自由端（零弯曲时，水平向右）
        this._stripLen  = this._inner.w * 0.60;
        this._stripFreeX0 = this._stripFixX + this._stripLen;
        this._stripFreeY0 = this._stripFixY;
        // 最大弯曲时自由端下移量
        this._maxBendY  = this._inner.h * 0.22;

        // NC 静触点（双金属片自由端正上方，常温时动触点接触此处）
        this._ncX = this._stripFreeX0 + this._inner.w * 0.06;
        this._ncY = this._stripFreeY0 - this._inner.h * 0.12;

        // NO 静触点（双金属片自由端正下方，超温时动触点接触此处）
        this._noX = this._ncX;
        this._noY = this._stripFreeY0 + this._maxBendY + this._inner.h * 0.10;

        // 整定旋钮（外壳右侧面）
        this._knobX = this._body.x + this._body.w - 16;
        this._knobY = this._body.y + this._body.h * 0.30;

        // 复位按钮（外壳顶面中央）
        this._btnX  = this._body.x + this._body.w * 0.50;
        this._btnY  = this._body.y + 6;

        // 温度窗口（外壳正面左上角）
        this._winX  = this._body.x + 10;
        this._winY  = this._body.y + 10;
        this._winW  = this._body.w * 0.42;
        this._winH  = this._inner.h * 0.22;

        // 接线端子（底座，三个：COM / NC / NO）
        const termSpan = this._base.w / 4;
        this._termCOMX = this._base.x + termSpan * 1.0;
        this._termNCX  = this._base.x + termSpan * 2.0;
        this._termNOX  = this._base.x + termSpan * 3.0;
        this._termY    = this._base.y + this._base.h + 4;

        this._init();

        // 端口
        this.addPort(this._termCOMX, this._termY, 'terminal_com', 'wire', 'COM');
        this.addPort(this._termNCX,  this._termY, 'terminal_nc',  'wire', 'NC');
        this.addPort(this._termNOX,  this._termY, 'terminal_no',  'wire', 'NO');
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBody();               // 静态：外壳
        this._drawBodyDetails();        // 静态：铭牌、整定旋钮、复位按钮
        this._drawBase();               // 静态：接线底座
        this._drawTerminals();          // 静态：接线端子
        this._drawStaticContacts();     // 静态：NC / NO 静触点座
        this._drawContactLayer();       // 动态层：双金属片 + 动触点 + 电弧
        this._drawWindowLayer();        // 动态层：温度数字窗口
        this._drawLabel();
        this._drawStatusIndicator();
        
    }

    // ── 外壳主体 ──────────────────────────────
    _drawBody() {
        const b = this._body;

        // 外壳阴影
        this.group.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 4,
            width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.30)', cornerRadius: b.rx,
        }));
        // 外壳主体（深灰黑酚醛）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: 0 },
            fillLinearGradientColorStops: [
                0,   '#1e1e22',
                0.2, '#2a2a2e',
                0.5, '#323236',
                0.8, '#2a2a2e',
                1,   '#1e1e22',
            ],
            stroke: '#3a3a40', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 6,
            shadowOffsetY: 2, shadowOpacity: 0.35,
        }));
        // 顶面高光
        this.group.add(new Konva.Rect({
            x: b.x + 3, y: b.y + 2,
            width: b.w - 6, height: b.h * 0.06,
            fill: 'rgba(255,255,255,0.07)',
            cornerRadius: [b.rx, b.rx, 0, 0],
        }));
        // 内腔背景（浅灰，模拟内壁）
        const inn = this._inner;
        this.group.add(new Konva.Rect({
            x: inn.x, y: inn.y, width: inn.w, height: inn.h,
            fill: '#28282e', stroke: '#383840', strokeWidth: 0.8,
            cornerRadius: 3,
        }));
    }

    // ── 外壳细节：铭牌 + 整定旋钮 + 复位按钮 ──
    _drawBodyDetails() {
        const b = this._body;

        // ── 铭牌（外壳右侧竖向区域）──
        const plX = this._inner.x + this._inner.w * 0.68;
        const plY = this._inner.y + 4;
        const plW = this._inner.w * 0.28;
        const plH = this._inner.h * 0.88;
        this.group.add(new Konva.Rect({
            x: plX, y: plY, width: plW, height: plH,
            fill: '#1a1a20', stroke: '#2a2a30', strokeWidth: 0.5,
            cornerRadius: 2,
        }));
        // 铭牌文字（型号、参数）
        [
            { text: 'TEMP',   y: plY +  8, col: '#808090', size: 7 },
            { text: 'RELAY',  y: plY + 18, col: '#808090', size: 7 },
            { text: `${this.tSet}°C`, y: plY + 32, col: '#c0a040', size: 9 },
            { text: `${this.ratedV}V`, y: plY + 46, col: '#7a8a94', size: 7 },
            { text: `${this.ratedI}A`, y: plY + 57, col: '#7a8a94', size: 7 },
        ].forEach(({ text, y, col, size }) => {
            this.group.add(new Konva.Text({
                x: plX + 2, y,
                width: plW - 4, text,
                fontSize: size, fill: col, align: 'center',
            }));
        });

        // ── 整定温度刻度（竖向小刻度尺，紧贴铭牌左侧）──
        const scX  = plX - 12;
        const scY0 = plY + 28;
        const scH  = plH * 0.45;
        // 刻度背景条
        this.group.add(new Konva.Rect({
            x: scX, y: scY0, width: 8, height: scH,
            fill: '#141418', stroke: '#2a2a30', strokeWidth: 0.5,
            cornerRadius: 1,
        }));
        // 刻度线（5条）
        for (let i = 0; i <= 4; i++) {
            const ty   = scY0 + (i / 4) * scH;
            const tVal = this.tMax - i * (this.tMax - this.tMin) / 4;
            const isMaj= (i % 2 === 0);
            this.group.add(new Konva.Line({
                points: [scX, ty, scX + (isMaj ? 8 : 5), ty],
                stroke: isMaj ? '#6a7a84' : '#3a4a54', strokeWidth: isMaj ? 0.8 : 0.5,
            }));
        }
        // 整定指针（黄色三角）
        const setFrac = (this.tSet - this.tMin) / (this.tMax - this.tMin);
        const setY    = scY0 + scH * (1 - setFrac);
        this.group.add(new Konva.Line({
            points: [scX + 10, setY, scX + 6, setY - 3, scX + 6, setY + 3],
            closed: true,
            fill: '#c0a030', stroke: '#8a7020', strokeWidth: 0.5,
        }));

        // ── 整定旋钮（外壳右侧面凸出）──
        const kx = this._knobX, ky = this._knobY;
        this.group.add(new Konva.Circle({
            x: kx, y: ky, radius: 9,
            fillLinearGradientStartPoint: { x: -9, y: -9 },
            fillLinearGradientEndPoint:   { x:  9, y:  9 },
            fillLinearGradientColorStops: [
                0, '#5a5a62', 0.5, '#9a9aa2', 1, '#4a4a52',
            ],
            stroke: '#3a3a40', strokeWidth: 1,
        }));
        // 旋钮刻线（一字）
        const kAng = Math.PI * 0.25;
        this.group.add(new Konva.Line({
            points: [
                kx + 5 * Math.cos(kAng), ky + 5 * Math.sin(kAng),
                kx - 5 * Math.cos(kAng), ky - 5 * Math.sin(kAng),
            ],
            stroke: '#282830', strokeWidth: 1.5, lineCap: 'round',
        }));

        // ── 复位按钮（外壳顶面，圆形凸起）──
        const bx = this._btnX, by = this._btnY;
        this.group.add(new Konva.Ellipse({
            x: bx, y: by,
            radiusX: 10, radiusY: 5,
            fillLinearGradientStartPoint: { x: -10, y: 0 },
            fillLinearGradientEndPoint:   { x:  10, y: 0 },
            fillLinearGradientColorStops: [
                0, '#8a2010', 0.4, '#d03020', 0.6, '#e04030', 1, '#8a2010',
            ],
            stroke: '#601010', strokeWidth: 1,
        }));
        this.group.add(new Konva.Text({
            x: bx - 12, y: by - 4,
            text: 'RESET', fontSize: 5, fill: 'rgba(255,200,180,0.70)',
        }));
    }

    // ── 接线底座 ──────────────────────────────
    _drawBase() {
        const b = this._base;
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#222226', stroke: '#3a3a40', strokeWidth: 1,
            cornerRadius: [0, 0, b.rx, b.rx],
        }));
        // 底座顶边分隔线
        this.group.add(new Konva.Line({
            points: [b.x, b.y, b.x + b.w, b.y],
            stroke: '#404048', strokeWidth: 1,
        }));
    }

    // ── 接线端子（COM / NC / NO）──────────────
    _drawTerminals() {
        const termDefs = [
            { x: this._termCOMX, label: 'COM', col: '#e0c060' },
            { x: this._termNCX,  label: 'NC',  col: '#ef9a9a' },
            { x: this._termNOX,  label: 'NO',  col: '#90caf9' },
        ];
        const ty  = this._base.y + 4;
        const tw  = this._body.w * 0.075;
        const th  = this._base.h * 0.55;

        termDefs.forEach(({ x, label, col }) => {
            // 端子主体（黄铜色）
            this.group.add(new Konva.Rect({
                x: x - tw / 2, y: ty,
                width: tw, height: th,
                fillLinearGradientStartPoint: { x: 0,  y: 0 },
                fillLinearGradientEndPoint:   { x: tw, y: 0 },
                fillLinearGradientColorStops: [
                    0, '#7a6820', 0.35, '#c8a840', 0.65, '#d8b848', 1, '#7a6820',
                ],
                stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 1,
            }));
            // 螺钉
            const sr = tw * 0.45;
            const sy = ty + th * 0.35;
            this.group.add(new Konva.Circle({
                x, y: sy, radius: sr,
                fill: '#888890', stroke: '#585860', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Line({
                points: [x - sr * 0.6, sy, x + sr * 0.6, sy],
                stroke: '#404048', strokeWidth: 0.8, lineCap: 'round',
            }));
            // 端子标注
            this.group.add(new Konva.Text({
                x: x - 10, y: this._termY - 1,
                text: label, fontSize: 7, fontStyle: 'bold', fill: col,
            }));
        });
    }

    // ── 静触点座（NC / NO，固定在内腔右侧）──
    _drawStaticContacts() {
        // NC 静触点座
        this._drawContactPost(this._ncX, this._ncY, 'NC', '#ef9a9a');
        // NO 静触点座
        this._drawContactPost(this._noX, this._noY, 'NO', '#90caf9');
    }

    _drawContactPost(cx, cy, label, col) {
        const pw = this._inner.w * 0.10;
        const ph = this._inner.h * 0.08;
        // 触点座主体（黄铜色矩形）
        this.group.add(new Konva.Rect({
            x: cx - pw * 0.5, y: cy - ph * 0.5,
            width: pw, height: ph,
            fillLinearGradientStartPoint: { x: 0,  y: 0 },
            fillLinearGradientEndPoint:   { x: pw, y: 0 },
            fillLinearGradientColorStops: [
                0, '#7a6820', 0.4, '#c8a840', 0.7, '#d4b040', 1, '#7a6820',
            ],
            stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 触点面（银色小圆点）
        this.group.add(new Konva.Circle({
            x: cx - pw * 0.3, y: cy, radius: ph * 0.30,
            fill: '#c0c0c8', stroke: '#909098', strokeWidth: 0.5,
        }));
        // 标注
        this.group.add(new Konva.Text({
            x: cx + pw * 0.2, y: cy - 5,
            text: label, fontSize: 7, fontStyle: 'bold', fill: col,
        }));
    }

    // ── 动态层：双金属片 + 动触点 + 电弧 ─────
    _drawContactLayer() {
        this._contactGroup = new Konva.Group();
        this.group.add(this._contactGroup);
        this._rebuildStrip();
    }

    _rebuildStrip() {
        this._contactGroup.destroyChildren();

        const bend    = this._stripBend;        // 0=平直，1=最大弯曲
        const tripped = this._tripped;

        // ── 双金属片（贝塞尔曲线模拟弯曲）──
        const fx  = this._stripFixX;
        const fy  = this._stripFixY;
        const len = this._stripLen;
        const maxB= this._maxBendY;

        // 自由端当前位置
        const freeY = fy + bend * maxB;
        const freeX = fx + len;

        // 控制点（中点偏移 = 弯曲量 × 0.6，模拟弹性梁弯曲形状）
        const midX  = fx + len * 0.55;
        const midY  = fy + bend * maxB * 0.65;

        // 片体宽度（双金属片截面厚度）
        const stripW = this._inner.h * 0.022;

        // 双金属片颜色：冷=钢蓝，热=铜橙红
        const tempFrac = Math.max(0, Math.min(1, (this._temp - this.tMin) / (this.tMax - this.tMin)));
        const sR = Math.round(80  + tempFrac * 160);
        const sG = Math.round(120 - tempFrac * 60);
        const sB = Math.round(180 - tempFrac * 140);
        const stripCol = `rgb(${sR},${sG},${sB})`;

        // 上边曲线（Path 贝塞尔）
        const topPath = `M ${fx},${fy - stripW} Q ${midX},${midY - stripW} ${freeX},${freeY - stripW}`;
        const botPath = `L ${freeX},${freeY + stripW} Q ${midX},${midY + stripW} ${fx},${fy + stripW} Z`;

        // 双金属片填充
        this._contactGroup.add(new Konva.Path({
            data: topPath + botPath,
            fill: stripCol,
            stroke: `rgba(${sR},${sG},${sB},0.60)`,
            strokeWidth: 0.5,
        }));
        // 双金属片高光（上层）
        this._contactGroup.add(new Konva.Path({
            data: `M ${fx},${fy - stripW * 0.2} Q ${midX},${midY - stripW * 0.2} ${freeX},${freeY - stripW * 0.2}`,
            fill: 'none',
            stroke: 'rgba(255,255,255,0.15)',
            strokeWidth: 0.8,
        }));

        // 双金属片材料分界线（上铜 / 下因瓦，中间虚线）
        this._contactGroup.add(new Konva.Path({
            data: `M ${fx},${fy} Q ${midX},${midY} ${freeX},${freeY}`,
            fill: 'none',
            stroke: 'rgba(180,160,100,0.30)',
            strokeWidth: 0.5,
            dash: [3, 2],
        }));

        // 固定端夹块（左侧）
        const clampH = stripW * 3.5;
        this._contactGroup.add(new Konva.Rect({
            x: fx - 6, y: fy - clampH / 2,
            width: 7, height: clampH,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 7, y: 0 },
            fillLinearGradientColorStops: [
                0, '#6a6820', 0.5, '#c8b040', 1, '#6a6820',
            ],
            stroke: '#5a5820', strokeWidth: 0.8, cornerRadius: 1,
        }));

        // ── 动触点（固定在双金属片自由端）──
        // 动触点位置
        const movX = freeX + this._inner.w * 0.02;
        const movY = freeY;

        // 动触点连杆（从自由端延伸到触点面）
        this._contactGroup.add(new Konva.Line({
            points: [freeX, freeY, movX + this._inner.w * 0.04, movY],
            stroke: '#909098', strokeWidth: 2, lineCap: 'round',
        }));

        // 动触点本体（矩形，比静触点座稍小）
        const ctW = this._inner.w * 0.08;
        const ctH = this._inner.h * 0.07;
        this._contactGroup.add(new Konva.Rect({
            x: movX + this._inner.w * 0.01, y: movY - ctH / 2,
            width: ctW, height: ctH,
            fillLinearGradientStartPoint: { x: 0,   y: 0 },
            fillLinearGradientEndPoint:   { x: ctW, y: 0 },
            fillLinearGradientColorStops: [
                0, '#7a6820', 0.4, '#c8a840', 0.7, '#d4b040', 1, '#7a6820',
            ],
            stroke: '#6a5820', strokeWidth: 0.8, cornerRadius: 2,
        }));
        // 动触点接触面（银色）
        this._contactGroup.add(new Konva.Circle({
            x: movX + this._inner.w * 0.07,
            y: movY, radius: ctH * 0.28,
            fill: '#c8c8d0', stroke: '#989898', strokeWidth: 0.5,
        }));

        // ── 触点接触高光（导通时发橙光）──
        const ncContactY = this._ncY;
        const noContactY = this._noY;
        const contactX   = this._ncX - this._inner.w * 0.02;

        if (!tripped) {
            // NC 闭合：动触点与 NC 静触点之间橙色接触光晕
            this._contactGroup.add(new Konva.Ellipse({
                x: contactX, y: ncContactY,
                radiusX: ctW * 0.55, radiusY: ctH * 0.60,
                fill: 'rgba(255,160,30,0.20)',
                stroke: 'rgba(255,160,30,0.40)',
                strokeWidth: 0.8,
            }));
        } else {
            // NO 闭合：动触点与 NO 静触点接触光晕
            this._contactGroup.add(new Konva.Ellipse({
                x: contactX, y: noContactY,
                radiusX: ctW * 0.55, radiusY: ctH * 0.60,
                fill: 'rgba(100,200,120,0.20)',
                stroke: 'rgba(100,200,120,0.40)',
                strokeWidth: 0.8,
            }));
        }

        // ── 电弧效果（触点切换瞬间）──
        if (this._animating && this._animT < 0.35) {
            this._drawArcEffect(
                contactX,
                tripped ? ncContactY : noContactY
            );
        }

        // ── 导通回路发光（连接线）──
        if (!tripped) {
            // COM → NC 路径高光（内腔底部走线）
            this._contactGroup.add(new Konva.Line({
                points: [
                    this._termCOMX, this._inner.y + this._inner.h - 2,
                    this._termCOMX, this._inner.y + this._inner.h * 0.72,
                    contactX,       this._inner.y + this._inner.h * 0.72,
                    contactX,       ncContactY,
                ],
                stroke: 'rgba(255,160,30,0.18)',
                strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
                dash: [4, 3],
            }));
        } else {
            // COM → NO 路径高光
            this._contactGroup.add(new Konva.Line({
                points: [
                    this._termCOMX, this._inner.y + this._inner.h - 2,
                    this._termCOMX, this._inner.y + this._inner.h * 0.80,
                    contactX,       this._inner.y + this._inner.h * 0.80,
                    contactX,       noContactY,
                ],
                stroke: 'rgba(100,200,120,0.18)',
                strokeWidth: 1.5, lineCap: 'round', lineJoin: 'round',
                dash: [4, 3],
            }));
        }
    }

    // 电弧效果（仿 knifeswitch.js _drawArcEffect）
    _drawArcEffect(cx, cy) {
        for (let i = 0; i < 3; i++) {
            const sx = cx + (Math.random() - 0.5) * 8;
            const sy = cy + (Math.random() - 0.5) * 6;
            this._contactGroup.add(new Konva.Line({
                points: [
                    cx, cy,
                    cx + (Math.random() - 0.5) * 14, cy + (Math.random() - 0.5) * 10,
                    sx, sy,
                ],
                stroke: `rgba(255,${180 + Math.round(Math.random() * 75)},60,${0.5 + Math.random() * 0.4})`,
                strokeWidth: 0.8 + Math.random() * 0.8,
                lineJoin: 'round', lineCap: 'round',
            }));
        }
    }

    // ── 动态层：温度数字窗口 ──────────────────
    _drawWindowLayer() {
        this._windowGroup = new Konva.Group();
        this.group.add(this._windowGroup);
        this._rebuildWindow();
    }

    _rebuildWindow() {
        this._windowGroup.destroyChildren();
        const x = this._winX, y = this._winY;
        const w = this._winW, h = this._winH;

        // 窗口背景（OLED 风格深色）
        this._windowGroup.add(new Konva.Rect({
            x, y, width: w, height: h,
            fill: '#050d10', stroke: '#1a3a40', strokeWidth: 1,
            cornerRadius: 2,
        }));
        // 内边框
        this._windowGroup.add(new Konva.Rect({
            x: x + 1, y: y + 1, width: w - 2, height: h - 2,
            fill: 'transparent', stroke: '#0a2a30', strokeWidth: 0.5,
            cornerRadius: 2,
        }));

        // 温度颜色
        const frac = Math.max(0, Math.min(1, (this._temp - this.tMin) / (this.tMax - this.tMin)));
        const tR   = Math.round(80  + frac * 175);
        const tG   = Math.round(180 - frac * 120);
        const tB   = Math.round(220 - frac * 180);
        const tCol = `rgb(${tR},${tG},${tB})`;

        // "TEMP" 小标
        this._windowGroup.add(new Konva.Text({
            x: x + 4, y: y + 4,
            text: 'TEMP', fontSize: 6, fill: '#4a7a8a', letterSpacing: 1,
        }));
        // 温度大字
        this._windowGroup.add(new Konva.Text({
            x: x + 4, y: y + 12,
            text: `${this._temp.toFixed(1)}`,
            fontSize: 15, fontStyle: 'bold', fontFamily: 'monospace',
            fill: tCol,
        }));
        // 单位
        this._windowGroup.add(new Konva.Text({
            x: x + w - 16, y: y + 14,
            text: '°C', fontSize: 8, fill: '#80deea',
        }));

        // 整定值参考线（窗口内小进度条）
        const setFrac = Math.max(0, Math.min(1, (this.tSet - this.tMin) / (this.tMax - this.tMin)));
        const barW    = w - 8;
        const barY    = y + h - 6;
        // 背景轨道
        this._windowGroup.add(new Konva.Rect({
            x: x + 4, y: barY, width: barW, height: 3,
            fill: '#0d2028', stroke: '#1a3040', strokeWidth: 0.5, cornerRadius: 1,
        }));
        // 当前温度填充
        this._windowGroup.add(new Konva.Rect({
            x: x + 4, y: barY, width: barW * frac, height: 3,
            fill: tCol, cornerRadius: 1,
        }));
        // 整定值标线
        this._windowGroup.add(new Konva.Line({
            points: [
                x + 4 + barW * setFrac, barY - 2,
                x + 4 + barW * setFrac, barY + 5,
            ],
            stroke: '#c0a030', strokeWidth: 1.2,
        }));
    }

    // ── 位号 + 参数标注 ────────────────────────
    _drawLabel() {
        const W = this.width;
        this.group.add(new Konva.Text({
            x: 0, y: -16, width: W,
            text: `${this.label}  Tset=${this.tSet}°C  ${this.ratedV}V/${this.ratedI}A`,
            fontSize: 9, fontStyle: 'bold', fill: '#546e7a', align: 'center',
        }));
    }

    // ── 状态指示（外壳底部左角）──────────────
    _drawStatusIndicator() {
        const ix = this._body.x + 10;
        const iy = this._body.y + this._body.h - 12;

        const on   = this._tripped;
        const col  = on ? '#ef5350' : '#66bb6a';
        const scol = on ? '#c62828' : '#2e7d32';
        const text = on ? '动作' : '正常';

        this._statusDot = new Konva.Circle({
            x: ix, y: iy, radius: 4,
            fill: col, stroke: scol, strokeWidth: 0.8,
            shadowColor: col, shadowBlur: on ? 7 : 2, shadowOpacity: 0.85,
        });
        this._statusText = new Konva.Text({
            x: ix + 7, y: iy - 5,
            text, fontSize: 8, fontStyle: 'bold', fill: col,
        });
        this.group.add(this._statusDot, this._statusText);
    }

    // ── 点击复位按钮 ──────────────────────────
    _bindInteraction() {
        this.group.on('click tap', (e) => {
            e.cancelBubble = true;
            if (this._tripped) {
                this.reset();
            } else {
                // 点击外壳其他区域：温度步进 +10°C
                this.stepTemperature();
            }
        });
        this.group.listening(true);
    }

    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tickAnimation(dt);
    }
    _tickAnimation(dt) {
        let needRefresh = false;

        // ── 温度平滑过渡 ──
        if (this._tempAnimating) {
            this._tempAnimT += dt / this._tempAnimDur;
            if (this._tempAnimT >= 1) {
                this._tempAnimT    = 1;
                this._tempAnimating= false;
                this._temp         = this._tempTo;
            }
            const ease   = 0.5 - 0.5 * Math.cos(this._tempAnimT * Math.PI);
            this._temp   = this._tempFrom + (this._tempTo - this._tempFrom) * ease;
            needRefresh  = true;

            // 检查是否超过整定温度 → 触发动作
            if (!this._tripped && this._temp >= this.tSet) {
                this._triggerTrip();
            }
            // 自动复位检查（降温后）
            if (this._tripped && this.autoReset && this._temp <= this.tReset) {
                this._triggerReset();
            }
        }

        // ── 触点切换动画 ──
        if (this._animating) {
            this._animT += dt / this._animDur;
            if (this._animT >= 1) {
                this._animT     = 1;
                this._animating = false;
                this._tripped   = this._animDir > 0;
            }
            // 正弦缓动（ease in-out）
            const ease         = 0.5 - 0.5 * Math.cos(this._animT * Math.PI);
            // 双金属片弯曲量：触发=1，复位=0
            this._stripBend    = this._animDir > 0
                ? ease
                : 1 - ease;
            needRefresh = true;
        } else if (!this._tempAnimating) {
            // 静止时，双金属片弯曲量跟随温度线性变化（超温后固定在 1）
            if (!this._tripped) {
                const frac = Math.max(0, Math.min(0.95,
                    (this._temp - this.tMin) / (this.tSet - this.tMin)
                ));
                if (Math.abs(this._stripBend - frac) > 0.002) {
                    this._stripBend  += (frac - this._stripBend) * Math.min(1, dt * 4);
                    needRefresh = true;
                }
            }
        }

        if (needRefresh) {
            this._rebuildStrip();
            this._rebuildWindow();
            this._updateStatus();
            this._refreshCache();
        }
    }

    _triggerTrip() {
        if (this._animating) return;
        this._animDir   = 1;
        this._animT     = 0;
        this._animating = true;
        this.opsCount++;
    }

    _triggerReset() {
        if (this._animating) return;
        this._animDir   = -1;
        this._animT     = 0;
        this._animating = true;
    }

    _updateStatus() {
        const on   = this._tripped || (this._animating && this._animDir > 0 && this._stripBend > 0.7);
        const col  = on ? '#ef5350' : '#66bb6a';
        const scol = on ? '#c62828' : '#2e7d32';

        if (this._statusDot) {
            this._statusDot.fill(col);
            this._statusDot.stroke(scol);
            this._statusDot.shadowColor(col);
            this._statusDot.shadowBlur(on ? 7 : 2);
        }
        if (this._statusText) {
            this._statusText.text(on ? '动作' : '正常');
            this._statusText.fill(col);
        }
    }

    // ═══════════════════════════════════════════
    /**
     * 设置目标温度（°C），带平滑动画
     * @param {number} t  目标温度（tMin ~ tMax）
     */
    setTemperature(t) {
        const target = Math.max(this.tMin, Math.min(this.tMax, t));
        if (Math.abs(target - this._temp) < 0.05) return;
        this._tempFrom      = this._temp;
        this._tempTo        = target;
        this._tempAnimT     = 0;
        this._tempAnimating = true;
        this._refreshCache();
    }

    /**
     * 温度步进（点击时调用）
     * 循环：tMin → tSet-10 → tSet+5 → tMax → tMin
     */
    stepTemperature() {
        if (this._tempAnimating || this._animating) return;
        const steps = [
            this.tMin,
            Math.round(this.tSet * 0.60),
            Math.round(this.tSet * 0.85),
            this.tSet + 5,
            this.tMax,
        ];
        const next = steps.find(s => s > this._temp + 0.5) ?? this.tMin;
        this.setTemperature(next);
    }

    /** 手动触发动作（强制动作，不管温度） */
    trip() {
        if (this._tripped || this._animating) return;
        this._triggerTrip();
        this._refreshCache();
    }

    /** 手动复位（已动作时有效） */
    reset() {
        if (!this._tripped || this._animating) return;
        this._triggerReset();
        this._refreshCache();
    }

    /** 当前温度（°C） */
    getTemperature() { return this._temp; }

    /** 是否已动作（超温触发） */
    isTripped()    { return this._tripped; }

    /** NC 触点当前是否导通 */
    isNCClosed()   { return !this._tripped; }

    /** NO 触点当前是否导通 */
    isNOClosed()   { return  this._tripped; }

    isAnimating()  { return this._animating || this._tempAnimating; }
    getOpsCount()  { return this.opsCount; }

    update(state) {
        if (typeof state === 'number') {
            this.setTemperature(state);
        } else if (typeof state === 'boolean') {
            state ? this.trip() : this.reset();
        }
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',          key: 'label',      type: 'text'   },
            { label: '动作整定温度 (°C)',   key: 'tSet',       type: 'number' },
            { label: '自动复位温度 (°C)',   key: 'tReset',     type: 'number' },
            { label: '量程下限 (°C)',       key: 'tMin',       type: 'number' },
            { label: '量程上限 (°C)',       key: 'tMax',       type: 'number' },
            { label: '自动复位（1=是）',    key: 'autoReset',  type: 'number' },
            { label: '额定电压 (V)',        key: 'ratedV',     type: 'number' },
            { label: '额定电流 (A)',        key: 'ratedI',     type: 'number' },
            { label: '初始温度 (°C)',       key: 'initTemp',   type: 'number' },
            { label: '动作时间 (s)',        key: 'animDur',    type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label     !== undefined) this.label      = cfg.label;
        if (cfg.tSet      !== undefined) this.tSet       = parseFloat(cfg.tSet)      || this.tSet;
        if (cfg.tReset    !== undefined) this.tReset     = parseFloat(cfg.tReset)    || this.tReset;
        if (cfg.tMin      !== undefined) this.tMin       = parseFloat(cfg.tMin)      || this.tMin;
        if (cfg.tMax      !== undefined) this.tMax       = parseFloat(cfg.tMax)      || this.tMax;
        if (cfg.autoReset !== undefined) this.autoReset  = !!parseInt(cfg.autoReset);
        if (cfg.ratedV    !== undefined) this.ratedV     = parseFloat(cfg.ratedV)    || this.ratedV;
        if (cfg.ratedI    !== undefined) this.ratedI     = parseFloat(cfg.ratedI)    || this.ratedI;
        if (cfg.animDur   !== undefined) this._animDur   = parseFloat(cfg.animDur)   || this._animDur;
        if (cfg.initTemp  !== undefined) {
            const t = parseFloat(cfg.initTemp);
            if (!isNaN(t)) this.setTemperature(t);
        }
        this.config = { ...this.config, ...cfg };
        // 重建所有静态层（整定值、量程等变化需重绘）
        this.group.destroyChildren();
        this._statusDot  = null;
        this._statusText = null;
        this._init();
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}