import { BaseComponent } from './BaseComponent.js';

/**
 * 气动活塞式执行机构（带定位器）仿真组件
 * Pneumatic Piston Actuator with Positioner
 *
 * ── 结构说明 ──────────────────────────────────────────────────
 *
 *  本组件为气缸（活塞式）执行机构，带智能定位器，正视图剖面仿真。
 *
 *  主要部件：
 *
 *  1. 气缸体（Cylinder Body）：双作用气缸，上下两腔分别进/排气
 *     - 上腔（Chamber A）：接正作用气源（增大→向下推）
 *     - 下腔（Chamber B）：接反作用气源 / 弹簧腔
 *
 *  2. 活塞（Piston）：在气缸内往复运动，驱动活塞杆
 *     - 行程范围：0%（全收）~ 100%（全出）
 *     - 活塞密封圈（O-ring）可见
 *
 *  3. 活塞杆（Piston Rod）：连接活塞与外部负载（如阀门）
 *     - 穿过下端盖的填料密封
 *
 *  4. 弹簧（Return Spring，弹簧复位型）：
 *     - 安装于下腔，活塞杆缩回时弹簧压缩
 *     - 故障安全：气源失压时弹簧复位（默认关闭/打开可配置）
 *     - 可配置为双作用（无弹簧）
 *
 *  5. 定位器（Positioner）：
 *     - 接收 4-20mA 或 0-10V 控制信号
 *     - 精确控制气缸进排气量，使活塞杆位置跟踪给定值
 *     - 内部 PID 控制回路（Kp/Ki/Kd 可配置）
 *     - 显示：给定值 SP、实际位置 PV、偏差 ERR、输出 OUT
 *     - 位置反馈：通过连杆机构检测活塞杆实际位置
 *
 *  6. 气源处理单元（Air Supply Unit, FRL）：
 *     - 过滤器（Filter）、减压阀（Regulator）、油雾器（Lubricator）
 *     - 供气压力范围：0.14 ~ 0.70 MPa（可配置）
 *
 *  7. 手动操作机构（Handwheel）：
 *     - 紧急断气时可手动操作活塞杆位置
 *     - 仿真中：点击手轮拖动
 *
 *  8. 位置传感器（LVDT / 电位器）：
 *     - 输出 4-20mA 位置反馈信号
 *
 *  9. 端盖密封（End Caps）：上下端盖含气口、导向套、密封件
 *
 * ── 工作原理 ──────────────────────────────────────────────────
 *
 *  弹簧复位（单作用）模式：
 *    供气 → 上腔进气增压 → 活塞向下移动（杆伸出）
 *    排气 → 上腔泄压 → 弹簧推活塞向上（杆缩回）
 *    故障安全位置 = 杆缩回（Fail-Retract / Fail-Close）
 *
 *  双作用模式：
 *    上腔进气 / 下腔排气 → 杆伸出
 *    下腔进气 / 上腔排气 → 杆缩回
 *
 *  定位器控制回路：
 *    SP（给定位置） → PID控制器 → 控制信号 → 电气/气转换器(I/P)
 *    → 先导阀（Pilot Valve）→ 主气缸进排气
 *    → 活塞移动 → 位置反馈 → 与SP比较 → 闭环
 *
 * ── 压力模型 ──────────────────────────────────────────────────
 *
 *  供气压力 Ps : 0.14 ~ 0.70 MPa（可配置，默认 0.40 MPa）
 *  腔室压力 Pa（上腔）: 0 ~ Ps，随给定值增大而增大
 *  腔室压力 Pb（下腔）: 弹簧力折算当量压力 + 反作用气压
 *
 *  理想平衡：Pa × A = Pb × A + Fspring + Fload（负载力）
 *
 * ── 定位器 PID 模型 ──────────────────────────────────────────
 *
 *  e(t) = SP - PV（位置偏差，%）
 *  OUT(t) = Kp*e + Ki*∫e dt + Kd*de/dt
 *  OUT 限幅 → [0, 100]%
 *  OUT → 换算为腔室压力变化率 → 活塞速度
 *
 * ── 状态机 ────────────────────────────────────────────────────
 *
 *  AUTO   : 定位器自动模式，PID 跟踪 SP
 *  MANUAL : 手动模式，直接设定活塞位置（跳过PID）
 *  FAILSAFE: 气源失压，弹簧复位
 *
 * ── 重点对外接口 ──────────────────────────────────────────────
 *
 *  setpoint     [%]    — 位置给定值（0-100%），对应 4-20mA
 *  position     [%]    — 活塞杆当前位置（0-100%）
 *  supplyPressure[MPa] — 供气压力
 *  chamberA_P   [MPa]  — 上腔压力
 *  chamberB_P   [MPa]  — 下腔压力（弹簧腔）
 *  signal_mA    [mA]   — 输入控制信号（4-20mA）
 *  feedback_mA  [mA]   — 位置反馈信号（4-20mA）
 *  pidOut       [%]    — 定位器PID输出
 *  mode         [str]  — AUTO / MANUAL / FAILSAFE
 *
 * ── 端口 ─────────────────────────────────────────────────────
 *  port_supply     — 气源进口（Ps）
 *  port_exhaust    — 排气口
 *  port_chamber_a  — 上腔气口（A口）
 *  port_chamber_b  — 下腔气口（B口）
 *  port_signal_pos — 控制信号正极（4-20mA +）
 *  port_signal_neg — 控制信号负极（4-20mA -）
 *  port_feedback_pos— 位置反馈正极
 *  port_feedback_neg— 位置反馈负极
 *  port_rod_tip    — 活塞杆末端连接点（机械接口）
 */
