import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 SINAMICS G120 变频器仿真组件（含 CU250S-2 PN 控制单元）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  硬件规格（G120 CU250S-2 PN + PM240-2 功率模块）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  控制单元：CU250S-2 PN（6SL3246-0BA22-1PA0）
 *    - PROFINET IO Device（集成双口 PN 交换机，P1/P2）
 *    - 支持 PROFIdrive 规范（报文 1/20/350/352/750/820）
 *    - 本体数字量输入：5 路（24V DC，DI0~DI4）
 *    - 本体数字量输出：1 路（DO0，继电器，30V DC/0.5A）
 *    - 本体模拟量输入：2 路（AI0/AI1，±10V 或 0~20mA）
 *    - 本体模拟量输出：2 路（AO0/AO1，0~20mA）
 *    - 编码器接口：HTL/TTL 增量编码器（X3 端子）
 *    - 存储卡：内置（参数保存）
 *    - USS 通信：X2 端子（RS-485）
 *    - BOP-2 操作面板：可拆卸（前面板）
 *
 *  功率模块：PM240-2（0.75kW~250kW，本仿真以 7.5kW 为例）
 *    - 型号：6SL3210-1PE21-4UL0（7.5kW，400V，3相）
 *    - 输入：3AC 380~480V，50/60Hz
 *    - 输出：0~500Hz，7.5kW
 *    - 效率：97.5%
 *    - 保护等级：IP55
 *
 * ══════════════════════════════════════════════════════════════════════
 *  PROFINET IO Device 实现（PROFIdrive 规范 V4.2）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  设备标识：
 *    VendorID  : 0x002A（Siemens）
 *    DeviceID  : 0x0409（SINAMICS G120/G120C）
 *    Station Name: 'g120-vfd'（可配）
 *    IP        : 192.168.0.10（可配）
 *
 *  支持的 PROFIdrive 报文（Telegram）：
 *
 *  ┌──────┬──────────────────────────────────────────────────────────┐
 *  │ 报文  │ 描述                                                     │
 *  ├──────┼──────────────────────────────────────────────────────────┤
 *  │  1   │ 标准报文（转速设定 + 状态）                               │
 *  │      │ 发送（输入→控制器）：ZSW1(2B) + NIST_A(2B)               │
 *  │      │ 接收（输出←控制器）：STW1(2B) + NSET_A(2B)               │
 *  ├──────┼──────────────────────────────────────────────────────────┤
 *  │ 20   │ 扩展报文（+转矩限制 + 实际电流 + 功率）                   │
 *  │      │ 发送：ZSW1 + NIST_A + MIST_A + IIST + PIST               │
 *  │      │ 接收：STW1 + NSET_A + MSET + ISET_MAX                    │
 *  ├──────┼──────────────────────────────────────────────────────────┤
 *  │350   │ VECTOR 矢量控制（标准）                                   │
 *  │      │ 发送：ZSW1 + NIST_B(4B) + MIST_A + IIST                  │
 *  │      │ 接收：STW1 + NSET_B(4B) + MSET                           │
 *  └──────┴──────────────────────────────────────────────────────────┘
 *
 *  控制字 STW1（从 Controller 接收，16位）：
 *    位0  ON/OFF1     1=使能运行，0=按斜坡减速停车
 *    位1  OFF2        0=快速停车（惰走）
 *    位2  OFF3        0=快速停车（减速）
 *    位3  使能运行    1=允许运行（与 位0 配合）
 *    位4  启用斜坡    1=启用斜坡函数发生器
 *    位5  继续斜坡    1=斜坡函数发生器继续
 *    位6  使能速度设定 1=速度设定值有效
 *    位7  应答故障    上升沿→清除故障
 *    位8  点动1       1=点动正转
 *    位9  点动2       1=点动反转
 *    位10 PLC控制     1=由 PLC 控制
 *    位11 设定值反向  1=速度给定取反
 *    位12~15 保留
 *
 *  状态字 ZSW1（向 Controller 发送，16位）：
 *    位0  准备就绪    1=可以运行
 *    位1  准备运行    1=运行使能有效
 *    位2  运行中      1=变频器正在运行
 *    位3  故障激活    1=有故障（F类）
 *    位4  OFF2激活    1=惰停激活
 *    位5  OFF3激活    1=快停激活
 *    位6  禁止接通    1=禁止接通（需 OFF1→ON1 重新触发）
 *    位7  报警激活    1=有报警（A类）
 *    位8  速度偏差    1=实际速度偏差超出窗口
 *    位9  过程数据有效 1=当前 PZD 有效
 *    位10 已达设定转速 1=实际转速已达设定值
 *    位11 超速限制    1=电机速度超出限制
 *    位12 输出电流限制 1=电流已达限制
 *    位13 I²t 报警    1=电机过热报警
 *    位14 电动机正转  1=电机正向转动
 *    位15 能量回馈    1=处于回馈制动状态
 *
 *  转速规格化（IEC 61800-7）：
 *    NSET_A / NIST_A（16bit 有符号）：
 *      0x4000（16384） = 100% 参考转速（P2000，默认 1500 rpm）
 *      -0x4000        = -100%（反转 1500 rpm）
 *      线性关系：n(rpm) = NSET × P2000 / 16384
 *
 *    NSET_B / NIST_B（32bit 有符号，高精度）：
 *      0x40000000 = 100%
 *
 * ══════════════════════════════════════════════════════════════════════
 *  变频器内部状态机（Drive State Machine）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  状态转移图：
 *
 *  S1 断路/上电未就绪
 *    ↓ 上电自检完成
 *  S2 等待 ON 命令（STW1.bit0=0）
 *    ↓ STW1.bit0=1 且 bit3=1（ON+使能运行）
 *  S3 斜坡加速中（RFG 加速斜坡）
 *    ↓ 速度达到设定值
 *  S4 稳定运行中（ZSW1.bit10=1）
 *    ↓ STW1.bit0=0（OFF1）
 *  S5 斜坡减速中（RFG 减速斜坡）
 *    ↓ 速度降为0
 *  S2（返回等待）
 *
 *  故障路径：任意状态 → S6 故障（ZSW1.bit3=1）
 *    → STW1.bit7 上升沿 → S2（清除故障后重新就绪）
 *
 *  惰走停车（OFF2）：任意状态 → STW1.bit1=0 → 立即停车（S2）
 *  快速停车（OFF3）：任意状态 → STW1.bit2=0 → 紧急减速（S5快）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  电机物理模型（异步电机 V/f 控制 + 简化矢量控制）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  电机参数（4极，7.5kW，400V，50Hz，默认值，可通过参数配置）：
 *    P0300  电机类型（1=异步电机，2=永磁同步）
 *    P0304  额定电压（V），默认 400V
 *    P0305  额定电流（A），默认 17.0A
 *    P0307  额定功率（kW），默认 7.5kW
 *    P0308  额定功率因数（cosφ），默认 0.85
 *    P0309  额定效率（%），默认 90.0
 *    P0310  额定频率（Hz），默认 50Hz
 *    P0311  额定转速（rpm），默认 1450rpm（4极/50Hz 异步）
 *    P0341  电机转动惯量（kg·m²），默认 0.025
 *
 *  物理仿真：
 *    1. 转矩计算（V/f 模式下线性简化）：
 *       T_elec = Kv × (Vout/Vrated) × I_magnetize × K_load
 *
 *    2. 机械方程（转动方程）：
 *       J × (dω/dt) = T_elec - T_load - B×ω
 *       ω = 2π × n / 60
 *
 *    3. 斜坡函数发生器（RFG）：
 *       加速时间 P1120（默认 10s）：0→额定转速的时间
 *       减速时间 P1121（默认 10s）：额定转速→0 的时间
 *       斜坡：Δn/Δt = P0311 / P1120（rpm/s）
 *
 *    4. 电流模型：
 *       I_motor = I_mag × sqrt(1 + (T_load/T_rated)²)
 *       I_mag   ≈ I_rated × 0.32（磁化电流，约30%额定）
 *       过载保护：I > I_max (= I_rated × P0640/100) → 故障 F7011
 *
 *    5. 功率计算：
 *       P_out = T_load × ω（机械功率）
 *       P_in  = P_out / η（输入功率，η=效率）
 *       P_loss = P_in - P_out（损耗，转化为温升）
 *
 *    6. 温度模型（热模型）：
 *       dT/dt = (P_loss - k_cool × (T - T_ambient)) / C_thermal
 *       超温保护：T > 85°C → 报警 A0502，T > 100°C → 故障 F0004
 *
 * ══════════════════════════════════════════════════════════════════════
 *  参数系统（P 参数 / r 参数）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  变频器通过参数对象存储所有设置。本仿真支持以下关键参数：
 *
 *  驱动配置：
 *    P0003  访问级别（1=标准，2=扩展，3=专家）
 *    P0004  参数筛选
 *    P0010  调试参数（0=就绪，1=快速调试，30=工厂复位）
 *    P0100  功率单位（0=kW，1=hp）
 *    P0205  变频器应用（0=泵/风机，1=压缩机，2=通用）
 *
 *  电机参数（P0300~P0350）：
 *    P0300  电机类型
 *    P0304~P0311  额定参数（如上）
 *    P0341  转动惯量
 *
 *  速度控制（P1000~P1300）：
 *    P1000  速度设定源（0=无，1=BOP，2=AI，6=现场总线）
 *    P1080  最小速度（rpm），默认 0
 *    P1082  最大速度（rpm），默认 1500
 *    P1120  加速时间（s），默认 10
 *    P1121  减速时间（s），默认 10
 *    P1135  OFF3 减速时间（s），默认 3
 *    P1300  开环/闭环控制模式（0=V/f线性，1=V/f平方，20=无速度传感器矢量，21=有速度传感器矢量）
 *
 *  PROFINET（P2000~P2050）：
 *    P2000  参考速度（rpm），默认 1500（对应 16384/0x4000）
 *    P2009  USS PZD 数量
 *    P8864  报文选择（1/20/350/352）
 *
 *  保护（P0600~P0650）：
 *    P0610  电机过热响应（0=禁用，1=报警，2=故障）
 *    P0625  环境温度（°C），默认 25
 *    P0640  过载因数（%），默认 150
 *
 *  I/O 参数（P0700~P0750）：
 *    P0700  命令源（0=工厂，1=BOP，2=端子，6=总线）
 *    P0701~P0705  DI0~DI4 功能（参见 SINAMICS 功能手册）
 *    P0731  DO0 功能
 *    P0771  AI0 量程（0=0~10V，1=0~20mA，2=±10V）
 *    P0772  AI1 量程
 *    P0776  AO0 量程（0=0~20mA，1=4~20mA）
 *    P0777  AO1 量程
 *
 * ══════════════════════════════════════════════════════════════════════
 *  故障/报警代码（仿真支持的主要代码）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  F类故障（锁定变频器，需手动 ACK）：
 *    F0001  过电压（DC-Bus）
 *    F0002  欠电压（DC-Bus）
 *    F0003  过温（变频器）
 *    F0004  过温（电机）
 *    F0011  电机过流
 *    F0012  输出接地故障
 *    F0021  地线电流过大
 *    F7011  速度偏差超出容限（矢量控制）
 *    F30016 参数错误
 *
 *  A类报警（不停机，自动清除）：
 *    A0501  电流限制激活
 *    A0502  变频器过热（温度降低后自动消除）
 *    A0503  速度控制器接近上限
 *    A0510  参考/实际速度偏差
 *    A7000  PROFINET 通信丢失
 *    A7002  PROFINET 配置错误
 *
 * ══════════════════════════════════════════════════════════════════════
 *  面板外观（CU250S-2 PN 正面）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  ┌───────────────────────────────────┐
 *  │  SINAMICS G120  [橙色顶部色带]    │
 *  │  CU250S-2 PN                      │
 *  ├───────────────────────────────────┤
 *  │  [BOP-2 操作面板]                 │  ← 可拆卸操作面板（简化绘制）
 *  │  ╔═══════════════════╗            │
 *  │  ║  0.00  Hz  →  OFF ║            │  ← LCD 显示（2行 × 6字符）
 *  │  ╚═══════════════════╝            │
 *  │  [▲][▼][OK][ESC][手动/自动]       │  ← BOP 按键
 *  ├───────────────────────────────────┤
 *  │  PROFINET P1  ○LNK ○RX/TX        │  ← PN P1 端口 + LED
 *  │  PROFINET P2  ○LNK ○RX/TX        │  ← PN P2 端口 + LED（菊花链）
 *  ├───────────────────────────────────┤
 *  │  ● RDY  ● RUN  ● FAULT  ● ALM   │  ← 4 状态 LED
 *  ├───────────────────────────────────┤
 *  │  驱动状态信息显示区               │  ← 实时参数显示
 *  │  n: 0.0 rpm   I: 0.0A  T: 25°C  │
 *  │  f: 0.0 Hz    U: 0V    P: 0.0kW │
 *  ├───────────────────────────────────┤
 *  │  端子排 X1(DI/DO/AI/AO/编码器)   │
 *  └───────────────────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *  与 ST20 的 PROFINET 通信接口
 * ══════════════════════════════════════════════════════════════════════
 *
 *  G120 作为 IO Device 从站，ST20 作为 IO Controller 主站：
 *
 *  1. ST20 侧注册：
 *     cpu.pnAddDevice({
 *       slot: 0,
 *       deviceName: 'g120-vfd',
 *       deviceIP: '192.168.0.10',
 *       deviceType: 'sinamics_g120',
 *       inputBytes: 4,   // ZSW1(2) + NIST_A(2)
 *       outputBytes: 4,  // STW1(2) + NSET_A(2)
 *     });
 *     cpu.pnBindModule(0, g120Instance);
 *
 *  2. G120 侧初始化：
 *     g120.connectToController(cpuInstance, 0);
 *     // 或通过配置：config.controllerRef + config.controllerSlot
 *
 *  3. 数据交换（每 PROFINET 周期自动执行）：
 *     ST20 → G120：_pn.deviceOutputData[0..1] = STW1，[2..3] = NSET_A
 *     G120 → ST20：_pn.deviceInputData[0..1]  = ZSW1，[2..3] = NIST_A
 *
 *  4. 扩展报文（报文20，8字节）：
 *     inputBytes: 10  (ZSW1+NIST_A+MIST_A+IIST+PIST)
 *     outputBytes: 8  (STW1+NSET_A+MSET+ISET_MAX)
 *
 *  5. 直接绑定 API（单页面仿真）：
 *     g120.connectToController(cpu, slotNumber)
 *     → 自动在 cpu.pnAddDevice 中注册
 *     → 每个 tick 自动交换数据
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *
 *  PN_P1   PROFINET Port1（bus，顶部，连接 ST20 PN_P1 或交换机）
 *  PN_P2   PROFINET Port2（bus，顶部，菊花链到下一设备）
 *  DI0~DI4 数字量输入（wire, passive）
 *  DO0     数字量输出（wire）
 *  AI0/AI1 模拟量输入（wire, passive）
 *  AO0/AO1 模拟量输出（wire）
 *  ENC_A/B 编码器 A/B 相输入（wire, passive）
 *  U/V/W   电机三相输出（wire）
 *  L1/L2/L3 电网三相输入（wire, passive）
 *  PE      接地（wire, passive）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  可配置参数
 * ══════════════════════════════════════════════════════════════════════
 *
 *  label           : 位号（默认 'G120-1'）
 *  stationName     : PROFINET 站名（'g120-vfd'）
 *  pnIP            : PROFINET IP（'192.168.0.10'）
 *  telegramType    : PROFIdrive 报文类型（1/20/350）
 *  motorPower      : 电机额定功率 kW（7.5）
 *  motorRatedSpeed : 电机额定转速 rpm（1450）
 *  motorRatedVoltage: 电机额定电压 V（400）
 *  motorRatedCurrent: 电机额定电流 A（17.0）
 *  motorInertia    : 转动惯量 kg·m²（0.025）
 *  rampUp          : 加速时间 s（10）
 *  rampDown        : 减速时间 s（10）
 *  refSpeed        : 参考转速 rpm P2000（1500）
 *  maxSpeed        : 最大转速 rpm（1500）
 *  loadTorque      : 初始负载转矩 N·m（0，可动态设置）
 *  controllerRef   : 直连的 ST20 实例（可选）
 *  controllerSlot  : 在 ST20 中的槽位号（0）
 *  autoConnect     : 上电自动连接（false）
 */
