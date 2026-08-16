import { BaseComponent } from './BaseComponent.js';

/**
 * MR-Ⅱ 型冷却水温度调节器 仿真组件
 * ═══════════════════════════════════════════════════════════════
 *
 * 本组件完整仿真 MR-Ⅱ 型调节器正面面板，包含：
 *
 * ┌──────────────────────────────────────────────┐
 * │           [A] 温度表（电流计式）              │
 * ├──────────────────────────────────────────────┤  插板B
 * │  ⊟₁（整定给定值）          ○₂（PV/SP切换）  │  输入和指示电路
 * ├──────────────────────────────────────────────┤  插板C
 * │  ⊟₃（微分时间 Td）        ⊟₄（比例带 PB）  │  比例微分控制电路
 * ├──────────────────────────────────────────────┤  插板D
 * │  ⊟₅（不灵敏区 DB）        ⊟₆（脉冲宽度 PW）│  脉冲宽度调制电路
 * ├──────────────────────────────────────────────┤  插板E
 * │  ○₇（正转灯）   ⊙₉（手操）   ○₈（反转灯）  │  继电器和开关电路
 * ├──────────────────────────────────────────────┤  插板F
 * │  ○₁₀(保险)⊙₁₂(手/自动)⊙₁₄(电源灯)⊙₁₃(主开关)○₁₁(保险)│ 电源和切换电路
 * ├──────────────────────────────────────────────┤
 * │           [接线端子排]                        │
 * └──────────────────────────────────────────────┘
 *
 * ── 控制逻辑 ───────────────────────────────────────────────────
 *
 *  自动模式（开关12 → 右/AUTO）：
 *    ① PD 控制：误差 e = SP - PV，输出 = Kp·(e + Td·de/dt)
 *    ② 死区处理：|e| < DB 时，输出为 0（不灵敏区）
 *    ③ PWM 输出：把连续量转换为脉冲宽度信号（0~PW ms 范围内的通断时间）
 *    ④ 继电器驱动：正转（开大阀）/ 反转（关小阀）/ 停止
 *    ⑤ 指示灯7（正转）/ 灯8（反转）实时点亮
 *
 *  手动模式（开关12 → 左/MAN）：
 *    手操开关9：持续拨向左/右 → 电机正转或反转
 *
 *  温度表 A：
 *    按钮2 弹出 → 指示 PV（测量值）
 *    按钮2 按下 → 指示 SP（给定值）
 *    0~1mA 电流线性对应 0~100°C，表盘弧度 ±60°
 *
 *  参数说明：
 *    旋钮1  : SP 整定（0~100°C）
 *    旋钮3  : 微分时间 Td（0~60 s）
 *    旋钮4  : 比例带 PB（10~200 %，越大越"软"）
 *    旋钮5  : 不灵敏区 DB（0~5 °C）
 *    旋钮6  : 脉冲宽度基准 PW（1~30 s）
 *
 * ── 故障仿真 ─────────────────────────────────────────────────
 *  • 当 |e| > 10°C 且灯7/8均不亮 → 触发"电机停转"故障提示
 *  • 保险丝10/11 可通过API模拟断路状态
 *
 * ── 端口 ──────────────────────────────────────────────────────
 *  port_pv_in    — 0~5V / 4~20mA 温度输入（来自温度变送器）
 *  port_motor_fw — 继电器正转输出（开大冷却水阀）
 *  port_motor_rv — 继电器反转输出（关小冷却水阀）
 *  port_alarm    — 故障报警输出
 */
