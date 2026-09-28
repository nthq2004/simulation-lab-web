import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 SINAMICS V90 伺服驱动器仿真组件
 *
 * ══════════════════════════════════════════════════════════════════════
 *  硬件规格（V90 PN，PROFINET 版本）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  驱动器型号：SINAMICS V90 PN
 *    订货号（0.4kW）：6SL3210-5FE10-4UA0
 *    订货号（1kW）：  6SL3210-5FE11-0UA0
 *    订货号（2kW）：  6SL3210-5FE12-0UA0
 *    通信：集成 PROFINET IO，支持 PROFIdrive
 *    接口：1 × RJ45（集成 2端口 PN 交换机）
 *
 *  配套电机（仿真默认）：
 *    1FK7 系列同步伺服电机
 *    额定功率：0.75kW
 *    额定转速：3000 RPM
 *    额定转矩：2.39 N·m
 *    编码器：20位增量式（1048576 PPR）
 *    带抱闸：可选
 *
 * ══════════════════════════════════════════════════════════════════════
 *  PROFIdrive 通信协议
 * ══════════════════════════════════════════════════════════════════════
 *
 *  PROFIdrive 报文类型（仿真支持）：
 *
 *  ── 报文 1（标准报文，速度控制）──────────────────────────────────────
 *  输出（Controller → Drive）：4 字节
 *    STW1（控制字 1）     : WORD   [字节 0~1]
 *    NSOLL_A（速度设定值）: INT    [字节 2~3]（16384 = 100% 额定转速）
 *
 *  输入（Drive → Controller）：4 字节
 *    ZSW1（状态字 1）     : WORD   [字节 0~1]
 *    NIST_A（实际速度）   : INT    [字节 2~3]（16384 = 100% 额定转速）
 *
 *  ── 报文 3（标准报文，速度+力矩限幅）────────────────────────────────
 *  输出：8 字节（STW1 + NSOLL_A + MOMRED + STW2）
 *  输入：8 字节（ZSW1 + NIST_A + MIST + ZSW2）
 *
 *  ── 报文 111（SIEMENS 扩展报文，位置控制）───────────────────────────
 *  输出：20 字节
 *    STW1         : WORD     控制字 1
 *    POS_STW1     : WORD     定位控制字 1
 *    POS_STW2     : WORD     定位控制字 2
 *    OVERRIDE     : WORD     速度修调（0~16384 = 0~100%）
 *    MDI_TARPOS   : DINT     目标位置（LU，Load Unit）
 *    MDI_VELOCITY : DWORD    速度设定（LU/min）
 *    MDI_ACC      : WORD     加速度倍率（0~16384 = 0~100%）
 *    MDI_DEC      : WORD     减速度倍率
 *
 *  输入：28 字节
 *    ZSW1         : WORD     状态字 1
 *    POS_ZSW1     : WORD     定位状态字 1
 *    POS_ZSW2     : WORD     定位状态字 2
 *    XIST_A       : DINT     实际位置（LU）
 *    NIST_A       : INT      实际速度
 *    MIST_A       : INT      实际转矩（%额定）
 *    FAULT_CODE   : WORD     故障代码
 *    WARN_CODE    : WORD     报警代码
 *
 *  ── STW1（控制字 1）位定义 ──────────────────────────────────────────
 *    Bit0   ON/OFF1          0=OFF1（斜坡停止），1=使能
 *    Bit1   OFF2             0=立即停止（惯性），1=正常
 *    Bit2   OFF3             0=快速停止，1=正常
 *    Bit3   ENABLE_OP        0=禁止运行，1=允许运行
 *    Bit4   RAMP_GEN_EN      1=启用斜坡发生器
 *    Bit5   SETP_RAMP_GEN    1=速度设定值有效
 *    Bit6   SETP_ENABLE      1=设定值使能
 *    Bit7   RESET_FAULT      上升沿=复位故障
 *    Bit8   JOGGING_1        1=JOG1 点动（正向）
 *    Bit9   JOGGING_2        1=JOG2 点动（反向）
 *    Bit10  REMOTE_CTRL      1=远程控制
 *    Bit11  SETP_INC         速度设定值增量
 *    Bit12  不使用
 *    Bit13  MOTOR_POT_UP     电动电位器增
 *    Bit14  MOTOR_POT_DOWN   电动电位器减
 *    Bit15  不使用
 *
 *  ── ZSW1（状态字 1）位定义 ──────────────────────────────────────────
 *    Bit0   READY_TO_ON      驱动已准备好上电
 *    Bit1   READY            驱动已使能，准备好运行
 *    Bit2   OPERATION_EN     运行使能
 *    Bit3   FAULT            故障（=1 有故障）
 *    Bit4   NO_OFF2          无 OFF2（=1 正常）
 *    Bit5   NO_OFF3          无 OFF3（=1 正常）
 *    Bit6   SWITCH_ON_INH    上电禁止（=1 禁止）
 *    Bit7   ALARM            报警（=1 有报警）
 *    Bit8   SPEED_AT_SETPT   速度到达设定值
 *    Bit9   REMOTE_CTRL      远程控制激活
 *    Bit10  SPEED_GTE_ZERO   速度≥0
 *    Bit11  MOTOR_CURRENT_OK 电流正常
 *    Bit12  HOLDING_BRAKE    抱闸
 *    Bit13  OVERLOAD_WARN    过载报警
 *    Bit14  MOTOR_CCW        电机反向
 *    Bit15  不使用
 *
 * ══════════════════════════════════════════════════════════════════════
 *  驱动状态机（PROFIdrive State Machine）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  S1 SWITCHING_ON_INHIBITED  上电禁止（初始/故障复位后）
 *  S2 READY_TO_SWITCH_ON      准备好上电（等待 ON 指令）
 *  S3 SWITCHED_ON             已上电（等待 ENABLE 指令）
 *  S4 OPERATION               运行中（正常工作状态）
 *  S5 RAMP_STOP               斜坡停止（OFF1）
 *  S6 QUICK_STOP              快速停止（OFF3）
 *  S7 FAULT_REACTION          故障处理中
 *  S8 FAULT                   故障（等待复位）
 *
 *  状态转换：
 *  S1 ←→ S2: STW1.Bit0=0/1（OFF1 / ON）
 *  S2 → S3:  STW1.Bit3=1 (ENABLE_OP)
 *  S3 → S4:  STW1.Bit4,5,6=1（全使能）
 *  S4 → S5:  STW1.Bit0=0（OFF1）
 *  S4 → S6:  STW1.Bit2=0（OFF3 快停）
 *  S4 → S7:  故障触发
 *  S7 → S8:  故障处理完成
 *  S8 → S1:  STW1.Bit7 上升沿（故障复位）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  运动物理引擎
 * ══════════════════════════════════════════════════════════════════════
 *
 *  速度控制模式：
 *    n_set（rpm）= NSOLL_A × n_rated / 16384
 *    控制律：n_act ≈ n_set（一阶惯性，时间常数 τ = J / B）
 *    速度斜坡：|dn/dt| ≤ acc_ramp（rpm/s）
 *
 *  位置控制模式（报文111）：
 *    目标位置（LU） = MDI_TARPOS
 *    1 LU = (编码器分辨率 / 机械传动比) 对应 1 个机械单位
 *    位置环控制：p_err = target - actual, v_cmd = Kp × p_err
 *    速度限幅、加减速斜坡约束
 *
 *  力矩计算：
 *    M = J × (dn/dt) + B × n + load_torque（N·m）
 *    功率 P = M × ω = M × n × 2π/60（W）
 *    转矩利用率 = M / M_rated × 100%
 *
 *  热保护仿真：
 *    电机温度 T += (I²·R - α·(T-T_amb)) × dt
 *    过载报警：T > 120°C，过热保护：T > 150°C（触发故障 F07011）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  故障与报警（Faults & Alarms）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  常用故障代码（Fxx）：
 *    F07011  电机过热（Motor Overtemperature）
 *    F07012  编码器故障
 *    F07901  直流母线过压（Overvoltage）
 *    F07902  直流母线欠压（Undervoltage）
 *    F30001  功率模块过温
 *    F30004  短路故障
 *    F30021  基板温度过高
 *
 *  常用报警代码（Axx）：
 *    A07011  电机温度过高警告（<故障阈值）
 *    A07030  过载积分器 > 80%
 *    A07901  直流母线电压过高警告
 *    A07902  直流母线电压过低警告
 *    A08505  PROFINET 通信中断（看门狗超时）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  外观描述（V90 正面面板）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  V90 驱动器为竖向长条形机身，典型宽度 70mm，高度因功率不同
 *  外壳颜色：深炭灰色（#2a2e36）
 *
 *  ┌──────────────────┐
 *  │  SINAMICS        │  ← 顶部金色/橙色品牌带
 *  │  V90 PN          │
 *  ├──────────────────┤
 *  │  [PROFINET RJ45] │  ← PN 口（绿色）
 *  │  ○LINK  ○ACT     │  ← PN LED
 *  ├──────────────────┤
 *  │  ○RDY  ○RUN  ○ALM│  ← 3 状态 LED（绿/绿/红）
 *  │  ○BRK  ○PN        │  ← 抱闸/PN 状态 LED
 *  ├──────────────────┤
 *  │  ┌────────────┐  │
 *  │  │  操作面板   │  │  ← 4行 LCD（仿真数值显示）
 *  │  │ n:1500 rpm │  │
 *  │  │ M: 45%     │  │
 *  │  │ P:  350W   │  │
 *  │  │ T:  48°C   │  │
 *  │  └────────────┘  │
 *  ├──────────────────┤
 *  │  [状态机]        │  ← 状态栏（S4/OPERATION）
 *  │  [STW1 位图]     │  ← 控制字位显示
 *  │  [ZSW1 位图]     │  ← 状态字位显示
 *  ├──────────────────┤
 *  │  速度波形图      │  ← 实时速度趋势曲线
 *  │  [~~~~~]         │
 *  ├──────────────────┤
 *  │  故障/报警       │  ← 最新故障代码
 *  ├──────────────────┤
 *  │  [接线端子]      │  ← 底部端子排（U/V/W/PE + 编码器）
 *  └──────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *
 *  PN_PORT   → PROFINET（bus，顶部 RJ45，连接 ST20 PN_P1）
 *  U / V / W → 三相电机动力线（wire）
 *  PE        → 接地（wire）
 *  BRK+/BRK- → 抱闸控制线（wire）
 *  ENC_A/B/Z → 编码器反馈（wire, passive）
 *  PWR_L1/L2/L3 → 三相供电（wire, passive）
 *  24V / 0V  → 控制电源（wire, passive）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  可配置参数
 * ══════════════════════════════════════════════════════════════════════
 *
 *  label           : 位号（默认 'V90-1'）
 *  pnStationName   : PROFINET 站名（默认 'v90-pn-1'）
 *  pnIP            : IP 地址（默认 '192.168.0.20'）
 *  pnSubnet        : 子网掩码（'255.255.255.0'）
 *  pnGateway       : 网关（'192.168.0.254'）
 *  telegramType    : PROFIdrive 报文类型（1 / 3 / 111，默认 111）
 *  ratedSpeed      : 额定转速 rpm（默认 3000）
 *  ratedTorque     : 额定转矩 N·m（默认 2.39）
 *  ratedPower      : 额定功率 W（默认 750）
 *  motorInertia    : 转动惯量 kg·m²（默认 0.00034）
 *  encoderPPR      : 编码器分辨率 PPR（默认 1048576）
 *  transmitRatio   : 机械传动比（默认 1.0）
 *  accRampS        : 加速时间 s（0→额定，默认 1.0）
 *  decRampS        : 减速时间 s（额定→0，默认 1.0）
 *  jogSpeedRpm     : 点动速度 rpm（默认 200）
 *  loadTorqueNm    : 负载转矩 N·m（默认 0.5）
 *  watchdogMs      : 看门狗超时 ms（默认 3000）
 *  hasBrake        : 是否有抱闸（默认 true）
 *  pnChannelName   : BroadcastChannel 名（'v90_pn_bus'）
 */