export class PneumaticPistonActuator extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(280, config.width  || 360);
        this.height = Math.max(380, config.height || 480);

        this.type    = 'pneumatic_piston_actuator';
        this.special = 'none';
        this.cache   = 'fixed';

        // ── 铭牌参数 ──
        this.label           = config.label           || 'PA-01';
        this.stroke          = config.stroke          || 100;     // mm 最大行程
        this.thrust          = config.thrust          || 10000;   // N 额定推力
        this.supplyPressure  = config.supplyPressure  || 0.40;    // MPa 供气压力
        this.springForce     = config.springForce     || 0.15;    // MPa 弹簧当量压力
        this.doubleActing    = config.doubleActing    !== true ? false : true; // 默认单作用
        this.failRetract     = config.failRetract     !== false;  // 默认气失弹簧缩回（FC）
        this.positionerType  = config.positionerType  || 'SIEMENS'; // 定位器品牌标注

        // ── 运行状态 ──
        this._mode       = 'AUTO';        // AUTO | MANUAL | FAILSAFE
        this._position   = config.initPosition !== undefined
            ? parseFloat(config.initPosition) : 0.0;  // % 0-100
        this._setpoint   = config.initSetpoint !== undefined
            ? parseFloat(config.initSetpoint) : 0.0;  // %
        this._supplyOk   = true;          // 气源正常标志

        // ── 腔室压力 ──
        this._chamberA   = 0.0;           // MPa 上腔
        this._chamberB   = this.springForce; // MPa 下腔（弹簧当量）

        // ── 定位器 PID ──
        this._Kp         = config.Kp  !== undefined ? config.Kp  : 2.5;
        this._Ki         = config.Ki  !== undefined ? config.Ki  : 0.8;
        this._Kd         = config.Kd  !== undefined ? config.Kd  : 0.05;
        this._pidIntegral  = 0;
        this._pidLastError = 0;
        this._pidOut       = 0;           // % 0-100

        // ── 信号 ──
        this._signalMA   = 4.0;           // mA 控制信号（4=0%, 20=100%）
        this._feedbackMA = 4.0;           // mA 位置反馈

        // ── 动画 ──
        this._flowPhase    = 0;
        this._springPhase  = 0;
        this.opsCount      = config.initOps || 0;

        // ── 几何尺寸 ──
        const W = this.width, H = this.height;

        // 定位器（左侧盒子）
        this._posBox = {
            x: W*0.04, y: H*0.05,
            w: W*0.26, h: H*0.38,
        };

        // 气缸体（右侧，核心）
        this._cyl = {
            x: W*0.38, y: H*0.08,
            w: W*0.24, h: H*0.68,
        };

        // 活塞（初始位置）
        this._pistonH = this._cyl.h * 0.10;  // 活塞高度
        this._pistonY = this._pistonYFromPos(this._position);

        // 活塞杆
        this._rodW    = this._cyl.w * 0.22;
        this._rodTipY = this._cyl.y + this._cyl.h;

        // FRL 单元（气源处理，顶部）
        this._frl = {
            x: W*0.38, y: H*0.02,
            w: W*0.24, h: H*0.05,
        };

        // 手轮（右侧）
        this._hwCX = this._cyl.x + this._cyl.w + W*0.08;
        this._hwCY = this._cyl.y + this._cyl.h * 0.75;


        this._init();

        // ── 注册端口 ──
        const cx  = this._cyl.x;
        const cy  = this._cyl.y;
        const cw  = this._cyl.w;
        const ch  = this._cyl.h;
        const pb  = this._posBox;
        this.addPort(cx + cw/2,  cy - 6,             'port_supply',       'pipe', 'Ps');
        this.addPort(cx + cw,    cy + ch*0.15,        'port_chamber_a',    'pipe', 'A');
        this.addPort(cx + cw,    cy + ch*0.85,        'port_chamber_b',    'pipe', 'B');
        this.addPort(cx + cw/2,  cy + ch + 30,        'port_rod_tip',      'mech', '杆');
        this.addPort(cx - 6,     cy + ch*0.55,        'port_exhaust',      'pipe', 'Exh');
        this.addPort(pb.x + pb.w, pb.y + pb.h*0.45,  'port_signal_pos',   'wire', 'I+');
        this.addPort(pb.x + pb.w, pb.y + pb.h*0.52,  'port_signal_neg',   'wire', 'I-');
        this.addPort(pb.x + pb.w, pb.y + pb.h*0.62,  'port_feedback_pos', 'wire', 'FB+');
        this.addPort(pb.x + pb.w, pb.y + pb.h*0.69,  'port_feedback_neg', 'wire', 'FB-');
    }

    // ── 活塞位置 → Y 坐标（0%=顶，100%=底）──
    _pistonYFromPos(pos) {
        const topLimit = this._cyl.y + this._cyl.h*0.06;
        const botLimit = this._cyl.y + this._cyl.h*0.88 - this._pistonH;
        return topLimit + (botLimit - topLimit) * (pos / 100);
    }

    // ═══════════════════════════════════════════
    _init() {
        this._drawBackground();
        this._drawFRL();
        this._drawCylinderBody();
        this._drawPositionerBox();
        this._drawHandwheel();
        this._drawTubing();
        this._drawLabel();

        this._dynGas    = new Konva.Group(); // 腔室气体 & 流动
        this._dynPiston = new Konva.Group(); // 活塞 & 活塞杆
        this._dynPID    = new Konva.Group(); // 定位器显示
        this._dynSpring = new Konva.Group(); // 弹簧
        this.group.add(this._dynGas, this._dynSpring, this._dynPiston, this._dynPID);

        this._rebuildGas();
        this._rebuildSpring();
        this._rebuildPiston();
        this._rebuildPID();
        this._drawStatusPanel();
        
    }

    // ── 背景 & 标尺 ──────────────────────────
    _drawBackground() {
        // 行程标尺（气缸右侧）
        const cx = this._cyl.x, cy = this._cyl.y;
        const cw = this._cyl.w, ch = this._cyl.h;
        const rx = cx + cw + 6;
        // 标尺线
        this.group.add(new Konva.Line({
            points: [rx, cy + ch*0.06, rx, cy + ch*0.88],
            stroke: '#8090a0', strokeWidth: 1, dash: [2,2],
        }));
        for (let i = 0; i <= 10; i++) {
            const ry = cy + ch*0.06 + (ch*0.82) * i / 10;
            this.group.add(new Konva.Line({
                points: [rx - 3, ry, rx + 3, ry],
                stroke: '#8090a0', strokeWidth: 1,
            }));
            this.group.add(new Konva.Text({
                x: rx + 5, y: ry - 4,
                text: `${i*10}%`, fontSize: 7, fill: '#607080',
            }));
        }
    }

    // ── FRL 气源处理单元 ──────────────────────
    _drawFRL() {
        const f = this._frl;
        this.group.add(new Konva.Rect({
            x: f.x, y: f.y, width: f.w, height: f.h,
            fill: '#d8e4ec', stroke: '#8090a0', strokeWidth: 1.2,
            cornerRadius: 3,
        }));
        // FRL 图标：三小格
        const gw = f.w / 3;
        ['F','R','L'].forEach((lbl, i) => {
            this.group.add(new Konva.Rect({
                x: f.x + gw*i + 1, y: f.y + 1,
                width: gw - 2, height: f.h - 2,
                fill: i===0?'#e0eaf4':i===1?'#eaf0e8':'#f0e8dc',
                stroke: '#b0c0cc', strokeWidth: 0.6,
            }));
            this.group.add(new Konva.Text({
                x: f.x + gw*i + gw/2 - 3.5, y: f.y + f.h/2 - 4,
                text: lbl, fontSize: 9, fontStyle: 'bold', fill: '#3a5060',
            }));
        });
        this.group.add(new Konva.Text({
            x: f.x + f.w + 4, y: f.y + f.h*0.2,
            text: 'FRL', fontSize: 7, fill: '#607080',
        }));
    }

    // ── 气缸体（剖面视图）───────────────────
    _drawCylinderBody() {
        const b = this._cyl;
        const W = this.width;

        // 外壳阴影
        this.group.add(new Konva.Rect({
            x: b.x+3, y: b.y+3, width: b.w, height: b.h,
            fill: 'rgba(0,0,0,0.14)', cornerRadius: 5,
        }));

        // 气缸外壳（剖面壳体，金属色）
        this.group.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:b.w, y:0 },
            fillLinearGradientColorStops: [0,'#5a6878',0.18,'#8090a0',0.82,'#8090a0',1,'#4a5868'],
            stroke: '#3a4858', strokeWidth: 2,
            cornerRadius: 5,
        }));

        // 内腔（气缸孔）
        const wallW = b.w * 0.14;
        this.group.add(new Konva.Rect({
            x: b.x + wallW, y: b.y + b.h*0.04,
            width: b.w - wallW*2, height: b.h*0.92,
            fill: '#c8d8e4',
            stroke: '#8090a0', strokeWidth: 0.8,
        }));

        // 剖面斜线（壳壁）
        [
            { x: b.x,          w: wallW,      y: b.y, h: b.h },
            { x: b.x+b.w-wallW,w: wallW,      y: b.y, h: b.h },
        ].forEach(r => {
            this.group.add(new Konva.Rect({ x:r.x, y:r.y, width:r.w, height:r.h, fill:'#4a5868', opacity:0.85 }));
            for (let i=-20; i<r.h+20; i+=5) {
                this.group.add(new Konva.Line({
                    points:[r.x+i,r.y, r.x+i+r.h,r.y+r.h],
                    stroke:'rgba(255,255,255,0.10)', strokeWidth:0.7, listening:false,
                }));
            }
        });

        // 上端盖（含气口）
        this.group.add(new Konva.Rect({
            x: b.x - 3, y: b.y - 2, width: b.w+6, height: b.h*0.06,
            fill: '#4a5868', stroke: '#2a3848', strokeWidth: 1.5, cornerRadius: [5,5,0,0],
        }));
        // 上腔气口
        this.group.add(new Konva.Rect({
            x: b.x + b.w*0.60, y: b.y - 8,
            width: 8, height: 10,
            fill: '#8090a8', stroke: '#5a6878', strokeWidth: 0.8,
        }));
        this.group.add(new Konva.Text({ x: b.x + b.w*0.60 - 8, y: b.y - 17, text: 'A口', fontSize: 7, fill: '#4a6070' }));

        // 下端盖（含填料密封、活塞杆孔）
        this.group.add(new Konva.Rect({
            x: b.x - 3, y: b.y + b.h*0.94, width: b.w+6, height: b.h*0.06,
            fill: '#4a5868', stroke: '#2a3848', strokeWidth: 1.5, cornerRadius: [0,0,5,5],
        }));
        // 下腔气口（双作用时有）
        if (this.doubleActing) {
            this.group.add(new Konva.Rect({
                x: b.x - 3, y: b.y + b.h*0.80,
                width: 8, height: 10,
                fill: '#8090a8', stroke: '#5a6878', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({ x: b.x - 18, y: b.y + b.h*0.80 - 2, text: 'B口', fontSize: 7, fill: '#4a6070' }));
        }

        // 活塞杆导套（下端盖中央）
        const rodCX = b.x + b.w/2;
        this.group.add(new Konva.Rect({
            x: rodCX - this._rodW*0.55, y: b.y + b.h*0.92,
            width: this._rodW*1.1, height: b.h*0.08,
            fill: '#6a7888', stroke: '#4a5868', strokeWidth: 1,
        }));
    }

    // ── 定位器盒（左侧）─────────────────────
    _drawPositionerBox() {
        const p = this._posBox;

        // 外壳阴影
        this.group.add(new Konva.Rect({
            x: p.x+2, y: p.y+2, width: p.w, height: p.h,
            fill: 'rgba(0,0,0,0.12)', cornerRadius: 4,
        }));
        // 外壳
        this.group.add(new Konva.Rect({
            x: p.x, y: p.y, width: p.w, height: p.h,
            fillLinearGradientStartPoint: {x:0, y:0},
            fillLinearGradientEndPoint:   {x:p.w, y:p.h},
            fillLinearGradientColorStops: [0,'#2a3848',0.5,'#3a4a5a',1,'#2a3848'],
            stroke: '#1a2838', strokeWidth: 1.5,
            cornerRadius: 4,
        }));
        // 面板
        this.group.add(new Konva.Rect({
            x: p.x+4, y: p.y+4, width: p.w-8, height: p.h-8,
            fill: '#1a2030', stroke: '#304050', strokeWidth: 1,
            cornerRadius: 2,
        }));
        // 品牌铭牌
        this.group.add(new Konva.Text({
            x: p.x + p.w*0.10, y: p.y + p.h*0.04,
            text: `${this.positionerType}`, fontSize: 8, fontStyle: 'bold',
            fill: '#80a0c0',
        }));
        this.group.add(new Konva.Text({
            x: p.x + p.w*0.10, y: p.y + p.h*0.10,
            text: 'POSITIONER', fontSize: 7,
            fill: '#607080',
        }));

        // 电显屏（静态底层）
        this.group.add(new Konva.Rect({
            x: p.x + p.w*0.08, y: p.y + p.h*0.17,
            width: p.w*0.84, height: p.h*0.22,
            fill: '#0a1420', stroke: '#203040', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 接线端子标注（静态）
        const terms = [
            { label: '4-20mA IN+', dy: 0.45 },
            { label: '4-20mA IN-', dy: 0.52 },
            { label: 'FB OUT+',   dy: 0.62 },
            { label: 'FB OUT-',   dy: 0.69 },
        ];
        terms.forEach(({ label, dy }) => {
            this.group.add(new Konva.Circle({
                x: p.x + p.w - 7, y: p.y + p.h*dy,
                radius: 3, fill: '#607080', stroke: '#405060', strokeWidth: 0.8,
            }));
            this.group.add(new Konva.Text({
                x: p.x + p.w*0.08, y: p.y + p.h*dy - 4,
                text: label, fontSize: 6.5, fill: '#607080',
            }));
        });

        // 调节旋钮（Kp/Ki/Kd）
        const knobs = ['KP','KI','KD'];
        knobs.forEach((k, i) => {
            const kx = p.x + p.w*(0.15 + i*0.30);
            const ky = p.y + p.h*0.80;
            this.group.add(new Konva.Circle({
                x: kx, y: ky, radius: p.w*0.07,
                fillRadialGradientStartPoint: {x:-2,y:-2},
                fillRadialGradientEndPoint:   {x:0,y:0},
                fillRadialGradientStartRadius: 0,
                fillRadialGradientEndRadius:   p.w*0.07,
                fillRadialGradientColorStops:  [0,'#708090',1,'#3a4858'],
                stroke: '#2a3848', strokeWidth: 1,
            }));
            this.group.add(new Konva.Line({
                points: [kx, ky - p.w*0.04, kx, ky - p.w*0.08],
                stroke: '#d0d8e0', strokeWidth: 1.5, lineCap: 'round',
            }));
            this.group.add(new Konva.Text({
                x: kx - 5, y: ky + p.w*0.08 + 1,
                text: k, fontSize: 6.5, fontStyle: 'bold', fill: '#8090a0',
            }));
        });

        // 模式按钮（AUTO/MAN）
        const btnX = p.x + p.w*0.08;
        const btnY = p.y + p.h*0.88;
        const btnW = p.w*0.36, btnH = p.h*0.07;
        this._btnAuto = new Konva.Rect({
            x: btnX, y: btnY, width: btnW, height: btnH,
            fill: '#204060', cornerRadius: 2, listening: true,
        });
        this._btnAutoText = new Konva.Text({
            x: btnX+2, y: btnY+2,
            text: 'AUTO', fontSize: 7, fontStyle: 'bold', fill: '#60b0e0', listening: false,
        });
        this._btnMan = new Konva.Rect({
            x: btnX + btnW + 4, y: btnY, width: btnW, height: btnH,
            fill: '#402010', cornerRadius: 2, listening: true,
        });
        this._btnManText = new Konva.Text({
            x: btnX + btnW + 6, y: btnY + 2,
            text: 'MAN', fontSize: 7, fontStyle: 'bold', fill: '#d08040', listening: false,
        });
        this.group.add(this._btnAuto, this._btnAutoText, this._btnMan, this._btnManText);
        this._btnAuto.on('click tap', () => this.setMode('AUTO'));
        this._btnMan.on('click tap',  () => this.setMode('MANUAL'));
    }

    // ── 手轮 ─────────────────────────────────
    _drawHandwheel() {
        const cx = this._hwCX, cy = this._hwCY;
        const r  = this.width * 0.055;
        // 手轮圈
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            fill: 'transparent', stroke: '#6a7a8a', strokeWidth: 3,
        }));
        // 辐条
        for (let i = 0; i < 4; i++) {
            const ang = (i * 90) * Math.PI / 180;
            this.group.add(new Konva.Line({
                points: [cx, cy, cx + r*0.85*Math.cos(ang), cy + r*0.85*Math.sin(ang)],
                stroke: '#6a7a8a', strokeWidth: 2,
            }));
        }
        // 轮毂
        this.group.add(new Konva.Circle({
            x: cx, y: cy, radius: r*0.18,
            fill: '#8090a0', stroke: '#5a6870', strokeWidth: 1,
        }));
        // 标注
        this.group.add(new Konva.Text({
            x: cx - 14, y: cy + r + 4,
            text: '手轮', fontSize: 7.5, fill: '#607080',
        }));
        // 连杆（手轮→活塞杆）
        this.group.add(new Konva.Line({
            points: [cx - r, cy, this._cyl.x + this._cyl.w, cy],
            stroke: '#7a8898', strokeWidth: 1.5, dash: [4,3],
        }));
        // 手轮点击增减位置
        this._hwGroup = new Konva.Group();
        this._hwBtnUp = new Konva.Arc({
            x: cx, y: cy - r - 8, innerRadius: 0, outerRadius: r*0.4,
            angle: 180, rotation: 0,
            fill: '#4a7090', listening: true,
        });
        this._hwBtnDn = new Konva.Arc({
            x: cx, y: cy + r + 8, innerRadius: 0, outerRadius: r*0.4,
            angle: 180, rotation: 180,
            fill: '#4a7090', listening: true,
        });
        this.group.add(this._hwBtnUp, this._hwBtnDn);
        this._hwBtnUp.on('click tap', () => { if (this._mode === 'MANUAL') this._setPositionDirect(Math.min(100, this._position + 5)); });
        this._hwBtnDn.on('click tap', () => { if (this._mode === 'MANUAL') this._setPositionDirect(Math.max(0, this._position - 5)); });
        this.group.add(new Konva.Text({ x: cx - r*0.3, y: cy - r - 14, text: '▲', fontSize: 8, fill: '#80a0c0', listening: true }).on('click tap', () => { if (this._mode==='MANUAL') this._setPositionDirect(Math.min(100, this._position+5)); }));
        this.group.add(new Konva.Text({ x: cx - r*0.3, y: cy + r + 6, text: '▼', fontSize: 8, fill: '#80a0c0', listening: true }).on('click tap', () => { if (this._mode==='MANUAL') this._setPositionDirect(Math.max(0, this._position-5)); }));
    }

    // ── 管路连接（气缸↔定位器↔FRL） ────────
    _drawTubing() {
        const b  = this._cyl;
        const p  = this._posBox;
        const f  = this._frl;
        const W  = this.width;

        const lineStyle = { stroke: '#8090a8', strokeWidth: 2, lineCap: 'round', lineJoin: 'round' };

        // FRL → 上腔（气源→定位器→A口）
        this.group.add(new Konva.Line({
            points: [
                f.x + f.w/2,      f.y + f.h,
                f.x + f.w/2,      b.y - 2,
                b.x + b.w*0.65,   b.y - 2,
            ],
            ...lineStyle,
        }));

        // 定位器 → 先导气路（虚线：信号气）
        this.group.add(new Konva.Line({
            points: [
                p.x + p.w,     p.y + p.h*0.30,
                b.x - 6,       p.y + p.h*0.30,
                b.x - 6,       b.y + b.h*0.25,
                b.x,           b.y + b.h*0.25,
            ],
            stroke: '#60a0c0', strokeWidth: 1.5, dash: [5,3],
        }));

        // 位置反馈连杆（实线虚标）
        this.group.add(new Konva.Line({
            points: [
                p.x + p.w,     p.y + p.h*0.60,
                b.x - 14,      p.y + p.h*0.60,
                b.x - 14,      b.y + b.h*0.55,
            ],
            stroke: '#a0c060', strokeWidth: 1.5, dash: [3,3],
        }));
    }

    // ── 标注 ─────────────────────────────────
    _drawLabel() {
        const b = this._cyl;
        this.group.add(new Konva.Text({
            x: 0, y: -22, width: this.width,
            text: `${this.label}  气动活塞式执行机构（带定位器）  行程:${this.stroke}mm  推力:${(this.thrust/1000).toFixed(1)}kN  ${this.doubleActing?'双作用':'弹簧复位'}`,
            fontSize: 9, fontStyle: 'bold', fill: '#3a5060', align: 'center',
        }));

        // 部件标注
        [
            { x: b.x - 38,  y: b.y + b.h*0.15, text: '上腔A' },
            { x: b.x - 38,  y: b.y + b.h*0.75, text: this.doubleActing ? '下腔B' : '弹簧腔' },
            { x: b.x + b.w + 14, y: b.y + b.h*0.05, text: '行程' },
        ].forEach(({ x, y, text }) => {
            this.group.add(new Konva.Text({ x, y, text, fontSize: 7.5, fill: '#4a6070' }));
        });
    }

    // ─────────────────────────────────────────
    // ── 动态：腔室气体填充 & 流动 ─────────────
    _rebuildGas() {
        this._dynGas.destroyChildren();
        const b      = this._cyl;
        const wallW  = b.w * 0.14;
        const innerX = b.x + wallW;
        const innerW = b.w - wallW * 2;
        const py     = this._pistonY;
        const pisH   = this._pistonH;

        // 上腔气体（活塞上方）
        const upperH = Math.max(0, py - (b.y + b.h*0.04));
        if (upperH > 0) {
            const pA = this._chamberA;
            const aAlpha = 0.2 + (pA / this.supplyPressure) * 0.5;
            this._dynGas.add(new Konva.Rect({
                x: innerX, y: b.y + b.h*0.04,
                width: innerW, height: upperH,
                fill: `rgba(80,160,255,${aAlpha})`,
            }));
            // 压力标注
            this._dynGas.add(new Konva.Text({
                x: innerX + 2, y: b.y + b.h*0.04 + 4,
                text: `Pa\n${pA.toFixed(3)}\nMPa`,
                fontSize: 7, fill: '#204080', lineHeight: 1.3,
            }));
        }

        // 下腔气体/弹簧腔（活塞下方，到杆密封处）
        const lowerTop = py + pisH;
        const lowerBot = b.y + b.h * 0.92;
        const lowerH   = Math.max(0, lowerBot - lowerTop);
        if (lowerH > 0) {
            const pB = this._chamberB;
            const bAlpha = this.doubleActing
                ? 0.15 + (pB / this.supplyPressure) * 0.45
                : 0.12;
            this._dynGas.add(new Konva.Rect({
                x: innerX, y: lowerTop,
                width: innerW, height: lowerH,
                fill: `rgba(80,200,120,${bAlpha})`,
            }));
            this._dynGas.add(new Konva.Text({
                x: innerX + 2, y: lowerTop + 4,
                text: this.doubleActing
                    ? `Pb\n${pB.toFixed(3)}\nMPa`
                    : `Fsp\n${this._chamberB.toFixed(3)}\nMPa`,
                fontSize: 7, fill: '#1a5030', lineHeight: 1.3,
            }));
        }

        // 气流动画（上腔进气时）
        if (this._motorRunning || this._pidOut > 50) {
            const flowDir = this._pidOut >= 50 ? 1 : -1; // 1=进气，-1=排气
            for (let j = 0; j < 3; j++) {
                const progress = ((this._flowPhase + j/3) % 1);
                const fy = b.y + b.h*0.04 + progress * upperH * flowDir + (flowDir < 0 ? upperH : 0);
                if (fy < b.y + b.h*0.04 || fy > lowerBot) continue;
                this._dynGas.add(new Konva.Circle({
                    x: innerX + innerW * (0.25 + j*0.25), y: fy,
                    radius: 3,
                    fill: `rgba(100,180,255,${0.7 - progress*0.4})`,
                }));
            }
        }
    }

    // ── 动态：弹簧（下腔） ───────────────────
    _rebuildSpring() {
        this._dynSpring.destroyChildren();
        if (this.doubleActing) return;

        const b      = this._cyl;
        const wallW  = b.w * 0.14;
        const innerX = b.x + wallW;
        const innerW = b.w - wallW * 2;
        const py     = this._pistonY + this._pistonH;
        const botY   = b.y + b.h * 0.88;
        const springH = Math.max(4, botY - py);
        const coils   = 8;
        const coilH   = springH / coils;
        const cx      = innerX + innerW / 2;
        const ax      = innerW * 0.28;

        // 弹簧压缩量指示色（越压缩越红）
        const compression = 1 - (this._position / 100);
        const sr = Math.round(80 + compression * 160);
        const sg = Math.round(180 - compression * 120);
        const sc = `rgb(${sr},${sg},60)`;

        // 弹簧线圈（锯齿线）
        const pts = [cx, py];
        for (let i = 0; i < coils; i++) {
            const y0 = py + coilH * i;
            const y1 = py + coilH * (i + 0.5);
            const y2 = py + coilH * (i + 1);
            pts.push(cx - ax, y1);
            pts.push(cx + ax, y2 - coilH*0.5);
        }
        pts.push(cx, botY);
        this._dynSpring.add(new Konva.Line({
            points: pts,
            stroke: sc, strokeWidth: 2.5,
            lineCap: 'round', lineJoin: 'round',
            listening: false,
        }));

        // 弹簧力标注
        this._dynSpring.add(new Konva.Text({
            x: cx + ax + 3, y: py + springH/2 - 8,
            text: `Fsp\n${(compression * this.springForce * this.supplyPressure / this.springForce).toFixed(3)}`,
            fontSize: 7, fill: sc,
        }));
    }

    // ── 动态：活塞 & 活塞杆 ─────────────────
    _rebuildPiston() {
        this._dynPiston.destroyChildren();
        const b      = this._cyl;
        const wallW  = b.w * 0.14;
        const innerX = b.x + wallW;
        const innerW = b.w - wallW * 2;
        const py     = this._pistonY;
        const pisH   = this._pistonH;

        // ── 活塞本体 ──
        this._dynPiston.add(new Konva.Rect({
            x: innerX, y: py, width: innerW, height: pisH,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:innerW, y:0 },
            fillLinearGradientColorStops: [0,'#6a7888',0.2,'#9aabb8',0.5,'#c0d0da',0.8,'#9aabb8',1,'#6a7888'],
            stroke: '#4a5868', strokeWidth: 1,
        }));

        // 活塞密封圈（O-ring × 2）
        [0.22, 0.78].forEach(frac => {
            this._dynPiston.add(new Konva.Rect({
                x: innerX, y: py + pisH*frac - 1.5,
                width: innerW, height: 3,
                fill: '#2a2a2a', stroke: '#1a1a1a', strokeWidth: 0.5,
            }));
        });

        // ── 活塞杆 ──
        const rodX = b.x + b.w/2 - this._rodW/2;
        const rodTop = py + pisH;
        const rodBot = b.y + b.h + 20;
        this._dynPiston.add(new Konva.Rect({
            x: rodX, y: rodTop, width: this._rodW, height: rodBot - rodTop,
            fillLinearGradientStartPoint: { x:0, y:0 },
            fillLinearGradientEndPoint:   { x:this._rodW, y:0 },
            fillLinearGradientColorStops: [0,'#8090a0',0.4,'#d0d8e0',0.6,'#c0c8d0',1,'#8090a0'],
            stroke: '#5a6878', strokeWidth: 0.8,
        }));

        // 连接法兰（杆末端）
        this._dynPiston.add(new Konva.Rect({
            x: rodX - 4, y: rodBot - 8,
            width: this._rodW + 8, height: 8,
            fill: '#6a7888', stroke: '#4a5868', strokeWidth: 1,
            cornerRadius: 2,
        }));

        // 位置刻度线（气缸右侧）
        const rx = b.x + b.w + 6;
        this._dynPiston.add(new Konva.Line({
            points: [rx - 6, py + pisH/2, rx + 10, py + pisH/2],
            stroke: '#e05030', strokeWidth: 1.5,
        }));

        // 更新截面正视图旋转臂（如有）
    }

    // ── 动态：定位器显示屏 ───────────────────
    _rebuildPID() {
        this._dynPID.destroyChildren();
        const p = this._posBox;
        const sx = p.x + p.w*0.10;
        const sy = p.y + p.h*0.19;
        const sw = p.w*0.80;
        const sh = p.h*0.20;

        // SP（给定值）
        const spColor = '#40d0ff';
        this._dynPID.add(new Konva.Text({
            x: sx, y: sy + 1,
            text: 'SP', fontSize: 7.5, fill: '#4090c0',
        }));
        this._dynPID.add(new Konva.Text({
            x: sx + 12, y: sy + 1,
            text: `${this._setpoint.toFixed(1)}%`, fontSize: 9, fontStyle: 'bold',
            fill: spColor,
        }));
        this._dynPID.add(new Konva.Text({
            x: sx + 40, y: sy + 1,
            text: `${(4 + this._setpoint/100*16).toFixed(1)}mA`, fontSize: 7, fill: '#306090',
        }));

        // PV（实际位置）
        const err  = Math.abs(this._setpoint - this._position);
        const pvColor = err < 2 ? '#40e080' : err < 8 ? '#f0c040' : '#f06040';
        this._dynPID.add(new Konva.Text({
            x: sx, y: sy + sh*0.28,
            text: 'PV', fontSize: 7.5, fill: '#308050',
        }));
        this._dynPID.add(new Konva.Text({
            x: sx + 12, y: sy + sh*0.28,
            text: `${this._position.toFixed(1)}%`, fontSize: 9, fontStyle: 'bold',
            fill: pvColor,
        }));
        this._dynPID.add(new Konva.Text({
            x: sx + 40, y: sy + sh*0.28,
            text: `${(4 + this._position/100*16).toFixed(1)}mA`, fontSize: 7, fill: '#207040',
        }));

        // ERR（偏差）
        const errVal = this._setpoint - this._position;
        const errColor = Math.abs(errVal) < 2 ? '#80a080' : '#f08040';
        this._dynPID.add(new Konva.Text({
            x: sx, y: sy + sh*0.56,
            text: 'ERR', fontSize: 7.5, fill: '#807040',
        }));
        this._dynPID.add(new Konva.Text({
            x: sx + 14, y: sy + sh*0.56,
            text: `${errVal.toFixed(1)}%`, fontSize: 9, fontStyle: 'bold',
            fill: errColor,
        }));

        // OUT（PID输出）
        const outColor = '#c0a040';
        this._dynPID.add(new Konva.Text({
            x: sx, y: sy + sh*0.80,
            text: 'OUT', fontSize: 7.5, fill: '#806020',
        }));
        this._dynPID.add(new Konva.Text({
            x: sx + 14, y: sy + sh*0.80,
            text: `${this._pidOut.toFixed(1)}%`, fontSize: 9, fontStyle: 'bold',
            fill: outColor,
        }));

        // 进度条（OUT）
        const barW = sw * 0.75;
        const barX = sx;
        const barY = sy + sh + 2;
        this._dynPID.add(new Konva.Rect({ x:barX, y:barY, width:barW, height:4, fill:'#182028', cornerRadius:2 }));
        this._dynPID.add(new Konva.Rect({
            x: barX, y: barY, width: barW * this._pidOut/100, height:4,
            fill: outColor, cornerRadius: 2,
        }));

        // 模式标签
        const modeColor = this._mode === 'AUTO' ? '#40b0f0' : this._mode === 'MANUAL' ? '#f0a040' : '#f04040';
        this._dynPID.add(new Konva.Text({
            x: p.x + p.w*0.08, y: p.y + p.h*0.74,
            text: `MODE: ${this._mode}`, fontSize: 8, fontStyle: 'bold',
            fill: modeColor,
        }));

        // SP 给定值可点击调节（定位器面板上的+/-按钮）
        const spBtnY = p.y + p.h*0.40;
        [
            { dx: 0,    label: '▲', delta: +5,  tip: 'SP+5%' },
            { dx: 20,   label: '▼', delta: -5,  tip: 'SP-5%' },
            { dx: 44,   label: '◀', delta: +1,  tip: 'SP+1%' },
            { dx: 58,   label: '▶', delta: -1,  tip: 'SP-1%' },
        ].forEach(({ dx, label, delta }) => {
            const btn = new Konva.Text({
                x: p.x + p.w*0.08 + dx, y: spBtnY,
                text: label, fontSize: 10, fill: '#6090c0', listening: true,
            });
            btn.on('click tap', () => this.setSetpoint(Math.max(0, Math.min(100, this._setpoint + delta))));
            this._dynPID.add(btn);
        });
        this._dynPID.add(new Konva.Text({ x:p.x+p.w*0.08, y:spBtnY+12, text:'SP给定', fontSize:7, fill:'#506070' }));

        // 气源状态指示
        const supplyColor = this._supplyOk ? '#40e060' : '#e04040';
        this._dynPID.add(new Konva.Circle({
            x: p.x + p.w*0.88, y: p.y + p.h*0.22,
            radius: 4, fill: supplyColor,
            shadowColor: supplyColor, shadowBlur: this._supplyOk ? 6 : 0, shadowOpacity: 0.9,
        }));
        this._dynPID.add(new Konva.Text({
            x: p.x + p.w*0.60, y: p.y + p.h*0.18,
            text: `Ps\n${this.supplyPressure.toFixed(2)}`, fontSize: 7, fill: '#508090',
        }));
    }

    // ── 状态面板（底部） ─────────────────────
    _drawStatusPanel() {
        const W = this.width, H = this.height;
        this._statusRect = new Konva.Rect({
            x: W*0.04, y: H*0.92, width: W*0.92, height: H*0.06,
            fill: '#182028', stroke: '#304050', strokeWidth: 1, cornerRadius: 3,
        });
        this._statusText = new Konva.Text({
            x: W*0.06, y: H*0.93,
            text: '', fontSize: 8, fill: '#60b0e0',
        });
        this.group.add(this._statusRect, this._statusText);
    }

    _updateStatusPanel() {
        if (!this._statusText) return;
        const pA = this._chamberA, pB = this._chamberB;
        const pos = this._position, sp = this._setpoint;
        const err = sp - pos;
        this._statusText.text(
            `位置PV: ${pos.toFixed(1)}%  给定SP: ${sp.toFixed(1)}%  偏差: ${err.toFixed(1)}%` +
            `  Pa: ${pA.toFixed(3)}MPa  Pb: ${pB.toFixed(3)}MPa` +
            `  PID-OUT: ${this._pidOut.toFixed(1)}%  模式: ${this._mode}  行程: ${(pos/100*this.stroke).toFixed(1)}mm`
        );
    }

    // ── 主循环 ────────────────────────────────
    // 集中化 tick（由 consys._tickAll 在 20fps 调用）
    tick(dt) {
        this._tick(dt);
    }
    _tick(dt) {
        this._flowPhase = (this._flowPhase + dt * 1.5) % 1;
        this._springPhase += dt;

        if (this._mode === 'FAILSAFE') {
            // 弹簧复位：快速向安全位置运动
            const target = this.failRetract ? 0 : 100;
            const speed  = 40; // %/s
            this._position = this._moveToward(this._position, target, speed * dt);
            this._chamberA = this._position * this.supplyPressure / 100 * 0.1;
            this._chamberB = this.springForce + (1 - this._position/100) * this.springForce;

        } else if (this._mode === 'AUTO') {
            // PID 控制
            const err  = this._setpoint - this._position;
            this._pidIntegral  += err * dt;
            this._pidIntegral   = Math.max(-50, Math.min(50, this._pidIntegral)); // 积分限幅
            const derr          = (err - this._pidLastError) / dt;
            this._pidLastError  = err;
            this._pidOut = Math.max(0, Math.min(100,
                this._Kp * err + this._Ki * this._pidIntegral + this._Kd * derr
            ));

            // 活塞速度（PID输出→腔室压力→活塞速度）
            const targetPressureA = (this._pidOut / 100) * this.supplyPressure;
            const pressureSpeed   = 4.0; // MPa/s 压力变化速率
            this._chamberA = this._moveToward(this._chamberA, targetPressureA, pressureSpeed * dt);
            this._chamberB = this.doubleActing
                ? this.supplyPressure - this._chamberA
                : this.springForce + (1 - this._position/100) * this.springForce * 0.5;

            // 活塞位置更新（压差驱动）
            const netForce = this._chamberA - this._chamberB; // MPa（正=向下伸出）
            const maxSpeed = 35; // %/s
            const velocity = netForce / this.supplyPressure * maxSpeed;
            this._position = Math.max(0, Math.min(100, this._position + velocity * dt));

        } else if (this._mode === 'MANUAL') {
            // 手动模式：位置由 _setPositionDirect 直接设定，缓动跟踪
            this._position = this._moveToward(this._position, this._manualTarget ?? this._position, 25 * dt);
            this._chamberA = (this._position / 100) * this.supplyPressure;
            this._chamberB = this.doubleActing
                ? this.supplyPressure - this._chamberA
                : this.springForce + (1 - this._position/100) * this.springForce * 0.5;
        }

        // 更新活塞几何
        this._pistonY    = this._pistonYFromPos(this._position);
        this._signalMA   = 4 + this._setpoint / 100 * 16;
        this._feedbackMA = 4 + this._position  / 100 * 16;

        this._rebuildGas();
        this._rebuildSpring();
        this._rebuildPiston();
        this._rebuildPID();
        this._updateStatusPanel();
        this._refreshCache();
    }

    _moveToward(current, target, maxStep) {
        if (Math.abs(target - current) <= maxStep) return target;
        return current + Math.sign(target - current) * maxStep;
    }

    _setPositionDirect(pos) {
        this._manualTarget = Math.max(0, Math.min(100, pos));
    }

    // ═══════════════════════════════════════════
    /** 设置位置给定值（%，0-100） */
    setSetpoint(sp) {
        this._setpoint = Math.max(0, Math.min(100, sp));
        this._pidIntegral  = 0; // 换点时清积分
        this._refreshCache();
    }

    /** 设置控制信号（mA，4-20） */
    setSignalMA(mA) {
        const sp = (Math.max(4, Math.min(20, mA)) - 4) / 16 * 100;
        this.setSetpoint(sp);
    }

    /** 设置运行模式 */
    setMode(mode) {
        const modes = ['AUTO', 'MANUAL', 'FAILSAFE'];
        if (!modes.includes(mode)) return;
        if (mode === 'MANUAL') this._manualTarget = this._position;
        this._mode = mode;
        if (mode === 'FAILSAFE') this._supplyOk = false;
        else this._supplyOk = true;
        this._pidIntegral = 0;
        this._refreshCache();
    }

    /** 设置供气压力（MPa） */
    setSupplyPressure(p) {
        this.supplyPressure = Math.max(0.14, Math.min(0.70, p));
        this._refreshCache();
    }

    /** 模拟气源失压（触发故障安全） */
    triggerAirFailure() { this.setMode('FAILSAFE'); }

    /** 恢复气源 */
    restoreAirSupply() {
        this._supplyOk = true;
        this.setMode('AUTO');
    }

    // ── 状态查询 ──────────────────────────────
    getPosition()        { return this._position; }
    getSetpoint()        { return this._setpoint; }
    getMode()            { return this._mode; }
    getChamberA()        { return this._chamberA; }
    getChamberB()        { return this._chamberB; }
    getSignalMA()        { return this._signalMA; }
    getFeedbackMA()      { return this._feedbackMA; }
    getPIDOut()          { return this._pidOut; }
    getOpsCount()        { return this.opsCount; }

    update(state) {
        if (!state || typeof state !== 'object') return;
        if (state.setpoint  !== undefined) this.setSetpoint(state.setpoint);
        if (state.signalMA  !== undefined) this.setSignalMA(state.signalMA);
        if (state.mode      !== undefined) this.setMode(state.mode);
        if (state.supplyPressure !== undefined) this.setSupplyPressure(state.supplyPressure);
        this._refreshCache();
    }

    getConfigFields() {
        return [
            { label: '位号/名称',              key: 'label',             type: 'text'   },
            { label: '行程 (mm)',              key: 'stroke',            type: 'number' },
            { label: '额定推力 (N)',            key: 'thrust',            type: 'number' },
            { label: '供气压力 (MPa)',          key: 'supplyPressure',    type: 'number' },
            { label: '弹簧当量压力 (MPa)',      key: 'springForce',       type: 'number' },
            { label: '双作用(1)/弹簧复位(0)',   key: 'doubleActing',      type: 'number' },
            { label: '失气缩回(1)/伸出(0)',     key: 'failRetract',       type: 'number' },
            { label: '定位器Kp',              key: 'Kp',                type: 'number' },
            { label: '定位器Ki',              key: 'Ki',                type: 'number' },
            { label: '定位器Kd',              key: 'Kd',                type: 'number' },
            { label: '积污速率(仿真)',          key: 'dirtyRate',         type: 'number' },
            { label: '品牌标注',              key: 'positionerType',    type: 'text'   },
            { label: '初始给定值 (%)',          key: 'initSetpoint',      type: 'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label)           this.label           = cfg.label;
        if (cfg.stroke)          this.stroke          = parseFloat(cfg.stroke)          || this.stroke;
        if (cfg.thrust)          this.thrust          = parseFloat(cfg.thrust)          || this.thrust;
        if (cfg.supplyPressure)  this.supplyPressure  = parseFloat(cfg.supplyPressure)  || this.supplyPressure;
        if (cfg.springForce)     this.springForce     = parseFloat(cfg.springForce)     || this.springForce;
        if (cfg.doubleActing !== undefined) this.doubleActing = !!parseInt(cfg.doubleActing);
        if (cfg.failRetract  !== undefined) this.failRetract  = !!parseInt(cfg.failRetract);
        if (cfg.Kp !== undefined) this._Kp = parseFloat(cfg.Kp) || this._Kp;
        if (cfg.Ki !== undefined) this._Ki = parseFloat(cfg.Ki) || this._Ki;
        if (cfg.Kd !== undefined) this._Kd = parseFloat(cfg.Kd) || this._Kd;
        if (cfg.positionerType)  this.positionerType  = cfg.positionerType;
        if (cfg.initSetpoint !== undefined) this.setSetpoint(parseFloat(cfg.initSetpoint));
        this.config = { ...this.config, ...cfg };
        this._refreshCache();
    }

    destroy() {
        super.destroy?.();
    }
}