export class SinamicsG120 extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(200, config.width  || 260);
        this.height = Math.max(380, config.height || 460);

        this.type    = 'sinamics_g120';
        this.special = 'drive';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initMotorModel();
        this._initDriveStateMachine();
        this._initPROFINET(config);
        this._init();

        this.config = {
            label:            this.label,
            stationName:      this._pn.stationName,
            pnIP:             this._pn.ip,
            telegramType:     this._telegramType,
            motorPower:       this._motor.ratedPower,
            motorRatedSpeed:  this._motor.ratedSpeed,
            motorRatedCurrent:this._motor.ratedCurrent,
            rampUp:           this._p.P1120,
            rampDown:         this._p.P1121,
            refSpeed:         this._p.P2000,
        };

        this._registerPorts();

        // 自动连接（若配置了 controllerRef）
        if (config.controllerRef && config.autoConnect !== false) {
            const slot = config.controllerSlot !== undefined ? config.controllerSlot : 0;
            setTimeout(() => this.connectToController(config.controllerRef, slot), 100);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._body = { x: 0, y: 0, w: W, h: H, rx: 3 };

        // ── 顶部橙色色带（SINAMICS 特有）
        this._topBar = { x: 0, y: 0, w: W, h: H * 0.075 };

        // ── PROFINET 端口区（顶部，H*0.075~H*0.20）
        this._pnP1Port = { x: W*0.05, y: H*0.085, w: W*0.40, h: H*0.060 };
        this._pnP2Port = { x: W*0.55, y: H*0.085, w: W*0.40, h: H*0.060 };

        // PN LED（端口下方）
        this._pnLEDs = {
            p1Lnk: { x: W*0.07,  y: H*0.167, r: H*0.012 },
            p1Act: { x: W*0.155, y: H*0.167, r: H*0.012 },
            p2Lnk: { x: W*0.57,  y: H*0.167, r: H*0.012 },
            p2Act: { x: W*0.655, y: H*0.167, r: H*0.012 },
        };

        // ── BOP-2 操作面板（LCD + 按键）
        this._bopArea = { x: W*0.06, y: H*0.195, w: W*0.88, h: H*0.175 };
        this._lcdArea = { x: W*0.08, y: H*0.205, w: W*0.84, h: H*0.090 };

        // BOP 按键（5个）
        const btnY = H*0.303, btnR = H*0.022;
        const btnXs = [0.12, 0.27, 0.45, 0.63, 0.82];
        this._bopBtns = btnXs.map((bx, i) => ({
            x: W*bx, y: btnY, r: btnR,
            label: ['▲','▼','OK','ESC','M'][i],
            id:    ['UP','DN','OK','ESC','MODE'][i],
        }));

        // ── 状态 LED 行
        this._statusLEDs = {
            rdy:   { x: W*0.10, y: H*0.395, r: H*0.013 },
            run:   { x: W*0.32, y: H*0.395, r: H*0.013 },
            fault: { x: W*0.54, y: H*0.395, r: H*0.013 },
            alarm: { x: W*0.76, y: H*0.395, r: H*0.013 },
        };

        // ── 驱动状态信息面板
        this._drivePanel = { x: W*0.05, y: H*0.420, w: W*0.90, h: H*0.165 };

        // ── 端子排区域
        this._terminalArea = { x: W*0.05, y: H*0.600, w: W*0.90, h: H*0.160 };

        // ── 功率模块（底部散热器）
        this._powerModule = { x: 0, y: H*0.780, w: W, h: H*0.145 };

        // ── 铭牌
        this._nameplate = { x: W*0.05, y: H*0.800, w: W*0.56, h: H*0.055 };

        // ── DIN 导轨
        this._dinRail = { x: 0, y: H*0.942, w: W, h: H*0.058 };

        // ── 散热栅格（功率模块右侧）
        this._heatSlots = [];
        for (let i = 0; i < 5; i++) {
            this._heatSlots.push({ x: W*0.66, y: H*(0.785+i*0.024), w: W*0.28, h: H*0.016 });
        }

        // ── 端口坐标
        const portY = H;
        this._portPos = {
            PN_P1: { x: W*0.25, y: 0      },
            PN_P2: { x: W*0.75, y: 0      },
            DI0:   { x: W*0.10, y: portY  },
            DI1:   { x: W*0.18, y: portY  },
            DI2:   { x: W*0.26, y: portY  },
            DI3:   { x: W*0.34, y: portY  },
            DI4:   { x: W*0.42, y: portY  },
            DO0:   { x: W*0.50, y: portY  },
            AI0:   { x: W*0.58, y: portY  },
            AI1:   { x: W*0.66, y: portY  },
            AO0:   { x: W*0.74, y: portY  },
            AO1:   { x: W*0.82, y: portY  },
            U:     { x: W*0.20, y: H*0.98 },
            V:     { x: W*0.40, y: H*0.98 },
            W:     { x: W*0.60, y: H*0.98 },
            L1:    { x: W*0.68, y: 0      },
            L2:    { x: W*0.78, y: 0      },
            L3:    { x: W*0.88, y: 0      },
            PE:    { x: W*0.92, y: H*0.50 },
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label       || 'G120-1';
        this._telegramType = config.telegramType || 1;   // PROFIdrive 报文类型

        // P 参数对象（关键参数）
        this._p = {
            // 基础
            P0003: 2,   // 访问级别
            P0010: 0,   // 调试状态（0=就绪）
            P0100: 0,   // 功率单位（0=kW）
            P0205: 0,   // 应用（0=泵/风机）

            // 电机参数
            P0300: 1,   // 电机类型（1=异步）
            P0304: config.motorRatedVoltage  || 400,
            P0305: config.motorRatedCurrent  || 17.0,
            P0307: config.motorPower         || 7.5,
            P0308: config.motorPowerFactor   || 0.85,
            P0309: config.motorEfficiency    || 90.0,
            P0310: config.motorFrequency     || 50,
            P0311: config.motorRatedSpeed    || 1450,
            P0341: config.motorInertia       || 0.025,

            // 速度控制
            P1000: 6,   // 速度设定源（6=现场总线）
            P1080: config.minSpeed           || 0,
            P1082: config.maxSpeed           || 1500,
            P1120: config.rampUp             || 10,
            P1121: config.rampDown           || 10,
            P1135: config.rampOff3           || 3,
            P1300: config.controlMode        || 0,   // 0=V/f线性

            // PROFINET
            P2000: config.refSpeed           || 1500,
            P8864: config.telegramType       || 1,

            // 保护
            P0625: config.ambientTemp        || 25,
            P0640: config.overloadFactor     || 150,
            P0610: 1,   // 电机过热响应（1=报警）

            // I/O
            P0700: 6,   // 命令源（6=总线）
            P0701: 0,   // DI0→无功能
            P0702: 0,
            P0703: 0,
            P0704: 0,
            P0705: 0,
            P0731: 52,  // DO0→变频器运行中
            P0771: 0,   // AI0→0~10V
            P0772: 0,   // AI1→0~10V
            P0776: 0,   // AO0→0~20mA
            P0777: 0,   // AO1→0~20mA
        };

        // r 参数（只读，运行时更新）
        this._r = {
            r0002: 0,   // 当前工作状态字
            r0020: 0.0, // 实际转速滤波值 rpm
            r0021: 0.0, // 实际输出频率 Hz
            r0022: 0.0, // 实际输出电压 V
            r0024: 0.0, // 实际输出电流 A
            r0025: 0.0, // 实际电机转矩 N·m
            r0027: 0.0, // 实际有功功率 kW
            r0034: 25.0,// 实际电机温度 °C（热模型）
            r0035: 25.0,// 变频器温度 °C
            r0038: 0.0, // 实际直流母线电压 V
            r0044: 0.0, // 实际输出频率 Hz（精确）
        };

        // 故障和报警
        this._faults  = [];   // 当前故障列表 [{code, msg, ts}]
        this._alarms  = [];   // 当前报警列表

        // BOP 显示
        this._bopDisplay = { line1: 'OFF', line2: '0.00Hz', cursor: 0, editMode: false };

        // DI/DO/AI/AO 本体 I/O
        this._di  = new Uint8Array(5);   // DI0~DI4（0/1）
        this._do  = new Uint8Array(1);   // DO0
        this._ai  = new Float32Array(2); // AI0/AI1（工程值，V 或 mA）
        this._ao  = new Float32Array(2); // AO0/AO1（0~20mA）

        // 编码器（虚拟）
        this._encoder = { positionPulses: 0, speedRpm: 0 };

        // STW1 / ZSW1（PROFINET IO 报文）
        this._stw1 = 0x0000;   // 控制字（从 Controller 接收）
        this._zsw1 = 0x0000;   // 状态字（向 Controller 发送）

        // 速度设定/实际值
        this._nset  = 0;    // 设定转速（标幺值，-16384~+16384）
        this._nist  = 0;    // 实际转速（标幺值）

        // 温度
        this._tempMotor  = this._p.P0625;
        this._tempInvt   = this._p.P0625;
        this._prevTick   = performance.now();
    }

    // ═══════════════════════════════════════════════════════════════════
    // 电机物理模型
    // ═══════════════════════════════════════════════════════════════════

    _initMotorModel() {
        const p = this._p;

        this._motor = {
            // 额定参数
            ratedPower:   p.P0307,
            ratedSpeed:   p.P0311,
            ratedCurrent: p.P0305,
            ratedVoltage: p.P0304,
            ratedFreq:    p.P0310,
            powerFactor:  p.P0308,
            efficiency:   p.P0309 / 100,
            inertia:      p.P0341,

            // 导出参数
            ratedTorque:  (p.P0307 * 1000) / (2 * Math.PI * p.P0311 / 60),  // N·m
            poles:        Math.round(120 * p.P0310 / p.P0311 / 2) * 2,       // 极数（通常4极）
            syncSpeed:    120 * p.P0310 / (Math.round(120 * p.P0310 / p.P0311 / 2) * 2), // 同步转速

            // 运行状态
            speed:        0.0,   // 实际转速 rpm
            targetSpeed:  0.0,   // 目标转速 rpm（经 RFG 后）
            torque:       0.0,   // 实际电磁转矩 N·m
            current:      0.0,   // 输出电流 A
            voltage:      0.0,   // 输出电压 V
            power:        0.0,   // 输出功率 kW
            frequency:    0.0,   // 输出频率 Hz
            dcBusVoltage: 540.0, // 直流母线电压 V（正常 540V = 380V × √2）

            // RFG（斜坡函数发生器）
            rfgOutput:    0.0,   // RFG 当前输出（rpm）
            rfgTarget:    0.0,   // RFG 目标值（rpm）

            // 热模型
            thermalLoad:  0.0,   // 热负荷百分比 %
        };

        // 负载转矩（外部设置，模拟负载）
        this._loadTorque = 0.0;  // N·m（外部施加的负载）
        this._loadInertia= 0.0;  // 外部负载惯量 kg·m²
    }

    // ═══════════════════════════════════════════════════════════════════
    // 驱动状态机
    // ═══════════════════════════════════════════════════════════════════

    _initDriveStateMachine() {
        // 状态定义
        // S1=上电未就绪, S2=等待ON, S3=使能/加速, S4=稳定运行, S5=减速, S6=故障, S7=快停
        this._driveState = 'S1';
        this._prevSTW1   = 0;
        this._startupTimer = 0.8;  // 上电自检时间 s
        this._ackPending   = false;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROFINET IO Device 初始化
    // ═══════════════════════════════════════════════════════════════════

    _initPROFINET(config) {
        const rnd = () => Math.floor(Math.random()*256).toString(16).padStart(2,'0').toUpperCase();
        this._pn = {
            stationName:       config.stationName     || 'g120-vfd',
            ip:                config.pnIP             || '192.168.0.10',
            subnet:            config.pnSubnet         || '255.255.255.0',
            gateway:           config.pnGateway        || '192.168.0.254',
            mac:               `00:0E:8C:${rnd()}:${rnd()}:${rnd()}`,
            vendorID:          0x002A,  // Siemens
            deviceID:          0x0409,  // SINAMICS G120
            state:             'OFFLINE',
            p1: { link: false, act: false },
            p2: { link: false, act: false },

            // AR 连接状态
            arEstablished:     false,
            controllerIP:      '',
            txFrames:          0,
            rxFrames:          0,
            missedCycles:      0,
            lastRxTs:          0,
            diagBuffer:        [],
            accumCycleMs:      0,
            cycleMs:           1,    // 发送周期 1ms

            // IO 数据缓冲区（根据报文类型确定大小）
            inputData:         new Uint8Array(20),   // 发送给 Controller（ZSW1+NIST...）
            outputData:        new Uint8Array(20),   // 从 Controller 接收（STW1+NSET...）
            inputBytes:        4,
            outputBytes:       4,
        };

        // 根据报文类型设置数据长度
        this._configTelegram(this._telegramType);

        // 连接的 Controller 引用（直连模式）
        this._controller      = null;
        this._controllerSlot  = -1;
        this._directMode      = false;

        // PN 调度器
        this._pnSchedulerQueue = [];

        this._pnLog('info', `G120 PROFINET 初始化 (IP=${this._pn.ip}, Name=${this._pn.stationName})`);
    }

    _configTelegram(type) {
        const pn = this._pn;
        switch (type) {
            case 1:  // 标准：ZSW1(2)+NIST_A(2) / STW1(2)+NSET_A(2)
                pn.inputBytes  = 4;
                pn.outputBytes = 4;
                break;
            case 20: // 扩展：ZSW1(2)+NIST_A(2)+MIST_A(2)+IIST(2)+PIST(2) / STW1+NSET+MSET+IMAX
                pn.inputBytes  = 10;
                pn.outputBytes = 8;
                break;
            case 350:// 矢量：ZSW1(2)+NIST_B(4)+MIST_A(2)+IIST(2) / STW1(2)+NSET_B(4)+MSET(2)
                pn.inputBytes  = 10;
                pn.outputBytes = 8;
                break;
            default:
                pn.inputBytes  = 4;
                pn.outputBytes = 4;
        }
        pn.inputData  = new Uint8Array(pn.inputBytes);
        pn.outputData = new Uint8Array(pn.outputBytes);
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROFINET 公开连接 API
    // ═══════════════════════════════════════════════════════════════════

    /**
     * 将 G120 作为 IO Device 注册到 ST20 控制器
     * 并建立直连通信通道
     *
     * @param {object} controller  ST20 CPU 实例
     * @param {number} slot        在 CPU 中占用的 PN 槽位号
     */
    connectToController(controller, slot = 0) {
        if (!controller) return;
        this._controller     = controller;
        this._controllerSlot = slot;
        this._directMode     = true;

        const pn = this._pn;
        pn.p1.link = true;
        pn.state   = 'STARTUP';

        // 在 Controller 上注册自身（若尚未注册）
        let dev = null;
        if (typeof controller.pnGetDevice === 'function') {
            dev = controller.pnGetDevice(slot);
        }
        if (!dev && typeof controller.pnAddDevice === 'function') {
            dev = controller.pnAddDevice({
                slot,
                deviceName:   pn.stationName,
                deviceIP:     pn.ip,
                deviceType:   this.type,
                vendorID:     pn.vendorID,
                deviceID:     pn.deviceID,
                inputBytes:   pn.inputBytes,
                outputBytes:  pn.outputBytes,
                moduleRef:    this,
                watchdogMs:   3000,
            });
        } else if (dev) {
            // 更新已有条目的 moduleRef
            dev.moduleRef   = this;
            dev.inputBytes  = pn.inputBytes;
            dev.outputBytes = pn.outputBytes;
        }

        // 注册到扩展模块列表（用于 tick 联动）
        if (controller._expansionModules && !controller._expansionModules.includes(this)) {
            controller._expansionModules.push(this);
        }

        this._pnLog('info', `注册到 Controller (${controller.label || '?'}) 槽位 ${slot}`);

        // 仿真 AR 建立序列（约 600ms）
        this._pnSchedule(200, () => { pn.state = 'STARTUP'; this._pnLog('info','DCP Response…'); });
        this._pnSchedule(400, () => { this._pnLog('info','Connect Req/Res…'); });
        this._pnSchedule(600, () => { this._pnLog('info','Param End → App Ready'); });
        this._pnSchedule(700, () => {
            pn.arEstablished  = true;
            pn.controllerIP   = controller._pn?.ip || '?';
            pn.state          = 'OPERATE';
            pn.lastRxTs       = performance.now();
            // 同步触发 Controller 端 AR 建立
            if (dev) {
                dev.arEstablished = true;
                dev.online        = true;
                dev.lastRxTs      = performance.now();
                if (controller._pn && controller._pn.state !== 'OPERATE') {
                    controller._pn.state  = 'OPERATE';
                    controller._pn.p1.link= true;
                }
            }
            this._pnLog('info', `✓ AR 建立，进入数据交换 (报文${this._telegramType})`);
            this._driveState = 'S2';  // 变频器就绪
            this._rebuildDynamic(); this.markDirty();
        });

        this._rebuildDynamic(); this.markDirty();
    }

    /**
     * 断开与 Controller 的连接
     */
    disconnectFromController() {
        const pn = this._pn;
        pn.arEstablished = false;
        pn.state         = 'OFFLINE';
        pn.p1.link       = false;
        pn.p1.act        = false;

        if (this._controller && this._controllerSlot >= 0) {
            const dev = this._controller.pnGetDevice?.(this._controllerSlot);
            if (dev) { dev.arEstablished = false; dev.online = false; }
        }
        this._controller     = null;
        this._controllerSlot = -1;
        this._directMode     = false;

        // 变频器脱网 → 保持状态但不再接收命令
        this._pnLog('warn', 'PROFINET 连接断开，变频器保持当前状态');
        this._rebuildDynamic(); this.markDirty();
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROFINET IO 数据交换（每 tick 的数据周期部分）
    // ═══════════════════════════════════════════════════════════════════

    _pnCycleExchange(dtMs) {
        const pn = this._pn;
        pn.accumCycleMs += dtMs;
        if (pn.accumCycleMs < pn.cycleMs) return;
        pn.accumCycleMs = 0;

        if (!pn.arEstablished) return;

        // ── 接收数据（Controller → Device）
        let stw1 = 0, nset = 0, mset = 0;
        if (this._directMode && this._controller) {
            const dev = this._controller.pnGetDevice?.(this._controllerSlot);
            if (dev?.outputData) {
                // 从 Controller 的 deviceOutputData 读取
                stw1 = (dev.outputData[0] << 8) | dev.outputData[1];
                nset = (dev.outputData[2] << 8) | dev.outputData[3];
                if (nset > 32767) nset -= 65536;
                if (this._telegramType === 20 || this._telegramType === 350) {
                    mset = (dev.outputData[4] << 8) | dev.outputData[5];
                    if (mset > 32767) mset -= 65536;
                }
                pn.rxFrames++;
                dev.rxCount = (dev.rxCount || 0) + 1;
                dev.lastRxTs = performance.now();
            }
        } else {
            // 从本地 outputData 缓冲读取（Channel 模式）
            stw1 = (pn.outputData[0] << 8) | pn.outputData[1];
            nset = (pn.outputData[2] << 8) | pn.outputData[3];
            if (nset > 32767) nset -= 65536;
        }
        this._stw1 = stw1;
        this._nset = nset;

        // 看门狗检测（3s 无数据 → 报警 A7000）
        if (performance.now() - pn.lastRxTs > 3000) {
            if (!this._alarms.find(a => a.code === 'A7000')) {
                this._triggerAlarm('A7000', 'PROFINET 通信丢失');
            }
        } else {
            this._clearAlarm('A7000');
        }
        pn.lastRxTs = performance.now();

        // ── 发送数据（Device → Controller）
        this._packInputData();
        if (this._directMode && this._controller) {
            const dev = this._controller.pnGetDevice?.(this._controllerSlot);
            if (dev?.inputData) {
                dev.inputData.set(pn.inputData.slice(0, pn.inputBytes));
                dev.txCount = (dev.txCount || 0) + 1;
            }
        }
        pn.txFrames++;
        pn.p1.act = (pn.txFrames % 4 < 2);
    }

    /**
     * 打包 ZSW1 + NIST_A（+ 扩展数据）到 inputData 缓冲
     */
    _packInputData() {
        const pn    = this._pn;
        const zsw1  = this._zsw1;
        const nist  = this._nist;   // 标幺值 -16384~+16384

        // 字节0~1：ZSW1
        pn.inputData[0] = (zsw1 >> 8) & 0xFF;
        pn.inputData[1] =  zsw1 & 0xFF;
        // 字节2~3：NIST_A
        const nistU = nist < 0 ? nist + 65536 : nist;
        pn.inputData[2] = (nistU >> 8) & 0xFF;
        pn.inputData[3] =  nistU & 0xFF;

        if (this._telegramType === 20 || this._telegramType === 350) {
            // 字节4~5：MIST_A（实际转矩，标幺值，0x4000=100%额定转矩）
            const mist = Math.round((this._motor.torque / this._motor.ratedTorque) * 0x4000);
            const mistU = mist < 0 ? mist + 65536 : mist;
            pn.inputData[4] = (mistU >> 8) & 0xFF;
            pn.inputData[5] =  mistU & 0xFF;
            // 字节6~7：IIST（实际电流，0x4000=额定电流）
            const iist = Math.round((this._motor.current / this._motor.ratedCurrent) * 0x4000);
            pn.inputData[6] = (iist >> 8) & 0xFF;
            pn.inputData[7] =  iist & 0xFF;
            if (this._telegramType === 20) {
                // 字节8~9：PIST（实际功率，0x4000=额定功率）
                const pist = Math.round((this._motor.power / this._motor.ratedPower) * 0x4000);
                pn.inputData[8] = (pist >> 8) & 0xFF;
                pn.inputData[9] =  pist & 0xFF;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STW1 控制字解析
    // ═══════════════════════════════════════════════════════════════════

    _parseSTW1(stw1) {
        return {
            on:         !!(stw1 & 0x0001),  // bit0: ON/OFF1
            noOff2:     !!(stw1 & 0x0002),  // bit1: 无 OFF2（=1表示不快停）
            noOff3:     !!(stw1 & 0x0004),  // bit2: 无 OFF3
            enableOp:   !!(stw1 & 0x0008),  // bit3: 使能运行
            enableRfg:  !!(stw1 & 0x0010),  // bit4: 启用斜坡
            continueRfg:!!(stw1 & 0x0020),  // bit5: 继续斜坡
            enableNset: !!(stw1 & 0x0040),  // bit6: 速度设定有效
            ackFault:   !!(stw1 & 0x0080),  // bit7: 应答故障
            jog1:       !!(stw1 & 0x0100),  // bit8: 点动1
            jog2:       !!(stw1 & 0x0200),  // bit9: 点动2
            plcControl: !!(stw1 & 0x0400),  // bit10: PLC控制
            setInverse: !!(stw1 & 0x0800),  // bit11: 设定值反向
        };
    }

    /**
     * 构建 ZSW1 状态字
     */
    _buildZSW1() {
        const m    = this._motor;
        const s    = this._driveState;
        const hasFault  = this._faults.length > 0;
        const hasAlarm  = this._alarms.length > 0;
        const isRunning = (s === 'S3' || s === 'S4' || s === 'S5');
        const isReady   = (s !== 'S1' && s !== 'S6' && !hasFault);
        const atSpeed   = (s === 'S4') && (Math.abs(m.speed - m.targetSpeed) < 10);

        let zsw1 = 0;
        if (isReady)                                              zsw1 |= 0x0001; // bit0 就绪
        if (isReady && this._driveState !== 'S2')                zsw1 |= 0x0002; // bit1 运行就绪
        if (isRunning)                                            zsw1 |= 0x0004; // bit2 运行中
        if (hasFault)                                             zsw1 |= 0x0008; // bit3 故障
        if (s === 'S2' && !this._stw1Prev?.on)                   zsw1 |= 0x0040; // bit6 禁止接通
        if (hasAlarm)                                             zsw1 |= 0x0080; // bit7 报警
        if (isRunning && Math.abs(m.speed - m.rfgOutput) > 50)   zsw1 |= 0x0100; // bit8 速度偏差
        if (this._pn.arEstablished)                               zsw1 |= 0x0200; // bit9 过程数据有效
        if (atSpeed)                                              zsw1 |= 0x0400; // bit10 已达设定速度
        if (m.speed > this._p.P1082 * 1.05)                      zsw1 |= 0x0800; // bit11 超速
        if (m.current > this._motor.ratedCurrent * 1.2)          zsw1 |= 0x1000; // bit12 电流限制
        if (this._r.r0034 > 80)                                   zsw1 |= 0x2000; // bit13 电机过热
        if (m.speed > 0)                                          zsw1 |= 0x4000; // bit14 正转
        return zsw1;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 驱动状态机执行（每 tick 调用）
    // ═══════════════════════════════════════════════════════════════════

    _execStateMachine(dtS) {
        const stw = this._parseSTW1(this._stw1);
        const prevStw = this._stw1Prev ? this._parseSTW1(this._stw1Prev) : stw;

        switch (this._driveState) {

            case 'S1': // 上电自检
                this._startupTimer -= dtS;
                if (this._startupTimer <= 0) {
                    this._startupTimer = 0;
                    this._driveState   = 'S2';
                    this._pnLog('info', '变频器上电就绪 → S2 等待 ON');
                }
                break;

            case 'S2': // 等待 ON 命令
                if (this._faults.length > 0) {
                    this._driveState = 'S6';
                    break;
                }
                // 故障应答（上升沿）
                if (stw.ackFault && !prevStw.ackFault) {
                    this._clearAllFaults();
                    this._pnLog('info', '故障已应答清除');
                }
                // ON 条件：bit0=1 AND bit3=1 AND bit1=1 AND bit2=1 AND 无故障
                if (stw.on && stw.enableOp && stw.noOff2 && stw.noOff3 && this._faults.length === 0) {
                    this._driveState     = 'S3';
                    this._motor.targetSpeed = this._nsetToRpm(this._nset);
                    this._pnLog('info', `ON → 加速运行 (目标: ${this._motor.targetSpeed.toFixed(0)} rpm)`);
                }
                break;

            case 'S3': // 斜坡加速
                if (!stw.noOff2) { this._driveState = 'S2'; this._stopImmediate(); break; }
                if (!stw.noOff3) { this._driveState = 'S7'; break; }
                if (!stw.on || !stw.enableOp) {
                    this._driveState = 'S5';
                    this._pnLog('info', 'OFF1 → 斜坡减速');
                    break;
                }
                // 更新速度设定目标
                if (stw.enableNset) {
                    const target = this._nsetToRpm(this._nset);
                    this._motor.targetSpeed = stw.setInverse ? -target : target;
                }
                // 检查加速是否完成
                if (Math.abs(this._motor.speed - this._motor.rfgOutput) < 5) {
                    this._driveState = 'S4';
                    this._pnLog('info', `稳定运行 @ ${this._motor.speed.toFixed(0)} rpm`);
                }
                if (this._faults.length > 0) { this._driveState = 'S6'; break; }
                break;

            case 'S4': // 稳定运行
                if (!stw.noOff2) { this._driveState = 'S2'; this._stopImmediate(); break; }
                if (!stw.noOff3) { this._driveState = 'S7'; break; }
                if (!stw.on || !stw.enableOp) {
                    this._driveState = 'S5';
                    this._pnLog('info', 'OFF1 → 斜坡减速');
                    break;
                }
                // 实时更新速度设定
                if (stw.enableNset) {
                    const target = this._nsetToRpm(this._nset);
                    this._motor.targetSpeed = stw.setInverse ? -target : target;
                }
                // 点动处理
                if (stw.jog1 && !stw.jog2) this._motor.targetSpeed = this._p.P1082 * 0.1;
                if (stw.jog2 && !stw.jog1) this._motor.targetSpeed = -this._p.P1082 * 0.1;
                if (this._faults.length > 0) { this._driveState = 'S6'; break; }
                break;

            case 'S5': // 斜坡减速（OFF1）
                if (!stw.noOff2) { this._driveState = 'S2'; this._stopImmediate(); break; }
                this._motor.targetSpeed = 0;
                if (Math.abs(this._motor.speed) < 2) {
                    this._motor.speed    = 0;
                    this._motor.rfgOutput= 0;
                    this._driveState     = 'S2';
                    this._pnLog('info', '已停止 → S2 等待 ON');
                }
                if (this._faults.length > 0) { this._driveState = 'S6'; break; }
                break;

            case 'S6': // 故障锁定
                this._motor.targetSpeed = 0;
                // 故障应答（上升沿 bit7）
                if (stw.ackFault && !prevStw.ackFault && this._faults.length > 0) {
                    this._clearAllFaults();
                    this._driveState = 'S2';
                    this._pnLog('info', '故障已确认，返回 S2');
                }
                break;

            case 'S7': // 快速停车（OFF3）
                this._motor.targetSpeed = 0;
                // 使用更短的减速时间
                if (Math.abs(this._motor.speed) < 2) {
                    this._driveState     = 'S2';
                    this._motor.speed    = 0;
                    this._motor.rfgOutput= 0;
                    this._pnLog('info', '快停完成 → S2');
                }
                break;
        }

        this._stw1Prev = { ...this._parseSTW1(this._stw1) };
    }

    // ═══════════════════════════════════════════════════════════════════
    // 电机物理仿真（每 tick）
    // ═══════════════════════════════════════════════════════════════════

    _simMotor(dtS) {
        const m  = this._motor;
        const p  = this._p;
        const s  = this._driveState;
        const isRunning = (s === 'S3' || s === 'S4' || s === 'S5' || s === 'S7');

        // ── 1. 斜坡函数发生器（RFG）
        const rampUpRate   = p.P1082 / p.P1120;  // rpm/s 加速斜率
        const rampDownRate = p.P1082 / p.P1121;  // rpm/s 减速斜率
        const off3Rate     = p.P1082 / p.P1135;  // 快停斜率

        if (s === 'S7') {
            // OFF3 快停：使用更快减速斜率
            const rate = off3Rate;
            if (m.rfgOutput > m.targetSpeed) m.rfgOutput = Math.max(m.targetSpeed, m.rfgOutput - rate * dtS);
            else if (m.rfgOutput < m.targetSpeed) m.rfgOutput = Math.min(m.targetSpeed, m.rfgOutput + rate * dtS);
        } else if (isRunning) {
            const target = m.targetSpeed;
            // 判断加速还是减速
            const approaching = (target > m.rfgOutput) ? 1 : -1;
            const isDecel     = (approaching < 0 && m.rfgOutput > 0) || (approaching > 0 && m.rfgOutput < 0);
            const rate        = isDecel ? rampDownRate : rampUpRate;
            if (Math.abs(m.rfgOutput - target) < rate * dtS) {
                m.rfgOutput = target;
            } else {
                m.rfgOutput += approaching * rate * dtS;
            }
        } else {
            m.rfgOutput = 0;
        }

        // 限速
        m.rfgOutput = Math.max(-p.P1082, Math.min(p.P1082, m.rfgOutput));

        // ── 2. 电磁转矩计算（简化 V/f 控制）
        const omega  = (2 * Math.PI * Math.abs(m.rfgOutput)) / 60;  // rad/s
        const fOut   = Math.abs(m.rfgOutput) / 60 * (m.poles / 2);  // 输出频率 Hz
        const vRatio = Math.min(1, fOut / p.P0310);                  // 电压比
        const vOut   = vRatio * p.P0304;
        const slip   = Math.max(0, (this._motor.syncSpeed - Math.abs(m.rfgOutput)) / this._motor.syncSpeed);
        const T_max  = m.ratedTorque * 2.5 * Math.min(1, vRatio + 0.1);
        // 简化转矩：比例于滑差
        let T_elec = T_max * Math.min(1, slip * 8) * Math.sign(m.rfgOutput);
        // 点动时降低转矩
        if (this._parseSTW1(this._stw1).jog1 || this._parseSTW1(this._stw1).jog2) {
            T_elec *= 0.5;
        }

        // ── 3. 机械运动方程（转动方程）
        const J_total = m.inertia + this._loadInertia;
        const B       = 0.001;  // 粘性摩擦系数
        const T_net   = T_elec - this._loadTorque * Math.sign(m.speed || 1) - B * omega;
        const alpha   = T_net / J_total;  // 角加速度 rad/s²
        const omegaActual = (2 * Math.PI * Math.abs(m.speed)) / 60;
        const domega  = alpha * dtS;
        let newSpeed  = m.rfgOutput;  // 电机跟随 RFG（简化：不单独积分）
        // 加入轻微的动态滞后
        const tau = J_total / (B + 0.01);  // 时间常数
        const lag = Math.exp(-dtS / Math.max(tau, 0.01));
        newSpeed  = m.rfgOutput * (1 - lag) + m.speed * lag;

        // ── 4. 速度限制 & 停车
        if (!isRunning && s !== 'S7') {
            newSpeed = 0;
            m.rfgOutput = 0;
        }
        newSpeed = Math.max(-p.P1082 * 1.1, Math.min(p.P1082 * 1.1, newSpeed));
        m.speed  = newSpeed;

        // ── 5. 电气量计算
        const speedRatio = Math.abs(m.speed) / m.ratedSpeed;
        m.frequency = fOut;
        m.voltage   = vOut;
        m.torque    = T_elec;

        // 电流：磁化电流 + 有效电流（近似）
        const I_mag  = m.ratedCurrent * 0.32;
        const I_act  = Math.min(m.ratedCurrent * (this._p.P0640 / 100),
                        Math.sqrt(I_mag*I_mag + Math.pow(Math.abs(this._loadTorque)/m.ratedTorque * m.ratedCurrent, 2)));
        m.current = isRunning ? Math.max(I_mag * vRatio, I_act) : 0;

        // 功率
        m.power = isRunning ? (Math.abs(m.torque) * Math.abs(m.speed) * Math.PI / 30) / 1000 : 0;

        // ── 6. 热模型
        const P_loss    = m.power * (1 - m.efficiency) + (m.current * m.current * 0.1);  // 近似损耗
        const C_thermal = 800;   // 热容
        const k_cool    = 5.0;   // 散热系数（随转速增加）
        const k_eff     = k_cool * (0.5 + 0.5 * speedRatio);
        this._tempMotor += (P_loss * 1000 - k_eff * (this._tempMotor - this._p.P0625)) / C_thermal * dtS;
        this._tempInvt  += (P_loss * 500  - 3.0 * (this._tempInvt  - this._p.P0625)) / 500 * dtS;
        this._tempMotor  = Math.max(this._p.P0625, this._tempMotor);
        this._tempInvt   = Math.max(this._p.P0625, this._tempInvt);

        // ── 7. 更新 r 参数
        this._r.r0020 = m.speed;
        this._r.r0021 = m.frequency;
        this._r.r0022 = m.voltage;
        this._r.r0024 = m.current;
        this._r.r0025 = m.torque;
        this._r.r0027 = m.power;
        this._r.r0034 = this._tempMotor;
        this._r.r0035 = this._tempInvt;
        this._r.r0038 = m.dcBusVoltage;

        // ── 8. NIST_A（实际转速标幺化）
        this._nist = Math.round((m.speed / this._p.P2000) * 16384);
        this._nist = Math.max(-16384, Math.min(16384, this._nist));

        // ── 9. 编码器仿真
        this._encoder.speedRpm     = m.speed;
        this._encoder.positionPulses += (m.speed / 60) * 1024 * dtS;  // 1024线/圈编码器

        // ── 10. AO 输出（根据 P0776/P0777 功能）
        this._ao[0] = (Math.abs(m.speed) / this._p.P2000) * 20;  // AO0：速度反馈 0~20mA
        this._ao[1] = (m.current / m.ratedCurrent) * 20;          // AO1：电流反馈 0~20mA

        // ── 11. DO 输出（根据 P0731）
        this._do[0] = (s === 'S4') ? 1 : 0;  // DO0：运行中继电器

        // ── 12. 保护检查
        this._checkProtection();
    }

    // ── 保护检查 ─────────────────────────────────────────────────────

    _checkProtection() {
        const m = this._motor;
        // 过电流
        if (m.current > m.ratedCurrent * (this._p.P0640 / 100) * 1.05) {
            this._triggerFault('F0011', `电机过流: ${m.current.toFixed(1)}A > ${(m.ratedCurrent*(this._p.P0640/100)).toFixed(1)}A`);
        }
        // 电机过温
        if (this._tempMotor > 100) {
            this._triggerFault('F0004', `电机过温: ${this._tempMotor.toFixed(1)}°C`);
        } else if (this._tempMotor > 85) {
            this._triggerAlarm('A0502', `电机过热警告: ${this._tempMotor.toFixed(1)}°C`);
        }
        // 变频器过温
        if (this._tempInvt > 95) {
            this._triggerFault('F0003', `变频器过温: ${this._tempInvt.toFixed(1)}°C`);
        }
    }

    // ── 故障 / 报警管理 ────────────────────────────────────────────────

    _triggerFault(code, msg) {
        if (!this._faults.find(f => f.code === code)) {
            this._faults.push({ code, msg, ts: new Date().toLocaleTimeString('zh-CN', {hour12:false}) });
            this._pnLog('error', `故障 ${code}: ${msg}`);
            // 停机
            this._motor.targetSpeed = 0;
            this._motor.rfgOutput   = 0;
        }
    }

    _triggerAlarm(code, msg) {
        if (!this._alarms.find(a => a.code === code)) {
            this._alarms.push({ code, msg, ts: new Date().toLocaleTimeString('zh-CN', {hour12:false}) });
            this._pnLog('warn', `报警 ${code}: ${msg}`);
        }
    }

    _clearAlarm(code) {
        this._alarms = this._alarms.filter(a => a.code !== code);
    }

    _clearAllFaults() {
        this._faults  = [];
        this._alarms  = this._alarms.filter(a => !a.code.startsWith('F'));
        this._pnLog('info', '所有故障已清除');
    }

    // ── 工具函数 ──────────────────────────────────────────────────────

    _nsetToRpm(nset) {
        // 标幺值 → rpm（0x4000=16384 = P2000 rpm）
        return (nset / 16384) * this._p.P2000;
    }

    _stopImmediate() {
        this._motor.speed     = 0;
        this._motor.rfgOutput = 0;
        this._motor.targetSpeed = 0;
        this._pnLog('warn', 'OFF2 惰走停车');
    }

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
        const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 });
        this._pn.diagBuffer.unshift({ level, msg, ts });
        if (this._pn.diagBuffer.length > 32) this._pn.diagBuffer.pop();
    }

    // ═══════════════════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════════════════

    _registerPorts() {
        const pp = this._portPos;
        this.addPort(pp.PN_P1.x, pp.PN_P1.y, 'PN_P1', 'bus');
        this.addPort(pp.PN_P2.x, pp.PN_P2.y, 'PN_P2', 'bus');
        for (let i = 0; i < 5; i++) this.addPort(pp[`DI${i}`].x, pp[`DI${i}`].y, `DI${i}`, 'wire', 'p');
        this.addPort(pp.DO0.x,  pp.DO0.y,  'DO0',  'wire');
        this.addPort(pp.AI0.x,  pp.AI0.y,  'AI0',  'wire', 'p');
        this.addPort(pp.AI1.x,  pp.AI1.y,  'AI1',  'wire', 'p');
        this.addPort(pp.AO0.x,  pp.AO0.y,  'AO0',  'wire');
        this.addPort(pp.AO1.x,  pp.AO1.y,  'AO1',  'wire');
        this.addPort(pp.U.x,    pp.U.y,    'U',    'wire');
        this.addPort(pp.V.x,    pp.V.y,    'V',    'wire');
        this.addPort(pp.W.x,    pp.W.y,    'W',    'wire');
        this.addPort(pp.L1.x,   pp.L1.y,   'L1',   'wire', 'p');
        this.addPort(pp.L2.x,   pp.L2.y,   'L2',   'wire', 'p');
        this.addPort(pp.L3.x,   pp.L3.y,   'L3',   'wire', 'p');
        this.addPort(pp.PE.x,   pp.PE.y,   'PE',   'wire', 'p');
    }

    // ═══════════════════════════════════════════════════════════════════
    // 绘图
    // ═══════════════════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    _drawStaticParts() {
        this._drawBody();
        this._drawTopBar();
        this._drawPNPorts();
        this._drawBOPFrame();
        this._drawTerminalStrip();
        this._drawPowerModule();
        this._drawNameplate();
        this._drawDINRail();
        this._drawHeatSlots();
    }

    _drawBody() {
        const b = this._body;
        // SINAMICS 主体：深灰蓝（与 S7-200 的灰色区别）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: b.w, y: 0 },
            fillLinearGradientColorStops: [0,'#2a3040', 0.2,'#353c50', 0.8,'#2e3448', 1,'#242838'],
            stroke: '#4a5268', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 10, shadowOffsetX: 3, shadowOffsetY: 4, shadowOpacity: 0.35,
        }));
        // 左侧橙色竖条（SINAMICS 品牌色）
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: b.h * 0.075, width: 5, height: b.h * 0.85,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: 0, y: b.h },
            fillLinearGradientColorStops: [0,'#e8600a', 0.5,'#f87010', 1,'#c84808'],
            cornerRadius: [b.rx, 0, 0, b.rx],
        }));
        // 右侧高光
        this._staticGroup.add(new Konva.Rect({
            x: b.w - 4, y: 4, width: 3, height: b.h - 8,
            fill: 'rgba(255,255,255,0.08)',
            cornerRadius: [0, b.rx, b.rx, 0],
        }));
    }

    _drawTopBar() {
        const W = this.width, H = this.height;
        // 顶部橙色色带（SINAMICS 特有）
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.075,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: W, y: 0 },
            fillLinearGradientColorStops: [0,'#c84808', 0.3,'#e8600a', 0.7,'#e8600a', 1,'#c04000'],
            cornerRadius: [3, 3, 0, 0],
        }));
        // SINAMICS 品牌
        this._staticGroup.add(new Konva.Text({
            x: 10, y: H * 0.010,
            text: 'SINAMICS',
            fontSize: Math.max(7, H * 0.026),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold', fill: '#ffffff', letterSpacing: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 10, y: H * 0.044,
            text: 'G120  CU250S-2 PN',
            fontSize: Math.max(5, H * 0.020),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#ffd0a0', letterSpacing: 0.5,
        }));
        // PROFINET 标志（右侧）
        this._staticGroup.add(new Konva.Text({
            x: W * 0.64, y: H * 0.008,
            text: 'PROFINET',
            fontSize: Math.max(5, H * 0.016),
            fontFamily: 'Arial Narrow', fontStyle: 'bold',
            fill: '#88ff44',
        }));
        this._staticGroup.add(new Konva.RegularPolygon({
            x: W * 0.94, y: H * 0.042, sides: 3, radius: H * 0.022,
            fill: '#88ff44', stroke: '#44aa22', strokeWidth: 0.8,
        }));
    }

    _drawPNPorts() {
        const H = this.height;
        const drawPort = (rect, label) => {
            // RJ45 外框（绿色边框，PROFINET 标志色）
            this._staticGroup.add(new Konva.Rect({
                x: rect.x, y: rect.y, width: rect.w, height: rect.h,
                fill: '#0f1a10', stroke: '#2a6a2a', strokeWidth: 1.2, cornerRadius: 2,
            }));
            // 8针触点
            for (let k = 0; k < 8; k++) {
                this._staticGroup.add(new Konva.Rect({
                    x: rect.x + rect.w * (0.08 + k * 0.108),
                    y: rect.y + rect.h * 0.18,
                    width: rect.w * 0.075, height: rect.h * 0.58,
                    fill: '#c8c060',
                }));
            }
            this._staticGroup.add(new Konva.Text({
                x: rect.x, y: rect.y + rect.h + 2,
                text: label,
                fontSize: Math.max(5, H * 0.017),
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: '#44aa44', align: 'center', width: rect.w,
            }));
        };
        drawPort(this._pnP1Port, 'PN P1');
        drawPort(this._pnP2Port, 'PN P2');
    }

    _drawBOPFrame() {
        const b = this._bopArea, H = this.height;
        // BOP-2 外框（深色，可拆卸面板感）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#1a1e26', stroke: '#3a3e4a', strokeWidth: 1,
            cornerRadius: 3,
        }));
        // LCD 背景
        this._staticGroup.add(new Konva.Rect({
            x: this._lcdArea.x, y: this._lcdArea.y,
            width: this._lcdArea.w, height: this._lcdArea.h,
            fill: '#0a1a0a', stroke: '#1a3a1a', strokeWidth: 1, cornerRadius: 2,
        }));
        // BOP 按键（静态底座）
        this._bopBtns.forEach(btn => {
            this._staticGroup.add(new Konva.Circle({
                x: btn.x, y: btn.y, radius: btn.r,
                fill: '#252830', stroke: '#3a3e4a', strokeWidth: 1,
            }));
        });
    }

    _drawTerminalStrip() {
        const t = this._terminalArea, H = this.height, W = this.width;
        // 端子排背景
        this._staticGroup.add(new Konva.Rect({
            x: t.x, y: t.y, width: t.w, height: t.h,
            fill: '#1a1e26', stroke: '#2a2e3a', strokeWidth: 1, cornerRadius: 2,
        }));
        // 端子标签
        const terminals = [
            {x:0.10,label:'DI0',color:'#4a90d0'},
            {x:0.18,label:'DI1',color:'#4a90d0'},
            {x:0.26,label:'DI2',color:'#4a90d0'},
            {x:0.34,label:'DI3',color:'#4a90d0'},
            {x:0.42,label:'DI4',color:'#4a90d0'},
            {x:0.50,label:'DO0',color:'#f07030'},
            {x:0.58,label:'AI0',color:'#44cc88'},
            {x:0.66,label:'AI1',color:'#44cc88'},
            {x:0.74,label:'AO0',color:'#44aacc'},
            {x:0.82,label:'AO1',color:'#44aacc'},
        ];
        terminals.forEach(tm => {
            const tx = t.x + t.w * (tm.x - t.x / W);
            // 端子孔
            this._staticGroup.add(new Konva.Rect({
                x: W * tm.x - 4, y: t.y + t.h * 0.12,
                width: 8, height: t.h * 0.50,
                fill: '#3a3e4a', stroke: '#2a2e38', strokeWidth: 0.5, cornerRadius: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: W * tm.x - 8, y: t.y + t.h * 0.66,
                text: tm.label, fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Arial', fill: tm.color, width: 18, align: 'center',
            }));
        });
        // 电机 U/V/W 端子（底部）
        const uvw = ['U','V','W'];
        uvw.forEach((lbl, i) => {
            this._staticGroup.add(new Konva.Rect({
                x: W * (0.16 + i * 0.20) - 5, y: t.y + t.h * 0.64,
                width: 10, height: t.h * 0.30,
                fill: ['#cc2020','#202020','#808020'][i],
                stroke: '#111', strokeWidth: 0.8, cornerRadius: 1,
            }));
            this._staticGroup.add(new Konva.Text({
                x: W * (0.16 + i * 0.20) - 8, y: t.y - H * 0.025,
                text: lbl, fontSize: Math.max(5, H * 0.018),
                fontFamily: 'Arial', fontStyle: 'bold',
                fill: ['#ff6060','#c0c0c0','#ffff40'][i],
                width: 18, align: 'center',
            }));
        });
    }

    _drawPowerModule() {
        const pm = this._powerModule, H = this.height, W = this.width;
        // 功率模块底部散热器区域（深色，金属感）
        this._staticGroup.add(new Konva.Rect({
            x: pm.x, y: pm.y, width: pm.w, height: pm.h,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint:   { x: pm.w, y: 0 },
            fillLinearGradientColorStops: [0,'#1a1e26', 0.5,'#222830', 1,'#1a1e26'],
            stroke: '#3a3e4a', strokeWidth: 1,
        }));
    }

    _drawNameplate() {
        const np = this._nameplate, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fill: '#f0ece0', stroke: '#aaa', strokeWidth: 0.8, cornerRadius: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 4, y: np.y + 2,
            text: `G120 PM240-2  ${this._p.P0307}kW`,
            fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Arial Narrow, Arial, sans-serif', fontStyle: 'bold',
            fill: '#1a1a1a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 4, y: np.y + np.h * 0.54,
            text: '6SL3210-1PE21-4UL0  400V/17A',
            fontSize: Math.max(4, H * 0.015),
            fontFamily: 'Consolas, monospace', fill: '#555',
        }));
    }

    _drawDINRail() {
        const dr = this._dinRail;
        this._staticGroup.add(new Konva.Rect({
            x: dr.x, y: dr.y, width: dr.w, height: dr.h,
            fill: '#b0b4b8', stroke: '#888', strokeWidth: 0.5,
            cornerRadius: [0, 0, 3, 3],
        }));
        [0.08, 0.88].forEach(px => {
            this._staticGroup.add(new Konva.Rect({
                x: dr.x + dr.w * px, y: dr.y,
                width: dr.w * 0.06, height: dr.h * 0.65,
                fill: '#777', stroke: '#555', strokeWidth: 0.5, cornerRadius: [0, 0, 2, 2],
            }));
        });
    }

    _drawHeatSlots() {
        this._heatSlots.forEach(hs => {
            this._staticGroup.add(new Konva.Rect({
                x: hs.x, y: hs.y, width: hs.w, height: hs.h,
                fill: '#141820', stroke: '#2a2e38', strokeWidth: 0.5, cornerRadius: 1,
            }));
        });
    }

    // ── 动态部件 ─────────────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawPNLEDs_dyn();
        this._drawBOP_dyn();
        this._drawStatusLEDs_dyn();
        this._drawDrivePanel_dyn();
        this._drawTerminalLEDs_dyn();
        this._drawHeatBar_dyn();
    }

    _drawLED(x, y, r, on, color_on, color_off, glowColor) {
        this._dynamicGroup.add(new Konva.Circle({
            x, y, radius: r,
            fill:        on ? color_on  : color_off,
            stroke:      on ? '#888'    : '#333',
            strokeWidth: 0.8,
            shadowColor: on ? glowColor : 'transparent',
            shadowBlur:  on ? r * 3.5   : 0,
            shadowOpacity: 0.9,
        }));
    }

    _drawPNLEDs_dyn() {
        const pn   = this._pn;
        const leds = this._pnLEDs;
        const H    = this.height;

        const linkOn1 = pn.p1.link;
        const actBlink1 = linkOn1 && (Math.floor(performance.now() / 120) % 2 === 0);
        const linkOn2 = pn.p2.link;
        const actBlink2 = linkOn2 && (Math.floor(performance.now() / 150) % 2 === 0);

        this._drawLED(leds.p1Lnk.x, leds.p1Lnk.y, leds.p1Lnk.r, linkOn1,  '#44dd44','#001100','#44dd44');
        this._drawLED(leds.p1Act.x, leds.p1Act.y, leds.p1Act.r, actBlink1,'#f07030','#110500','#f07030');
        this._drawLED(leds.p2Lnk.x, leds.p2Lnk.y, leds.p2Lnk.r, linkOn2,  '#44dd44','#001100','#44dd44');
        this._drawLED(leds.p2Act.x, leds.p2Act.y, leds.p2Act.r, actBlink2,'#f07030','#110500','#f07030');

        // 端口状态标注
        const fs = Math.max(4, H * 0.014);
        const stateColor = { OPERATE:'#44dd44', STARTUP:'#f5c842', OFFLINE:'#444', STOP:'#ee4444' }[pn.state] || '#444';
        this._dynamicGroup.add(new Konva.Text({
            x: leds.p1Act.x + leds.p1Act.r + 3, y: leds.p1Act.y - leds.p1Act.r,
            text: pn.state, fontSize: fs,
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: stateColor,
        }));
        if (pn.arEstablished) {
            this._dynamicGroup.add(new Konva.Text({
                x: leds.p2Act.x + leds.p2Act.r + 3, y: leds.p2Act.y - leds.p2Act.r,
                text: `TX:${pn.txFrames}`, fontSize: fs,
                fontFamily: 'Consolas, monospace', fill: '#2a5a2a',
            }));
        }
    }

    _drawBOP_dyn() {
        const lcd = this._lcdArea, H = this.height;
        const m   = this._motor;
        const s   = this._driveState;

        // LCD 背光（运行时绿色，故障时红色，待机时暗绿）
        const hasFault = this._faults.length > 0;
        const isRun    = (s === 'S3' || s === 'S4' || s === 'S5');
        const lcdBg    = hasFault ? '#1a0000' : isRun ? '#001a08' : '#001208';
        this._dynamicGroup.add(new Konva.Rect({
            x: lcd.x, y: lcd.y, width: lcd.w, height: lcd.h,
            fill: lcdBg, cornerRadius: 2,
        }));

        // LCD 第1行：频率/转速/故障
        let line1 = '', line2 = '';
        if (hasFault) {
            line1 = `FAULT: ${this._faults[0]?.code}`;
            line2 = (this._faults[0]?.msg || '').slice(0, 18);
        } else if (s === 'S1') {
            line1 = 'STARTUP...';
            line2 = '等待就绪';
        } else if (s === 'S2') {
            line1 = 'READY  OFF';
            line2 = `n=0.0rpm`;
        } else {
            const sign = m.speed < 0 ? '▼' : '▲';
            line1 = `${sign} ${Math.abs(m.frequency).toFixed(1).padStart(5)} Hz`;
            line2 = `${Math.abs(m.speed).toFixed(0).padStart(5)} rpm`;
        }

        const txtColor = hasFault ? '#ff6060' : isRun ? '#44ee88' : '#44aa66';
        const lcdFontSize = Math.max(6, H * 0.023);

        this._dynamicGroup.add(new Konva.Text({
            x: lcd.x + 6, y: lcd.y + lcd.h * 0.08,
            text: line1, fontSize: lcdFontSize,
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: txtColor,
        }));
        this._dynamicGroup.add(new Konva.Text({
            x: lcd.x + 6, y: lcd.y + lcd.h * 0.54,
            text: line2, fontSize: lcdFontSize,
            fontFamily: 'Consolas, monospace',
            fill: hasFault ? '#ff4040' : '#2a8a40',
        }));

        // BOP 按键标签（动态）
        const fs = Math.max(5, H * 0.017);
        this._bopBtns.forEach(btn => {
            this._dynamicGroup.add(new Konva.Text({
                x: btn.x - btn.r, y: btn.y - btn.r * 0.65,
                text: btn.label, fontSize: fs,
                fontFamily: 'Arial', fill: '#7090b0',
                width: btn.r * 2, align: 'center',
            }));
        });
    }

    _drawStatusLEDs_dyn() {
        const sl  = this._statusLEDs;
        const s   = this._driveState;
        const H   = this.height;
        const hasFault = this._faults.length > 0;
        const hasAlarm = this._alarms.length > 0;
        const isRun    = (s === 'S3' || s === 'S4' || s === 'S5');
        const isReady  = (s !== 'S1') && !hasFault;

        // RDY（绿色）
        this._drawLED(sl.rdy.x, sl.rdy.y, sl.rdy.r, isReady,  '#44cc44','#002200','#44cc44');
        // RUN（绿色，运行中闪烁）
        const runOn = isRun && (s === 'S4' || Math.floor(performance.now()/500)%2===0);
        this._drawLED(sl.run.x, sl.run.y, sl.run.r, runOn,   '#44cc44','#002200','#44cc44');
        // FAULT（红色）
        const faultBlink = hasFault && (Math.floor(performance.now()/400)%2===0);
        this._drawLED(sl.fault.x, sl.fault.y, sl.fault.r, faultBlink,'#ee3333','#220000','#ee3333');
        // ALM（橙色，报警时闪烁）
        const almBlink = hasAlarm && (Math.floor(performance.now()/600)%2===0);
        this._drawLED(sl.alarm.x, sl.alarm.y, sl.alarm.r, almBlink, '#f07030','#1a0800','#f07030');

        // LED 标签
        const fs = Math.max(4, H * 0.014);
        const ledData = [
            { led: sl.rdy,   label:'RDY',   on:isReady,  color:'#44cc44' },
            { led: sl.run,   label:'RUN',   on:runOn,    color:'#44cc44' },
            { led: sl.fault, label:'FAULT', on:hasFault, color:'#ee3333' },
            { led: sl.alarm, label:'ALM',   on:hasAlarm, color:'#f07030' },
        ];
        ledData.forEach(d => {
            this._dynamicGroup.add(new Konva.Text({
                x: d.led.x - d.led.r * 1.2, y: d.led.y + d.led.r + 3,
                text: d.label, fontSize: fs, fontFamily: 'Arial',
                fill: d.on ? d.color : '#3a3a3a',
                width: d.led.r * 2.5, align: 'center',
            }));
        });
    }

    _drawDrivePanel_dyn() {
        const dp = this._drivePanel, H = this.height;
        const m  = this._motor;

        // 面板背景
        this._dynamicGroup.add(new Konva.Rect({
            x: dp.x, y: dp.y, width: dp.w, height: dp.h,
            fill: '#080c14', stroke: '#1a2030', strokeWidth: 0.8, cornerRadius: 2,
        }));

        const fs = Math.max(5, H * 0.019);
        const col_val  = '#44ddaa';
        const col_unit = '#4a6070';
        const col_lbl  = '#304050';

        // 参数显示（6个值，2行×3列）
        const params = [
            { lbl:'n',  val: Math.abs(m.speed).toFixed(0),    unit:'rpm', color:col_val },
            { lbl:'f',  val: Math.abs(m.frequency).toFixed(1),unit:'Hz',  color:col_val },
            { lbl:'I',  val: m.current.toFixed(1),            unit:'A',   color:this._faults.find(f=>f.code==='F0011')?'#ff6060':col_val },
            { lbl:'U',  val: m.voltage.toFixed(0),            unit:'V',   color:col_val },
            { lbl:'P',  val: m.power.toFixed(2),              unit:'kW',  color:col_val },
            { lbl:'T°', val: this._tempMotor.toFixed(0),      unit:'°C',  color:this._tempMotor>80?'#ff8800':col_val },
        ];

        const cols = 3, rows = 2;
        const cW = dp.w / cols, cH = dp.h / rows;

        params.forEach((param, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            const px  = dp.x + col * cW, py = dp.y + row * cH;

            this._dynamicGroup.add(new Konva.Text({
                x: px + 3, y: py + 2,
                text: param.lbl, fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Arial', fill: col_lbl,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: px + 3, y: py + cH * 0.35,
                text: param.val, fontSize: fs,
                fontFamily: 'Consolas, monospace', fontStyle: 'bold',
                fill: param.color,
            }));
            this._dynamicGroup.add(new Konva.Text({
                x: px + cW * 0.65, y: py + cH * 0.68,
                text: param.unit, fontSize: Math.max(4, H * 0.015),
                fontFamily: 'Arial', fill: col_unit,
            }));
        });

        // STW1 / ZSW1 显示（底部小字）
        this._dynamicGroup.add(new Konva.Text({
            x: dp.x + 3, y: dp.y + dp.h - H * 0.026,
            text: `STW:${this._stw1.toString(16).padStart(4,'0').toUpperCase()}  ZSW:${this._zsw1.toString(16).padStart(4,'0').toUpperCase()}  NSET:${this._nset}  NIST:${this._nist}`,
            fontSize: Math.max(4, H * 0.014),
            fontFamily: 'Consolas, monospace', fill: '#2a4050',
        }));

        // 状态字符串
        const stateStr = {S1:'上电',S2:'就绪/OFF',S3:'加速',S4:'运行',S5:'减速',S6:'故障',S7:'快停'}[this._driveState] || '?';
        this._dynamicGroup.add(new Konva.Text({
            x: dp.x + dp.w * 0.60, y: dp.y + 2,
            text: stateStr, fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: this._driveState === 'S4' ? '#44cc44' :
                  this._driveState === 'S6' ? '#ee4444' :
                  this._driveState === 'S2' ? '#aaaaaa' : '#f5c842',
        }));

        // 速度条
        const barX = dp.x + 3, barY = dp.y + dp.h - H * 0.040;
        const barW  = dp.w - 6, barH = H * 0.010;
        const pct   = Math.abs(m.speed) / this._p.P2000;
        const barFill = m.speed < 0 ? '#4aaccc' : '#44aacc';
        this._dynamicGroup.add(new Konva.Rect({
            x: barX, y: barY, width: barW, height: barH,
            fill: '#080c14', stroke: '#1a2030', strokeWidth: 0.5, cornerRadius: barH/2,
        }));
        if (pct > 0.002) {
            this._dynamicGroup.add(new Konva.Rect({
                x: barX, y: barY, width: barW * Math.min(1, pct), height: barH,
                fill: barFill, cornerRadius: barH/2,
                shadowColor: barFill, shadowBlur: 3, shadowOpacity: 0.7,
            }));
        }

        // 标签
        this._dynamicGroup.add(new Konva.Text({
            x: dp.x + 3, y: barY - H * 0.018,
            text: this.label, fontSize: Math.max(5, H * 0.017),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#4a6080',
        }));
    }

    _drawTerminalLEDs_dyn() {
        const H = this.height, W = this.width;
        // DI LED
        for (let i = 0; i < 5; i++) {
            const x = W * (0.10 + i * 0.08);
            const y = this._terminalArea.y + this._terminalArea.h * 0.82;
            const on = this._di[i] > 0;
            this._dynamicGroup.add(new Konva.Circle({
                x, y, radius: H * 0.010,
                fill: on ? '#f5c842' : '#1a1500',
                shadowColor: on ? '#f5c842' : 'transparent',
                shadowBlur: on ? 4 : 0, shadowOpacity: 0.9,
            }));
        }
        // DO LED
        const dox = W * 0.50, doy = this._terminalArea.y + this._terminalArea.h * 0.82;
        this._drawLED(dox, doy, H*0.010, this._do[0]>0, '#f07030','#110500','#f07030');
    }

    _drawHeatBar_dyn() {
        const H = this.height, W = this.width;
        // 变频器温度条（散热栅格区域）
        const tempPct = Math.min(1, (this._tempInvt - 20) / 80);
        const tempColor = tempPct > 0.8 ? '#ee4444' : tempPct > 0.6 ? '#f5c842' : '#44aacc';
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.63, y: H * 0.808,
            text: `${this._tempInvt.toFixed(0)}°C`,
            fontSize: Math.max(5, H * 0.016),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: tempColor,
        }));
    }

    // ── 交互绑定 ─────────────────────────────────────────────────────

    _bindInteraction() {
        const H = this.height;

        // BOP 按键交互
        this._bopBtns.forEach(btn => {
            const hit = new Konva.Circle({
                x: btn.x, y: btn.y, radius: btn.r * 2.5, fill: 'transparent',
            });
            hit.on('click tap', () => this._bopButtonPress(btn.id));
            this._interactGroup.add(hit);
        });

        // PN P1 端口点击：切换连接状态
        const p1 = this._pnP1Port;
        const hitP1 = new Konva.Rect({
            x: p1.x, y: p1.y, width: p1.w, height: p1.h, fill: 'transparent',
        });
        hitP1.on('click tap', () => {
            if (this._pn.arEstablished) this.disconnectFromController();
            else if (this._controller)  this.connectToController(this._controller, this._controllerSlot);
        });
        this._interactGroup.add(hitP1);

        // DI 端子点击（手动切换输入）
        for (let i = 0; i < 5; i++) {
            const x = this.width * (0.10 + i * 0.08);
            const y = this._terminalArea.y + this._terminalArea.h * 0.82;
            const hit = new Konva.Circle({ x, y, radius: H * 0.025, fill: 'transparent' });
            const idx = i;
            hit.on('click tap', () => {
                this._di[idx] = this._di[idx] > 0 ? 0 : 1;
                this._rebuildDynamic(); this.markDirty();
            });
            this._interactGroup.add(hit);
        }
    }

    _bopButtonPress(id) {
        switch (id) {
            case 'OK':
                // 手动 RUN（BOP 控制模式下）
                if (this._driveState === 'S2') {
                    this._stw1 = 0x047F;  // ON+使能+斜坡
                    this._nset = Math.round(this._p.P1082 / this._p.P2000 * 16384 * 0.5);
                }
                break;
            case 'ESC':
                // 手动 STOP
                this._stw1 = 0x047E;  // OFF1
                break;
            case 'UP':
                // 速度+10%
                this._nset = Math.min(16384, this._nset + Math.round(16384 * 0.1));
                break;
            case 'DN':
                // 速度-10%
                this._nset = Math.max(-16384, this._nset - Math.round(16384 * 0.1));
                break;
            case 'MODE':
                // 故障确认
                if (this._faults.length > 0) {
                    this._clearAllFaults();
                    this._driveState = 'S2';
                }
                break;
        }
        this._rebuildDynamic(); this.markDirty();
    }

    // ═══════════════════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════════════════

    tick(dt) {
        const dtMs = dt * 1000;
        const dtS  = dt;

        // PN 调度器
        this._pnTickScheduler();

        // PROFINET 数据交换（每周期）
        this._pnCycleExchange(dtMs);

        // 驱动状态机（每 tick）
        this._execStateMachine(dtS);

        // 电机物理仿真
        this._simMotor(dtS);

        // 构建 ZSW1 并更新
        this._zsw1 = this._buildZSW1();

        // 重绘（约20fps，每3帧一次完整重绘）
        this._rebuildDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════════════

    /** 设置转速给定（标幺值 -16384~+16384，或直接 rpm） */
    setSpeedRef(value, unit = 'pu') {
        if (unit === 'rpm') {
            this._nset = Math.round((value / this._p.P2000) * 16384);
        } else {
            this._nset = Math.round(value);
        }
        this._nset = Math.max(-16384, Math.min(16384, this._nset));
    }

    /** 获取实际转速 rpm */
    getActualSpeed() { return this._motor.speed; }

    /** 获取实际频率 Hz */
    getActualFrequency() { return this._motor.frequency; }

    /** 获取输出电流 A */
    getActualCurrent() { return this._motor.current; }

    /** 获取输出功率 kW */
    getActualPower() { return this._motor.power; }

    /** 设置 STW1 控制字（直接写入，适用于脚本测试） */
    setSTW1(stw1) { this._stw1 = stw1 & 0xFFFF; }

    /** 读取 ZSW1 状态字 */
    getZSW1() { return this._zsw1; }

    /** 设置外部负载转矩 N·m */
    setLoadTorque(Nm) {
        this._loadTorque = Math.max(0, Nm);
    }

    /** 设置外部负载惯量 kg·m² */
    setLoadInertia(kgm2) {
        this._loadInertia = Math.max(0, kgm2);
    }

    /** 读取参数 P */
    getParam(pNum) {
        return this._p[`P${pNum}`] !== undefined ? this._p[`P${pNum}`] : null;
    }

    /** 写入参数 P */
    setParam(pNum, value) {
        const key = `P${pNum}`;
        if (this._p[key] !== undefined) {
            this._p[key] = value;
            // 特殊参数重新计算
            if (pNum === 8864) {
                this._telegramType = value;
                this._configTelegram(value);
            }
            if (pNum === 2000) {
                this._motor.ratedSpeed = Math.max(1, value);
            }
        }
    }

    /** 读取 r 参数 */
    getR(rNum) {
        return this._r[`r${String(rNum).padStart(4,'0')}`];
    }

    /** 手动触发故障 */
    triggerFault(code, msg) {
        this._triggerFault(code, msg || `故障 ${code}`);
    }

    /** 清除故障（需 STW1.bit7 应答或调用此函数） */
    clearFaults() {
        this._clearAllFaults();
        if (this._driveState === 'S6') this._driveState = 'S2';
    }

    /** PROFINET 状态 */
    pnGetState()      { return this._pn.state; }
    pnIsOperating()   { return this._pn.arEstablished; }
    pnGetStats()      { return { txFrames: this._pn.txFrames, rxFrames: this._pn.rxFrames, missedCycles: this._pn.missedCycles }; }
    pnGetDiagBuffer() { return this._pn.diagBuffer; }

    /** 获取完整驱动状态快照 */
    getDriveSnapshot() {
        return {
            state:       this._driveState,
            speed:       this._motor.speed,
            frequency:   this._motor.frequency,
            current:     this._motor.current,
            voltage:     this._motor.voltage,
            torque:      this._motor.torque,
            power:       this._motor.power,
            tempMotor:   this._tempMotor,
            tempInvt:    this._tempInvt,
            stw1:        this._stw1,
            zsw1:        this._zsw1,
            nset:        this._nset,
            nist:        this._nist,
            faults:      [...this._faults],
            alarms:      [...this._alarms],
            pnConnected: this._pn.arEstablished,
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label:'位号',              key:'label',          type:'text'   },
            { label:'PROFINET 站名',     key:'stationName',    type:'text'   },
            { label:'PROFINET IP',       key:'pnIP',           type:'text'   },
            { label:'报文类型(1/20/350)', key:'telegramType',   type:'number' },
            { label:'电机额定功率 kW',    key:'motorPower',     type:'number' },
            { label:'电机额定转速 rpm',   key:'motorRatedSpeed',type:'number' },
            { label:'电机额定电流 A',     key:'motorRatedCurrent',type:'number'},
            { label:'加速时间 s',         key:'rampUp',         type:'number' },
            { label:'减速时间 s',         key:'rampDown',       type:'number' },
            { label:'参考转速 rpm(P2000)',key:'refSpeed',       type:'number' },
            { label:'最大转速 rpm',       key:'maxSpeed',       type:'number' },
            { label:'控制模式(P1300)',    key:'controlMode',    type:'select', options:['0(V/f线性)','20(无传感矢量)','21(有传感矢量)'] },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label           !== undefined) this.label          = cfg.label;
        if (cfg.stationName     !== undefined) this._pn.stationName= cfg.stationName;
        if (cfg.pnIP            !== undefined) this._pn.ip         = cfg.pnIP;
        if (cfg.telegramType    !== undefined) { this._telegramType=parseInt(cfg.telegramType)||1; this._configTelegram(this._telegramType); }
        if (cfg.motorPower      !== undefined) { this._p.P0307     = parseFloat(cfg.motorPower)||7.5;   this._initMotorModel(); }
        if (cfg.motorRatedSpeed !== undefined) { this._p.P0311     = parseFloat(cfg.motorRatedSpeed)||1450; this._initMotorModel(); }
        if (cfg.motorRatedCurrent!==undefined) { this._p.P0305    = parseFloat(cfg.motorRatedCurrent)||17;  this._initMotorModel(); }
        if (cfg.rampUp          !== undefined) this._p.P1120       = Math.max(0.1, parseFloat(cfg.rampUp)||10);
        if (cfg.rampDown        !== undefined) this._p.P1121       = Math.max(0.1, parseFloat(cfg.rampDown)||10);
        if (cfg.refSpeed        !== undefined) this._p.P2000       = Math.max(1, parseFloat(cfg.refSpeed)||1500);
        if (cfg.maxSpeed        !== undefined) this._p.P1082       = Math.max(1, parseFloat(cfg.maxSpeed)||1500);
        if (cfg.controlMode     !== undefined) this._p.P1300       = parseInt(cfg.controlMode)||0;

        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        this.disconnectFromController();
        super.destroy?.();
    }
}