export class V90Drive extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(140, config.width  || 200);
        this.height = Math.max(380, config.height || 500);

        this.type    = 'v90_drive';
        this.special = 'servo_drive';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initMotorPhysics();
        this._initDriveStateMachine();
        this._initPROFIdrive();
        this._initProfinet(config);
        this._init();

        this.config = {
            label:          this.label,
            pnStationName:  this._pn.stationName,
            pnIP:           this._pn.ip,
            pnSubnet:       this._pn.subnet,
            pnGateway:      this._pn.gateway,
            telegramType:   this._tg.type,
            ratedSpeed:     this._motor.nRated,
            ratedTorque:    this._motor.mRated,
            ratedPower:     this._motor.pRated,
            accRampS:       this._ramp.accS,
            decRampS:       this._ramp.decS,
            jogSpeedRpm:    this._jogSpeed,
            loadTorqueNm:   this._motor.loadTorque,
            hasBrake:       this._hasBrake,
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._body = { x:0, y:0, w:W, h:H, rx:4 };

        // ── 顶部品牌带（金橙色）──
        this._brandBar = { x:0, y:0, w:W, h:H*0.060 };

        // ── PN 接口区 ──
        this._pnPortArea = { x:W*0.06, y:H*0.068, w:W*0.88, h:H*0.072 };
        this._pnLinkLED  = { x:W*0.16, y:H*0.158, r:H*0.012 };
        this._pnActLED   = { x:W*0.35, y:H*0.158, r:H*0.012 };

        // ── 状态 LED 区 ──
        const ledY = H*0.190;
        const ledR = H*0.013;
        this._leds = {
            rdy: { x:W*0.12, y:ledY, r:ledR },  // 绿：准备好
            run: { x:W*0.30, y:ledY, r:ledR },  // 绿：运行
            alm: { x:W*0.48, y:ledY, r:ledR },  // 红：报警
            brk: { x:W*0.66, y:ledY, r:ledR },  // 黄：抱闸
            pn:  { x:W*0.84, y:ledY, r:ledR },  // 绿：PN 连接
        };

        // ── LCD 面板 ──
        this._lcd = { x:W*0.06, y:H*0.225, w:W*0.88, h:H*0.160 };

        // ── 状态机显示 ──
        this._stateBar = { x:W*0.06, y:H*0.394, w:W*0.88, h:H*0.038 };

        // ── STW1 / ZSW1 位图 ──
        this._stw1Bar = { x:W*0.06, y:H*0.438, w:W*0.88, h:H*0.034 };
        this._zsw1Bar = { x:W*0.06, y:H*0.476, w:W*0.88, h:H*0.034 };

        // ── 速度波形图 ──
        this._waveArea = { x:W*0.06, y:H*0.520, w:W*0.88, h:H*0.105 };

        // ── 位置/速度数值条 ──
        this._paramArea = { x:W*0.06, y:H*0.634, w:W*0.88, h:H*0.080 };

        // ── 故障/报警条 ──
        this._faultBar = { x:W*0.06, y:H*0.720, w:W*0.88, h:H*0.052 };

        // ── 端子排（底部）──
        this._terminals = { x:W*0.04, y:H*0.786, w:W*0.92, h:H*0.072 };

        // ── 铭牌 ──
        this._nameplate = { x:W*0.04, y:H*0.865, w:W*0.92, h:H*0.046 };

        // ── DIN 卡扣 ──
        this._dinRail = { x:0, y:H*0.918, w:W, h:H*0.082 };

        // ── 散热格栅（右侧）──
        this._ventSlots = [];
        for (let i=0; i<6; i++) {
            this._ventSlots.push({ x:W*0.930, y:H*(0.30+i*0.052), w:W*0.040, h:H*0.028 });
        }

        // ── 端口坐标 ──
        this._portPos = {
            PN_PORT: { x:W*0.50, y:0 },
            U:       { x:W*0.14, y:H },
            V:       { x:W*0.28, y:H },
            W_:      { x:W*0.42, y:H },  // W_ 避免关键字
            PE:      { x:W*0.56, y:H },
            'BRK+':  { x:W*0.68, y:H },
            'BRK-':  { x:W*0.78, y:H },
            ENC_A:   { x:W*0.88, y:H },
            PWR_L1:  { x:W*0.14, y:0 },
            PWR_L2:  { x:W*0.28, y:0 },
            PWR_L3:  { x:W*0.42, y:0 },
            '24V':   { x:W*0.72, y:0 },
            '0V':    { x:W*0.86, y:0 },
        };

        // 速度/位置历史（波形）
        this._speedHist    = new Float64Array(80);
        this._speedHistPtr = 0;
        this._torqueHist   = new Float64Array(80);
    }

    // ═══════════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label      = config.label      || 'V90-1';
        this._hasBrake  = config.hasBrake   !== undefined ? !!config.hasBrake : true;
        this._jogSpeed  = config.jogSpeedRpm !== undefined ? config.jogSpeedRpm : 200;
        this._stateStr  = 'S1 上电禁止';

        // 错误/报警
        this._faults    = [];   // [ { code:'F07011', msg:'电机过热', ts } ]
        this._alarms    = [];
        this._prevStw1Bit7 = false;  // 用于检测 Bit7 上升沿

        // 诊断缓冲区
        this._diagLog   = [];
    }

    // ═══════════════════════════════════════════════════════════════
    // 电机物理引擎初始化
    // ═══════════════════════════════════════════════════════════════

    _initMotorPhysics() {
        const cfg = arguments[0] || {};   // 第一次调用时 config 已存于 this._config
        const C   = this.config || cfg;

        this._motor = {
            // 额定参数
            nRated:     3000,    // 额定转速 rpm
            mRated:     2.39,    // 额定转矩 N·m
            pRated:     750,     // 额定功率 W
            J:          0.00034, // 转动惯量 kg·m²
            B:          0.0002,  // 粘滞摩擦 N·m·s/rad
            loadTorque: 0.5,     // 负载转矩 N·m

            // 动态状态
            nAct:       0.0,     // 实际转速 rpm
            nCmd:       0.0,     // 速度指令 rpm（斜坡输出）
            mAct:       0.0,     // 实际转矩 N·m
            pAct:       0.0,     // 实际功率 W
            posAct:     0.0,     // 实际位置（LU，Load Unit）
            posTarget:  0.0,     // 目标位置（LU）

            // 热学
            tempMotor:  25.0,    // 电机温度 °C
            tempAmb:    25.0,    // 环境温度 °C
            thermalR:   0.8,     // 热阻 °C/W
            thermalTau: 300,     // 热时间常数 s

            // 直流母线
            dcBusVoltage: 540,   // V（三相 380V 整流）
            dcBusMin:     450,
            dcBusMax:     800,
        };

        // 斜坡发生器
        this._ramp = {
            accS:    1.0,    // 加速时间 s（0→额定）
            decS:    1.0,    // 减速时间 s（额定→0）
            current: 0.0,    // 斜坡当前输出 rpm
        };

        // 编码器
        this._encoder = {
            ppr:        1048576,  // PPR
            ratio:      1.0,      // 机械传动比（减速比）
            pulseCount: 0,        // 累计脉冲数
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFIdrive 状态机初始化
    // ═══════════════════════════════════════════════════════════════

    _initDriveStateMachine() {
        this._dsm = {
            state: 'S1',   // S1~S8
            stw1:  0x0000, // 控制字 1（来自 Controller）
            zsw1:  0x0000, // 状态字 1（发给 Controller）
            prevStw1: 0,
        };
        // 初始 ZSW1：Bit6=1（上电禁止），Bit9=1（远程控制）
        this._dsm.zsw1 = (1<<6) | (1<<9);
        this._updateZSW1();
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFIdrive 报文数据初始化
    // ═══════════════════════════════════════════════════════════════

    _initPROFIdrive() {
        this._tg = {
            type: 111,         // 报文类型

            // 报文111 输出区（Controller → Drive）：20 字节
            outData: new Uint8Array(20),

            // 报文111 输入区（Drive → Controller）：28 字节
            inData:  new Uint8Array(28),

            // 解析后的输出字段
            stw1:        0,    // 控制字 1
            posStw1:     0,    // 定位控制字 1
            posStw2:     0,    // 定位控制字 2
            override:    16384,// 速度修调
            mdiTarpos:   0,    // 目标位置（DINT）
            mdiVelocity: 0,    // 速度（DWORD，LU/min）
            mdiAcc:      16384,// 加速度倍率
            mdiDec:      16384,// 减速度倍率

            // 报文1/3 输出字段
            nsollA:      0,    // 速度设定值（INT）
        };

        // PROFIdrive 参数（P 参数，部分关键参数）
        this._params = {
            p29001: 0.0,       // 目标位置偏移（LU）
            p29002: 100,       // 最大速度（%额定）
            p29003: 100,       // 最大加速度（%额定）
            p29010: 0,         // 参考速度（RPM）
            p29019: 10000,     // 最大定位速度（LU/min）
            p1300:  0,         // 控制模式（0=速度，1=位置）
        };

        // LU 单位（Load Unit）定义：1 LU = 1/1000 转
        this._luPerRev = 1000;  // 每转 LU 数（可配置）
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET 初始化（Device 模式，与 ET200SP 相同模式）
    // ═══════════════════════════════════════════════════════════════

    _initProfinet(config) {
        const rnd = () => Math.floor(Math.random()*256).toString(16).padStart(2,'0').toUpperCase();
        this._pn = {
            stationName:     config.pnStationName || 'v90-pn-1',
            ip:              config.pnIP          || '192.168.0.20',
            subnet:          config.pnSubnet      || '255.255.255.0',
            gateway:         config.pnGateway     || '192.168.0.254',
            mac:             `00:1B:1B:${rnd()}:${rnd()}:${rnd()}`,
            vendorID:        0x002A,
            deviceID:        0x0156,    // SINAMICS V90 PN
            fwVersion:       'V1.08',
            orderNumber:     '6SL3210-5FE10-4UA0',

            state:           'OFFLINE',
            arEstablished:   false,
            controllerRef:   null,
            controllerIP:    '',
            deviceSlot:      -1,

            p1: { link:false, act:false },
            p2: { link:false, act:false },

            sendClockMs:     config.pnSendClockMs || 1,
            accumCycleMs:    0,
            cycleCounter:    0,
            txFrames:        0,
            rxFrames:        0,
            lastCycleTs:     0,
            measuredCycleUs: 0,
            missedCycles:    0,

            watchdogMs:      config.watchdogMs || 3000,
            lastRxTs:        0,
            watchdogTripped: false,

            diagBuffer:      [],
            startupTimer:    0,

            channelName:     config.pnChannelName || 'v90_pn_bus',
            bcChannel:       null,

            // PROFIdrive 报文规格（与 inputBytes/outputBytes 对应）
            inputBytes:  28,  // Drive → Controller（ZSW1 + 速度 + 位置 + 故障码等）
            outputBytes: 20,  // Controller → Drive（STW1 + 速度/位置指令）
        };

        try {
            this._pn.bcChannel = new BroadcastChannel(this._pn.channelName);
            this._pn.bcChannel.onmessage = (e) => this._onBCMessage(e.data);
        } catch(e) {}

        this._pnSchedulerQueue = [];
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET 调度器
    // ═══════════════════════════════════════════════════════════════

    _pnSchedule(delayMs, cb) {
        this._pnSchedulerQueue.push({ fireAt: performance.now() + delayMs, cb });
    }

    _pnTickScheduler() {
        const now = performance.now();
        this._pnSchedulerQueue = this._pnSchedulerQueue.filter(item => {
            if (now >= item.fireAt) { item.cb(); return false; }
            return true;
        });
    }

    _pnLog(level, msg) {
        const ts = new Date().toLocaleTimeString('zh-CN', { hour12:false, fractionalSecondDigits:2 });
        this._pn.diagBuffer.unshift({ level, msg, ts });
        this._diagLog.unshift({ level, msg, ts });
        if (this._pn.diagBuffer.length > 48) this._pn.diagBuffer.pop();
        if (this._diagLog.length > 64) this._diagLog.pop();
    }

    // ── BroadcastChannel 处理 ─────────────────────────────────────

    _onBCMessage(msg) {
        if (!msg?.type) return;
        if (msg.type === 'pn_output_data' && msg.deviceName === this._pn.stationName) {
            this._receiveOutputFrame(new Uint8Array(msg.data));
        }
        if (msg.type === 'pn_connect_device' && msg.deviceName === this._pn.stationName) {
            this._handleAREstablish(msg.controllerIP || '?');
        }
        if (msg.type === 'pn_disconnect' && msg.deviceName === this._pn.stationName) {
            this._handleARRelease();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET 连接 API（公开）
    // ═══════════════════════════════════════════════════════════════

    /**
     * 直接连接到 Controller CPU（ST20 / S7-1200）
     * @param {object} controllerCPU  CPU 实例
     * @param {object} opts           { controllerIP, deviceSlot }
     */
    connectToController(controllerCPU, opts = {}) {
        if (!controllerCPU) return;
        this._pn.controllerRef = controllerCPU;
        this._pn.controllerIP  = opts.controllerIP || controllerCPU._pn?.ip || '192.168.0.1';
        this._pn.deviceSlot    = opts.deviceSlot   !== undefined ? opts.deviceSlot : 0;
        this._pn.p1.link       = true;
        this._pn.state         = 'STARTUP';
        this._pnLog('info', `连接到 Controller ${this._pn.controllerIP}，站名: ${this._pn.stationName}`);
        this._pn.startupTimer  = 400 + Math.random() * 300;
        this._rebuildDynamic(); this.markDirty();
    }

    /** connectToCPU 兼容接口（供 pnBindModule 调用） */
    connectToCPU(cpu) {
        this.connectToController(cpu, {
            controllerIP: cpu._pn?.ip || '192.168.0.1',
            deviceSlot:   0,
        });
    }

    /** 断开连接 */
    disconnectFromController() { this._handleARRelease(); }
    disconnectFromCPU()        { this.disconnectFromController(); }

    _handleAREstablish(controllerIP) {
        this._pn.arEstablished       = true;
        this._pn.controllerIP        = controllerIP;
        this._pn.state               = 'DATA_EXCHANGE';
        this._pn.lastRxTs            = performance.now();
        this._pn.watchdogTripped     = false;
        this._pn.p1.link             = true;
        this._pn.p1.act              = true;
        // 进入 READY_TO_SWITCH_ON（S2）
        if (this._dsm.state === 'S1') {
            this._dsm.state = 'S2';
            this._stateStr  = 'S2 准备好上电';
            this._dsm.zsw1 &= ~(1<<6);  // 清除上电禁止
            this._dsm.zsw1 |=  (1<<0);  // READY_TO_ON
        }
        this._pnLog('info', `✓ AR 建立，进入 DATA_EXCHANGE（${controllerIP}）`);
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    _handleARRelease() {
        this._pn.arEstablished   = false;
        this._pn.state           = 'OFFLINE';
        this._pn.controllerRef   = null;
        this._pn.p1.link         = false;
        this._pn.p1.act          = false;
        this._pn.watchdogTripped = false;
        // 驱动停止（OFF1）
        this._dsm.state = 'S1';
        this._stateStr  = 'S1 上电禁止';
        this._dsm.zsw1  = (1<<6) | (1<<9);  // 上电禁止 + 远程控制
        this._motor.nCmd = 0;
        this._pnLog('warn', 'AR 断开，驱动回到 OFFLINE');
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFIdrive 报文解析
    // ═══════════════════════════════════════════════════════════════

    /** 接收 Controller 发来的输出帧（Controller → Drive） */
    _receiveOutputFrame(data) {
        if (!data || data.length < 4) return;
        const tg = this._tg;

        // 解析 STW1（字节 0~1，大端）
        const stw1 = (data[0] << 8) | data[1];
        this._pn.lastRxTs = performance.now();
        this._pn.rxFrames++;

        if (this._tg.type === 1 || this._tg.type === 3) {
            // 报文 1/3：STW1 + NSOLL_A
            tg.stw1   = stw1;
            tg.nsollA = data.length >= 4 ? ((data[2]<<8)|data[3]) : 0;
            // 速度设定值换算：NSOLL_A=16384 → 100% 额定转速
            const nSetPct = tg.nsollA / 16384;
            tg.mdiVelocity = nSetPct * this._motor.nRated * this._luPerRev;  // LU/min

        } else {
            // 报文 111（20 字节）
            if (data.length < 10) return;
            tg.stw1     = stw1;
            tg.posStw1  = (data[2]<<8)|data[3];
            tg.posStw2  = (data[4]<<8)|data[5];
            tg.override = (data[6]<<8)|data[7];
            // MDI_TARPOS（DINT，字节 8~11，大端有符号）
            const tarposRaw = ((data[8]<<24)|(data[9]<<16)|(data[10]<<8)|data[11]);
            tg.mdiTarpos    = tarposRaw > 0x7FFFFFFF ? tarposRaw - 0x100000000 : tarposRaw;
            // MDI_VELOCITY（DWORD，字节 12~15）
            tg.mdiVelocity  = ((data[12]<<24)|(data[13]<<16)|(data[14]<<8)|data[15]) >>> 0;
            tg.mdiAcc       = (data[16]<<8)|data[17];
            tg.mdiDec       = (data[18]<<8)|data[19];
        }

        // 执行状态机转换
        this._processDSM(tg.stw1);
        this._pn.watchdogTripped = false;
    }

    /** 构建输入帧（Drive → Controller） */
    _buildInputFrame() {
        const buf = this._tg.inData;
        const m   = this._motor;
        const dsm = this._dsm;

        // 更新 ZSW1
        this._updateZSW1();
        const zsw1 = dsm.zsw1;

        if (this._tg.type === 1 || this._tg.type === 3) {
            // 报文 1/3（4/8 字节）
            buf[0] = (zsw1>>8)&0xFF; buf[1] = zsw1&0xFF;
            const nistA = Math.round((m.nAct / m.nRated) * 16384);
            buf[2] = (nistA>>8)&0xFF; buf[3] = nistA&0xFF;

        } else {
            // 报文 111（28 字节）
            // ZSW1
            buf[0] = (zsw1>>8)&0xFF; buf[1] = zsw1&0xFF;
            // POS_ZSW1（定位状态字）
            const posZsw1 = this._calcPosZSW1();
            buf[2] = (posZsw1>>8)&0xFF; buf[3] = posZsw1&0xFF;
            // POS_ZSW2
            buf[4] = 0; buf[5] = 0;
            // XIST_A（实际位置，DINT 大端）
            const xistA = Math.round(m.posAct) & 0xFFFFFFFF;
            buf[6]=(xistA>>>24)&0xFF; buf[7]=(xistA>>>16)&0xFF;
            buf[8]=(xistA>>>8)&0xFF;  buf[9]=xistA&0xFF;
            // NIST_A（实际速度 INT，16384=额定）
            const nistA = Math.round((m.nAct / m.nRated) * 16384);
            const nistU = nistA < 0 ? nistA + 65536 : nistA;
            buf[10]=(nistU>>8)&0xFF; buf[11]=nistU&0xFF;
            // MIST_A（实际转矩 INT，16384=额定）
            const mistA = Math.round((m.mAct / m.mRated) * 16384);
            const mistU = mistA < 0 ? mistA + 65536 : mistA;
            buf[12]=(mistU>>8)&0xFF; buf[13]=mistU&0xFF;
            // FAULT_CODE
            const fCode = this._faults.length > 0 ? parseInt(this._faults[0].code.replace(/\D/g,'')) : 0;
            buf[14]=(fCode>>8)&0xFF; buf[15]=fCode&0xFF;
            // WARN_CODE
            const aCode = this._alarms.length > 0 ? parseInt(this._alarms[0].code.replace(/\D/g,'')) : 0;
            buf[16]=(aCode>>8)&0xFF; buf[17]=aCode&0xFF;
            // 预留字节 18~27
            buf[18]=0; buf[19]=0;
            // 实际直流母线电压（扩展字段）
            const vdc = Math.round(m.dcBusVoltage);
            buf[20]=(vdc>>8)&0xFF; buf[21]=vdc&0xFF;
            // 电机温度
            const tempRaw = Math.round(m.tempMotor * 10);
            buf[22]=(tempRaw>>8)&0xFF; buf[23]=tempRaw&0xFF;
            // 实际功率
            const pRaw = Math.round(m.pAct);
            buf[24]=(pRaw>>8)&0xFF; buf[25]=pRaw&0xFF;
            // CRC 占位
            buf[26]=0; buf[27]=0;
        }
        return buf;
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFIdrive 状态机执行
    // ═══════════════════════════════════════════════════════════════

    _processDSM(stw1) {
        const dsm = this._dsm;
        const bit  = n => !!(stw1 & (1<<n));
        const was  = dsm.state;

        // 故障复位（Bit7 上升沿）
        const stw7Now = bit(7);
        if (stw7Now && !this._prevStw1Bit7 && dsm.state === 'S8') {
            dsm.state = 'S1';
            this._faults = [];
            this._pnLog('info', '故障复位 → S1 上电禁止');
        }
        this._prevStw1Bit7 = stw7Now;

        switch (dsm.state) {
            case 'S1':
                // Bit0=1 → S2
                if (bit(0) && bit(1) && bit(2)) { dsm.state='S2'; break; }
                break;

            case 'S2':
                // Bit0=0 → S1
                if (!bit(0)) { dsm.state='S1'; this._motor.nCmd=0; break; }
                // Bit3=1 → S3
                if (bit(3)) { dsm.state='S3'; break; }
                break;

            case 'S3':
                // Bit0=0 → S2
                if (!bit(0)) { dsm.state='S2'; this._motor.nCmd=0; break; }
                // Bit3=0 → S2
                if (!bit(3)) { dsm.state='S2'; this._motor.nCmd=0; break; }
                // Bit4,5,6=1 → S4（OPERATION）
                if (bit(4) && bit(5) && bit(6)) { dsm.state='S4'; break; }
                break;

            case 'S4':
                // OFF1（Bit0=0）
                if (!bit(0)) { dsm.state='S5'; break; }
                // OFF3（Bit2=0）快速停止
                if (!bit(2)) { dsm.state='S6'; this._motor.nCmd=0; break; }
                // 正常运行：解析速度/位置指令
                this._execControl(stw1);
                break;

            case 'S5':  // 斜坡停止
                this._motor.nCmd = 0;
                if (Math.abs(this._motor.nAct) < 1.0) {
                    dsm.state = 'S1';
                    this._pnLog('info', 'OFF1 停止完成 → S1');
                }
                break;

            case 'S6':  // 快速停止
                this._motor.nCmd = 0;
                if (Math.abs(this._motor.nAct) < 1.0) {
                    dsm.state = 'S1';
                    this._pnLog('info', 'OFF3 快停完成 → S1');
                }
                break;

            case 'S7':  // 故障处理
                if (this._faults.length > 0) dsm.state = 'S8';
                break;

            case 'S8':  // 故障等待复位
                this._motor.nCmd = 0;
                break;
        }

        // 更新状态字符串
        const stateNames = {
            S1:'S1 上电禁止', S2:'S2 准备好上电', S3:'S3 已上电',
            S4:'S4 运行中', S5:'S5 斜坡停止', S6:'S6 快速停止',
            S7:'S7 故障处理', S8:'S8 故障',
        };
        this._stateStr = stateNames[dsm.state] || dsm.state;
        if (dsm.state !== was) this._pnLog('info', `状态: ${was} → ${dsm.state}`);
    }

    /** 运行状态下执行速度/位置控制 */
    _execControl(stw1) {
        const tg  = this._tg;
        const m   = this._motor;
        const bit = n => !!(stw1 & (1<<n));

        if (tg.type === 1 || tg.type === 3) {
            // 速度控制模式
            const nSetPct = tg.nsollA / 16384;
            m.nCmd = nSetPct * m.nRated;

        } else {
            // 报文 111：根据 POS_STW1 决定模式
            const ps1 = tg.posStw1;

            if (ps1 & (1<<5)) {
                // MDI 绝对定位
                m.posTarget = tg.mdiTarpos;
                const velRpm = (tg.mdiVelocity / this._luPerRev);  // LU/min → rpm
                const overridePct = tg.override / 16384;
                m.nCmd = Math.min(velRpm * overridePct, m.nRated * (this._params.p29002/100));

            } else if (ps1 & (1<<6)) {
                // MDI 相对定位
                m.posTarget = m.posAct + tg.mdiTarpos;
                const velRpm = (tg.mdiVelocity / this._luPerRev);
                const overridePct = tg.override / 16384;
                m.nCmd = Math.min(velRpm * overridePct, m.nRated * (this._params.p29002/100));

            } else {
                // 速度控制（直接速度设定）
                const nsollFromVel = tg.mdiVelocity / this._luPerRev;
                m.nCmd = nsollFromVel * (tg.override / 16384);
            }
        }

        // JOG（点动）
        if (bit(8))  { m.nCmd =  this._jogSpeed; }
        if (bit(9))  { m.nCmd = -this._jogSpeed; }
        if (!bit(8) && !bit(9) && tg.type===111 && !(tg.posStw1 & 0x0060)) {
            // 非点动非 MDI：维持 nCmd
        }
    }

    /** 更新 ZSW1（状态字 1） */
    _updateZSW1() {
        const dsm = this._dsm;
        const m   = this._motor;
        let   z   = 0;

        const inS  = s => dsm.state === s;
        const inAny = (...ss) => ss.includes(dsm.state);

        if (inAny('S2','S3','S4','S5','S6'))          z |= (1<<0);  // READY_TO_ON
        if (inAny('S3','S4','S5','S6'))               z |= (1<<1);  // READY
        if (inAny('S4'))                               z |= (1<<2);  // OPERATION_EN
        if (this._faults.length > 0)                   z |= (1<<3);  // FAULT
        if (!inAny('S6'))                              z |= (1<<4);  // NO_OFF2
        if (!inAny('S6'))                              z |= (1<<5);  // NO_OFF3
        if (inAny('S1'))                               z |= (1<<6);  // SWITCH_ON_INH
        if (this._alarms.length > 0)                   z |= (1<<7);  // ALARM

        // Bit8：速度到达（|n_act - n_cmd| < 5%额定）
        if (inS('S4') && Math.abs(m.nAct - m.nCmd) < m.nRated * 0.05) z |= (1<<8);

        z |= (1<<9);   // REMOTE_CTRL（始终 1）

        if (m.nAct >= 0)       z |= (1<<10);  // SPEED_GTE_ZERO
        if (!inS('S8'))        z |= (1<<11);  // MOTOR_CURRENT_OK（简化）
        if (this._hasBrake && inAny('S1','S2')) z |= (1<<12);  // HOLDING_BRAKE
        if (m.mAct > m.mRated * 0.80) z |= (1<<13);  // OVERLOAD_WARN
        if (m.nAct < 0)        z |= (1<<14);  // MOTOR_CCW

        dsm.zsw1 = z & 0xFFFF;
    }

    /** 计算 POS_ZSW1（定位状态字） */
    _calcPosZSW1() {
        const m   = this._motor;
        const tg  = this._tg;
        let   pz  = 0;

        // Bit13：到达目标位置
        if (Math.abs(m.posAct - m.posTarget) < 5) pz |= (1<<13);

        // Bit14：速度到达
        if (Math.abs(m.nAct - m.nCmd) < this._motor.nRated * 0.02) pz |= (1<<14);

        // Bit12：零速
        if (Math.abs(m.nAct) < 10) pz |= (1<<12);

        return pz;
    }

    // ═══════════════════════════════════════════════════════════════
    // 电机物理仿真
    // ═══════════════════════════════════════════════════════════════

    _tickMotor(dtS) {
        const m    = this._motor;
        const ramp = this._ramp;
        const dsm  = this._dsm;

        // ── 斜坡发生器 ──────────────────────────────────────────
        const accRate = m.nRated / this._ramp.accS;  // rpm/s
        const decRate = m.nRated / this._ramp.decS;

        const nTarget = (dsm.state === 'S4') ? m.nCmd : 0.0;
        const dn      = nTarget - ramp.current;

        if (Math.abs(dn) > 0.1) {
            if (dn > 0) ramp.current = Math.min(ramp.current + accRate * dtS, nTarget);
            else        ramp.current = Math.max(ramp.current - decRate * dtS, nTarget);
        } else {
            ramp.current = nTarget;
        }

        // 位置控制：将目标位置转换为速度指令
        if (this._tg.type === 111 && dsm.state === 'S4' && (this._tg.posStw1 & 0x0060)) {
            const posErr = m.posTarget - m.posAct;
            const Kp     = 0.005;  // 位置环增益（rpm/LU）
            const nFromPos = Math.max(-m.nRated, Math.min(m.nRated, Kp * posErr * m.nRated));
            // 到达目标位置（5LU 以内）→ 停止
            if (Math.abs(posErr) < 5) {
                ramp.current = 0;
            } else {
                ramp.current = nFromPos;
            }
        }

        // ── 电机动力学（一阶惯性）──────────────────────────────
        const nCmd_radS  = ramp.current * (2 * Math.PI / 60);  // rpm → rad/s
        const nAct_radS  = m.nAct * (2 * Math.PI / 60);

        // 驱动力矩 = J * dn/dt + B * n
        const driveTorque = (nCmd_radS - nAct_radS) / dtS * m.J;

        // 净力矩 = 驱动 - 负载 - 粘滞摩擦
        const loadDir    = nAct_radS >= 0 ? 1 : -1;
        const netTorque  = driveTorque - m.loadTorque * loadDir - m.B * nAct_radS;

        // 加速度 α = M_net / J
        const alpha = netTorque / m.J;
        const newNact_radS = nAct_radS + alpha * dtS;

        // 限幅到额定
        m.nAct = Math.max(-m.nRated * 1.1, Math.min(m.nRated * 1.1,
            newNact_radS * 60 / (2 * Math.PI)));

        // 实际力矩（用于显示）
        m.mAct = Math.abs(netTorque + m.B * Math.abs(nAct_radS));
        m.mAct = Math.min(m.mAct, m.mRated * 2.0);  // 限幅

        // ── 位置积分 ────────────────────────────────────────────
        // posAct（LU）= posAct + n(rpm)/60 × ratio × luPerRev × dt
        const dPos = (m.nAct / 60) * this._encoder.ratio * this._luPerRev * dtS;
        m.posAct  += dPos;
        this._encoder.pulseCount = Math.round(m.posAct * this._encoder.ppr / this._luPerRev);

        // ── 实际功率 ────────────────────────────────────────────
        m.pAct = Math.abs(m.mAct * nAct_radS);
        m.pAct = Math.min(m.pAct, m.pRated * 2.0);

        // ── 热模型 ──────────────────────────────────────────────
        const heatInput  = m.mAct * Math.abs(nAct_radS) * 0.05 / m.pRated;  // 效率损耗模拟
        const heatDiss   = (m.tempMotor - m.tempAmb) / m.thermalR;
        m.tempMotor += (heatInput - heatDiss / m.thermalTau) * dtS;
        m.tempMotor  = Math.max(m.tempAmb, m.tempMotor);

        // ── 热保护 ──────────────────────────────────────────────
        if (m.tempMotor > 150 && !this._faults.find(f=>f.code==='F07011')) {
            this._triggerFault('F07011', '电机过热（Motor Overtemperature）');
        } else if (m.tempMotor > 120 && !this._alarms.find(a=>a.code==='A07011')) {
            this._triggerAlarm('A07011', '电机温度过高警告');
        } else if (m.tempMotor < 115) {
            this._alarms = this._alarms.filter(a=>a.code!=='A07011');
        }

        // ── 直流母线电压扰动 ────────────────────────────────────
        m.dcBusVoltage += (Math.random()-0.5) * 2;
        m.dcBusVoltage  = Math.max(520, Math.min(560, m.dcBusVoltage));

        // 看门狗超时 → 过压保护触发（仿真）
        if (this._pn.watchdogTripped && !this._faults.find(f=>f.code==='A08505')) {
            this._triggerAlarm('A08505', 'PROFINET 通信中断（看门狗超时）');
        }
    }

    _triggerFault(code, msg) {
        if (this._faults.find(f=>f.code===code)) return;
        this._faults.push({ code, msg, ts: new Date().toLocaleTimeString('zh-CN',{hour12:false}) });
        this._pnLog('error', `故障 ${code}: ${msg}`);
        this._dsm.state = 'S7';
        this._stateStr  = `S7 故障(${code})`;
        this._motor.nCmd = 0;
        this._rebuildDynamic(); this.markDirty();
    }

    _triggerAlarm(code, msg) {
        if (this._alarms.find(a=>a.code===code)) return;
        this._alarms.push({ code, msg, ts: new Date().toLocaleTimeString('zh-CN',{hour12:false}) });
        this._pnLog('warn', `报警 ${code}: ${msg}`);
    }

    /** 故障复位（手动调用） */
    resetFault() {
        this._faults = [];
        this._alarms = this._alarms.filter(a=>a.code!=='A08505');
        if (this._dsm.state === 'S7' || this._dsm.state === 'S8') {
            this._dsm.state = 'S1';
            this._stateStr  = 'S1 上电禁止';
        }
        this._pnLog('info', '手动故障复位');
        this._rebuildDynamic(); this.markDirty();
    }

    // ── 推送输入帧到 Controller ───────────────────────────────────

    _pushToController() {
        const pn  = this._pn;
        if (!pn.arEstablished) return;
        const buf = this._buildInputFrame();

        if (pn.controllerRef) {
            const cpu = pn.controllerRef;
            const dev = cpu._pn?.devices?.find(d => d.moduleRef === this);
            if (dev) {
                dev.inputData.set(buf.slice(0, Math.min(buf.length, dev.inputData.length)));
                dev.rxCount++;
                dev.lastRxTs = performance.now();
                dev.online   = true;

                // 将 ZSW1 和 NIST_A 映射到 Controller IW 区（报文1模式）
                // IW[iBaseAddr]   = ZSW1
                // IW[iBaseAddr+2] = NIST_A
                if (cpu._I && dev.iBaseAddr + 3 < cpu._I.length) {
                    cpu._I[dev.iBaseAddr]     = buf[0];
                    cpu._I[dev.iBaseAddr + 1] = buf[1];
                    cpu._I[dev.iBaseAddr + 2] = buf[10];  // NIST_A hi
                    cpu._I[dev.iBaseAddr + 3] = buf[11];  // NIST_A lo
                }

                // 从 dev.outputData 接收 Controller 输出
                if (dev.outputData.length >= 4) {
                    this._receiveOutputFrame(dev.outputData);
                }
            }
            pn.txFrames++;
        }

        // BroadcastChannel
        if (pn.bcChannel) {
            try {
                pn.bcChannel.postMessage({
                    type:       'pn_input_data',
                    deviceName: pn.stationName,
                    data:       Array.from(buf.slice(0, pn.inputBytes)),
                    cycleCount: pn.cycleCounter,
                });
            } catch(e) {}
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════════════

    _registerPorts() {
        const pp = this._portPos;
        this.addPort(pp['PN_PORT'].x, pp['PN_PORT'].y, 'PN_PORT', 'bus');
        ['U','V','W_','PE','BRK+','BRK-','ENC_A'].forEach(k=>{
            const alias = k === 'W_' ? 'W' : k;
            this.addPort(pp[k].x, pp[k].y, alias, 'wire');
        });
        ['PWR_L1','PWR_L2','PWR_L3','24V','0V'].forEach(k=>{
            this.addPort(pp[k].x, pp[k].y, k, 'wire','p');
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 绘图
    // ═══════════════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    _drawStaticParts() {
        this._drawBody();
        this._drawBrandBar();
        this._drawPNPortBody();
        this._drawLCDFrame();
        this._drawTerminals();
        this._drawNameplate();
        this._drawDINRail();
        this._drawVentSlots();
    }

    _drawBody() {
        const b = this._body;
        // 深炭灰色机身（V90 特有）
        this._staticGroup.add(new Konva.Rect({
            x:b.x, y:b.y, width:b.w, height:b.h,
            fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:b.w,y:0},
            fillLinearGradientColorStops:[0,'#28303a',0.3,'#323c48',0.7,'#2c3640',1,'#22282e'],
            stroke:'#505a68',strokeWidth:1.5,cornerRadius:b.rx,
            shadowColor:'#000',shadowBlur:10,shadowOffsetX:3,shadowOffsetY:4,shadowOpacity:0.35,
        }));
        // 左侧高光
        this._staticGroup.add(new Konva.Rect({
            x:2, y:6, width:3, height:b.h-12,
            fill:'rgba(255,255,255,0.08)', cornerRadius:[b.rx,0,0,b.rx],
        }));
    }

    _drawBrandBar() {
        const W=this.width, H=this.height;
        // SINAMICS 金橙色顶带（V90 标志性）
        this._staticGroup.add(new Konva.Rect({
            x:0, y:0, width:W, height:H*0.060,
            fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:W,y:0},
            fillLinearGradientColorStops:[0,'#c07010',0.5,'#e08820',1,'#c07010'],
            cornerRadius:[4,4,0,0],
        }));
        this._staticGroup.add(new Konva.Text({
            x:5, y:H*0.008, text:'SINAMICS',
            fontSize:Math.max(6,H*0.026),fontFamily:'Arial Narrow, Arial',fontStyle:'bold',
            fill:'#fff',letterSpacing:1,
        }));
        this._staticGroup.add(new Konva.Text({
            x:5, y:H*0.038, text:'V90 PN',
            fontSize:Math.max(5,H*0.018),fontFamily:'Arial Narrow, Arial',
            fill:'#ffeebb',letterSpacing:0.5,
        }));
        // PROFINET 绿色三角标志
        this._staticGroup.add(new Konva.Text({
            x:W*0.56, y:H*0.012, text:'PN',
            fontSize:Math.max(6,H*0.022),fontFamily:'Arial Narrow',fontStyle:'bold',fill:'#88ee44',
        }));
        this._staticGroup.add(new Konva.RegularPolygon({
            x:W*0.88, y:H*0.032,sides:3,radius:H*0.022,fill:'#88ee44',stroke:'#44bb22',strokeWidth:0.8,
        }));
    }

    _drawPNPortBody() {
        const W=this.width, H=this.height;
        const p=this._pnPortArea;
        // PN RJ45 口
        this._staticGroup.add(new Konva.Rect({
            x:p.x, y:p.y, width:p.w, height:p.h,
            fill:'#1a2818',stroke:'#2a5028',strokeWidth:1.2,cornerRadius:2,
        }));
        for(let k=0;k<8;k++){
            this._staticGroup.add(new Konva.Rect({
                x:p.x+p.w*(0.06+k*0.112), y:p.y+p.h*0.20,
                width:p.w*0.075, height:p.h*0.55, fill:'#c8b040',
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x:p.x, y:p.y+p.h+2, text:'PROFINET',
            fontSize:Math.max(5,H*0.016),fontFamily:'Arial',fontStyle:'bold',
            fill:'#44aa44',align:'center',width:p.w,
        }));
        // LED 标签
        const ll=this._pnLinkLED, la=this._pnActLED;
        this._staticGroup.add(new Konva.Text({ x:ll.x-7, y:ll.y+ll.r+2, text:'LNK', fontSize:Math.max(4,H*0.013),fontFamily:'Arial',fill:'#336633' }));
        this._staticGroup.add(new Konva.Text({ x:la.x-7, y:la.y+la.r+2, text:'ACT', fontSize:Math.max(4,H*0.013),fontFamily:'Arial',fill:'#336633' }));
        // 状态 LED 标签
        const leds=this._leds, fs=Math.max(4,H*0.013);
        [['RDY','#336633'],['RUN','#336633'],['ALM','#663333'],['BRK','#554400'],['PN','#336633']].forEach(([lbl,col],i)=>{
            const led=[leds.rdy,leds.run,leds.alm,leds.brk,leds.pn][i];
            this._staticGroup.add(new Konva.Text({ x:led.x-8, y:led.y+led.r+2, text:lbl, fontSize:fs,fontFamily:'Arial',fill:col }));
        });
    }

    _drawLCDFrame() {
        const lcd=this._lcd;
        // LCD 黑色边框
        this._staticGroup.add(new Konva.Rect({
            x:lcd.x-2, y:lcd.y-2, width:lcd.w+4, height:lcd.h+4,
            fill:'#0a0a0a',stroke:'#3a3a3a',strokeWidth:1,cornerRadius:2,
        }));
    }

    _drawTerminals() {
        const W=this.width, H=this.height;
        const t=this._terminals;
        this._staticGroup.add(new Konva.Rect({
            x:t.x, y:t.y, width:t.w, height:t.h,
            fill:'#1a1a1a',stroke:'#111',strokeWidth:0.8,cornerRadius:2,
        }));
        // 端子孔（U/V/W/PE + BRK+/- + ENC）
        const termDefs = [
            {label:'U',  col:'#cc6600'},{label:'V',  col:'#cc6600'},{label:'W',  col:'#cc6600'},
            {label:'PE', col:'#44aa44'},{label:'B+',col:'#cccc00'},{label:'B-',col:'#cccc00'},
            {label:'ENC',col:'#6688cc'},
        ];
        termDefs.forEach((td,i)=>{
            const tx=t.x+t.w*(0.04+i*0.135);
            this._staticGroup.add(new Konva.Rect({ x:tx, y:t.y+t.h*0.14, width:t.w*0.100, height:t.h*0.72, fill:'#555',stroke:'#444',strokeWidth:0.4,cornerRadius:1 }));
            this._staticGroup.add(new Konva.Text({ x:tx-2, y:t.y-H*0.018, text:td.label, fontSize:Math.max(4,H*0.014),fontFamily:'Arial',fill:td.col }));
        });
    }

    _drawNameplate() {
        const np=this._nameplate,H=this.height;
        this._staticGroup.add(new Konva.Rect({ x:np.x, y:np.y, width:np.w, height:np.h, fill:'#e8e4d8',stroke:'#a0a098',strokeWidth:0.6,cornerRadius:1 }));
        this._staticGroup.add(new Konva.Text({ x:np.x+3, y:np.y+2, text:`SINAMICS V90 PN  ${this._pn.orderNumber}`, fontSize:Math.max(4,H*0.014),fontFamily:'Consolas, monospace',fill:'#333' }));
        this._staticGroup.add(new Konva.Text({ x:np.x+3, y:np.y+np.h*0.52,
            text:`${this._motor.pRated}W  ${this._motor.nRated}rpm  ${this._motor.mRated}N·m`,
            fontSize:Math.max(4,H*0.013),fontFamily:'Consolas, monospace',fill:'#555' }));
    }

    _drawDINRail() {
        const dr=this._dinRail;
        this._staticGroup.add(new Konva.Rect({ x:dr.x, y:dr.y, width:dr.w, height:dr.h, fill:'#505860',stroke:'#404850',strokeWidth:0.5,cornerRadius:[0,0,4,4] }));
        [0.10,0.86].forEach(px=>{
            this._staticGroup.add(new Konva.Rect({ x:dr.x+dr.w*px, y:dr.y, width:dr.w*0.06, height:dr.h*0.65, fill:'#404858',stroke:'#303848',strokeWidth:0.4,cornerRadius:[0,0,2,2] }));
        });
    }

    _drawVentSlots() {
        this._ventSlots.forEach(vs=>{
            this._staticGroup.add(new Konva.Rect({ x:vs.x, y:vs.y, width:vs.w, height:vs.h, fill:'#1a2028',stroke:'#303848',strokeWidth:0.4,cornerRadius:1 }));
        });
    }

    // ─────────────────────────────────────────────────────────────
    // 动态部件
    // ─────────────────────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawPNLEDs_dyn();
        this._drawStatusLEDs_dyn();
        this._drawLCD_dyn();
        this._drawStateBar_dyn();
        this._drawControlWords_dyn();
        this._drawSpeedWave_dyn();
        this._drawParamBars_dyn();
        this._drawFaultBar_dyn();
        this._drawLabelText_dyn();
    }

    _drawLED(x, y, r, on, col_on, col_off) {
        this._dynamicGroup.add(new Konva.Circle({
            x, y, radius:r,
            fill:   on ? col_on  : col_off,
            stroke: on ? '#999'  : '#333', strokeWidth:0.7,
            shadowColor: on ? col_on : 'transparent',
            shadowBlur:  on ? r*3.5 : 0, shadowOpacity:0.9,
        }));
    }

    _drawPNLEDs_dyn() {
        const pn=this._pn;
        const ll=this._pnLinkLED, la=this._pnActLED;
        this._drawLED(ll.x,ll.y,ll.r, pn.p1.link, '#44dd44','#002200');
        const actBlink=pn.p1.link&&(Math.floor(performance.now()/100)%2===0);
        this._drawLED(la.x,la.y,la.r, actBlink,   '#f07030','#1a0500');
    }

    _drawStatusLEDs_dyn() {
        const dsm=this._dsm, pn=this._pn, m=this._motor;
        const leds=this._leds;
        const inOp = dsm.state==='S4';
        const hasFlt= this._faults.length>0;
        const hasAlm= this._alarms.length>0;
        const isRdy = ['S2','S3','S4'].includes(dsm.state);

        this._drawLED(leds.rdy.x,leds.rdy.y,leds.rdy.r, isRdy,   '#44cc44','#002200');
        // RUN 闪烁（运行中且速度>0）
        const runBlink=inOp&&Math.abs(m.nAct)>10&&(Math.floor(performance.now()/200)%2===0);
        this._drawLED(leds.run.x,leds.run.y,leds.run.r, runBlink||inOp,'#44cc44','#002200');
        // 故障红色闪烁
        const fltBlink=hasFlt&&(Math.floor(performance.now()/300)%2===0);
        this._drawLED(leds.alm.x,leds.alm.y,leds.alm.r, fltBlink||hasAlm,'#ee4444','#220000');
        // 抱闸（停止时接合）
        const brkOn=this._hasBrake&&['S1','S2'].includes(dsm.state);
        this._drawLED(leds.brk.x,leds.brk.y,leds.brk.r, brkOn,'#f5c842','#221500');
        // PN 连接
        this._drawLED(leds.pn.x,leds.pn.y,leds.pn.r, pn.arEstablished,'#44cc44','#002200');
    }

    _drawLCD_dyn() {
        const lcd=this._lcd, H=this.height, m=this._motor;
        // LCD 背景
        this._dynamicGroup.add(new Konva.Rect({
            x:lcd.x, y:lcd.y, width:lcd.w, height:lcd.h,
            fill:'#050e08', cornerRadius:1,
        }));
        // 扫描线
        for (let i=0; i<Math.floor(lcd.h/2.5); i++) {
            this._dynamicGroup.add(new Konva.Rect({ x:lcd.x, y:lcd.y+i*2.5, width:lcd.w, height:1, fill:'rgba(0,20,8,0.20)', listening:false }));
        }

        const fs   = Math.max(8, H*0.032);
        const lineH= lcd.h / 4.2;
        const green= '#44dd88';
        const dim  = '#1a5a30';

        const lines = [
            { label:'n', val: m.nAct.toFixed(0).padStart(5), unit:'rpm',  color:green },
            { label:'M', val: (m.mAct/m.mRated*100).toFixed(1).padStart(5), unit:'%', color:Math.abs(m.mAct/m.mRated)>0.8?'#f5c842':green },
            { label:'P', val: m.pAct.toFixed(0).padStart(5),  unit:'W',   color:green },
            { label:'T', val: m.tempMotor.toFixed(1).padStart(5),unit:'°C',color:m.tempMotor>100?'#f07030':m.tempMotor>80?'#f5c842':green },
        ];

        lines.forEach((ln, i) => {
            const y = lcd.y + lineH*(i+0.25);
            this._dynamicGroup.add(new Konva.Text({
                x:lcd.x+4, y,
                text: `${ln.label}:`,
                fontSize:fs, fontFamily:'Consolas, monospace', fill:dim,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x:lcd.x+lcd.w*0.25, y,
                text: ln.val,
                fontSize:fs, fontFamily:'Consolas, monospace', fontStyle:'bold', fill:ln.color,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x:lcd.x+lcd.w*0.78, y,
                text: ln.unit,
                fontSize:Math.max(6,H*0.022), fontFamily:'Arial', fill:dim,
            }));
        });

        // 位置值（小字，底部）
        const posStr = `pos:${this._motor.posAct.toFixed(0)} LU`;
        this._dynamicGroup.add(new Konva.Text({
            x:lcd.x+lcd.w*0.55, y:lcd.y+lcd.h-H*0.016,
            text:posStr, fontSize:Math.max(5,H*0.015), fontFamily:'Consolas, monospace', fill:'#1a5a30',
        }));
    }

    _drawStateBar_dyn() {
        const sb=this._stateBar, H=this.height, dsm=this._dsm;
        const stateColors={ S1:'#555',S2:'#4488cc',S3:'#44aa88',S4:'#44cc44',S5:'#f5c842',S6:'#f07030',S7:'#ee8800',S8:'#ee4444' };
        const col = stateColors[dsm.state] || '#555';
        this._dynamicGroup.add(new Konva.Rect({ x:sb.x, y:sb.y, width:sb.w, height:sb.h, fill:'#060c0a', stroke:'#1a3020', strokeWidth:0.6, cornerRadius:1 }));
        this._dynamicGroup.add(new Konva.Text({
            x:sb.x+4, y:sb.y+sb.h*0.15,
            text:this._stateStr,
            fontSize:Math.max(7,H*0.025), fontFamily:'Consolas, monospace', fontStyle:'bold', fill:col,
        }));
        // 报文类型标签
        this._dynamicGroup.add(new Konva.Text({
            x:sb.x+sb.w*0.60, y:sb.y+sb.h*0.15,
            text:`TG${this._tg.type} | ${this._pn.arEstablished?'DATA_EX':'OFFLINE'}`,
            fontSize:Math.max(5,H*0.016), fontFamily:'Consolas, monospace', fill:'#2a5a40',
        }));
    }

    _drawControlWords_dyn() {
        const H=this.height;
        this._drawWordBits(this._stw1Bar, this._dsm.stw1, 'STW1', '#2a9fd8', H);
        this._drawWordBits(this._zsw1Bar, this._dsm.zsw1, 'ZSW1', '#44dd88', H);
    }

    _drawWordBits(area, word, label, color, H) {
        this._dynamicGroup.add(new Konva.Rect({ x:area.x, y:area.y, width:area.w, height:area.h, fill:'#040a08', stroke:'#1a2a20', strokeWidth:0.5, cornerRadius:1 }));
        const fs=Math.max(4,H*0.012);
        this._dynamicGroup.add(new Konva.Text({ x:area.x+2, y:area.y+area.h*0.15, text:label, fontSize:Math.max(5,H*0.014), fontFamily:'Consolas', fontStyle:'bold', fill:color }));
        for (let b=15; b>=0; b--) {
            const on = !!(word & (1<<b));
            const idx = 15-b;
            const bx  = area.x + area.w*0.16 + idx*(area.w*0.052);
            this._dynamicGroup.add(new Konva.Rect({
                x:bx, y:area.y+area.h*0.15,
                width:area.w*0.042, height:area.h*0.70,
                fill: on ? color : '#0e1a14', stroke:'#1a3020', strokeWidth:0.4,
            }));
        }
    }

    _drawSpeedWave_dyn() {
        const wa=this._waveArea, m=this._motor, H=this.height;
        this._dynamicGroup.add(new Konva.Rect({ x:wa.x, y:wa.y, width:wa.w, height:wa.h, fill:'#030808', stroke:'#1a2820', strokeWidth:0.5, cornerRadius:1 }));
        // 零线
        const zeroY = wa.y + wa.h/2;
        this._dynamicGroup.add(new Konva.Line({ points:[wa.x+2,zeroY, wa.x+wa.w-2,zeroY], stroke:'#0e2018', strokeWidth:0.5, listening:false }));
        // 速度曲线（绿色）
        const hist = this._speedHist;
        const ptr  = this._speedHistPtr;
        const n    = hist.length;
        const pts  = [];
        for (let k=0;k<n;k++) {
            const hi  = (ptr+k)%n;
            const spd = hist[hi];
            const px  = wa.x+2 + (k/(n-1))*(wa.w-4);
            const py  = zeroY - (spd/m.nRated) * (wa.h/2 - 2);
            pts.push(px,py);
        }
        if (pts.length>=4) {
            this._dynamicGroup.add(new Konva.Line({ points:pts, stroke:'#44dd88', strokeWidth:1.0, lineCap:'round', lineJoin:'round', tension:0.2, listening:false }));
        }
        // 转矩曲线（橙色，较细）
        const tpts=[];
        for (let k=0;k<n;k++) {
            const hi  = (ptr+k)%n;
            const trq = this._torqueHist[hi];
            const px  = wa.x+2 + (k/(n-1))*(wa.w-4);
            const py  = zeroY - (trq/m.mRated/2) * (wa.h/2 - 2);
            tpts.push(px,py);
        }
        if (tpts.length>=4) {
            this._dynamicGroup.add(new Konva.Line({ points:tpts, stroke:'#f07030', strokeWidth:0.8, lineCap:'round', lineJoin:'round', tension:0.2, opacity:0.7, listening:false }));
        }
        // 图例
        const fs=Math.max(4,H*0.013);
        this._dynamicGroup.add(new Konva.Line({ points:[wa.x+3,wa.y+3,wa.x+12,wa.y+3], stroke:'#44dd88', strokeWidth:1.5 }));
        this._dynamicGroup.add(new Konva.Text({ x:wa.x+14, y:wa.y+0, text:'n(rpm)', fontSize:fs, fontFamily:'Consolas', fill:'#44dd88' }));
        this._dynamicGroup.add(new Konva.Line({ points:[wa.x+3,wa.y+H*0.015,wa.x+12,wa.y+H*0.015], stroke:'#f07030', strokeWidth:1.2 }));
        this._dynamicGroup.add(new Konva.Text({ x:wa.x+14, y:wa.y+H*0.012, text:'M(%)', fontSize:fs, fontFamily:'Consolas', fill:'#f07030' }));
    }

    _drawParamBars_dyn() {
        const pa=this._paramArea, m=this._motor, H=this.height;
        const fs=Math.max(5,H*0.016);

        // 位置进度条（-2M ~ +2M LU）
        const pos_range=2000000;
        const posPct=Math.max(0,Math.min(1,(m.posAct+pos_range)/(pos_range*2)));
        const barW=pa.w*0.55;
        this._dynamicGroup.add(new Konva.Rect({ x:pa.x, y:pa.y, width:pa.w, height:pa.h, fill:'#050c08', stroke:'#1a2820',strokeWidth:0.5,cornerRadius:1 }));
        this._dynamicGroup.add(new Konva.Text({ x:pa.x+2, y:pa.y+pa.h*0.05, text:`pos: ${m.posAct.toFixed(0)} LU`, fontSize:fs,fontFamily:'Consolas',fill:'#44dd88' }));
        this._dynamicGroup.add(new Konva.Rect({ x:pa.x+pa.w*0.36, y:pa.y+pa.h*0.06, width:barW, height:pa.h*0.40, fill:'#0a1a10',stroke:'#1a3020',strokeWidth:0.3,cornerRadius:2 }));
        if (posPct>0) this._dynamicGroup.add(new Konva.Rect({ x:pa.x+pa.w*0.36, y:pa.y+pa.h*0.06, width:barW*posPct, height:pa.h*0.40, fill:'#44aa66',cornerRadius:2 }));

        // 速度进度条
        const nPct=Math.abs(m.nAct)/m.nRated;
        this._dynamicGroup.add(new Konva.Text({ x:pa.x+2, y:pa.y+pa.h*0.52, text:`n:   ${m.nAct.toFixed(0)} rpm`, fontSize:fs,fontFamily:'Consolas',fill:'#44dd88' }));
        this._dynamicGroup.add(new Konva.Rect({ x:pa.x+pa.w*0.36, y:pa.y+pa.h*0.56, width:barW, height:pa.h*0.36, fill:'#0a1a10',stroke:'#1a3020',strokeWidth:0.3,cornerRadius:2 }));
        if (nPct>0) this._dynamicGroup.add(new Konva.Rect({ x:pa.x+pa.w*0.36, y:pa.y+pa.h*0.56, width:barW*Math.min(1,nPct), height:pa.h*0.36, fill:nPct>1?'#f07030':'#44dd88',cornerRadius:2 }));

        // 目标位置/速度标注（右侧）
        this._dynamicGroup.add(new Konva.Text({ x:pa.x+pa.w*0.92, y:pa.y+pa.h*0.05, text:`→${m.posTarget.toFixed(0)}`, fontSize:Math.max(4,H*0.013),fontFamily:'Consolas',fill:'#1a5a30' }));
        this._dynamicGroup.add(new Konva.Text({ x:pa.x+pa.w*0.92, y:pa.y+pa.h*0.52, text:`→${m.nCmd.toFixed(0)}`,      fontSize:Math.max(4,H*0.013),fontFamily:'Consolas',fill:'#1a5a30' }));
    }

    _drawFaultBar_dyn() {
        const fb=this._faultBar, H=this.height;
        const hasFlt=this._faults.length>0, hasAlm=this._alarms.length>0;
        const bgCol = hasFlt?'rgba(238,68,68,0.10)':hasAlm?'rgba(245,200,66,0.07)':'#040c08';
        const bdCol = hasFlt?'rgba(238,68,68,0.35)':hasAlm?'rgba(245,200,66,0.25)':'#1a2820';

        this._dynamicGroup.add(new Konva.Rect({ x:fb.x, y:fb.y, width:fb.w, height:fb.h, fill:bgCol, stroke:bdCol, strokeWidth:0.6, cornerRadius:1 }));

        const fs=Math.max(5,H*0.016);
        if (hasFlt) {
            const f=this._faults[0];
            this._dynamicGroup.add(new Konva.Text({
                x:fb.x+3, y:fb.y+fb.h*0.10,
                text:`⚠ ${f.code}: ${f.msg}`,
                fontSize:fs, fontFamily:'Consolas, monospace', fill:'#ee6644',
                width:fb.w-6,
            }));
        } else if (hasAlm) {
            const a=this._alarms[0];
            this._dynamicGroup.add(new Konva.Text({
                x:fb.x+3, y:fb.y+fb.h*0.10,
                text:`△ ${a.code}: ${a.msg}`,
                fontSize:fs, fontFamily:'Consolas, monospace', fill:'#f5c842',
                width:fb.w-6,
            }));
        } else {
            this._dynamicGroup.add(new Konva.Text({
                x:fb.x+3, y:fb.y+fb.h*0.10,
                text:'  No Fault / No Alarm',
                fontSize:fs, fontFamily:'Consolas, monospace', fill:'#1a5a30',
            }));
        }
    }

    _drawLabelText_dyn() {
        const W=this.width, H=this.height;
        this._dynamicGroup.add(new Konva.Text({
            x:W*0.50, y:H*0.032, text:this.label,
            fontSize:Math.max(6,H*0.022), fontFamily:'Arial', fontStyle:'bold', fill:'rgba(255,255,255,0.9)',
        }));
        this._dynamicGroup.add(new Konva.Text({
            x:W*0.04, y:H*0.062, text:`${this._pn.ip}  ${this._pn.stationName}`,
            fontSize:Math.max(4,H*0.013), fontFamily:'Consolas', fill:'#a07820',
        }));
    }

    // ── 交互绑定 ─────────────────────────────────────────────────────

    _bindInteraction() {
        const W=this.width, H=this.height;

        // PN 端口点击：连接/断开
        const p=this._pnPortArea;
        const pnHit=new Konva.Rect({ x:p.x, y:p.y, width:p.w, height:p.h, fill:'transparent' });
        pnHit.on('click tap', ()=>{
            if (this._pn.state==='OFFLINE') {
                if (this._pn.controllerRef) this.connectToController(this._pn.controllerRef);
                else this._pnLog('warn','请先绑定 Controller: connectToController(cpu)');
            } else this.disconnectFromController();
        });
        this._interactGroup.add(pnHit);

        // LCD 点击：点动使能切换
        const lcd=this._lcd;
        const lcdHit=new Konva.Rect({ x:lcd.x, y:lcd.y, width:lcd.w, height:lcd.h, fill:'transparent' });
        lcdHit.on('click tap', ()=>{
            // 手动切换 S4 运行状态（模拟全使能 STW1=0x047F）
            if (this._dsm.state==='S4') {
                this._processDSM(0x0000);  // OFF1
            } else if (this._dsm.state==='S3'||this._dsm.state==='S2') {
                this._processDSM(0x047F);  // 全使能
            }
        });
        this._interactGroup.add(lcdHit);

        // 故障复位按钮（故障条点击）
        const fb=this._faultBar;
        const faultHit=new Konva.Rect({ x:fb.x, y:fb.y, width:fb.w, height:fb.h, fill:'transparent' });
        faultHit.on('click tap', ()=>{ if (this._faults.length>0) this.resetFault(); });
        this._interactGroup.add(faultHit);
    }

    // ═══════════════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════════════

    tick(dt) {
        const dtMs = dt * 1000;

        // 调度器
        this._pnTickScheduler();

        // 启动序列定时器
        if (this._pn.startupTimer > 0) {
            this._pn.startupTimer -= dtMs;
            if (this._pn.startupTimer <= 0) {
                this._pn.startupTimer = 0;
                this._handleAREstablish(this._pn.controllerIP);
            }
        }

        // 电机物理仿真
        this._tickMotor(dt);

        // 波形历史采样
        this._speedHist[this._speedHistPtr] = this._motor.nAct;
        this._torqueHist[this._speedHistPtr] = this._motor.mAct;
        this._speedHistPtr = (this._speedHistPtr + 1) % this._speedHist.length;

        // PROFINET 周期数据交换
        const pn = this._pn;
        if (pn.state === 'DATA_EXCHANGE') {
            pn.accumCycleMs += dtMs;
            const cyclePeriod = Math.max(1, pn.sendClockMs);
            if (pn.accumCycleMs >= cyclePeriod) {
                pn.accumCycleMs -= cyclePeriod;
                const now = performance.now();
                if (pn.lastCycleTs > 0) pn.measuredCycleUs = (now - pn.lastCycleTs) * 1000;
                pn.lastCycleTs   = now;
                pn.cycleCounter  = (pn.cycleCounter + 1) & 0xFFFF || 1;
                pn.txFrames++;
                pn.p1.act        = (pn.txFrames % 4 < 2);
                this._pushToController();
            }

            // 看门狗检测
            if (pn.lastRxTs > 0 && (performance.now() - pn.lastRxTs) > pn.watchdogMs) {
                if (!pn.watchdogTripped) {
                    pn.watchdogTripped = true;
                    this._motor.nCmd   = 0;
                    if (this._dsm.state === 'S4') {
                        this._dsm.state = 'S5';  // OFF1 斜坡停
                        this._stateStr  = 'S5 斜坡停止（通信超时）';
                    }
                    this._pnLog('error', `看门狗超时（${pn.watchdogMs}ms），执行安全停止`);
                    this._rebuildDynamic(); this.markDirty();
                }
            }
        }

        // 动态层重建
        this._rebuildDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    _pnTickScheduler() {
        const now = performance.now();
        this._pnSchedulerQueue = this._pnSchedulerQueue.filter(item => {
            if (now >= item.fireAt) { item.cb(); return false; }
            return true;
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════════

    // ── PROFINET 连接 ─────────────────────────────────────────────

    /** 连接 Controller（已在上方定义，此处列出签名） */
    // connectToController(controllerCPU, opts)
    // connectToCPU(cpu)  → connectToController 别名
    // disconnectFromController()

    // ── 驱动控制 ─────────────────────────────────────────────────

    /** 手动写入 STW1（仿真直接操作控制字） */
    writeSTW1(stw1) {
        this._tg.stw1 = stw1 & 0xFFFF;
        this._receiveOutputFrame(new Uint8Array([
            (stw1>>8)&0xFF, stw1&0xFF, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]));
    }

    /** 设置速度指令（rpm） */
    setSpeedSetpoint(nRpm) {
        const nRated = this._motor.nRated;
        const nsollA = Math.round(Math.max(-nRated, Math.min(nRated, nRpm)) / nRated * 16384);
        const buf = new Uint8Array(4);
        buf[0] = 0x04; buf[1] = 0x7F;  // STW1 = 0x047F（全使能）
        const u = nsollA < 0 ? nsollA + 65536 : nsollA;
        buf[2] = (u>>8)&0xFF; buf[3] = u&0xFF;
        this._receiveOutputFrame(buf);
    }

    /** 设置目标位置（LU） */
    setPositionTarget(posLU, velocityLUmin) {
        const buf = new Uint8Array(20);
        buf[0] = 0x04; buf[1] = 0x7F;  // STW1
        buf[2] = 0x00; buf[3] = (1<<5); // POS_STW1: MDI 绝对定位
        buf[4] = 0; buf[5] = 0;
        buf[6] = 0x40; buf[7] = 0x00;  // OVERRIDE = 16384（100%）
        const pos = Math.round(posLU);
        const pU  = pos < 0 ? pos + 0x100000000 : pos;
        buf[8]=(pU>>>24)&0xFF; buf[9]=(pU>>>16)&0xFF;
        buf[10]=(pU>>>8)&0xFF; buf[11]=pU&0xFF;
        const vel = Math.round(velocityLUmin || this._params.p29019);
        buf[12]=(vel>>>24)&0xFF; buf[13]=(vel>>>16)&0xFF;
        buf[14]=(vel>>>8)&0xFF; buf[15]=vel&0xFF;
        buf[16]=0x40; buf[17]=0x00;  // MDI_ACC = 16384
        buf[18]=0x40; buf[19]=0x00;  // MDI_DEC = 16384
        this._receiveOutputFrame(buf);
    }

    /** JOG 点动 */
    jogForward()  { this.writeSTW1(0x047F | (1<<8)); }
    jogBackward() { this.writeSTW1(0x047F | (1<<9)); }
    jogStop()     { this.writeSTW1(0x047F & ~(1<<8) & ~(1<<9)); }

    /** 使能/停止 */
    enable()  { this.writeSTW1(0x047F); }  // 全使能
    disable() { this.writeSTW1(0x0476); }  // OFF1

    /** 快速停止 */
    quickStop() { this.writeSTW1(0x0473); }  // STW1.Bit2=0

    /** 故障复位 */
    resetFault() {
        this._faults = [];
        this._alarms = this._alarms.filter(a=>a.code!=='A08505');
        if (['S7','S8'].includes(this._dsm.state)) {
            this._dsm.state = 'S1';
            this._stateStr  = 'S1 上电禁止';
        }
        this._pnLog('info', '故障复位');
        this._rebuildDynamic(); this.markDirty();
    }

    // ── 参数读写 ──────────────────────────────────────────────────

    /** 读取 P 参数 */
    getParam(pNum) { return this._params[`p${pNum}`] ?? null; }

    /** 写入 P 参数 */
    setParam(pNum, val) {
        this._params[`p${pNum}`] = val;
        // 特殊参数处理
        if (pNum === 1300) {
            this._pnLog('info', `P1300 = ${val}（控制模式: ${val===0?'速度':'位置'}）`);
        }
    }

    /** 设置负载转矩 */
    setLoadTorque(nm) { this._motor.loadTorque = Math.max(0, nm); }

    /** 设置报文类型 */
    setTelegramType(type) {
        if ([1,3,111].includes(type)) {
            this._tg.type = type;
            this._pnLog('info', `切换为报文 ${type}`);
        }
    }

    /** 设置额定参数 */
    setMotorParams(params) {
        if (params.nRated)     this._motor.nRated    = params.nRated;
        if (params.mRated)     this._motor.mRated    = params.mRated;
        if (params.pRated)     this._motor.pRated    = params.pRated;
        if (params.J)          this._motor.J         = params.J;
        if (params.loadTorque) this._motor.loadTorque= params.loadTorque;
        if (params.accRampS)   this._ramp.accS       = params.accRampS;
        if (params.decRampS)   this._ramp.decS       = params.decRampS;
    }

    // ── 状态读取 ──────────────────────────────────────────────────

    getActualSpeed()    { return this._motor.nAct; }
    getActualPosition() { return this._motor.posAct; }
    getActualTorque()   { return this._motor.mAct; }
    getActualPower()    { return this._motor.pAct; }
    getMotorTemp()      { return this._motor.tempMotor; }
    getDCBusVoltage()   { return this._motor.dcBusVoltage; }
    getSTW1()           { return this._dsm.stw1; }
    getZSW1()           { return this._dsm.zsw1; }
    getDriveState()     { return this._dsm.state; }
    getFaults()         { return [...this._faults]; }
    getAlarms()         { return [...this._alarms]; }
    isOnline()          { return this._pn.arEstablished; }
    isRunning()         { return this._dsm.state === 'S4'; }
    isAtSetpoint()      { return !!(this._dsm.zsw1 & (1<<8)); }

    getPNStatus() {
        return {
            state:           this._pn.state,
            connected:       this._pn.arEstablished,
            stationName:     this._pn.stationName,
            ip:              this._pn.ip,
            mac:             this._pn.mac,
            txFrames:        this._pn.txFrames,
            rxFrames:        this._pn.rxFrames,
            cycleUs:         this._pn.measuredCycleUs,
            watchdogTripped: this._pn.watchdogTripped,
            telegramType:    this._tg.type,
            diagBuffer:      this._pn.diagBuffer.slice(0,16),
        };
    }

    getDriveSnapshot() {
        const m=this._motor;
        return {
            state:      this._dsm.state,
            stw1:       this._dsm.stw1,
            zsw1:       this._dsm.zsw1,
            nAct:       m.nAct,
            nCmd:       m.nCmd,
            mAct:       m.mAct,
            pAct:       m.pAct,
            posAct:     m.posAct,
            posTarget:  m.posTarget,
            tempMotor:  m.tempMotor,
            dcBus:      m.dcBusVoltage,
            faults:     [...this._faults],
            alarms:     [...this._alarms],
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label:'位号',             key:'label',          type:'text'   },
            { label:'PN 站名',          key:'pnStationName',  type:'text'   },
            { label:'PN IP 地址',       key:'pnIP',           type:'text'   },
            { label:'PN 子网掩码',      key:'pnSubnet',       type:'text'   },
            { label:'PN 网关',          key:'pnGateway',      type:'text'   },
            { label:'PROFIdrive 报文',  key:'telegramType',   type:'select', options:['1','3','111'] },
            { label:'额定转速 (rpm)',    key:'ratedSpeed',     type:'number' },
            { label:'额定转矩 (N·m)',   key:'ratedTorque',    type:'number' },
            { label:'额定功率 (W)',      key:'ratedPower',     type:'number' },
            { label:'加速时间 (s)',      key:'accRampS',       type:'number' },
            { label:'减速时间 (s)',      key:'decRampS',       type:'number' },
            { label:'点动速度 (rpm)',    key:'jogSpeedRpm',    type:'number' },
            { label:'负载转矩 (N·m)',   key:'loadTorqueNm',   type:'number' },
            { label:'看门狗 (ms)',      key:'watchdogMs',     type:'number' },
            { label:'带抱闸',           key:'hasBrake',       type:'number' },
            { label:'PN Channel 名',    key:'pnChannelName',  type:'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label         !== undefined) this.label                = cfg.label;
        if (cfg.pnStationName !== undefined) this._pn.stationName      = cfg.pnStationName;
        if (cfg.pnIP          !== undefined) this._pn.ip               = cfg.pnIP;
        if (cfg.pnSubnet      !== undefined) this._pn.subnet           = cfg.pnSubnet;
        if (cfg.pnGateway     !== undefined) this._pn.gateway          = cfg.pnGateway;
        if (cfg.telegramType  !== undefined) this.setTelegramType(parseInt(cfg.telegramType));
        if (cfg.ratedSpeed    !== undefined) this._motor.nRated        = parseFloat(cfg.ratedSpeed)||3000;
        if (cfg.ratedTorque   !== undefined) this._motor.mRated        = parseFloat(cfg.ratedTorque)||2.39;
        if (cfg.ratedPower    !== undefined) this._motor.pRated        = parseFloat(cfg.ratedPower)||750;
        if (cfg.accRampS      !== undefined) this._ramp.accS           = Math.max(0.1,parseFloat(cfg.accRampS)||1);
        if (cfg.decRampS      !== undefined) this._ramp.decS           = Math.max(0.1,parseFloat(cfg.decRampS)||1);
        if (cfg.jogSpeedRpm   !== undefined) this._jogSpeed            = parseFloat(cfg.jogSpeedRpm)||200;
        if (cfg.loadTorqueNm  !== undefined) this._motor.loadTorque    = parseFloat(cfg.loadTorqueNm)||0.5;
        if (cfg.watchdogMs    !== undefined) this._pn.watchdogMs       = Math.max(100,parseFloat(cfg.watchdogMs)||3000);
        if (cfg.hasBrake      !== undefined) this._hasBrake            = !!parseInt(cfg.hasBrake);
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        this.disconnectFromController();
        this._pn.bcChannel?.close();
        super.destroy?.();
    }
}