export class MRIIController extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        // ── 面板尺寸（参照图纸比例：约 3:5 竖版）──
        this.width  = Math.max(240, config.width  || 300);
        this.height = Math.max(400, config.height || 500);

        this.type    = 'mrii_cooling_ctrl';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌 ──
        this.label = config.label || 'MR-Ⅱ';

        // ── 温度量程 ──
        this.rangeMin = 0;
        this.rangeMax = 100;   // °C

        // ── 参数（旋钮对应）──
        this._sp  = config.initSP !== undefined ? config.initSP : 36;  // °C  旋钮1
        this._pv  = config.initPV !== undefined ? config.initPV : 42;  // °C  仿真过程值
        this._Td  = config.Td     !== undefined ? config.Td     : 8;   // s   旋钮3
        this._PB  = config.PB     !== undefined ? config.PB     : 60;  // %   旋钮4
        this._DB  = config.DB     !== undefined ? config.DB     : 1.5; // °C  旋钮5
        this._PW  = config.PW     !== undefined ? config.PW     : 10;  // s   旋钮6

        // ── 状态 ──
        this._powered     = false;  // 主开关13
        this._autoMode    = false;  // 手/自动开关12：false=手动，true=自动
        this._spIndMode   = false;  // 按钮2：false=弹出(PV), true=按下(SP)
        this._motorFwd    = false;  // 正转灯7
        this._motorRev    = false;  // 反转灯8
        this._fuse10ok    = true;   // 保险丝10
        this._fuse11ok    = true;   // 保险丝11
        this._powerLed    = false;  // 电源指示灯14

        // ── 手操开关9（三位：-1 反转, 0 中立, 1 正转）──
        this._manSwitch9  = 0;

        // ── PD 控制器内部状态 ──
        this._prevError   = 0;
        this._ctrlOutput  = 0;  // 连续控制量（-100~+100）
        this._pwmPhase    = 0;  // PWM 相位计数（s）
        this._pwmOn       = false;

        // ── 过程仿真（阀位 → 冷却水温度）──
        this._valvePos    = 50; // 0~100% 调节阀开度
        this._pvTarget    = this._pv;
        this._tau         = 40; // 过程惯性时间常数 s
        this._noiseAmp    = 0.05;

        // ── 故障标志 ──
        this._motorFault  = false;

        this._blinkPhase  = 0;

        this._computeLayout();
        this._init();
        this._addPorts();
    }

    // ═══════════════════════════════════════════
    _computeLayout() {
        const W = this.width, H = this.height;

        // 外边框
        this._outerPad = 6;

        // 表头区（温度表 A）：占顶部约 30%
        this._meterY  = this._outerPad;
        this._meterH  = H * 0.30;
        this._meterW  = W - this._outerPad * 2;
        this._meterX  = this._outerPad;

        // 五块插板区域（均分剩余高度约60%）
        const boardTop  = this._meterY + this._meterH + 4;
        const boardAreaH = H * 0.61;
        this._boardH    = boardAreaH / 5;
        this._boards    = ['B', 'C', 'D', 'E', 'F'].map((id, i) => ({
            id,
            x: this._outerPad,
            y: boardTop + i * this._boardH,
            w: W - this._outerPad * 2,
            h: this._boardH,
        }));

        // 接线端子排（最底部）
        this._terminalY = boardTop + boardAreaH + 4;
        this._terminalH = H - this._terminalY - 4;
    }

    // ── 全量初始化 ────────────────────────────
    _init() {
        this._drawCabinetBody();
        this._drawMeterA();
        this._drawBoardB();
        this._drawBoardC();
        this._drawBoardD();
        this._drawBoardE();
        this._drawBoardF();
        this._drawTerminalStrip();
        
    }

    // ── 仪器箱体 ─────────────────────────────
    _drawCabinetBody() {
        const W = this.width, H = this.height;

        // 外阴影
        this.group.add(new Konva.Rect({
            x: 3, y: 3, width: W, height: H,
            fill: 'rgba(0,0,0,0.40)', cornerRadius: 4,
        }));

        // 主体（深米灰，仿金属烤漆）
        this.group.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: W, y: H },
            fillLinearGradientColorStops: [
                0,   '#d0cec8',
                0.3, '#c4c2bc',
                0.7, '#b8b6b0',
                1,   '#a8a6a0',
            ],
            stroke: '#707060', strokeWidth: 2,
            cornerRadius: 3,
        }));

        // 顶部高光
        this.group.add(new Konva.Rect({
            x: 1, y: 1, width: W - 2, height: H * 0.025,
            fill: 'rgba(255,255,255,0.30)', cornerRadius: [3, 3, 0, 0],
        }));

        // 左侧型号铭牌
        this.group.add(new Konva.Text({
            x: 0, y: H * 0.005, width: W,
            text: 'MR-Ⅱ 型  冷却水温度调节器',
            fontSize: 9, fontFamily: 'SimHei, Arial, sans-serif',
            fill: '#3a3830', align: 'center', fontStyle: 'bold',
        }));
    }

    // ── 温度表 A（电流计/模拟表头）──────────
    _drawMeterA() {
        const mx = this._meterX + 8;
        const my = this._meterY + 14;
        const mw = this._meterW - 16;
        const mh = this._meterH - 18;

        // 表头外框（凸起感）
        this.group.add(new Konva.Rect({
            x: mx - 2, y: my - 2, width: mw + 4, height: mh + 4,
            fill: '#88887a', stroke: '#505040', strokeWidth: 1.5,
            cornerRadius: 3,
        }));

        // 表盘背景（乳白色）
        this.group.add(new Konva.Rect({
            x: mx, y: my, width: mw, height: mh,
            fill: '#f4f2e8', stroke: '#888878', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 表盘弧面（半圆仿圆弧刻度区域）
        const arcCX = mx + mw / 2;
        const arcCY = my + mh * 0.88;
        const arcR  = mw * 0.46;

        // 弧形刻度背景
        this.group.add(new Konva.Arc({
            x: arcCX, y: arcCY,
            innerRadius: arcR * 0.55,
            outerRadius: arcR * 1.02,
            angle: 120, rotation: -150,
            fill: '#e8e6d8',
        }));

        // 刻度线（11个主刻度，对应 0-10-20..100°C）
        for (let i = 0; i <= 10; i++) {
            const ang  = (-150 + i * 12) * Math.PI / 180;
            const isMaj = (i % 2 === 0);
            const r1   = arcR * (isMaj ? 0.82 : 0.88);
            const r2   = arcR * 0.99;
            const x1   = arcCX + Math.cos(ang) * r1;
            const y1   = arcCY + Math.sin(ang) * r1;
            const x2   = arcCX + Math.cos(ang) * r2;
            const y2   = arcCY + Math.sin(ang) * r2;
            this.group.add(new Konva.Line({
                points: [x1, y1, x2, y2],
                stroke: '#404030', strokeWidth: isMaj ? 1.2 : 0.7,
            }));

            // 主刻度数字
            if (isMaj) {
                const tx = arcCX + Math.cos(ang) * arcR * 0.68;
                const ty = arcCY + Math.sin(ang) * arcR * 0.68;
                this.group.add(new Konva.Text({
                    x: tx - 8, y: ty - 5, width: 16,
                    text: String(i * 10),
                    fontSize: 7, fill: '#303020',
                    fontFamily: 'Arial, sans-serif', align: 'center',
                }));
            }
        }

        // 单位标注
        this.group.add(new Konva.Text({
            x: arcCX - 16, y: my + mh * 0.52,
            text: '°C', fontSize: 9, fill: '#303020',
            fontFamily: 'Arial, sans-serif',
        }));

        // 标注 "A"（温度表标识）
        this._drawLabel(mx - 14, my + mh * 0.30, 'A');

        // ── 表针（动态）──
        const needleLen = arcR * 0.88;
        const initAng   = this._pvSpAngle(this._pv);
        this._needleCX  = arcCX;
        this._needleCY  = arcCY;
        this._needleR   = needleLen;

        // 表针阴影
        this._needleShadow = new Konva.Line({
            points: this._needlePoints(initAng, arcCX + 1, arcCY + 1, needleLen),
            stroke: 'rgba(0,0,0,0.2)', strokeWidth: 1.5, lineCap: 'round',
        });
        this.group.add(this._needleShadow);

        // 表针主体（红色）
        this._needle = new Konva.Line({
            points: this._needlePoints(initAng, arcCX, arcCY, needleLen),
            stroke: '#cc2010', strokeWidth: 1.8, lineCap: 'round',
        });
        this.group.add(this._needle);

        // 中心轴圆
        this.group.add(new Konva.Circle({
            x: arcCX, y: arcCY, radius: 4,
            fill: '#404030', stroke: '#202010', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Circle({
            x: arcCX, y: arcCY, radius: 2,
            fill: '#a09880',
        }));

        // 表框下沿 "°C / 0~100"
        this.group.add(new Konva.Text({
            x: mx, y: my + mh - 12, width: mw,
            text: '0 ~ 100 °C',
            fontSize: 7.5, fill: '#484838',
            fontFamily: 'Arial, sans-serif', align: 'center',
        }));
    }

    /** 返回表针的 [x1,y1, x2,y2] 点数组 */
    _needlePoints(angleDeg, cx, cy, len) {
        const a = angleDeg * Math.PI / 180;
        // 表针从中心延伸，反向有短尾巴
        return [
            cx - Math.cos(a) * len * 0.12,
            cy - Math.sin(a) * len * 0.12,
            cx + Math.cos(a) * len,
            cy + Math.sin(a) * len,
        ];
    }

    /** 温度值 → 表针角度（deg）；量程 0~100°C 对应 -150° ~ -30°（弧度 120°）*/
    _pvSpAngle(val) {
        const frac = Math.max(0, Math.min(1, (val - this.rangeMin) / (this.rangeMax - this.rangeMin)));
        return -150 + frac * 120;
    }

    // ── 插板 B（输入和指示电路）───────────────
    _drawBoardB() {
        const bd = this._boards[0];
        this._drawBoardFrame(bd, 'B', '输入·指示');

        const midY = bd.y + bd.h / 2;

        // 旋钮1（左）── 整定给定值
        this._knob1 = this._drawKnob(bd.x + bd.w * 0.14, midY, 13, '1', '#b08060');
        this._knob1.body.on('click tap', () => this._adjustSP(1));
        this._knob1.body.on('contextmenu', e => { e.evt.preventDefault(); this._adjustSP(-1); });

        // 按钮2（右）── PV/SP 切换（弹出式）
        this._btn2 = this._drawPushButton(bd.x + bd.w * 0.86, midY, 11, '2',
            this._spIndMode ? '#c04020' : '#d8d0c0');
        this._btn2.on('click tap', () => {
            this._spIndMode = !this._spIndMode;
            this._btn2.fill(this._spIndMode ? '#c04020' : '#d8d0c0');
            this._refreshCache();
        });

        // SP 值文本（面板上小字）
        this._spLabel = new Konva.Text({
            x: bd.x + bd.w * 0.30, y: midY - 6,
            text: `SP: ${this._sp.toFixed(1)}°C`,
            fontSize: 8, fill: '#303020',
            fontFamily: 'Arial, sans-serif',
        });
        this.group.add(this._spLabel);
    }

    // ── 插板 C（比例微分控制电路）────────────
    _drawBoardC() {
        const bd = this._boards[1];
        this._drawBoardFrame(bd, 'C', 'PD控制');

        const midY = bd.y + bd.h / 2;

        // 旋钮3（左）── 微分时间 Td
        this._knob3 = this._drawKnob(bd.x + bd.w * 0.14, midY, 13, '3', '#607090');
        this._knob3.body.on('click tap', () => { this._Td = Math.min(60, this._Td + 2); this._knob3.label.text(`Td:${this._Td}s`); this._refreshCache(); });
        this._knob3.body.on('contextmenu', e => { e.evt.preventDefault(); this._Td = Math.max(0, this._Td - 2); this._knob3.label.text(`Td:${this._Td}s`); this._refreshCache(); });

        // 旋钮4（右）── 比例带 PB
        this._knob4 = this._drawKnob(bd.x + bd.w * 0.86, midY, 13, '4', '#607090');
        this._knob4.body.on('click tap', () => { this._PB = Math.min(200, this._PB + 5); this._knob4.label.text(`PB:${this._PB}%`); this._refreshCache(); });
        this._knob4.body.on('contextmenu', e => { e.evt.preventDefault(); this._PB = Math.max(10, this._PB - 5); this._knob4.label.text(`PB:${this._PB}%`); this._refreshCache(); });

        // 参数标注
        this._addParamText(bd, 0.30, `Td:${this._Td}s`, 'left');
        this._addParamText(bd, 0.62, `PB:${this._PB}%`, 'left');

        // 绑定到旋钮 label（动态更新）
        this._knob3.label = this._addParamText(bd, 0.30, `Td:${this._Td}s`, 'left', true);
        this._knob4.label = this._addParamText(bd, 0.62, `PB:${this._PB}%`, 'left', true);
    }

    // ── 插板 D（脉冲宽度调制电路）────────────
    _drawBoardD() {
        const bd = this._boards[2];
        this._drawBoardFrame(bd, 'D', 'PWM');

        const midY = bd.y + bd.h / 2;

        // 旋钮5（左）── 不灵敏区 DB
        this._knob5 = this._drawKnob(bd.x + bd.w * 0.14, midY, 13, '5', '#507050');
        this._knob5.body.on('click tap', () => { this._DB = Math.min(5, +(this._DB + 0.5).toFixed(1)); this._knob5.label.text(`DB:${this._DB}°`); this._refreshCache(); });
        this._knob5.body.on('contextmenu', e => { e.evt.preventDefault(); this._DB = Math.max(0, +(this._DB - 0.5).toFixed(1)); this._knob5.label.text(`DB:${this._DB}°`); this._refreshCache(); });

        // 旋钮6（右）── 脉冲宽度 PW
        this._knob6 = this._drawKnob(bd.x + bd.w * 0.86, midY, 13, '6', '#507050');
        this._knob6.body.on('click tap', () => { this._PW = Math.min(30, this._PW + 1); this._knob6.label.text(`PW:${this._PW}s`); this._refreshCache(); });
        this._knob6.body.on('contextmenu', e => { e.evt.preventDefault(); this._PW = Math.max(1, this._PW - 1); this._knob6.label.text(`PW:${this._PW}s`); this._refreshCache(); });

        this._knob5.label = this._addParamText(bd, 0.30, `DB:${this._DB}°`, 'left', true);
        this._knob6.label = this._addParamText(bd, 0.62, `PW:${this._PW}s`, 'left', true);
    }

    // ── 插板 E（继电器和开关电路）────────────
    _drawBoardE() {
        const bd = this._boards[3];
        this._drawBoardFrame(bd, 'E', '继电器·开关');

        const midY = bd.y + bd.h / 2;

        // 指示灯7（正转，左）
        this._led7 = this._drawLED(bd.x + bd.w * 0.14, midY, 11, '7', '#22cc44');

        // 手操开关9（中）── 三位拨杆
        this._sw9 = this._drawToggleSwitch3(bd.x + bd.w * 0.50, midY, '9');

        // 指示灯8（反转，右）
        this._led8 = this._drawLED(bd.x + bd.w * 0.86, midY, 11, '8', '#22cc44');
    }

    // ── 插板 F（电源和手/自动切换）───────────
    _drawBoardF() {
        const bd = this._boards[4];
        this._drawBoardFrame(bd, 'F', '电源·手/自动');

        const midY = bd.y + bd.h / 2;
        const W    = bd.w;

        // 保险丝10（左1）
        this._fuse10shape = this._drawFuse(bd.x + W * 0.09, midY, '10', this._fuse10ok);

        // 手动/自动转换开关12（左2）── 拨杆开关
        this._sw12 = this._drawToggleSwitch2(bd.x + W * 0.30, midY, '12', this._autoMode);

        // 电源指示灯14（中）
        this._led14 = this._drawLED(bd.x + W * 0.50, midY, 10, '14', '#ffcc00');

        // 电源主开关13（中右）── 拨杆开关
        this._sw13 = this._drawToggleSwitch2(bd.x + W * 0.68, midY, '13', this._powered);

        // 保险丝11（右）
        this._fuse11shape = this._drawFuse(bd.x + W * 0.88, midY, '11', this._fuse11ok);

        // 交互
        this._sw13.body.on('click tap', () => this._onPowerToggle());
        this._sw12.body.on('click tap', () => this._onModeToggle());
    }

    // ── 接线端子排 ───────────────────────────
    _drawTerminalStrip() {
        const tx = this._outerPad;
        const ty = this._terminalY;
        const tw = this.width - this._outerPad * 2;
        const th = this._terminalH;

        this.group.add(new Konva.Rect({
            x: tx, y: ty, width: tw, height: th,
            fill: '#b0aea8', stroke: '#707060', strokeWidth: 1,
        }));

        const terminals = [
            'L', 'N', 'PE', 'PV+', 'PV−', 'FWD', 'REV', 'COM',
        ];
        const spacing = tw / (terminals.length + 1);
        terminals.forEach((t, i) => {
            const cx = tx + spacing * (i + 1);
            const cy = ty + th / 2;
            // 端子孔
            this.group.add(new Konva.Circle({
                x: cx, y: cy - 4, radius: 4,
                fill: '#303020', stroke: '#484830', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({
                x: cx - 8, y: cy + 1, width: 16,
                text: t, fontSize: 6,
                fill: '#303020', align: 'center',
                fontFamily: 'Arial, sans-serif',
            }));
        });
    }

    // ═══════════════════════════════════════════
    // 绘图辅助方法
    // ═══════════════════════════════════════════

    /** 绘制插板框和标注 */
    _drawBoardFrame(bd, id, desc) {
        // 插板区域背景（交替浅色）
        const col = ['B','D','F'].includes(id) ? '#d0cec8' : '#c8c6c0';
        this.group.add(new Konva.Rect({
            x: bd.x, y: bd.y, width: bd.w, height: bd.h,
            fill: col, stroke: '#888878', strokeWidth: 0.8,
        }));
        // 插板分隔线（上）
        this.group.add(new Konva.Line({
            points: [bd.x, bd.y, bd.x + bd.w, bd.y],
            stroke: '#666658', strokeWidth: 1.2,
        }));
        // 标注字母（左边界外）
        this._drawLabel(bd.x - 14, bd.y + bd.h * 0.28, id);
        // 电路描述（小字，左侧内部）
        this.group.add(new Konva.Text({
            x: bd.x + 2, y: bd.y + 2,
            text: desc, fontSize: 6.5,
            fill: '#505040', fontFamily: 'Arial, sans-serif',
        }));
    }

    /** 标注字母（面板外侧）*/
    _drawLabel(x, y, text) {
        this.group.add(new Konva.Text({
            x, y, text,
            fontSize: 11, fontStyle: 'bold',
            fill: '#202010', fontFamily: 'Arial, sans-serif',
        }));
    }

    /** 绘制旋钮（⊟ 式，带刻度线，返回 {body, pointer, label} 对象）*/
    _drawKnob(cx, cy, r, numLabel, fillColor) {
        // 底座
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 1.38,
            fill: '#888878', stroke: '#555545', strokeWidth: 1,
        }));
        // 旋钮主体
        const body = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fillLinearGradientStartPoint: { x: -r * 0.4, y: -r * 0.4 },
            fillLinearGradientEndPoint:   { x: r * 0.4,  y: r * 0.4  },
            fillLinearGradientColorStops: [
                0,   this._lighten(fillColor, 0.25),
                0.5, fillColor,
                1,   this._darken(fillColor, 0.30),
            ],
            stroke: this._darken(fillColor, 0.4), strokeWidth: 0.9,
        });
        this.group.add(body);
        // 十字刻槽（⊟ 效果）
        this.group.add(new Konva.Line({
            points: [cx - r * 0.65, cy, cx + r * 0.65, cy],
            stroke: this._darken(fillColor, 0.5), strokeWidth: 2, lineCap: 'round',
        }));
        this.group.add(new Konva.Line({
            points: [cx, cy - r * 0.65, cx, cy + r * 0.65],
            stroke: this._darken(fillColor, 0.5), strokeWidth: 1.2, lineCap: 'round',
        }));
        // 编号标注（旋钮右下）
        this.group.add(new Konva.Text({
            x: cx + r * 0.55, y: cy + r * 0.55,
            text: numLabel, fontSize: 8,
            fill: '#303020', fontFamily: 'Arial, sans-serif',
        }));
        // 鼠标悬停效果
        body.on('mouseenter', () => { body.opacity(0.75); this._refreshCache(); });
        body.on('mouseleave', () => { body.opacity(1.00); this._refreshCache(); });

        // 参数标签（占位，后续可赋值）
        const label = { text: () => {}, fill: () => {} }; // 哑对象，实际由 _addParamText 创建
        return { body, label };
    }

    /** 绘制按压式按钮（圆形，弹出/按下两态）*/
    _drawPushButton(cx, cy, r, numLabel, initFill) {
        this.group.add(new Konva.Circle({
            x: cx + 1, y: cy + 1, radius: r * 1.2,
            fill: '#505040',
        }));
        const btn = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: initFill, stroke: '#505040', strokeWidth: 1,
            shadowColor: 'rgba(0,0,0,0.3)', shadowBlur: 3, shadowOpacity: 0.5,
        });
        this.group.add(btn);
        // 高光
        this.group.add(new Konva.Circle({
            x: cx - r * 0.3, y: cy - r * 0.3, radius: r * 0.3,
            fill: 'rgba(255,255,255,0.30)',
        }));
        // 编号
        this.group.add(new Konva.Text({
            x: cx + r * 0.55, y: cy + r * 0.55,
            text: numLabel, fontSize: 8,
            fill: '#303020', fontFamily: 'Arial, sans-serif',
        }));
        btn.on('mouseenter', () => { btn.opacity(0.75); this._refreshCache(); });
        btn.on('mouseleave', () => { btn.opacity(1.00); this._refreshCache(); });
        return btn;
    }

    /** 绘制 LED 指示灯 */
    _drawLED(cx, cy, r, numLabel, activeColor) {
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r * 1.3,
            fill: '#585848', stroke: '#383828', strokeWidth: 0.8,
        }));
        const dot = new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: '#202010', stroke: '#383828', strokeWidth: 0.8,
            shadowColor: 'transparent', shadowBlur: 0,
        });
        this.group.add(dot);
        // 高光
        this.group.add(new Konva.Circle({
            x: cx - r * 0.30, y: cy - r * 0.30, radius: r * 0.30,
            fill: 'rgba(255,255,255,0.15)',
        }));
        // 编号
        this.group.add(new Konva.Text({
            x: cx + r * 0.55, y: cy + r * 0.55,
            text: numLabel, fontSize: 7,
            fill: '#303020', fontFamily: 'Arial, sans-serif',
        }));
        return { dot, activeColor, cx, cy };
    }

    /** 更新 LED 状态 */
    _setLED(led, on) {
        if (!led?.dot) return;
        led.dot.fill(on ? led.activeColor : '#202010');
        led.dot.stroke(on ? led.activeColor : '#383828');
        led.dot.shadowColor(on ? led.activeColor : 'transparent');
        led.dot.shadowBlur(on ? 8 : 0);
        led.dot.shadowOpacity(0.85);
    }

    /** 三位拨杆开关（手操9：正转/停/反转）*/
    _drawToggleSwitch3(cx, cy, numLabel) {
        const bw = 24, bh = 14;
        // 开关底座
        this.group.add(new Konva.Rect({
            x: cx - bw / 2 - 1, y: cy - bh / 2 - 1, width: bw + 2, height: bh + 2,
            fill: '#404030', stroke: '#282818', strokeWidth: 1, cornerRadius: 2,
        }));
        // 三格
        const cols = ['FWD', 'MID', 'REV'];
        this._sw9Idx = 1; // 0=FWD,1=MID,2=REV
        const sw9Seg = [];
        cols.forEach((c, i) => {
            const sx = cx - bw / 2 + i * (bw / 3);
            const seg = new Konva.Rect({
                x: sx, y: cy - bh / 2, width: bw / 3, height: bh,
                fill: i === 1 ? '#a09880' : '#606050',
                stroke: '#282818', strokeWidth: 0.5,
            });
            this.group.add(seg);
            seg.on('click tap', () => {
                this._sw9Idx = i;
                this._manSwitch9 = i - 1; // -1,0,1
                sw9Seg.forEach((s, j) => s.fill(j === i ? '#d0b030' : '#606050'));
                this._refreshCache();
            });
            sw9Seg.push(seg);
        });
        // 标注
        this.group.add(new Konva.Text({
            x: cx - bw / 2, y: cy - bh / 2 - 8, width: bw,
            text: '←  9  →', fontSize: 6.5,
            fill: '#303020', align: 'center', fontFamily: 'Arial',
        }));
        this.group.add(new Konva.Text({
            x: cx - bw / 2, y: cy + bh / 2 + 1, width: bw,
            text: 'REV MAN FWD', fontSize: 5.5,
            fill: '#484830', align: 'center', fontFamily: 'Arial',
        }));
        return { segs: sw9Seg };
    }

    /** 两位拨杆开关（手/自动，电源开关）*/
    _drawToggleSwitch2(cx, cy, numLabel, initState) {
        const bw = 22, bh = 13;
        this.group.add(new Konva.Rect({
            x: cx - bw / 2 - 1, y: cy - bh / 2 - 1, width: bw + 2, height: bh + 2,
            fill: '#404030', stroke: '#282818', strokeWidth: 1, cornerRadius: 2,
        }));
        // 左格 / 右格
        const makeHalf = (side, active) => new Konva.Rect({
            x: cx - bw / 2 + (side === 'R' ? bw / 2 : 0),
            y: cy - bh / 2, width: bw / 2, height: bh,
            fill: active ? '#e06020' : '#606050',
            stroke: '#282818', strokeWidth: 0.5,
        });
        const leftH  = makeHalf('L', !initState);
        const rightH = makeHalf('R',  initState);
        this.group.add(leftH); this.group.add(rightH);

        // 扳把标识
        const handleX = initState ? cx + bw * 0.18 : cx - bw * 0.18;
        const handle = new Konva.Circle({
            x: handleX, y: cy, radius: 4,
            fill: '#c0c0b0', stroke: '#808070', strokeWidth: 0.8,
        });
        this.group.add(handle);

        // 编号
        this.group.add(new Konva.Text({
            x: cx - bw / 2, y: cy + bh / 2 + 1, width: bw,
            text: numLabel, fontSize: 6.5,
            fill: '#303020', align: 'center', fontFamily: 'Arial',
        }));

        const body = new Konva.Rect({
            x: cx - bw / 2 - 1, y: cy - bh / 2 - 1, width: bw + 2, height: bh + 2,
            fill: 'transparent',
        });
        this.group.add(body);

        return { body, leftH, rightH, handle, state: initState };
    }

    /** 更新两位拨杆开关外观 */
    _updateSwitch2(sw, state) {
        sw.state = state;
        sw.leftH.fill(state  ? '#606050' : '#e06020');
        sw.rightH.fill(state ? '#e06020' : '#606050');
        sw.handle.x(state ? sw.handle.x() + 7 : sw.handle.x() - 7);
    }

    /** 保险丝符号 */
    _drawFuse(cx, cy, numLabel, ok) {
        const fw = 18, fh = 8;
        // 外壳
        const shell = new Konva.Rect({
            x: cx - fw / 2, y: cy - fh / 2, width: fw, height: fh,
            fill: ok ? '#d0c890' : '#c04030',
            stroke: '#484830', strokeWidth: 1, cornerRadius: 2,
        });
        this.group.add(shell);
        // 内部断点线
        if (!ok) {
            this.group.add(new Konva.Line({
                points: [cx - fw * 0.2, cy - fh * 0.3, cx + fw * 0.2, cy + fh * 0.3],
                stroke: '#ff4040', strokeWidth: 1.5, lineCap: 'round',
            }));
        } else {
            this.group.add(new Konva.Line({
                points: [cx - fw * 0.3, cy, cx + fw * 0.3, cy],
                stroke: '#808060', strokeWidth: 1.2, lineCap: 'round',
            }));
        }
        // 引脚线
        ['L','R'].forEach(s => {
            this.group.add(new Konva.Line({
                points: s === 'L'
                    ? [cx - fw / 2 - 4, cy, cx - fw / 2, cy]
                    : [cx + fw / 2, cy, cx + fw / 2 + 4, cy],
                stroke: '#484830', strokeWidth: 1.5,
            }));
        });
        // 编号
        this.group.add(new Konva.Text({
            x: cx - fw / 2, y: cy + fh / 2 + 1, width: fw,
            text: numLabel, fontSize: 6.5,
            fill: '#303020', align: 'center', fontFamily: 'Arial',
        }));
        return shell;
    }

    /** 在插板中央添加参数文本标注（返回 Konva.Text 以便动态更新）*/
    _addParamText(bd, xFrac, initText, align, dynamic) {
        const t = new Konva.Text({
            x: bd.x + bd.w * xFrac, y: bd.y + bd.h * 0.22,
            width: bd.w * 0.22, text: initText,
            fontSize: 7, fill: '#404030',
            fontFamily: 'Arial, sans-serif', align: align || 'left',
        });
        if (dynamic) this.group.add(t);
        return t;
    }

    // ═══════════════════════════════════════════
    // 动画主循环
    // ═══════════════════════════════════════════
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._simulate(dt);
        this._refreshDisplay();
    }
    // ── 控制仿真 ─────────────────────────────
    _simulate(dt) {
        if (!this._powered) {
            this._motorFwd = false;
            this._motorRev = false;
            return;
        }

        const error = this._sp - this._pv;

        if (this._autoMode) {
            // ── PD 控制 ──
            const derivative  = (error - this._prevError) / dt;
            this._prevError   = error;
            const Kp          = 100 / Math.max(1, this._PB); // 比例增益
            const rawOutput   = Kp * (error + this._Td * derivative);
            this._ctrlOutput  = Math.max(-100, Math.min(100, rawOutput));

            // 死区处理
            if (Math.abs(error) < this._DB) {
                this._motorFwd = false;
                this._motorRev = false;
            } else {
                // PWM：把 ctrlOutput 映射为脉冲
                this._pwmPhase += dt;
                if (this._pwmPhase > this._PW) this._pwmPhase = 0;
                const onRatio = Math.abs(this._ctrlOutput) / 100;
                this._pwmOn   = this._pwmPhase < this._PW * onRatio;

                if (this._pwmOn) {
                    this._motorFwd = this._ctrlOutput > 0; // 正转：开大阀（降温）
                    this._motorRev = this._ctrlOutput < 0; // 反转：关小阀（升温）
                } else {
                    this._motorFwd = false;
                    this._motorRev = false;
                }
            }

            // 故障检测：误差大且电机不转
            this._motorFault = Math.abs(error) > 10 && !this._motorFwd && !this._motorRev && Math.abs(error) > this._DB;

        } else {
            // ── 手动模式 ──
            this._prevError  = error;
            this._ctrlOutput = this._manSwitch9 * 80;
            this._motorFwd   = this._manSwitch9 > 0;
            this._motorRev   = this._manSwitch9 < 0;
            this._motorFault = false;
        }

        // 阀位积分（电机正转开大阀，反转关小阀）
        const valveDelta = (this._motorFwd ? 1 : this._motorRev ? -1 : 0) * dt * 2.5;
        this._valvePos   = Math.max(0, Math.min(100, this._valvePos + valveDelta));

        // 过程温度（一阶惯性，阀开→降温）
        const loadTemp   = 50 - (this._valvePos - 50) * 0.28;
        const noise      = (Math.random() - 0.5) * this._noiseAmp * 2;
        this._pvTarget   = loadTemp + noise;
        this._pv        += ((this._pvTarget - this._pv) / this._tau) * dt;
        this._pv         = Math.max(0, Math.min(100, this._pv));
    }

    // ── 刷新全部显示 ─────────────────────────
    _refreshDisplay() {
        // 温度表指针
        const displayVal = this._spIndMode ? this._sp : this._pv;
        if (this._needle) {
            const ang = this._pvSpAngle(this._powered ? displayVal : 0);
            const pts = this._needlePoints(ang, this._needleCX, this._needleCY, this._needleR);
            this._needle.points(pts);
            this._needleShadow.points(this._needlePoints(ang, this._needleCX + 1, this._needleCY + 1, this._needleR));
        }

        // SP 值标注更新
        if (this._spLabel) this._spLabel.text(`SP: ${this._sp.toFixed(1)}°C`);

        // 按钮2（按下=红，弹出=原色）
        if (this._btn2) {
            this._btn2.fill(this._spIndMode ? '#c04020' : '#d8d0c0');
        }

        // 指示灯7/8（正转/反转）
        this._setLED(this._led7, this._motorFwd  && this._powered);
        this._setLED(this._led8, this._motorRev  && this._powered);

        // 电源指示灯14
        this._powerLed = this._powered && this._fuse10ok && this._fuse11ok;
        this._setLED(this._led14, this._powerLed);

        this._refreshCache();
    }

    // ── 事件处理 ─────────────────────────────
    _onPowerToggle() {
        this._powered = !this._powered;
        if (this._sw13) this._updateSwitch2(this._sw13, this._powered);
        if (!this._powered) {
            this._motorFwd = false;
            this._motorRev = false;
            this._integral  = 0;
            this._prevError = 0;
        }
        this._refreshCache();
    }

    _onModeToggle() {
        if (!this._powered) return;
        this._autoMode = !this._autoMode;
        if (this._sw12) this._updateSwitch2(this._sw12, this._autoMode);
        // 无扰动切换：保持积分项连续
        this._prevError = 0;
        this._refreshCache();
    }

    _adjustSP(delta) {
        this._sp = Math.max(0, Math.min(100, this._sp + delta));
    }

    // ── 颜色辅助 ─────────────────────────────
    _lighten(hex, f) {
        const [r, g, b] = [1,3,5].map(i => parseInt(hex.slice(i, i+2), 16));
        return `#${[r,g,b].map(v => Math.min(255, Math.round(v + (255-v)*f)).toString(16).padStart(2,'0')).join('')}`;
    }
    _darken(hex, f) {
        const [r, g, b] = [1,3,5].map(i => parseInt(hex.slice(i, i+2), 16));
        return `#${[r,g,b].map(v => Math.max(0, Math.round(v*(1-f))).toString(16).padStart(2,'0')).join('')}`;
    }

    // ═══════════════════════════════════════════
    // 端口
    // ═══════════════════════════════════════════
    _addPorts() {
        const W = this.width, H = this.height;
        this.addPort(W * 0.25, H, 'port_pv_in',    'wire', 'PV IN');
        this.addPort(W * 0.50, H, 'port_motor_fw',  'wire', 'FWD');
        this.addPort(W * 0.65, H, 'port_motor_rv',  'wire', 'REV');
        this.addPort(W * 0.85, H, 'port_alarm',     'wire', 'ALM');
    }

    // ═══════════════════════════════════════════
    // 公共 API
    // ═══════════════════════════════════════════
    getPV()         { return this._pv;           }
    getSP()         { return this._sp;           }
    isAutoMode()    { return this._autoMode;     }
    isPowered()     { return this._powered;      }
    isMotorFault()  { return this._motorFault;   }
    getValvePos()   { return this._valvePos;     }

    setPV(v)        { this._pv = Math.max(0, Math.min(100, v)); }
    setSP(v)        { this._sp = Math.max(0, Math.min(100, v)); }
    setFuse(idx, ok){ idx === 10 ? this._fuse10ok = ok : this._fuse11ok = ok; }

    update(state) {
        if (!state) return;
        if (state.pv  !== undefined) this.setPV(state.pv);
        if (state.sp  !== undefined) this.setSP(state.sp);
        if (state.power !== undefined && state.power !== this._powered) this._onPowerToggle();
        if (state.auto  !== undefined && state.auto  !== this._autoMode) this._onModeToggle();
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号',              key: 'label',  type: 'text'   },
            { label: '初始 SP (°C)',      key: 'initSP', type: 'number' },
            { label: '初始 PV (°C)',      key: 'initPV', type: 'number' },
            { label: '比例带 PB (%)',     key: 'PB',     type: 'number' },
            { label: '微分时间 Td (s)',   key: 'Td',     type: 'number' },
            { label: '不灵敏区 DB (°C)', key: 'DB',     type: 'number' },
            { label: '脉冲宽度 PW (s)',   key: 'PW',     type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label  ) this.label = cfg.label;
        if (cfg.initSP !== undefined) this.setSP(parseFloat(cfg.initSP));
        if (cfg.initPV !== undefined) this.setPV(parseFloat(cfg.initPV));
        if (cfg.PB     !== undefined) this._PB = parseFloat(cfg.PB) || this._PB;
        if (cfg.Td     !== undefined) this._Td = parseFloat(cfg.Td) || this._Td;
        if (cfg.DB     !== undefined) this._DB = parseFloat(cfg.DB) || this._DB;
        if (cfg.PW     !== undefined) this._PW = parseFloat(cfg.PW) || this._PW;
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}