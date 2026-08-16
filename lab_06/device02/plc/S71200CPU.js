import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 S7-1200 CPU 1214C DC/DC/DC 仿真组件
 *
 * ══════════════════════════════════════════════════════════════════════
 *  硬件规格（CPU 1214C DC/DC/DC，订货号 6ES7 214-1AG40-0XB0）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  处理器：
 *    - 程序存储器（Work Memory）：100 KB
 *    - 装载存储器（Load Memory）：4 MB（内置）
 *    - 保持存储器：10 KB
 *    - 执行速度：位运算 0.1μs/指令，字运算 0.2μs，浮点 2.3μs
 *
 *  本体数字量 I/O：
 *    - 数字量输入：14 点（I0.0~I0.7, I1.0~I1.5）DC 24V Sink/Source
 *    - 数字量输出：10 点（Q0.0~Q0.7, Q1.0~Q1.1）DC 24V 0.5A×10
 *    - 高速计数器：6 路（最高 100kHz 单相 / 80kHz A/B相）
 *    - 脉冲输出：4 路（最高 100kHz）
 *
 *  本体模拟量 I/O：
 *    - 模拟量输入：2 路（AI0/AI1）0~10V，12位，AIW64/AIW66
 *
 *  扩展能力：
 *    - 信号板（SB）：1 块（CPU 正面槽）
 *    - 信号模块（SM）：8 块（右侧扩展）
 *    - 通信模块（CM/CP）：3 块（左侧扩展）
 *    - 最大本地 I/O：68 字节数字量输入 + 68 字节数字量输出
 *
 *  通信接口：
 *    - PROFINET（集成以太网）：1 × RJ45，支持 IO Controller / IO Device
 *    - 点对点（PtP）：通过 CM 1241 扩展（RS232/RS485）
 *    - USS / Modbus RTU：通过 CM 扩展
 *    - AS-i / IO-Link：通过 SM 扩展
 *
 *  存储区（S7-1200 地址空间）：
 *    I     过程映像输入    PII    IB0~IB67
 *    Q     过程映像输出    PIQ    QB0~QB67
 *    M     内存标志        MB0~MB8191
 *    DB    数据块          DB1~DB65535（仿真支持 DB1~DB255，每块最大 64KB）
 *    L     局部数据堆栈    LB0~LB255
 *    T     IEC 定时器      通过 DB 实现（IEC_TIMER 结构体）
 *    C     IEC 计数器      通过 DB 实现（IEC_COUNTER 结构体）
 *    AI    本体模拟量输入  AIW64/AIW66
 *
 * ══════════════════════════════════════════════════════════════════════
 *  程序组织单元（POU）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  OB（组织块）：
 *    OB1   Main（循环扫描，调用 FC/FB）
 *    OB30  Cyclic Interrupt（循环中断，可配周期 1~60000ms）
 *    OB80  Time Error
 *    OB82  Diagnostic Error
 *    OB83  Remove/Insert Module
 *    OB100 Startup（上电初始化，运行一次）
 *
 *  FC（函数，无背景 DB）：
 *    FC1   自定义逻辑（用户可添加）
 *
 *  FB（函数块，有背景 DB）：
 *    FB1   PID_Compact（集成 PID 控制器，背景 DB = DB10）
 *    FB2   用户自定义 FB
 *
 *  DB（数据块）：
 *    DB1   GlobalDB（全局 DB，可自由读写）
 *    DB10  PID_Compact 背景 DB
 *    DB100 通信数据区（供 SCADA/HMI 使用）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  指令集（在 ST20 基础上大幅扩展）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  一、基础位逻辑（继承 ST20）
 *    LD LDN A AN O ON NOT = S R
 *    P（正跳变触点）N（负跳变触点）
 *    SR（置位复位触发器）RS（复位置位触发器）
 *
 *  二、IEC 定时器（TON_DB / TOF_DB / TONR_DB / TP_DB）
 *    TON   addr, PT, ET, Q       使用 DB 背景
 *    TOF   addr, PT, ET, Q
 *    TP    addr, PT, ET, Q       脉冲定时器
 *    TONR  addr, PT, ET, Q, R    保持定时器
 *    时间参数：T#1s / T#500ms / T#2m30s（IEC TIME 格式）
 *
 *  三、IEC 计数器（CTU_DB / CTD_DB / CTUD_DB）
 *    CTU   addr, CU, R, PV, CV, Q
 *    CTD   addr, CD, LD, PV, CV, Q
 *    CTUD  addr, CU, CD, R, LD, PV, QU, QD, CV
 *
 *  四、整数运算（16/32位）
 *    ADD  IN1, IN2, OUT   (WORD/DWORD/INT/DINT)
 *    SUB  IN1, IN2, OUT
 *    MUL  IN1, IN2, OUT
 *    DIV  IN1, IN2, OUT
 *    MOD  IN1, IN2, OUT
 *    NEG  IN, OUT
 *    ABS  IN, OUT
 *    MIN  IN1, IN2, OUT
 *    MAX  IN1, IN2, OUT
 *    LIMIT MN, IN, MX, OUT
 *    INC  IN_OUT
 *    DEC  IN_OUT
 *
 *  五、浮点运算（REAL/LREAL）
 *    ADD_R  SUB_R  MUL_R  DIV_R
 *    ABS_R  NEG_R  SQRT   SQR
 *    LN     EXP    SIN    COS    TAN
 *    ASIN   ACOS   ATAN   ATAN2
 *    FRAC   EXPT
 *    ROUND  TRUNC  CEIL   FLOOR
 *
 *  六、数据类型转换
 *    INT_TO_REAL   REAL_TO_INT   REAL_TO_DINT
 *    INT_TO_DINT   DINT_TO_INT   DINT_TO_REAL
 *    WORD_TO_INT   INT_TO_WORD   BYTE_TO_WORD
 *    BCD_TO_INT    INT_TO_BCD
 *
 *  七、传送与比较
 *    MOV  IN, OUT（支持所有数据类型）
 *    MOVE_BLK  IN, COUNT, OUT（块传送）
 *    FILL_BLK  IN, COUNT, OUT（块填充）
 *    ==  <>  >=  <=  >  <（支持 BYTE/INT/DINT/REAL/WORD）
 *
 *  八、移位与循环移位
 *    SHL  SHR  ROL  ROR
 *    （支持 BYTE/WORD/DWORD）
 *
 *  九、逻辑运算
 *    AND_W  OR_W  XOR_W  INV_W
 *    AND_DW OR_DW XOR_DW INV_DW
 *
 *  十、DB 访问
 *    OPEN_DB  n              打开指定 DB（隐含在 DB.xxx 地址中）
 *    DBR_B    DB1.DBB0       读 DB 字节
 *    DBR_W    DB1.DBW0       读 DB 字
 *    DBR_D    DB1.DBD0       读 DB 双字（整数）
 *    DBR_R    DB1.DBD0       读 DB 实数
 *    DBW_B/W/D/R             写 DB
 *
 *  十一、字符串操作
 *    S_MOVE  S_CONCAT  S_LEN  S_FIND  S_COMP
 *
 *  十二、通信（Comm）
 *    TSEND_C    TCP/UDP 客户端发送
 *    TRCV_C     TCP/UDP 客户端接收
 *    TCON/TDISCON  连接/断开
 *    PUT/GET    S7 通信读写（作为 Client）
 *
 *  十三、PID_Compact（集成 PID 功能块）
 *    PID_COMPACT  DB_REF, ENABLE, SETPOINT, INPUT, OUTPUT
 *    自动/手动模式切换，内置抗积分饱和，参数整定
 *
 *  十四、运动控制（Motion Control）
 *    MC_Power     MC_Reset    MC_Home
 *    MC_MoveAbsolute  MC_MoveRelative  MC_MoveVelocity
 *    MC_Halt     MC_ReadActualPosition
 *    MC_TorqueLimit  MC_SetSensorOffset
 *
 *  十五、PROFINET 指令（与 ST20 v4 相同）
 *    PNRD  PNWR  PNST  PNDIAG
 *
 *  十六、SCADA 通信（与 ST20 v4 相同）
 *    内置 S7 Communication Server + BroadcastChannel
 *
 * ══════════════════════════════════════════════════════════════════════
 *  DB（数据块）仿真模型
 * ══════════════════════════════════════════════════════════════════════
 *
 *  _db = Map<number, { name, size, data:Uint8Array, isGlobal, isInstance }>
 *
 *  DB 地址格式：
 *    DB1.DBB0    → DB号1，字节偏移0（1字节）
 *    DB1.DBW10   → DB号1，字节偏移10（2字节，大端）
 *    DB1.DBD20   → DB号1，字节偏移20（4字节）
 *    DB1.DBX5.3  → DB号1，字节5，位3（布尔）
 *
 *  IEC 定时器结构体（存于背景 DB，占 16 字节）：
 *    +0   PT   DINT    预设时间（ms）
 *    +4   ET   DINT    已用时间（ms，只读）
 *    +8   IN   BOOL    输入信号
 *    +9   Q    BOOL    输出位
 *    +10  STATE BYTE   内部状态字
 *
 *  IEC 计数器结构体（存于背景 DB，占 12 字节）：
 *    +0   PV   DINT    预设值
 *    +4   CV   DINT    当前值
 *    +8   Q    BOOL    输出位（CTU: CV>=PV）
 *    +9   QU   BOOL    CTU/CTUD 向上计满
 *    +10  QD   BOOL    CTD/CTUD 向下计完
 *
 *  PID_Compact 背景 DB（DB10，占 128 字节）：
 *    +0   Setpoint    REAL
 *    +4   Input       REAL（过程变量）
 *    +8   Output      REAL（0.0~1.0）
 *    +12  Kp          REAL
 *    +16  Ti          REAL（积分时间，s）
 *    +20  Td          REAL（微分时间，s）
 *    +24  OutputHigh  REAL（输出上限，默认 1.0）
 *    +28  OutputLow   REAL（输出下限，默认 0.0）
 *    +32  Ix          REAL（积分累积，内部）
 *    +36  PrevInput   REAL（上次 Input，内部）
 *    +40  Mode        INT  (0=停止,1=自动,2=手动)
 *    +42  ManualValue REAL（手动输出值）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  外观描述（CPU 1214C 正面面板）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  机身颜色：浅绿/米黄（S7-1200 特有的淡绿灰色调，与 S7-200 深灰不同）
 *
 *  ┌──────────────────────────────────────┐
 *  │  SIMATIC S7-1200  [西门子蓝顶部带]    │  ← 顶部色带（绿色调）
 *  │  ┌──┐ ┌──┐ ┌──────────────────┐      │
 *  │  │E0│ │E1│ │   PROFINET RJ45  │      │  ← 通信接口区
 *  │  └──┘ └──┘ └──────────────────┘      │
 *  │  PN LED:  ○(LNK) ○(RX/TX)            │  ← PN 状态 LED
 *  │                                       │
 *  │  ○RUN  ○STOP  ○ERR  ○MAINT           │  ← 4个状态 LED
 *  │  ○SF   ○BF1   ○BF2                   │  ← 系统故障 LED
 *  │                                       │
 *  │  ┌──────────────────────────────┐    │
 *  │  │ 信号板（SB）槽位（可选）      │    │  ← 正面中央 SB 槽
 *  │  └──────────────────────────────┘    │
 *  │                                       │
 *  │  ●●●●●●●●●●●●●●  [I0.0~I1.5 LED]  │  ← 14点输入 LED（黄色）
 *  │  ●●●●●●●●●●       [Q0.0~Q1.1 LED]  │  ← 10点输出 LED（橙色）
 *  │  ●●              [AI0/AI1 指示]      │  ← 2点模拟量输入指示（绿）
 *  │                                       │
 *  │  [端子排 INPUT 24 针]                │  ← 底部接线端子
 *  │  [端子排 OUTPUT 12 针]               │
 *  ├──────────────────────────────────────┤
 *  │  [DIN 导轨]                          │
 *  └──────────────────────────────────────┘
 *
 *  右侧：扩展总线公头（SM 接口）
 *  左侧：CM 通信模块接口
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *
 *  I0.0~I0.7   → 数字量输入端口（bus, passive，底部）
 *  I1.0~I1.5   → 数字量输入端口（bus, passive，底部）
 *  Q0.0~Q0.7   → 数字量输出端口（bus，底部）
 *  Q1.0~Q1.1   → 数字量输出端口（bus，底部）
 *  AI0 / AI1   → 模拟量输入端口（wire, passive，底部）
 *  PWR_L+      → 24V DC 电源 L+（wire, passive）
 *  PWR_M       → 24V DC 电源 M（wire, passive）
 *  PN_P1       → PROFINET 以太网（bus，顶部）
 *  SM_BUS      → 右侧 SM 扩展总线（bus）
 *  CM_BUS      → 左侧 CM 扩展总线（bus）
 *  ETH_S7      → S7 通信以太网（bus，顶部，与 SCADA 连线）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  可配置参数
 * ══════════════════════════════════════════════════════════════════════
 *
 *  label            : 位号（默认 'PLC-1'）
 *  scanCycleMs      : 扫描周期 ms（默认 10）
 *  initRun          : 初始是否运行（false）
 *  cpuVariant       : 'CPU1214C'|'CPU1212C'|'CPU1215C'（默认'CPU1214C'）
 *  firmwareVersion  : 固件版本（默认 'V4.5'）
 *  ladderProgram    : OB1 梯形图 JSON
 *  ob30Program      : OB30 循环中断程序 JSON
 *  ob30CycleMs      : OB30 周期 ms（默认 100）
 *  ob100Program     : OB100 启动程序 JSON
 *
 *  PROFINET（同 ST20 v4）：
 *  pnStationName / pnIP / pnSubnet / pnGateway
 *  pnMode / pnSendClockMs / pnMRPEnabled / pnMRPRole / pnDevices
 *
 *  SCADA（同 ST20 v4）：
 *  scadaChannelName / scadaMaxClients / scadaPushIntervalMs
 *  scadaWriteEnabled / scadaAutoAccept / scadaPassword
 */
export class S71200CPU extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(300, config.width  || 380);
        this.height = Math.max(340, config.height || 420);

        this.type    = 's7_1200_cpu';
        this.special = 'plc';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initMemory();
        this._initDB();
        this._initExpansionBus();
        this._initProfinet(config);
        this._initSCADA(config);
        this._initLadderEngine();
        this._init();

        this.config = {
            label:           this.label,
            scanCycleMs:     this._scanCycleMs,
            initRun:         this._running,
            cpuVariant:      this._cpuVariant,
            firmwareVersion: this._fwVersion,
            ladderProgram:   JSON.stringify(this._ob[1].program),
            ob30Program:     JSON.stringify(this._ob[30].program),
            ob30CycleMs:     this._ob[30].cycleMs,
            ob100Program:    JSON.stringify(this._ob[100].program),
            pnStationName:   this._pn.stationName,
            pnIP:            this._pn.ip,
            pnMode:          this._pn.mode,
            pnSendClockMs:   this._pn.sendClockMs,
            pnMRPEnabled:    this._pn.mrpEnabled,
            scadaChannelName:    this._s7.channelName,
            scadaMaxClients:     this._s7.maxClients,
            scadaPushIntervalMs: this._s7.pushIntervalMs,
            scadaWriteEnabled:   this._s7.writeEnabled,
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 机身主体 ──
        this._body = { x: 0, y: 0, w: W, h: H, rx: 3 };

        // ── 顶部色带（绿色调，S7-1200 特色）──
        this._topBar = { x: 0, y: 0, w: W, h: H * 0.08 };

        // ── 通信接口区（顶部，H*0.08 ~ H*0.22）──
        // PROFINET RJ45（宽口，居中偏右）
        this._pnPort   = { x: W*0.36, y: H*0.095, w: W*0.38, h: H*0.075 };
        // Expansion Slot E0（左）
        this._e0Port   = { x: W*0.04, y: H*0.095, w: W*0.12, h: H*0.075 };
        // Expansion Slot E1（E0右）
        this._e1Port   = { x: W*0.18, y: H*0.095, w: W*0.12, h: H*0.075 };

        // ── PN Link/ACT LED ──
        this._pnLinkLED = { x: W*0.365, y: H*0.197, r: H*0.013 };
        this._pnActLED  = { x: W*0.395, y: H*0.197, r: H*0.013 };

        // ── 状态 LED（竖排，左侧）──
        const ledX = W*0.040, ledR = H*0.014;
        this._statusLEDs = {
            run:   { x: ledX, y: H*0.220, r: ledR },
            stop:  { x: ledX, y: H*0.252, r: ledR },
            error: { x: ledX, y: H*0.284, r: ledR },
            maint: { x: ledX, y: H*0.316, r: ledR },
            sf:    { x: ledX, y: H*0.348, r: ledR },
            bf:    { x: ledX, y: H*0.380, r: ledR },
        };

        // ── 信号板（SB）槽位（正面中央）──
        this._sbSlot = { x: W*0.10, y: H*0.210, w: W*0.82, h: H*0.10 };

        // ── 旋转选择开关（RUN/STOP/MRES，位于 SB 槽下方左侧）──
        this._modeSwitch = { x: W*0.078, y: H*0.330, r: H*0.030 };

        // ── MAINT 按钮 ──
        this._maintBtn = { x: W*0.140, y: H*0.334, r: H*0.018 };

        // ── 铭牌 ──
        this._nameplate = { x: W*0.24, y: H*0.310, w: W*0.54, h: H*0.08 };

        // ── PN INFO 小面板（铭牌下方）──
        this._pnInfoPanel = { x: W*0.24, y: H*0.400, w: W*0.54, h: H*0.08 };

        // ── IO LED 行（3行）──
        // 第1行：I0.0~I0.7（8个，黄色）
        this._inputLEDs0 = [];
        for (let i = 0; i < 8; i++) {
            this._inputLEDs0.push({ x: W*(0.04+i*0.118), y: H*0.500, r: H*0.014, bit:i, byte:0 });
        }
        // 第2行：I1.0~I1.5（6个，黄色）
        this._inputLEDs1 = [];
        for (let i = 0; i < 6; i++) {
            this._inputLEDs1.push({ x: W*(0.04+i*0.118), y: H*0.548, r: H*0.014, bit:i, byte:1 });
        }
        // 第3行：Q0.0~Q0.7（8个，橙色）
        this._outputLEDs0 = [];
        for (let i = 0; i < 8; i++) {
            this._outputLEDs0.push({ x: W*(0.04+i*0.118), y: H*0.596, r: H*0.014, bit:i, byte:0 });
        }
        // 第4行：Q1.0~Q1.1 + AI0/AI1（2+2，橙/绿）
        this._outputLEDs1 = [];
        for (let i = 0; i < 2; i++) {
            this._outputLEDs1.push({ x: W*(0.04+i*0.118), y: H*0.644, r: H*0.014, bit:i, byte:1 });
        }
        this._aiLEDs = [];
        for (let i = 0; i < 2; i++) {
            this._aiLEDs.push({ x: W*(0.30+i*0.118), y: H*0.644, r: H*0.014, ch:i });
        }

        // ── 端子排 ──
        this._inputTerminals  = { x: W*0.02, y: H*0.690, w: W*0.56, h: H*0.088 };
        this._outputTerminals = { x: W*0.60, y: H*0.690, w: W*0.38, h: H*0.088 };
        this._aiTerminals     = { x: W*0.02, y: H*0.788, w: W*0.24, h: H*0.055 };
        this._pwrTerminals    = { x: W*0.28, y: H*0.788, w: W*0.20, h: H*0.055 };

        // ── 右侧 SM 扩展接头 ──
        this._smBus = { x: W-2, y: H*0.12, w: 8, h: H*0.20 };

        // ── 左侧 CM 扩展接头 ──
        this._cmBus = { x: -6, y: H*0.12, w: 8, h: H*0.14 };

        // ── DIN 导轨 ──
        this._dinRail = { x: 0, y: H*0.925, w: W, h: H*0.075 };

        // ── 散热格栅（右侧竖纹）──
        this._ventSlots = [];
        for (let i = 0; i < 5; i++) {
            this._ventSlots.push({ x:W*0.945, y:H*(0.35+i*0.056), w:W*0.040, h:H*0.030 });
        }

        // ── 端口坐标 ──
        const portY = H * 0.985;
        this._portPos = {};
        for (let i = 0; i < 8; i++) this._portPos[`I0.${i}`] = { x: W*(0.04+i*0.118), y: portY };
        for (let i = 0; i < 6; i++) this._portPos[`I1.${i}`] = { x: W*(0.04+(i+8)*0.065), y: portY };
        for (let i = 0; i < 8; i++) this._portPos[`Q0.${i}`] = { x: W*(0.60+i*0.046),     y: portY };
        for (let i = 0; i < 2; i++) this._portPos[`Q1.${i}`] = { x: W*(0.60+(i+8)*0.046), y: portY };
        this._portPos['AI0']    = { x: W*0.05, y: portY };
        this._portPos['AI1']    = { x: W*0.14, y: portY };
        this._portPos['PWR_L+'] = { x: W*0.86, y: 0      };
        this._portPos['PWR_M']  = { x: W*0.93, y: 0      };
        this._portPos['PN_P1']  = { x: W*0.55, y: 0      };
        this._portPos['ETH_S7'] = { x: W*0.72, y: 0      };
        this._portPos['SM_BUS'] = { x: W+8,    y: H*0.22 };
        this._portPos['CM_BUS'] = { x: -8,     y: H*0.19 };
    }

    // ═══════════════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label          = config.label          || 'PLC-1';
        this._scanCycleMs   = config.scanCycleMs    !== undefined ? config.scanCycleMs  : 10;
        this._running       = config.initRun        !== undefined ? !!config.initRun    : false;
        this._cpuVariant    = config.cpuVariant     || 'CPU1214C';
        this._fwVersion     = config.firmwareVersion|| 'V4.5';
        this._errorState    = false;
        this._errorMsg      = '';
        this._scanCount     = 0;
        this._accumMs       = 0;
        this._firstScan     = true;

        // OB 表
        const loadProg = (key, def) => {
            try {
                return config[key]
                    ? (typeof config[key]==='string' ? JSON.parse(config[key]) : config[key])
                    : def;
            } catch(e) { return def; }
        };

        this._ob = {
            1:   { program: loadProg('ladderProgram', this._defaultOB1()),  accumMs: 0 },
            30:  { program: loadProg('ob30Program',   { name:'OB30', networks:[] }), cycleMs: config.ob30CycleMs||100, accumMs: 0 },
            100: { program: loadProg('ob100Program',  { name:'OB100', networks:[] }), executed: false },
        };

        // MAINT 状态
        this._maintMode  = false;
        this._diagEvents = [];  // 诊断事件缓冲区
    }

    // ═══════════════════════════════════════════════════════════════════
    // 存储区初始化
    // ═══════════════════════════════════════════════════════════════════

    _initMemory() {
        // 过程映像 I/O（S7-1200 最大 68字节）
        this._I   = new Uint8Array(68);   // IB0~IB67
        this._Q   = new Uint8Array(68);   // QB0~QB67
        // 内存标志区（8192字节 = 65536位）
        this._M   = new Uint8Array(8192); // MB0~MB8191
        // 局部数据
        this._L   = new Uint8Array(256);  // LB0~LB255
        // 模拟量输入（本体 AI，地址 AIW64/AIW66）
        this._AI  = new Uint8Array(16);   // AIW64~AIW78

        // S7-1200 SM（特殊存储位，精简版）
        // 不同于 S7-200 的 SM，S7-1200 使用系统 DB（%DB）和时钟存储器位
        this._clockMem  = 0;   // 时钟存储器字节（M0 可配）
        this._clockMs   = { 10:0, 20:0, 50:0, 100:0, 200:0, 500:0, 1000:0, 1250:0 }; // Hz振荡器
        this._clockFlip = {};

        // 定时器/计数器（IEC 风格，存于背景 DB，这里用快速查找表）
        // key = 'T#dbNum_byte'  value = { state, ET, PT, Q, inPrev }
        this._iecTimers   = new Map();
        this._iecCounters = new Map();

        // PID_Compact（最多8个回路）
        this._pidCompact = Array.from({length:8}, () => ({
            Ix:0, prevInput:0, active:false, prevEN:false,
        }));

        // Motion Control 轴表（最多4轴）
        this._axes = Array.from({length:4}, () => ({
            enabled:   false,
            homed:     false,
            position:  0.0,
            velocity:  0.0,
            setVel:    0.0,
            setPos:    0.0,
            inMotion:  false,
            error:     false,
            errorCode: 0,
        }));

        // 扩展模块、BroadcastChannel
        this._expansionSlots    = [];
        this._expansionModules  = [];
        this._aiwPatched        = false;
        this._labelCache        = {};

        // 时钟振荡器（S7-1200 CLK_x 特殊位）
        this._clkAccum = {};
    }

    // ═══════════════════════════════════════════════════════════════════
    // DB（数据块）初始化
    // ═══════════════════════════════════════════════════════════════════

    _initDB() {
        this._db = new Map();
        // DB1：全局数据块（256字节）
        this._dbCreate(1,  'GlobalDB',       256,  false);
        // DB10：PID_Compact 背景 DB（4个回路 × 64字节）
        this._dbCreate(10, 'PID_Compact_DB', 256,  true);
        // DB100：通信数据区（SCADA 读写专用，512字节）
        this._dbCreate(100,'CommDB',         512,  false);
    }

    _dbCreate(num, name, size, isInstance) {
        this._db.set(num, {
            num,
            name,
            size,
            data:       new Uint8Array(size),
            isInstance: !!isInstance,
            isGlobal:   !isInstance,
            accessCount:0,
        });
    }

    _dbGet(num) { return this._db.get(num) || null; }

    // DB 字节/字/双字 读写
    _dbReadByte(dbNum, offset) {
        const db = this._dbGet(dbNum); if (!db) return 0;
        return db.data[offset] || 0;
    }
    _dbReadWord(dbNum, offset) {
        const db = this._dbGet(dbNum); if (!db) return 0;
        const r = (db.data[offset]<<8)|db.data[offset+1]; return r>32767?r-65536:r;
    }
    _dbReadDWord(dbNum, offset) {
        const db = this._dbGet(dbNum); if (!db) return 0;
        return ((db.data[offset]<<24)|(db.data[offset+1]<<16)|(db.data[offset+2]<<8)|db.data[offset+3])>>>0;
    }
    _dbReadReal(dbNum, offset) {
        const db = this._dbGet(dbNum); if (!db||offset+3>=db.size) return 0;
        const buf=new ArrayBuffer(4), dv=new DataView(buf);
        dv.setUint8(0,db.data[offset]); dv.setUint8(1,db.data[offset+1]);
        dv.setUint8(2,db.data[offset+2]); dv.setUint8(3,db.data[offset+3]);
        return dv.getFloat32(0,false);
    }
    _dbReadBit(dbNum, byte, bit) {
        const db = this._dbGet(dbNum); if (!db) return false;
        return !!(db.data[byte]&(1<<bit));
    }

    _dbWriteByte(dbNum, offset, val) {
        const db=this._dbGet(dbNum); if(!db) return;
        db.data[offset]=val&0xFF;
    }
    _dbWriteWord(dbNum, offset, val) {
        const db=this._dbGet(dbNum); if(!db) return;
        val=Math.max(-32768,Math.min(32767,Math.round(val)));const u=val<0?val+65536:val;
        db.data[offset]=(u>>8)&0xFF; db.data[offset+1]=u&0xFF;
    }
    _dbWriteReal(dbNum, offset, val) {
        const db=this._dbGet(dbNum); if(!db||offset+3>=db.size) return;
        const buf=new ArrayBuffer(4),dv=new DataView(buf);
        dv.setFloat32(0,val,false);
        db.data[offset]=dv.getUint8(0); db.data[offset+1]=dv.getUint8(1);
        db.data[offset+2]=dv.getUint8(2); db.data[offset+3]=dv.getUint8(3);
    }
    _dbWriteBit(dbNum, byte, bit, val) {
        const db=this._dbGet(dbNum); if(!db) return;
        if(val) db.data[byte]|=(1<<bit); else db.data[byte]&=~(1<<bit);
    }

    // 解析 DB 地址字符串
    _parseDBAddr(addr) {
        // DB1.DBX5.3  → { db:1, type:'BIT', byte:5, bit:3 }
        // DB1.DBB10   → { db:1, type:'BYTE', byte:10 }
        // DB1.DBW20   → { db:1, type:'WORD', byte:20 }
        // DB1.DBD32   → { db:1, type:'DWORD', byte:32 }
        // DB1.DBR40   → { db:1, type:'REAL', byte:40 }  (扩展，非标准)
        const m1 = addr.match(/^DB(\d+)\.DBX(\d+)\.(\d+)$/i);
        if (m1) return { db:+m1[1], type:'BIT',   byte:+m1[2], bit:+m1[3] };
        const m2 = addr.match(/^DB(\d+)\.DB([BWDR])(\d+)$/i);
        if (m2) {
            const t = { B:'BYTE',W:'WORD',D:'DWORD',R:'REAL' }[m2[2].toUpperCase()]||'BYTE';
            return { db:+m2[1], type:t, byte:+m2[3] };
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 扩展总线（SM / CM 模块）
    // ═══════════════════════════════════════════════════════════════════

    _initExpansionBus() { /* slots init 已在 _initMemory 中完成 */ }

    mountModule(module, slot) {
        if (this._expansionSlots.length >= 8) return -1;
        const usedSlots = this._expansionSlots.map(s=>s.slot);
        if (slot===undefined||slot===null) {
            for (let i=0;i<8;i++) { if(!usedSlots.includes(i)){slot=i;break;} }
        }
        if (usedSlots.includes(slot)) return -1;
        const type  = (module.type||'').toLowerCase();
        const entry = { slot, type, module,
            aiBase:   (slot+1)*8,
            aqBase:   (slot+1)*8,
            diBase:   2+slot,
            doBase:   2+Math.floor(slot/2),
        };
        this._expansionSlots.push(entry);
        this._expansionSlots.sort((a,b)=>a.slot-b.slot);
        if (module._slotAddr!==undefined) module._slotAddr=slot;
        if (!this._aiwPatched) this._patchAIWAQW();
        if (!this._expansionModules.includes(module)) this._expansionModules.push(module);
        if (typeof module.connectToCPU==='function') module.connectToCPU(this);
        return slot;
    }

    unmountModule(slotOrModule) {
        let idx = typeof slotOrModule==='number'
            ? this._expansionSlots.findIndex(s=>s.slot===slotOrModule)
            : this._expansionSlots.findIndex(s=>s.module===slotOrModule);
        if (idx<0) return;
        const entry=this._expansionSlots[idx];
        entry.module?.disconnectFromCPU?.();
        this._expansionSlots.splice(idx,1);
        const mi=this._expansionModules.indexOf(entry.module);
        if (mi>=0) this._expansionModules.splice(mi,1);
    }

    _patchAIWAQW() {
        if (this._aiwPatched) return;
        this._aiwPatched = true;
        const origR = this._readWord.bind(this);
        const origW = this._writeWord.bind(this);
        const self  = this;
        this._readWord = function(addr) {
            const mAIW=addr.match(/^AIW(\d+)$/i);
            if (mAIW) { const off=+mAIW[1]; const r=(self._AI[off]<<8)|self._AI[off+1]; return r>32767?r-65536:r; }
            const mAQW=addr.match(/^AQW(\d+)$/i);
            if (mAQW) { const off=+mAQW[1]; const r=(self._AI[off]<<8)|self._AI[off+1]; return r>32767?r-65536:r; }
            return origR(addr);
        };
        this._writeWord = function(addr, val) {
            const mAQW=addr.match(/^AQW(\d+)$/i);
            if (mAQW) { const off=+mAQW[1]; val=Math.max(-32768,Math.min(32767,Math.round(val)));const u=val<0?val+65536:val;self._AI[off]=(u>>8)&0xFF;self._AI[off+1]=u&0xFF;return; }
            origW(addr,val);
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // 存储区访问（S7-1200 地址格式扩展）
    // ═══════════════════════════════════════════════════════════════════

    _readBit(addr) {
        // 时钟存储器位（%M0.0 系列）
        if (addr.match(/^%?M(\d+)\.(\d+)$/i)) {
            const b=+addr.match(/M(\d+)/i)[1], bit=+addr.match(/\.(\d+)/)[1];
            return !!(this._M[b]&(1<<bit));
        }
        // DB 位地址
        const dbP = this._parseDBAddr(addr);
        if (dbP?.type==='BIT') return this._dbReadBit(dbP.db, dbP.byte, dbP.bit);
        // 标准地址（兼容不带%前缀）
        const clean = addr.replace(/^%/,'');
        const m = clean.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
        if (m) {
            const z=m[1].toUpperCase(),b=+m[2],bit=+m[3],mask=1<<bit;
            if(z==='I') return !!(this._I[b]&mask); if(z==='Q') return !!(this._Q[b]&mask);
            if(z==='M') return !!(this._M[b]&mask); if(z==='L') return !!(this._L[b]&mask);
        }
        const tc=clean.match(/^([TC])(\d+)$/);
        if (tc) {
            const key=`iec_${tc[1]}_${tc[2]}`;
            const t=this._iecTimers.get(key)||this._iecCounters.get(key);
            return t?.Q||false;
        }
        return false;
    }

    _writeBit(addr, val) {
        const clean = addr.replace(/^%/,'');
        const dbP   = this._parseDBAddr(addr);
        if (dbP?.type==='BIT') { this._dbWriteBit(dbP.db,dbP.byte,dbP.bit,val); return; }
        const m=clean.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
        if (!m) return;
        const z=m[1].toUpperCase(),b=+m[2],bit=+m[3],mask=1<<bit;
        if(z==='Q'){if(val)this._Q[b]|=mask;else this._Q[b]&=~mask;return;}
        if(z==='M'){if(val)this._M[b]|=mask;else this._M[b]&=~mask;return;}
        if(z==='L'){if(val)this._L[b]|=mask;else this._L[b]&=~mask;return;}
    }

    _readWord(addr) {
        if (/^-?\d+$/.test(addr)) return parseInt(addr);
        const clean = addr.replace(/^%/,'');
        // DB 字地址
        const dbP = this._parseDBAddr(addr);
        if (dbP) {
            if(dbP.type==='WORD')  return this._dbReadWord(dbP.db,dbP.byte);
            if(dbP.type==='DWORD') return this._dbReadDWord(dbP.db,dbP.byte);
            if(dbP.type==='BYTE')  return this._dbReadByte(dbP.db,dbP.byte);
        }
        const m=clean.match(/^([A-Za-z]+)W?(\d+)$/i); if(!m) return 0;
        const z=m[1].toUpperCase(),b=+m[2];
        const rA=arr=>{const r=(arr[b]<<8)|arr[b+1];return r>32767?r-65536:r;};
        if(z==='M') return rA(this._M); if(z==='MW') return rA(this._M);
        if(z==='I'||z==='IW') return rA(this._I); if(z==='Q'||z==='QW') return rA(this._Q);
        if(z==='L'||z==='LW') return rA(this._L);
        if(z==='AIW'){ const r=(this._AI[b]<<8)|this._AI[b+1]; return r>32767?r-65536:r; }
        return 0;
    }

    _writeWord(addr, val) {
        val=Math.max(-32768,Math.min(32767,Math.round(val)));const u=val<0?val+65536:val;
        const clean=addr.replace(/^%/,'');
        const dbP=this._parseDBAddr(addr);
        if (dbP?.type==='WORD'){this._dbWriteWord(dbP.db,dbP.byte,val);return;}
        const m=clean.match(/^([A-Za-z]+)W?(\d+)$/i); if(!m) return;
        const z=m[1].toUpperCase(),b=+m[2];
        const wA=arr=>{arr[b]=(u>>8)&0xFF;arr[b+1]=u&0xFF;};
        if(z==='M'||z==='MW'){wA(this._M);return;} if(z==='Q'||z==='QW'){wA(this._Q);return;}
        if(z==='L'||z==='LW'){wA(this._L);return;}
    }

    _readByte(addr) {
        const clean=addr.replace(/^%/,'');
        const dbP=this._parseDBAddr(addr);
        if (dbP?.type==='BYTE') return this._dbReadByte(dbP.db,dbP.byte);
        const m=clean.match(/^([A-Za-z]+)B?(\d+)$/i); if(!m){const n=parseInt(addr);return isNaN(n)?0:n&0xFF;}
        const z=m[1].toUpperCase(),b=+m[2];
        if(z==='M'||z==='MB') return this._M[b]||0; if(z==='I'||z==='IB') return this._I[b]||0;
        if(z==='Q'||z==='QB') return this._Q[b]||0; if(z==='L'||z==='LB') return this._L[b]||0;
        return 0;
    }

    _writeByte(addr, val) {
        val=Math.max(0,Math.min(255,Math.round(val)));
        const clean=addr.replace(/^%/,'');
        const dbP=this._parseDBAddr(addr);
        if (dbP?.type==='BYTE'){this._dbWriteByte(dbP.db,dbP.byte,val);return;}
        const m=clean.match(/^([A-Za-z]+)B?(\d+)$/i); if(!m) return;
        const z=m[1].toUpperCase(),b=+m[2];
        if(z==='M'||z==='MB'){this._M[b]=val;return;} if(z==='Q'||z==='QB'){this._Q[b]=val;return;}
        if(z==='L'||z==='LB'){this._L[b]=val;return;}
    }

    // 实数（REAL）
    readReal(addr) {
        const clean=addr.replace(/^%/,'');
        const dbP=this._parseDBAddr(addr);
        if (dbP?.type==='REAL') return this._dbReadReal(dbP.db,dbP.byte);
        // MD（双字实数）
        const m=clean.match(/^MD(\d+)$/i);
        if (m) {
            const b=+m[1];
            const buf=new ArrayBuffer(4),dv=new DataView(buf);
            dv.setUint8(0,this._M[b]); dv.setUint8(1,this._M[b+1]);
            dv.setUint8(2,this._M[b+2]); dv.setUint8(3,this._M[b+3]);
            return dv.getFloat32(0,false);
        }
        const n=parseFloat(addr); return isNaN(n)?0:n;
    }

    _writeReal(addr, val) {
        const clean=addr.replace(/^%/,'');
        const dbP=this._parseDBAddr(addr);
        if (dbP?.type==='REAL'){this._dbWriteReal(dbP.db,dbP.byte,val);return;}
        const m=clean.match(/^MD(\d+)$/i);
        if (m) {
            const b=+m[1];
            const buf=new ArrayBuffer(4),dv=new DataView(buf);
            dv.setFloat32(0,val,false);
            this._M[b]=dv.getUint8(0); this._M[b+1]=dv.getUint8(1);
            this._M[b+2]=dv.getUint8(2); this._M[b+3]=dv.getUint8(3);
        }
    }

    _parseIndex(addr, prefix) {
        const n=parseInt(addr.replace(new RegExp(`^${prefix}`,'i'),''));return isNaN(n)?0:Math.max(0,Math.min(255,n));
    }

    // ═══════════════════════════════════════════════════════════════════
    // IEC 定时器（TON / TOF / TP / TONR）
    // ═══════════════════════════════════════════════════════════════════

    _parseIECTime(val) {
        // 支持 T#1s / T#500ms / T#2m30s / T#1h / 直接数字(ms)
        if (typeof val === 'number') return val;
        const s = String(val).toUpperCase();
        if (!s.startsWith('T#')) return parseFloat(s)||0;
        let ms = 0;
        const rest = s.slice(2);
        const hm = rest.match(/(\d+)H/); if(hm) ms += parseInt(hm[1])*3600000;
        const mm = rest.match(/(\d+)M(?!S)/); if(mm) ms += parseInt(mm[1])*60000;
        const sm = rest.match(/(\d+)S(?!S)/); if(sm) ms += parseInt(sm[1])*1000;
        const msm = rest.match(/(\d+)MS/); if(msm) ms += parseInt(msm[1]);
        const um  = rest.match(/(\d+)US/); if(um)  ms += parseInt(um[1])/1000;
        return ms;
    }

    _execTON(key, en, PT_ms) {
        let t = this._iecTimers.get(key);
        if (!t) { t={Q:false,ET:0,state:0,inPrev:false}; this._iecTimers.set(key,t); }
        if (!en) { t.Q=false; t.ET=0; t.state=0; return t; }
        // ET 在 tick 中累积（这里只置位状态）
        t._en=en; t._PT=PT_ms;
        if (t.ET >= PT_ms) t.Q=true;
        return t;
    }

    _execTOF(key, en, PT_ms) {
        let t = this._iecTimers.get(key);
        if (!t) { t={Q:false,ET:0,state:0,inPrev:false}; this._iecTimers.set(key,t); }
        if (en) { t.Q=true; t.ET=0; t.state=1; }
        else if (t.state===1) {
            t._PT=PT_ms; t._en=false;
            if (t.ET>=PT_ms) { t.Q=false; t.state=0; }
        }
        return t;
    }

    _execTP(key, en, PT_ms) {
        let t = this._iecTimers.get(key);
        if (!t) { t={Q:false,ET:0,state:0,inPrev:false}; this._iecTimers.set(key,t); }
        if (en && !t.inPrev && t.state===0) { t.Q=true; t.ET=0; t.state=1; t._PT=PT_ms; }
        t.inPrev=en;
        if (t.state===1 && t.ET>=PT_ms) { t.Q=false; t.state=0; }
        return t;
    }

    _tickIECTimers(dtMs) {
        this._iecTimers.forEach((t,key) => {
            if (!t._en && key.startsWith('iec_T_TON')) return;
            if (t.state===1 || t._en) t.ET = Math.min((t.ET||0)+dtMs, t._PT||0);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // PID_Compact（S7-1200 集成 PID 功能块）
    // ═══════════════════════════════════════════════════════════════════

    _execPIDCompact(dbNum, en) {
        const loop   = dbNum - 10;  // DB10→loop0, DB11→loop1…
        if (loop < 0 || loop >= 8) return;
        const s      = this._pidCompact[loop];
        const SP     = this._dbReadReal(dbNum, 0);
        const PV     = this._dbReadReal(dbNum, 4);
        let   MX     = this._dbReadReal(dbNum, 8);
        const Kp     = this._dbReadReal(dbNum, 12);
        const Ti     = this._dbReadReal(dbNum, 16);  // 积分时间 s
        const Td     = this._dbReadReal(dbNum, 20);  // 微分时间 s
        const MXhigh = this._dbReadReal(dbNum, 24) || 1.0;
        const MXlow  = this._dbReadReal(dbNum, 28) || 0.0;
        const mode   = this._dbReadWord(dbNum, 40);  // 0=停止,1=自动,2=手动

        if (!en || mode===0) {
            if (s.prevEN) { s.Ix=MX; s.prevEN=false; }
            return;
        }
        s.prevEN=true;

        if (mode===2) { // 手动模式：直接使用 ManualValue
            const mv=this._dbReadReal(dbNum,42);
            this._dbWriteReal(dbNum,8,Math.max(MXlow,Math.min(MXhigh,mv)));
            return;
        }

        // 自动模式：位置式 PID
        const Ts = this._scanCycleMs / 1000.0;
        const e  = SP - PV;
        if (Ti > 0)  s.Ix += Kp*(Ts/Ti)*((e + s.ePrev)/2);
        let Dout = 0;
        if (Td > 0)  Dout = -Kp*(Td/Ts)*(PV - s.prevInput);
        MX = Kp*e + s.Ix + Dout;
        if (MX > MXhigh) { MX=MXhigh; if(e>0&&Ti>0) s.Ix-=Kp*(Ts/Ti)*e; }
        else if (MX < MXlow) { MX=MXlow; if(e<0&&Ti>0) s.Ix-=Kp*(Ts/Ti)*e; }
        this._dbWriteReal(dbNum, 8,  MX);
        s.ePrev     = e;
        s.prevInput = PV;
        s.active    = true;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 时钟存储器（S7-1200 Clock Memory Bits）
    // ═══════════════════════════════════════════════════════════════════

    _tickClockMemory(dtMs) {
        // Hz → 对应 M 字节的各位（M0 作为时钟字节，可配置）
        // 位7: 10Hz, 位6: 5Hz, 位5: 2.5Hz, 位4: 2Hz
        // 位3: 1.25Hz, 位2: 1Hz, 位1: 0.625Hz, 位0: 0.5Hz
        const freqs = [0.5, 0.625, 1, 1.25, 2, 2.5, 5, 10];
        freqs.forEach((hz, i) => {
            const period = 1000 / hz;
            const key    = `clk${i}`;
            this._clkAccum[key] = (this._clkAccum[key] || 0) + dtMs;
            if (this._clkAccum[key] >= period/2) {
                this._clkAccum[key] = 0;
                this._clockFlip[key] = !this._clockFlip[key];
                if (this._clockFlip[key]) this._M[0] |=  (1<<i);
                else                      this._M[0] &= ~(1<<i);
            }
        });
        // SM0.5 兼容：M0.4（1Hz，0.5s on/0.5s off）
        // 直接通过 M0.2 映射到 1Hz bit
    }

    // ═══════════════════════════════════════════════════════════════════
    // 梯形图执行引擎（完整 S7-1200 指令集）
    // ═══════════════════════════════════════════════════════════════════

    _initLadderEngine() { this._stack=[]; this._flow=false; }

    _execOB(obNum) {
        const ob = this._ob[obNum];
        if (!ob?.program?.networks) return;
        try {
            for (const net of ob.program.networks)
                for (const rung of (net.rungs||[]))
                    this._execRung(rung);
        } catch(e) {
            this._errorState=true;
            this._errorMsg  = `OB${obNum}: ${e.message}`;
            this._running   = false;
            this._diagEvents.push({ ts:performance.now(), code:0x0002, msg:this._errorMsg });
        }
    }

    _execRung(insts) {
        const stack=[]; let flow=false;
        for (const inst of insts) {
            const op=(inst.op||'').toUpperCase();
            const {addr,addr2,addr3,pv,timeBase,loop,dbRef}=inst;

            switch(op){
                // ── 位逻辑 ──────────────────────────────────────────
                case 'LD':  stack.push(flow);flow=this._readBit(addr);break;
                case 'LDN': stack.push(flow);flow=!this._readBit(addr);break;
                case 'A':   flow=flow&&this._readBit(addr);break;
                case 'AN':  flow=flow&&!this._readBit(addr);break;
                case 'O':   flow=flow||this._readBit(addr);break;
                case 'ON':  flow=flow||!this._readBit(addr);break;
                case 'NOT': flow=!flow;break;
                case 'OLD': {const p=stack.pop();flow=flow||(p||false);break;}
                case 'ALD': {const p=stack.pop();flow=flow&&(p||false);break;}
                case 'LPS': stack.push(flow);break;
                case 'LRD': flow=stack[stack.length-1];break;
                case 'LPP': flow=stack.pop()||false;break;
                // 跳变触点（P=正跳变，N=负跳变）
                case 'P':  {const k=`_p_${inst._id||addr}`;const prev=this[k]||false;const cur=this._readBit(addr);this[k]=cur;flow=flow&&(cur&&!prev);break;}
                case 'N':  {const k=`_n_${inst._id||addr}`;const prev=this[k]||false;const cur=this._readBit(addr);this[k]=cur;flow=flow&&(!cur&&prev);break;}
                case 'EU': {const k=`_eu_${inst._id||addr}`;const prev=this[k]||false;const cur=this._readBit(addr);this[k]=cur;flow=flow&&(cur&&!prev);break;}
                case 'ED': {const k=`_ed_${inst._id||addr}`;const prev=this[k]||false;const cur=this._readBit(addr);this[k]=cur;flow=flow&&(!cur&&prev);break;}

                // ── 线圈 ────────────────────────────────────────────
                case '=':  this._writeBit(addr,flow);break;
                case 'S':  if(flow)this._writeBit(addr,true);break;
                case 'R':  if(flow)this._writeBit(addr,false);break;
                // SR 置位优先触发器
                case 'SR': {
                    const s=this._readBit(addr), r=addr2?this._readBit(addr2):false;
                    if(s) this._writeBit(addr3||addr,true);
                    else if(r) this._writeBit(addr3||addr,false);
                    break;
                }
                // RS 复位优先触发器
                case 'RS': {
                    const s=this._readBit(addr), r=addr2?this._readBit(addr2):false;
                    if(r) this._writeBit(addr3||addr,false);
                    else if(s) this._writeBit(addr3||addr,true);
                    break;
                }
                // 上升沿输出线圈
                case '=P': {const k=`_cop_${inst._id||addr}`;const prev=this[k]||false;this[k]=flow;if(flow&&!prev)this._writeBit(addr,true);else this._writeBit(addr,false);break;}
                case '=N': {const k=`_con_${inst._id||addr}`;const prev=this[k]||false;this[k]=flow;if(!flow&&prev)this._writeBit(addr,true);else this._writeBit(addr,false);break;}

                // ── IEC 定时器 ─────────────────────────────────────
                case 'TON': {
                    const PT_ms=this._parseIECTime(pv||inst.PT||0);
                    const key=`iec_T_TON_${addr||inst._id||'0'}`;
                    const t=this._execTON(key,flow,PT_ms);
                    if(addr2)this._writeBit(addr2,t.Q);
                    if(addr3)this._writeWord(addr3,Math.round(t.ET));
                    break;
                }
                case 'TOF': {
                    const PT_ms=this._parseIECTime(pv||inst.PT||0);
                    const key=`iec_T_TOF_${addr||inst._id||'0'}`;
                    const t=this._execTOF(key,flow,PT_ms);
                    if(addr2)this._writeBit(addr2,t.Q);
                    if(addr3)this._writeWord(addr3,Math.round(t.ET));
                    break;
                }
                case 'TP': {
                    const PT_ms=this._parseIECTime(pv||inst.PT||0);
                    const key=`iec_T_TP_${addr||inst._id||'0'}`;
                    const t=this._execTP(key,flow,PT_ms);
                    if(addr2)this._writeBit(addr2,t.Q);
                    break;
                }
                // 兼容 S7-200 风格定时器（TON_S / TOF_S 别名）
                case 'TON_S': {
                    const t=this._iecTimers.get('s200_T_'+addr)||{Q:false,ET:0,bit:false,accMs:0,pv:0,enabled:false};
                    if(!t._init){t.type='TON';t.timeBase=timeBase||100;if(pv!==undefined)t.pv=pv;t.enabled=flow;this._iecTimers.set('s200_T_'+addr,t);}
                    if(!flow){t.ET=0;t.Q=false;}
                    t.enabled=flow;
                    break;
                }

                // ── IEC 计数器 ─────────────────────────────────────
                case 'CTU': {
                    const PV=pv!==undefined?pv:(inst.PV||0);
                    const key=`iec_C_CTU_${addr||inst._id||'0'}`;
                    let c=this._iecCounters.get(key);
                    if(!c){c={CV:0,Q:false,lastCU:false};this._iecCounters.set(key,c);}
                    const R=addr2?this._readBit(addr2):false;
                    if(R){c.CV=0;c.Q=false;}else if(flow&&!c.lastCU)c.CV++;
                    c.Q=c.CV>=PV;c.lastCU=flow;
                    if(addr3)this._writeBit(addr3,c.Q);
                    break;
                }
                case 'CTD': {
                    const PV=pv!==undefined?pv:(inst.PV||0);
                    const key=`iec_C_CTD_${addr||inst._id||'0'}`;
                    let c=this._iecCounters.get(key);
                    if(!c){c={CV:PV,Q:false,lastCD:false};this._iecCounters.set(key,c);}
                    const LD=addr2?this._readBit(addr2):false;
                    if(LD){c.CV=PV;c.Q=false;}else if(flow&&!c.lastCD)c.CV=Math.max(0,c.CV-1);
                    c.Q=c.CV===0;c.lastCD=flow;
                    if(addr3)this._writeBit(addr3,c.Q);
                    break;
                }
                case 'CTUD': {
                    const PV=pv!==undefined?pv:(inst.PV||0);
                    const key=`iec_C_CTUD_${addr||inst._id||'0'}`;
                    let c=this._iecCounters.get(key);
                    if(!c){c={CV:0,QU:false,QD:false,lastCU:false,lastCD:false};this._iecCounters.set(key,c);}
                    const cuNow=flow, cdNow=addr2?this._readBit(addr2):false;
                    const R=addr3?this._readBit(addr3):false;
                    const LD=inst.addr4?this._readBit(inst.addr4):false;
                    if(R){c.CV=0;}else if(LD){c.CV=PV;}
                    else{if(cuNow&&!c.lastCU)c.CV++;if(cdNow&&!c.lastCD)c.CV=Math.max(0,c.CV-1);}
                    c.QU=c.CV>=PV;c.QD=c.CV<=0;c.lastCU=cuNow;c.lastCD=cdNow;
                    break;
                }

                // ── 整数运算 ──────────────────────────────────────
                case 'ADD': case 'ADD_I': if(flow)this._writeWord(addr3||addr2,this._readWord(addr)+this._readWord(addr2));break;
                case 'SUB': case 'SUB_I': if(flow)this._writeWord(addr3||addr2,this._readWord(addr)-this._readWord(addr2));break;
                case 'MUL': case 'MUL_I': if(flow)this._writeWord(addr3||addr2,this._readWord(addr)*this._readWord(addr2));break;
                case 'DIV': case 'DIV_I': if(flow){const d=this._readWord(addr2);if(d)this._writeWord(addr3||addr2,Math.trunc(this._readWord(addr)/d));}break;
                case 'MOD': if(flow){const d=this._readWord(addr2);if(d)this._writeWord(addr3||addr2,this._readWord(addr)%d);}break;
                case 'NEG': if(flow)this._writeWord(addr2||addr,-this._readWord(addr));break;
                case 'ABS': if(flow)this._writeWord(addr2||addr,Math.abs(this._readWord(addr)));break;
                case 'MIN': if(flow)this._writeWord(addr3||addr2,Math.min(this._readWord(addr),this._readWord(addr2)));break;
                case 'MAX': if(flow)this._writeWord(addr3||addr2,Math.max(this._readWord(addr),this._readWord(addr2)));break;
                case 'LIMIT': if(flow)this._writeWord(addr3||addr2,Math.max(this._readWord(addr),Math.min(this._readWord(addr2),this._readWord(addr3))));break;
                case 'INC':  if(flow)this._writeWord(addr,this._readWord(addr)+1);break;
                case 'DEC':  if(flow)this._writeWord(addr,this._readWord(addr)-1);break;
                case 'INCW': if(flow)this._writeWord(addr,this._readWord(addr)+1);break;
                case 'DECW': if(flow)this._writeWord(addr,this._readWord(addr)-1);break;

                // ── 浮点运算 ──────────────────────────────────────
                case 'ADD_R':  if(flow)this._writeReal(addr3||addr2,this.readReal(addr)+this.readReal(addr2));break;
                case 'SUB_R':  if(flow)this._writeReal(addr3||addr2,this.readReal(addr)-this.readReal(addr2));break;
                case 'MUL_R':  if(flow)this._writeReal(addr3||addr2,this.readReal(addr)*this.readReal(addr2));break;
                case 'DIV_R':  if(flow){const d=this.readReal(addr2);if(d)this._writeReal(addr3||addr2,this.readReal(addr)/d);}break;
                case 'ABS_R':  if(flow)this._writeReal(addr2||addr,Math.abs(this.readReal(addr)));break;
                case 'NEG_R':  if(flow)this._writeReal(addr2||addr,-this.readReal(addr));break;
                case 'SQRT':   if(flow)this._writeReal(addr2||addr,Math.sqrt(Math.max(0,this.readReal(addr))));break;
                case 'SQR':    if(flow)this._writeReal(addr2||addr,Math.pow(this.readReal(addr),2));break;
                case 'LN':     if(flow){const v=this.readReal(addr);if(v>0)this._writeReal(addr2||addr,Math.log(v));}break;
                case 'EXP':    if(flow)this._writeReal(addr2||addr,Math.exp(this.readReal(addr)));break;
                case 'SIN':    if(flow)this._writeReal(addr2||addr,Math.sin(this.readReal(addr)));break;
                case 'COS':    if(flow)this._writeReal(addr2||addr,Math.cos(this.readReal(addr)));break;
                case 'TAN':    if(flow)this._writeReal(addr2||addr,Math.tan(this.readReal(addr)));break;
                case 'ASIN':   if(flow)this._writeReal(addr2||addr,Math.asin(this.readReal(addr)));break;
                case 'ACOS':   if(flow)this._writeReal(addr2||addr,Math.acos(this.readReal(addr)));break;
                case 'ATAN':   if(flow)this._writeReal(addr2||addr,Math.atan(this.readReal(addr)));break;
                case 'ATAN2':  if(flow)this._writeReal(addr3||addr2,Math.atan2(this.readReal(addr),this.readReal(addr2)));break;
                case 'ROUND':  if(flow)this._writeWord(addr2||addr,Math.round(this.readReal(addr)));break;
                case 'TRUNC':  if(flow)this._writeWord(addr2||addr,Math.trunc(this.readReal(addr)));break;
                case 'CEIL':   if(flow)this._writeWord(addr2||addr,Math.ceil(this.readReal(addr)));break;
                case 'FLOOR':  if(flow)this._writeWord(addr2||addr,Math.floor(this.readReal(addr)));break;

                // ── 数据类型转换 ──────────────────────────────────
                case 'INT_TO_REAL': case 'DTR':    if(flow)this._writeReal(addr2||addr,this._readWord(addr));break;
                case 'REAL_TO_INT': case 'TRUNC_INT':
                case 'DINT_TO_INT':if(flow)this._writeWord(addr2||addr,Math.trunc(this.readReal(addr)));break;
                case 'INT_TO_DINT': if(flow)this._writeWord(addr2||addr,this._readWord(addr));break;
                case 'DINT_TO_REAL':if(flow)this._writeReal(addr2||addr,this._readWord(addr));break;
                case 'WORD_TO_INT': if(flow)this._writeWord(addr2||addr,this._readWord(addr));break;
                case 'INT_TO_WORD': if(flow)this._writeWord(addr2||addr,this._readWord(addr)&0xFFFF);break;

                // ── 传送 ──────────────────────────────────────────
                case 'MOV':   case 'MOV_B': if(flow)this._writeByte(addr2,this._readByte(addr));break;
                case 'MOV_W': if(flow)this._writeWord(addr2,this._readWord(addr));break;
                case 'MOV_R': if(flow)this._writeReal(addr2,this.readReal(addr));break;
                case 'MOVE':  if(flow){
                    // 智能传送（自动检测类型）
                    if(addr.startsWith('MD')||addr.includes('DBD')||addr.includes('DBR')) this._writeReal(addr2,this.readReal(addr));
                    else if(addr.match(/DBW|MW|IW|QW/i)||addr.match(/^\d+$/)) this._writeWord(addr2,this._readWord(addr));
                    else this._writeByte(addr2,this._readByte(addr));
                    break;
                }
                case 'FILL_BLK':   if(flow){const n=parseInt(addr2)||1;const v=this._readByte(addr);for(let i=0;i<n;i++)this._writeByte(addr3+'+'+(i),(v));} break;

                // ── 比较 ──────────────────────────────────────────
                case '==':case '==I':case 'CMP==': flow=flow&&(this._readWord(addr)===this._readWord(addr2));break;
                case '<>':case '<>I':flow=flow&&(this._readWord(addr)!==this._readWord(addr2));break;
                case '>=':case '>=I':case 'CMP>=': flow=flow&&(this._readWord(addr)>=this._readWord(addr2));break;
                case '<=':case '<=I':flow=flow&&(this._readWord(addr)<=this._readWord(addr2));break;
                case '>': case '>I': flow=flow&&(this._readWord(addr)>this._readWord(addr2));break;
                case '<': case '<I': flow=flow&&(this._readWord(addr)<this._readWord(addr2));break;
                case '>=R':flow=flow&&(this.readReal(addr)>=this.readReal(addr2));break;
                case '<=R':flow=flow&&(this.readReal(addr)<=this.readReal(addr2));break;
                case '>R': flow=flow&&(this.readReal(addr)>this.readReal(addr2));break;
                case '<R': flow=flow&&(this.readReal(addr)<this.readReal(addr2));break;
                case '==R':flow=flow&&(Math.abs(this.readReal(addr)-this.readReal(addr2))<1e-7);break;

                // ── 移位 ──────────────────────────────────────────
                case 'SHL': if(flow)this._writeWord(addr3||addr2,(this._readWord(addr)<<(parseInt(addr2)||1))&0xFFFF);break;
                case 'SHR': if(flow)this._writeWord(addr3||addr2,(this._readWord(addr)>>(parseInt(addr2)||1))&0xFFFF);break;
                case 'ROL': if(flow){const n=(parseInt(addr2)||1)&15,v=this._readWord(addr)&0xFFFF;this._writeWord(addr3||addr2,((v<<n)|(v>>(16-n)))&0xFFFF);}break;
                case 'ROR': if(flow){const n=(parseInt(addr2)||1)&15,v=this._readWord(addr)&0xFFFF;this._writeWord(addr3||addr2,((v>>n)|(v<<(16-n)))&0xFFFF);}break;
                case 'LSHIFT_B':case 'SHL_B':if(flow)this._writeByte(addr,(this._readByte(addr)<<(pv||1))&0xFF);break;
                case 'RSHIFT_B':case 'SHR_B':if(flow)this._writeByte(addr,(this._readByte(addr)>>(pv||1))&0xFF);break;

                // ── 逻辑运算 ──────────────────────────────────────
                case 'AND_W': if(flow)this._writeWord(addr3||addr2,this._readWord(addr)&this._readWord(addr2));break;
                case 'OR_W':  if(flow)this._writeWord(addr3||addr2,this._readWord(addr)|this._readWord(addr2));break;
                case 'XOR_W': if(flow)this._writeWord(addr3||addr2,this._readWord(addr)^this._readWord(addr2));break;
                case 'INV_W': if(flow)this._writeWord(addr2||addr,(~this._readWord(addr))&0xFFFF);break;
                case 'AND_B': if(flow)this._writeByte(addr2||addr,this._readByte(addr)&this._readByte(addr2));break;
                case 'OR_B':  if(flow)this._writeByte(addr2||addr,this._readByte(addr)|this._readByte(addr2));break;
                case 'XOR_B': if(flow)this._writeByte(addr2||addr,this._readByte(addr)^this._readByte(addr2));break;
                case 'INV_B': if(flow)this._writeByte(addr2||addr,(~this._readByte(addr))&0xFF);break;

                // ── PID_Compact ────────────────────────────────────
                case 'PID_COMPACT': case 'PID': {
                    const dbN = dbRef || (loop!==undefined?10+loop:10);
                    this._execPIDCompact(dbN, flow);
                    break;
                }

                // ── Motion Control（简化版）──────────────────────
                case 'MC_POWER': {
                    const ax = parseInt(addr)||0;
                    if (ax < this._axes.length) this._axes[ax].enabled = flow;
                    if(addr2) this._writeBit(addr2, this._axes[ax].enabled);
                    break;
                }
                case 'MC_HALT': {
                    const ax=parseInt(addr)||0;
                    if (ax<this._axes.length&&flow){this._axes[ax].inMotion=false;this._axes[ax].setVel=0;}
                    break;
                }
                case 'MC_MOVEVELOCITY': {
                    const ax=parseInt(addr)||0;
                    if(ax<this._axes.length&&flow){this._axes[ax].setVel=this.readReal(addr2||'0');this._axes[ax].inMotion=true;}
                    break;
                }
                case 'MC_MOVEABSOLUTE': {
                    const ax=parseInt(addr)||0;
                    if(ax<this._axes.length&&flow){this._axes[ax].setPos=this.readReal(addr2||'0');this._axes[ax].inMotion=true;}
                    break;
                }
                case 'MC_READACTUALPOSITION': {
                    const ax=parseInt(addr)||0;
                    if(ax<this._axes.length&&addr2)this._writeReal(addr2,this._axes[ax].position);
                    break;
                }

                // ── PROFINET / SCADA 指令（同 ST20 v4）────────────
                case 'PNRD':   if(flow)this._execPNRD(inst);break;
                case 'PNWR':   if(flow)this._execPNWR(inst);break;
                case 'PNST':   this._execPNST(inst);break;
                case 'PNDIAG': this._execPNDIAG(inst);break;

                // ── DB 读写指令 ────────────────────────────────────
                case 'DBR_B': if(flow)this._writeByte(addr2,this._dbReadByte(...this._dbAddrParts(addr)));break;
                case 'DBR_W': if(flow)this._writeWord(addr2,this._dbReadWord(...this._dbAddrParts(addr)));break;
                case 'DBR_R': if(flow)this._writeReal(addr2,this._dbReadReal(...this._dbAddrParts(addr)));break;
                case 'DBW_B': if(flow)this._dbWriteByte(...this._dbAddrParts(addr),this._readByte(addr2));break;
                case 'DBW_W': if(flow)this._dbWriteWord(...this._dbAddrParts(addr),this._readWord(addr2));break;
                case 'DBW_R': if(flow)this._dbWriteReal(...this._dbAddrParts(addr),this.readReal(addr2));break;

                case 'NOP': break;
                default:    break;
            }
        }
    }

    _dbAddrParts(addr) {
        const p=this._parseDBAddr(addr); if(!p) return [1,0];
        return [p.db, p.byte];
    }

    // ── 定时器 Tick ──────────────────────────────────────────────────

    _tickTimers(dtMs) {
        this._iecTimers.forEach((t, key) => {
            if (!t._en && !t.state) return;
            if (key.includes('TON') || key.includes('TONR')) {
                if (t._en) { t.ET=Math.min((t.ET||0)+dtMs, t._PT||0); if(t.ET>=(t._PT||0))t.Q=true; }
                else { t.ET=0; t.Q=false; }
            } else if (key.includes('TOF')) {
                if (t.state===1) { t.ET=Math.min((t.ET||0)+dtMs, t._PT||0); if(t.ET>=(t._PT||0)){t.Q=false;t.state=0;} }
            } else if (key.includes('TP')) {
                if (t.state===1) { t.ET=Math.min((t.ET||0)+dtMs, t._PT||0); if(t.ET>=(t._PT||0)){t.Q=false;t.state=0;} }
            } else {
                // 兼容 S200 风格定时器
                if (t.enabled) {
                    t.ET=(t.ET||0)+dtMs;
                    const ticks=Math.floor(t.ET/(t.timeBase||100));
                    if(ticks>0){t.ET-=ticks*(t.timeBase||100);t.CV=Math.min((t.CV||0)+ticks,32767);if(t.CV>=(t.pv||0))t.Q=true;}
                } else { t.ET=0; t.CV=0; t.Q=false; }
            }
        });
    }

    // ── Motion Control 物理仿真 ─────────────────────────────────────

    _tickAxes(dtS) {
        this._axes.forEach(ax => {
            if (!ax.enabled || !ax.inMotion) return;
            // 简单速度积分
            if (ax.setVel !== 0) {
                ax.velocity = ax.setVel;
                ax.position += ax.velocity * dtS;
            } else if (ax.setPos !== ax.position) {
                const diff = ax.setPos - ax.position;
                const step = Math.min(Math.abs(diff), Math.abs(ax.velocity||10)*dtS) * Math.sign(diff);
                ax.position += step;
                if (Math.abs(ax.position - ax.setPos) < 0.001) {
                    ax.position = ax.setPos;
                    ax.inMotion = false;
                    ax.velocity = 0;
                }
            }
        });
    }

    // ── 扫描循环 ─────────────────────────────────────────────────────

    _execScan() {
        if (!this._running) return;

        // OB100（上电初始化，仅执行一次）
        if (!this._ob[100].executed) {
            this._ob[100].executed = true;
            this._execOB(100);
        }

        // OB1 主循环
        this._execOB(1);

        // OB30 循环中断（独立累积，不依赖 OB1 周期）
        this._ob[30].accumMs = (this._ob[30].accumMs||0) + this._scanCycleMs;
        if (this._ob[30].accumMs >= this._ob[30].cycleMs) {
            this._ob[30].accumMs -= this._ob[30].cycleMs;
            this._execOB(30);
        }

        this._scanCount++;
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROFINET（直接复用 ST20 v4 的实现，相同 API）
    // ═══════════════════════════════════════════════════════════════════

    _initProfinet(config) {
        const rnd = () => Math.floor(Math.random()*256).toString(16).padStart(2,'0').toUpperCase();
        this._pn = {
            stationName:    config.pnStationName || `s71200-${this.label.toLowerCase()}`,
            ip:             config.pnIP          || '192.168.0.1',
            subnet:         config.pnSubnet      || '255.255.255.0',
            gateway:        config.pnGateway     || '192.168.0.254',
            mac:            `00:1B:1B:${rnd()}:${rnd()}:${rnd()}`,
            vendorID:       0x002A,
            deviceID:       0x0301,  // S7-1200 device ID
            mode:           config.pnMode        || 'controller',
            state:          'OFFLINE',
            sendClockMs:    config.pnSendClockMs !== undefined ? config.pnSendClockMs : 1,
            reductionRatio: config.pnReductionRatio || 1,
            accumCycleMs:   0, cycleCounter:0, txFrames:0, rxFrames:0,
            lastCycleTs:    0, measuredCycleUs:0,
            p1: { link:false, act:false, speed:'1Gbps', duplex:'Full', actTimer:0 },
            p2: { link:false, act:false, speed:'1Gbps', duplex:'Full', actTimer:0 },
            devices:        [],
            maxDevices:     16,
            deviceInputData:  new Uint8Array(128),
            deviceOutputData: new Uint8Array(128),
            deviceConnected:  false,
            deviceControllerIP: '',
            arTable:        [],
            dcpIdentifyPending: false,
            dcpResponses:   [],
            mrpEnabled:     config.pnMRPEnabled !== undefined ? !!config.pnMRPEnabled : false,
            mrpRole:        config.pnMRPRole    || 'manager',
            mrpState:       'OPEN',
            mrpTestMs:      0,
            mrpRingPort:    'p1',
            diagBuffer:     [],
            cycleData:      [],
            missedCycles:   0,
            frameErrors:    0,
            consecutiveMiss:0,
        };
        this._pnSchedulerQueue = [];
        if (config.pnDevices?.length) config.pnDevices.forEach(d=>this.pnAddDevice(d));
        if (config.pnAutoStart) setTimeout(()=>this.pnStart(),100);
    }

    pnStart() {
        const pn=this._pn; if(pn.state!=='OFFLINE') return;
        pn.state='STARTUP'; pn.p1.link=true; pn.p2.link=(pn.devices.length>0||pn.mrpEnabled); pn.accumCycleMs=0;
        this._pnLog('info',`PROFINET 启动 (${pn.mode}, IP=${pn.ip}, Name=${pn.stationName})`);
        this._pnStartupTimer=400+pn.devices.length*120;
        this._rebuildDynamic(); this.markDirty();
    }

    pnStop() {
        const pn=this._pn; pn.state='OFFLINE'; pn.p1.link=false; pn.p2.link=false; pn.p1.act=false; pn.p2.act=false;
        pn.devices.forEach(d=>{d.online=false;d.arEstablished=false;}); pn.arTable=[];
        this._pnLog('warn','PROFINET 已停止'); this._rebuildDynamic(); this.markDirty();
    }

    pnAddDevice(cfg) {
        const pn=this._pn; if(pn.devices.length>=pn.maxDevices) return null;
        const slot=cfg.slot!==undefined?cfg.slot:pn.devices.length;
        const dev={
            slot, deviceName:cfg.deviceName||`device-${slot}`,
            deviceIP:cfg.deviceIP||`192.168.0.${10+slot}`,
            deviceType:cfg.deviceType||'generic', vendorID:cfg.vendorID||0, deviceID:cfg.deviceID||0,
            inputBytes:cfg.inputBytes!==undefined?cfg.inputBytes:4,
            outputBytes:cfg.outputBytes!==undefined?cfg.outputBytes:4,
            inputData:new Uint8Array(cfg.inputBytes||4), outputData:new Uint8Array(cfg.outputBytes||4),
            online:false, arEstablished:false, diagAlarm:false, configError:false,
            watchdogMs:cfg.watchdogMs||3000, lastRxTs:0,
            iBaseAddr:2+slot*4, qBaseAddr:1+slot,
            moduleRef:cfg.moduleRef||null, txCount:0, rxCount:0, missCount:0,
        };
        pn.devices.push(dev); this._pnLog('info',`添加设备: slot=${slot} ${dev.deviceName}`); return dev;
    }

    pnGetDevice(slotOrName) {
        const pn=this._pn;
        return typeof slotOrName==='number'?pn.devices.find(d=>d.slot===slotOrName):pn.devices.find(d=>d.deviceName===slotOrName);
    }

    pnDiscoverDevices() {
        const pn=this._pn; if(pn.state==='OFFLINE'){this._pnLog('warn','PN未启动');return;}
        this._pnLog('info','DCP Identify Req → 广播');
        pn.devices.forEach((dev,i)=>{
            this._pnSchedule(200+i*80+Math.random()*100,()=>{dev.online=true;dev.lastRxTs=performance.now();this._pnLog('info',`DCP Res ← ${dev.deviceName}`);this._rebuildDynamic();this.markDirty();});
        });
    }

    pnConnectDevice(slotOrName) {
        const pn=this._pn, dev=this.pnGetDevice(slotOrName); if(!dev) return;
        const steps=[{label:'Connect Req',delay:80},{label:'Connect Res',delay:50},{label:'Write Param',delay:100},{label:'Param End',delay:50},{label:'App Ready',delay:100}];
        let acc=0;
        steps.forEach(s=>{acc+=s.delay+Math.random()*40;this._pnSchedule(acc,()=>{this._pnLog('info',`  [AR ${dev.deviceName}] ${s.label}`);});});
        this._pnSchedule(acc+50,()=>{dev.arEstablished=true;dev.online=true;dev.lastRxTs=performance.now();pn.p1.link=true;pn.p1.act=true;if(pn.state!=='OPERATE')pn.state='OPERATE';this._pnLog('info',`✓ AR: ${dev.deviceName}`);this._rebuildDynamic();this.markDirty();});
    }

    pnDisconnectDevice(slotOrName) {
        const pn=this._pn, dev=this.pnGetDevice(slotOrName); if(!dev) return;
        dev.arEstablished=false;dev.online=false;pn.arTable=pn.arTable.filter(a=>a.deviceSlot!==dev.slot);
        this._pnLog('warn',`AR 断开: ${dev.deviceName}`); if(pn.arTable.length===0)pn.state='CLEAR';
        this._rebuildDynamic(); this.markDirty();
    }

    pnBindModule(slot,module) {
        const dev=this.pnGetDevice(slot); if(!dev) return;
        dev.moduleRef=module; this._pnLog('info',`绑定 ${module.type||'?'} → slot${slot}`);
        if(typeof module.connectToCPU==='function') module.connectToCPU(this);
    }

    _pnCycleExchange(dtMs) {
        const pn=this._pn; pn.accumCycleMs+=dtMs;
        const period=pn.sendClockMs*pn.reductionRatio; if(pn.accumCycleMs<period) return;
        const now=performance.now(); if(pn.lastCycleTs>0) pn.measuredCycleUs=(now-pn.lastCycleTs)*1000;
        pn.lastCycleTs=now; pn.accumCycleMs=0; pn.cycleCounter=(pn.cycleCounter+1)&0xFFFF||1;
        if(pn.state==='OFFLINE'||pn.state==='STOP') return;
        if(pn.mode==='controller') this._pnControllerCycle();
        else this._pnDeviceCycle();
        pn.p1.act=(pn.txFrames%4<2);
        if(pn.mrpEnabled)this._pnMRPTick(dtMs);
    }

    _pnControllerCycle() {
        const pn=this._pn;
        pn.devices.forEach(dev=>{
            if(!dev.arEstablished) return;
            if(dev.lastRxTs>0&&(performance.now()-dev.lastRxTs)>dev.watchdogMs){if(dev.online){dev.online=false;dev.diagAlarm=true;dev.missCount++;pn.missedCycles++;this._pnLog('error',`看门狗超时: ${dev.deviceName}`);} return;}
            for(let b=0;b<dev.outputBytes;b++) dev.outputData[b]=this._Q[dev.qBaseAddr+b]||0;
            for(let b=0;b<dev.inputBytes;b++)  this._I[dev.iBaseAddr+b]=dev.inputData[b]||0;
            if(dev.moduleRef){const mod=dev.moduleRef;const mt=(mod.type||'').toLowerCase();
                if(mt.includes('ai04')){const src=mod._AIW||mod.AIW;if(src)for(let i=0;i<Math.min(src.length,8);i++)this._AI[dev.slot*8+i]=src[i];}
                if(mt.includes('aq04')){const dst=mod._AQW||mod.AQW;if(dst)for(let i=0;i<Math.min(dst.length,8);i++)dst[i]=this._AI[dev.slot*8+i];}
                dev.online=true;dev.lastRxTs=performance.now();}
            else{dev.lastRxTs=performance.now();}
            dev.txCount++;dev.rxCount++;pn.txFrames++;pn.rxFrames++;
        });
    }

    _pnDeviceCycle() {
        const pn=this._pn; if(!pn.deviceConnected) return;
        for(let i=0;i<Math.min(pn.deviceInputData.length,this._I.length);i++) this._I[i]=pn.deviceInputData[i];
        for(let i=0;i<Math.min(pn.deviceOutputData.length,this._Q.length);i++) pn.deviceOutputData[i]=this._Q[i];
        pn.txFrames++;pn.rxFrames++;
    }

    _pnMRPTick(dtMs) {
        const pn=this._pn; pn.mrpTestMs+=dtMs;
        if(pn.mrpTestMs>=20){pn.mrpTestMs=0;if(Math.random()<0.002&&pn.mrpState==='CLOSED'){pn.mrpState='OPEN';this._pnLog('warn','MRP断路');this._pnSchedule(150,()=>{pn.mrpState='CLOSED';this._pnLog('info','MRP恢复');});}}
    }

    _pnSchedulerQueue = [];
    _pnSchedule(delayMs,cb){this._pnSchedulerQueue.push({fireAt:performance.now()+delayMs,cb});}
    _pnTickScheduler(){const now=performance.now();this._pnSchedulerQueue=this._pnSchedulerQueue.filter(item=>{if(now>=item.fireAt){item.cb();return false;}return true;});}
    _pnTickStartup(dtMs){if(!this._pnStartupTimer||this._pnStartupTimer<=0)return;this._pnStartupTimer-=dtMs;if(this._pnStartupTimer<=0){this._pnStartupTimer=0;const pn=this._pn;pn.state='OPERATE';pn.p1.link=true;pn.devices.forEach(d=>{d.online=true;d.arEstablished=true;d.lastRxTs=performance.now();});if(pn.mrpEnabled){pn.mrpState='CLOSED';pn.p2.link=true;}this._pnLog('info',`PN OPERATE (${pn.devices.filter(d=>d.online).length}/${pn.devices.length}在线)`);this._rebuildDynamic();this.markDirty();}}
    _pnLog(level,msg){const ts=new Date().toLocaleTimeString('zh-CN',{hour12:false,fractionalSecondDigits:3});this._pn.diagBuffer.unshift({level,msg,ts});if(this._pn.diagBuffer.length>32)this._pn.diagBuffer.pop();}
    _pnGenUUID(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&0x3|0x8)).toString(16);});}

    _execPNRD(inst){const slot=parseInt(inst.addr)||0,offset=parseInt(inst.addr2)||0,len=parseInt(inst.pv)||1,dest=inst.addr3||'MB0';const dev=this.pnGetDevice(slot);if(!dev||!dev.online)return;const b=parseInt(dest.replace(/[A-Za-z]/g,''))||0;for(let i=0;i<len;i++)this._M[b+i]=dev.inputData[offset+i]||0;}
    _execPNWR(inst){const slot=parseInt(inst.addr)||0,offset=parseInt(inst.addr2)||0,len=parseInt(inst.pv)||1,src=inst.addr3||'MB0';const dev=this.pnGetDevice(slot);if(!dev||!dev.arEstablished)return;const b=parseInt(src.replace(/[A-Za-z]/g,''))||0;for(let i=0;i<len;i++)dev.outputData[offset+i]=this._M[b+i]||0;dev.txCount++;}
    _execPNST(inst){const slot=parseInt(inst.addr)||0,destBit=inst.addr2||'M0.0';const dev=this.pnGetDevice(slot);this._writeBit(destBit,dev?dev.online:false);}
    _execPNDIAG(inst){const slot=parseInt(inst.addr)||0,destByte=inst.addr2||'MB0';const dev=this.pnGetDevice(slot);let d=0;if(dev){if(dev.online)d|=1;if(dev.arEstablished)d|=2;if(dev.diagAlarm)d|=4;if(dev.configError)d|=8;}const b=parseInt(destByte.replace(/[A-Za-z]/g,''))||0;this._M[b]=d;}

    pnGetState()      {return this._pn.state;}
    pnGetDevices()    {return this._pn.devices;}
    pnGetDiagBuffer() {return this._pn.diagBuffer;}
    pnGetStats()      {return{txFrames:this._pn.txFrames,rxFrames:this._pn.rxFrames,missedCycles:this._pn.missedCycles,cycleUs:this._pn.measuredCycleUs,mrpState:this._pn.mrpState};}
    pnIsOperating()   {return this._pn.state==='OPERATE';}

    // ═══════════════════════════════════════════════════════════════════
    // SCADA/HMI 通信层（直接复用 ST20 v4 代码，仅修改 SZL 返回值）
    // ═══════════════════════════════════════════════════════════════════

    _initSCADA(config) {
        this._s7={
            channelName:    config.scadaChannelName    ||'s71200_scada_bus',
            maxClients:     config.scadaMaxClients      !==undefined?config.scadaMaxClients     :8,
            pushIntervalMs: config.scadaPushIntervalMs  !==undefined?config.scadaPushIntervalMs :50,
            writeEnabled:   config.scadaWriteEnabled    !==undefined?!!config.scadaWriteEnabled  :true,
            autoAccept:     config.scadaAutoAccept      !==undefined?!!config.scadaAutoAccept    :true,
            password:       config.scadaPassword        ||'',
            clients:[], requestQueue:[], subscriptions:[],
            pushAccumMs:0, totalPushes:0, lastPushTs:0, lastSnapshot:null,
            forceTable:{}, totalRxRequests:0, totalTxResponses:0, totalTxBytes:0, totalRxBytes:0,
            diagLog:[], downloadProg:null, downloadTimer:0,
        };
        this._s7BroadcastChannel=null;
        try{this._s7BroadcastChannel=new BroadcastChannel(this._s7.channelName);this._s7BroadcastChannel.onmessage=(e)=>this._s7OnChannelMessage(e.data);this._s7Log('info',`BroadcastChannel '${this._s7.channelName}' 就绪`);}catch(e){}
        this._s7.lastSnapshot=this._s7TakeSnapshot();
    }

    // -- 以下所有 _s7 方法直接复用 ST20 v4 实现（完整粘贴）--

    _s7OnChannelMessage(msg){if(!msg||!msg.type)return;switch(msg.type){case 'scada_connect':this._s7HandleChannelConnect(msg);break;case 'scada_disconnect':this._s7HandleChannelDisconnect(msg.clientId);break;case 'scada_request':this._s7EnqueueRequest({...msg.req,clientId:msg.clientId,via:'channel'});break;case 'scada_ping':this._s7BroadcastChannel?.postMessage({type:'st20_pong',ts:performance.now(),state:{running:this._running,scanCount:this._scanCount}});break;}}
    _s7HandleChannelConnect(msg){const cid=msg.clientId||this._s7GenId();if(this._s7.password&&msg.password!==this._s7.password){this._s7BroadcastChannel?.postMessage({type:'s7_connect_ack',clientId:cid,ok:false,reason:'WRONG_PASSWORD'});return;}if(this._s7.clients.length>=this._s7.maxClients){this._s7BroadcastChannel?.postMessage({type:'s7_connect_ack',clientId:cid,ok:false,reason:'MAX_CLIENTS'});return;}const sess=this._s7CreateSession(cid,msg.clientName||'Channel-Client',msg.clientIP||'?','channel');this._s7Log('info',`Channel连接: ${sess.name}`);this._s7BroadcastChannel?.postMessage({type:'s7_connect_ack',clientId:cid,ok:true,serverInfo:this._s7GetServerInfo()});this._rebuildDynamic();this.markDirty();}
    _s7HandleChannelDisconnect(clientId){const idx=this._s7.clients.findIndex(c=>c.id===clientId);if(idx>=0){this._s7Log('info',`断开: ${this._s7.clients[idx].name}`);this._s7.clients.splice(idx,1);this._s7.subscriptions=this._s7.subscriptions.filter(s=>s.clientId!==clientId);this._rebuildDynamic();this.markDirty();}}
    _s7CreateSession(id,name,ip,via){const s={id,name,ip,via,connectedAt:performance.now(),lastActivity:performance.now(),txBytes:0,rxBytes:0,subscriptions:[],ref:null};this._s7.clients.push(s);return s;}
    _s7GetSession(clientId){return this._s7.clients.find(c=>c.id===clientId)||null;}
    _s7EnqueueRequest(req){this._s7.requestQueue.push(req);this._s7.totalRxRequests++;}

    _s7ProcessQueue(){
        const toProcess=this._s7.requestQueue.splice(0,8);
        toProcess.forEach(req=>{
            try{const result=this._s7ExecuteRequest(req);if(req.callback)req.callback(null,result);if(req.via==='channel'&&this._s7BroadcastChannel){this._s7BroadcastChannel.postMessage({type:'s7_response',clientId:req.clientId,requestId:req.requestId,ok:true,result});}this._s7.totalTxResponses++;}
            catch(e){if(req.callback)req.callback(e,null);if(req.via==='channel'&&this._s7BroadcastChannel){this._s7BroadcastChannel.postMessage({type:'s7_response',clientId:req.clientId,requestId:req.requestId,ok:false,error:e.message});}}
            const sess=this._s7GetSession(req.clientId);if(sess)sess.lastActivity=performance.now();
        });
    }

    _s7ExecuteRequest(req){
        const type=(req.type||'').toUpperCase();
        switch(type){
            case 'READ':{const addr=req.addr||'';if(addr.startsWith('MD')||addr.includes('DBD')||addr.includes('DBR'))return{addr,value:this.readReal(addr),type:'REAL'};if(addr.match(/MW|DBW|IW|QW/i))return{addr,value:this._readWord(addr),type:'INT'};if(addr.match(/AIW/i))return{addr,value:this._readWord(addr),type:'INT'};return{addr,value:this._readBit(addr),type:'BOOL'};}
            case 'READ_AREA':{const area=(req.area||'M').toUpperCase(),start=req.start||0,len=Math.min(req.length||4,256);const getArr=()=>{if(area==='I')return this._I;if(area==='Q')return this._Q;if(area==='M')return this._M;if(area==='AI')return this._AI;return this._M;};const arr=getArr();const data=[];for(let i=start;i<start+len&&i<arr.length;i++)data.push(arr[i]);return{area,start,length:data.length,data};}
            case 'WRITE':{if(!this._s7.writeEnabled)throw new Error('写入权限关闭');const addr=req.addr||'',val=req.value;if(addr.startsWith('MD')||addr.includes('DBD')||addr.includes('DBR'))this._writeReal(addr,parseFloat(val)||0);else if(addr.match(/MW|DBW|QW/i))this._writeWord(addr,parseInt(val)||0);else this._writeBit(addr,!!val);return{addr,written:val};}
            case 'WRITE_AREA':{if(!this._s7.writeEnabled)throw new Error('写入权限关闭');const area=(req.area||'M').toUpperCase(),start=req.start||0,data=req.data||[];const getArr=()=>{if(area==='Q')return this._Q;if(area==='M')return this._M;return null;};const arr=getArr();if(!arr)throw new Error(`区域${area}不可写`);data.forEach((v,i)=>{if(start+i<arr.length)arr[start+i]=v&0xFF;});return{area,start,written:data.length};}
            case 'FORCE':{if(!this._s7.writeEnabled)throw new Error('写入权限关闭');this._s7.forceTable[req.addr]=req.value;this._s7Log('warn',`强制: ${req.addr}=${req.value}`);return{addr:req.addr,forced:req.value};}
            case 'UNFORCE':{delete this._s7.forceTable[req.addr];return{addr:req.addr,unforced:true};}
            case 'CPU_RUN':  this.run();   this._s7Log('info','SCADA→RUN');  return{state:'RUN'};
            case 'CPU_STOP': this.stop();  this._s7Log('info','SCADA→STOP'); return{state:'STOP'};
            case 'CPU_RESET':this.reset(); this._s7Log('info','SCADA→RESET');return{state:'RESET'};
            case 'LOAD_PROGRAM':{if(!this._s7.writeEnabled)throw new Error('写入权限关闭');const prog=req.program||req.data;if(!prog)throw new Error('无程序数据');this._s7.downloadProg=prog;this._s7.downloadTimer=800+(JSON.stringify(prog).length/50);this._s7Log('info',`接收程序下载请求`);return{accepted:true,estimatedMs:this._s7.downloadTimer};}
            case 'GET_PROGRAM':return{program:JSON.parse(JSON.stringify(this._ob[1].program)),name:this._ob[1].program?.name||'OB1',ob30:this._ob[30].program,ob100:this._ob[100].program};
            case 'GET_SNAPSHOT':return this._s7TakeFullSnapshot();
            case 'SUBSCRIBE':{const areas=req.areas||['I','Q','M','AI'],interval=req.interval||this._s7.pushIntervalMs;this._s7.subscriptions=this._s7.subscriptions.filter(s=>s.clientId!==req.clientId);this._s7.subscriptions.push({clientId:req.clientId,areas,minIntervalMs:interval});return{subscribed:true,areas,interval};}
            case 'UNSUBSCRIBE':{this._s7.subscriptions=this._s7.subscriptions.filter(s=>s.clientId!==req.clientId);return{unsubscribed:true};}
            case 'READ_SZL':return this._s7ReadSZL(req.id||0x0011);
            case 'SET_SP':{if(!this._s7.writeEnabled)throw new Error('写入权限关闭');const loop=req.loop!==undefined?req.loop:0,val=parseFloat(req.value)||0;this._dbWriteReal(10+loop,0,val);this._s7Log('info',`PID DB${10+loop} SP=${val}`);return{loop,sp:val};}
            case 'PN_START':   this.pnStart();           return{pnState:this._pn.state};
            case 'PN_STOP':    this.pnStop();            return{pnState:this._pn.state};
            case 'PN_DISCOVER':this.pnDiscoverDevices(); return{triggered:true};
            case 'READ_DB':{const dbNum=req.dbNum||1,offset=req.offset||0,len=req.length||1;const db=this._dbGet(dbNum);if(!db)throw new Error(`DB${dbNum}不存在`);return{dbNum,offset,data:Array.from(db.data.slice(offset,offset+len))};}
            case 'WRITE_DB':{if(!this._s7.writeEnabled)throw new Error('写入权限关闭');const dbNum=req.dbNum||1,offset=req.offset||0,data=req.data||[];const db=this._dbGet(dbNum);if(!db)throw new Error(`DB${dbNum}不存在`);data.forEach((v,i)=>{if(offset+i<db.size)db.data[offset+i]=v&0xFF;});return{dbNum,offset,written:data.length};}
            case 'PING':return{pong:true,ts:performance.now(),scanCount:this._scanCount,cpuType:this._cpuVariant};
            default:throw new Error(`未知请求: ${type}`);
        }
    }

    _s7TakeSnapshot(){return{I:new Uint8Array(this._I.slice(0,14)),Q:new Uint8Array(this._Q.slice(0,10)),M:new Uint8Array(this._M.slice(0,256)),AI:new Uint8Array(this._AI.slice(0,8)),T:[...this._iecTimers.entries()].slice(0,16).map(([k,t])=>({k,Q:t.Q,ET:t.ET})),C:[...this._iecCounters.entries()].slice(0,16).map(([k,c])=>({k,CV:c.CV,Q:c.Q}}));};}
    _s7TakeFullSnapshot(){const pidInfo=[];for(let i=0;i<4;i++){const db=10+i;pidInfo.push({sp:this._dbReadReal(db,0),pv:this._dbReadReal(db,4),out:this._dbReadReal(db,8)});}return{I:Array.from(this._I.slice(0,14)),Q:Array.from(this._Q.slice(0,10)),M:Array.from(this._M.slice(0,256)),AI:Array.from(this._AI.slice(0,8)),DB1:Array.from(this._dbGet(1)?.data.slice(0,64)||[]),DB100:Array.from(this._dbGet(100)?.data.slice(0,64)||[]),running:this._running,errorState:this._errorState,errorMsg:this._errorMsg,scanCount:this._scanCount,cpuVariant:this._cpuVariant,pnState:this._pn.state,pnDevices:this._pn.devices.map(d=>({slot:d.slot,name:d.deviceName,online:d.online})),s7Clients:this._s7.clients.length,pid:pidInfo,axes:this._axes.map(a=>({pos:a.position,vel:a.velocity,enabled:a.enabled})),};}

    _s7DetectAndPush(){
        const cur=this._s7TakeSnapshot(),prev=this._s7.lastSnapshot;
        if(!prev){this._s7.lastSnapshot=cur;return;}
        const changes={I:{},Q:{},M:{},AI:{},T:{},C:{}};let hasChange=false;
        const cmpArr=(key,len)=>{for(let i=0;i<len;i++){if(cur[key][i]!==prev[key][i]){changes[key][i]=cur[key][i];hasChange=true;}}};
        cmpArr('I',cur.I.length);cmpArr('Q',cur.Q.length);cmpArr('M',cur.M.length);cmpArr('AI',cur.AI.length);
        if(!hasChange)return;
        const meta={scanCount:this._scanCount,running:this._running,errorState:this._errorState,ts:performance.now(),pnState:this._pn.state};
        this._s7.clients.forEach(sess=>{if(sess.via==='direct'&&sess.ref){try{sess.ref.onCPUDataChange?.(changes,meta);sess.txBytes+=JSON.stringify(changes).length;}catch(e){}}});
        if(this._s7BroadcastChannel&&this._s7.subscriptions.some(s=>s.clientId.startsWith('ch_'))){try{this._s7BroadcastChannel.postMessage({type:'data_push',changes,meta});this._s7.totalTxBytes+=JSON.stringify(changes).length;}catch(e){}}
        this._s7.lastSnapshot=cur;this._s7.totalPushes++;this._s7.lastPushTs=performance.now();
    }

    _s7FilterChanges(changes,areas){if(!areas)return changes;const f={};areas.forEach(a=>{if(changes[a])f[a]=changes[a];});if(changes.T)f.T=changes.T;if(changes.C)f.C=changes.C;return f;}
    _s7ApplyForceTable(){Object.entries(this._s7.forceTable).forEach(([addr,val])=>{try{if(addr.startsWith('MD')||addr.includes('DB'))this._writeReal(addr,parseFloat(val)||0);else if(addr.match(/MW|QW/i))this._writeWord(addr,parseInt(val)||0);else this._writeBit(addr,!!val);}catch(e){}});}
    _s7TickDownload(dtMs){if(!this._s7.downloadProg||this._s7.downloadTimer<=0)return;this._s7.downloadTimer-=dtMs;if(this._s7.downloadTimer<=0){this._s7.downloadTimer=0;const prog=this._s7.downloadProg;this._s7.downloadProg=null;try{this._ob[1].program=typeof prog==='string'?JSON.parse(prog):(prog.networks?prog:prog.ob1||prog);if(prog.ob30)this._ob[30].program=prog.ob30;if(prog.ob100)this._ob[100].program=prog.ob100;}catch(e){}this._ob[100].executed=false;this._scanCount=0;this._firstScan=true;this._errorState=false;this._errorMsg='';if(!this._running)this.run();this._s7Log('info','程序下载完成');this._s7.clients.forEach(s=>{if(s.via==='direct'&&s.ref)s.ref.onProgramDownloaded?.({ts:performance.now()});});if(this._s7BroadcastChannel)this._s7BroadcastChannel.postMessage({type:'program_downloaded',ts:performance.now()});this._rebuildDynamic();this.markDirty();}}

    _s7ReadSZL(id){
        const szl={id,data:null};
        switch(id){
            case 0x0011:szl.data={moduleType:this._cpuVariant,orderNumber:'6ES7 214-1AG40-0XB0',firmwareVersion:this._fwVersion,serialNumber:this._pn.mac};break;
            case 0x0025:szl.data={programMemoryKB:100,loadMemoryMB:4,retainMemoryKB:10,workMemoryKB:100};break;
            case 0x0124:szl.data={diPoints:14,doPoints:10,aiPoints:2,aoPoints:0,ethernetPorts:2,smSlots:8,cmSlots:3,sbSlots:1};break;
            case 0x0232:szl.data={s7Clients:this._s7.clients.length,s7MaxClients:this._s7.maxClients,pnDevices:this._pn.devices.length,pnState:this._pn.state};break;
            case 0x0F00:szl.data={diagEvents:[...this._pn.diagBuffer.slice(0,16),...this._s7.diagLog.slice(0,8),...this._diagEvents.slice(0,8)]};break;
            default:throw new Error(`SZL-ID 0x${id.toString(16).toUpperCase()}不支持`);
        }
        return szl;
    }

    _s7Log(level,msg){const ts=new Date().toLocaleTimeString('zh-CN',{hour12:false,fractionalSecondDigits:3});this._s7.diagLog.unshift({level,msg,ts});if(this._s7.diagLog.length>32)this._s7.diagLog.pop();}
    _s7GenId(){return 'c'+Math.random().toString(36).slice(2,10);}
    _s7GetServerInfo(){return{cpuType:this._cpuVariant,orderNumber:'6ES7 214-1AG40-0XB0',firmware:this._fwVersion,ip:this._pn.ip,stationName:this._pn.stationName,mac:this._pn.mac,pnState:this._pn.state,running:this._running,scanCount:this._scanCount};}

    scadaConnect(scadaInstance,clientName){if(!scadaInstance)return null;if(this._s7.clients.length>=this._s7.maxClients)return null;const cid=this._s7GenId(),name=clientName||scadaInstance.label||'SCADA';const sess=this._s7CreateSession(cid,name,'direct','direct');sess.ref=scadaInstance;this._s7.subscriptions.push({clientId:cid,areas:['I','Q','M','AI'],minIntervalMs:this._s7.pushIntervalMs});try{scadaInstance.onCPUDataChange?.(this._s7TakeFullSnapshot(),{scanCount:this._scanCount,running:this._running,errorState:this._errorState,ts:performance.now(),pnState:this._pn.state,isInitialSnapshot:true});}catch(e){}this._s7Log('info',`直连SCADA: ${name}`);this._rebuildDynamic();this.markDirty();return cid;}
    scadaDisconnect(clientId){this._s7HandleChannelDisconnect(clientId);}
    scadaDisconnectAll(){const ids=this._s7.clients.map(c=>c.id);ids.forEach(id=>this._s7HandleChannelDisconnect(id));this._s7.requestQueue=[];this._s7Log('info','所有SCADA连接已断开');}
    scadaRequest(req){return new Promise((resolve,reject)=>{this._s7EnqueueRequest({...req,clientId:req.clientId||'_direct',via:'promise',callback:(err,res)=>err?reject(err):resolve(res)});});}
    scadaRead(addr){if(addr.startsWith('MD')||addr.includes('DB'))return this.readReal(addr);if(addr.match(/MW|DBW|IW|QW|AIW/i))return this._readWord(addr);return this._readBit(addr);}
    scadaWrite(addr,val){if(!this._s7.writeEnabled)return;if(addr.startsWith('MD')||addr.includes('DB'))this._writeReal(addr,parseFloat(val)||0);else if(addr.match(/MW|QW/i))this._writeWord(addr,parseInt(val)||0);else this._writeBit(addr,!!val);this._s7Log('info',`直写: ${addr}=${val}`);}
    scadaGetStatus(){return{clients:this._s7.clients.map(c=>({id:c.id,name:c.name,via:c.via,connectedSec:((performance.now()-c.connectedAt)/1000).toFixed(1)})),totalPushes:this._s7.totalPushes,totalRequests:this._s7.totalRxRequests,forceTable:{...this._s7.forceTable},pushIntervalMs:this._s7.pushIntervalMs,writeEnabled:this._s7.writeEnabled,diagLog:this._s7.diagLog.slice(0,16)};}
    scadaForce(addr,val){if(!this._s7.writeEnabled)return;this._s7.forceTable[addr]=val;this._s7Log('warn',`强制: ${addr}=${val}`);}
    scadaUnforce(addr){delete this._s7.forceTable[addr];}
    scadaClearForce(){this._s7.forceTable={};}

    // ═══════════════════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════════════════

    _registerPorts() {
        for(let i=0;i<8;i++){const p=this._portPos[`I0.${i}`];this.addPort(p.x,p.y,`I0.${i}`,'wire','p');}
        for(let i=0;i<6;i++){const p=this._portPos[`I1.${i}`];this.addPort(p.x,p.y,`I1.${i}`,'wire','p');}
        for(let i=0;i<8;i++){const p=this._portPos[`Q0.${i}`];this.addPort(p.x,p.y,`Q0.${i}`,'wire');}
        for(let i=0;i<2;i++){const p=this._portPos[`Q1.${i}`];this.addPort(p.x,p.y,`Q1.${i}`,'wire');}
        this.addPort(this._portPos['AI0'].x,   this._portPos['AI0'].y,   'AI0',   'wire','p');
        this.addPort(this._portPos['AI1'].x,   this._portPos['AI1'].y,   'AI1',   'wire','p');
        this.addPort(this._portPos['PWR_L+'].x,this._portPos['PWR_L+'].y,'PWR_L+','wire','p');
        this.addPort(this._portPos['PWR_M'].x, this._portPos['PWR_M'].y, 'PWR_M', 'wire','p');
        this.addPort(this._portPos['PN_P1'].x, this._portPos['PN_P1'].y, 'PN_P1', 'bus');
        this.addPort(this._portPos['ETH_S7'].x,this._portPos['ETH_S7'].y,'ETH_S7','bus');
        this.addPort(this._portPos['SM_BUS'].x,this._portPos['SM_BUS'].y,'SM_BUS','bus');
        this.addPort(this._portPos['CM_BUS'].x,this._portPos['CM_BUS'].y,'CM_BUS','bus');
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
        this._drawCommPorts();
        this._drawSBSlot();
        this._drawTerminals();
        this._drawSMBus();
        this._drawCMBus();
        this._drawDINRail();
        this._drawVentSlots();
        this._drawNameplate();
        this._drawIOLabels();
        this._drawPortLabels();
    }

    _drawBody() {
        const b=this._body;
        // S7-1200 特有的淡绿灰色调（#d4d8d0）
        this._staticGroup.add(new Konva.Rect({x:b.x,y:b.y,width:b.w,height:b.h,
            fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:b.w,y:0},
            fillLinearGradientColorStops:[0,'#c8ccc8',0.3,'#d4d8d0',0.7,'#ccd0cc',1,'#c0c4c0'],
            stroke:'#8a8e88',strokeWidth:1.5,cornerRadius:b.rx,
            shadowColor:'#000',shadowBlur:10,shadowOffsetX:3,shadowOffsetY:4,shadowOpacity:0.28}));
        // 左侧绿色竖纹装饰（S7-1200 标志性设计）
        this._staticGroup.add(new Konva.Rect({x:0,y:b.h*0.08,width:4,height:b.h*0.84,
            fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:0,y:b.h},
            fillLinearGradientColorStops:[0,'#4a8a30',0.5,'#5a9a40',1,'#3a7a20'],
            cornerRadius:[b.rx,0,0,b.rx]}));
        // 右侧高光
        this._staticGroup.add(new Konva.Rect({x:b.w-5,y:4,width:3,height:b.h-8,fill:'rgba(255,255,255,0.28)',cornerRadius:[0,b.rx,b.rx,0]}));
    }

    _drawTopBar() {
        const W=this.width,H=this.height;
        // S7-1200 顶部：深橄榄绿（区别于 S7-200 的蓝色）
        this._staticGroup.add(new Konva.Rect({x:0,y:0,width:W,height:H*0.08,
            fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:W,y:0},
            fillLinearGradientColorStops:[0,'#2a5a1a',0.5,'#3a6a28',1,'#2a5a1a'],
            cornerRadius:[3,3,0,0]}));
        this._staticGroup.add(new Konva.Text({x:8,y:H*0.010,text:'SIMATIC',fontSize:Math.max(7,H*0.028),fontFamily:'Arial Narrow, Arial, sans-serif',fontStyle:'bold',fill:'#ffffff',letterSpacing:1.5}));
        this._staticGroup.add(new Konva.Text({x:8,y:H*0.046,text:'S7-1200',fontSize:Math.max(6,H*0.022),fontFamily:'Arial Narrow, Arial, sans-serif',fill:'#b8d8a0',letterSpacing:0.5}));
        // PROFINET 绿色三角标志
        this._staticGroup.add(new Konva.Text({x:W*0.60,y:H*0.008,text:'PROFINET',fontSize:Math.max(5,H*0.016),fontFamily:'Arial Narrow',fontStyle:'bold',fill:'#88ee44',letterSpacing:0.5}));
        this._staticGroup.add(new Konva.RegularPolygon({x:W*0.930,y:H*0.045,sides:3,radius:H*0.025,fill:'#88ee44',stroke:'#44bb22',strokeWidth:0.8}));
    }

    _drawCommPorts() {
        const W=this.width,H=this.height;
        // ── Expansion Slot E0 ──
        const e0=this._e0Port;
        this._staticGroup.add(new Konva.Rect({x:e0.x,y:e0.y,width:e0.w,height:e0.h,fill:'#1a1a1a',stroke:'#444',strokeWidth:1,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:e0.x,y:e0.y+e0.h+2,text:'E0',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fill:'#555',align:'center',width:e0.w}));
        // ── Expansion Slot E1 ──
        const e1=this._e1Port;
        this._staticGroup.add(new Konva.Rect({x:e1.x,y:e1.y,width:e1.w,height:e1.h,fill:'#1a1a1a',stroke:'#444',strokeWidth:1,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:e1.x,y:e1.y+e1.h+2,text:'E1',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fill:'#555',align:'center',width:e1.w}));
        // ── PROFINET RJ45（大口，有防尘盖外形）──
        const pn=this._pnPort;
        this._staticGroup.add(new Konva.Rect({x:pn.x,y:pn.y,width:pn.w,height:pn.h,fill:'#1a2820',stroke:'#2a5a38',strokeWidth:1.5,cornerRadius:3}));
        // 8针触点
        for(let k=0;k<8;k++){this._staticGroup.add(new Konva.Rect({x:pn.x+pn.w*(0.08+k*0.11),y:pn.y+pn.h*0.20,width:pn.w*0.080,height:pn.h*0.55,fill:'#c8c060'}));}
        // PROFINET 标签
        this._staticGroup.add(new Konva.Text({x:pn.x,y:pn.y+pn.h+2,text:'PROFINET RJ45',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fontStyle:'bold',fill:'#44aa44',align:'center',width:pn.w}));
        // PN Link/ACT LED 标签
        const pl=this._pnLinkLED,pa=this._pnActLED;
        this._staticGroup.add(new Konva.Text({x:pl.x-8,y:pl.y+pl.r+3,text:'LNK',fontSize:Math.max(4,H*0.014),fontFamily:'Arial',fill:'#448844'}));
        this._staticGroup.add(new Konva.Text({x:pa.x-8,y:pa.y+pa.r+3,text:'RX/TX',fontSize:Math.max(4,H*0.014),fontFamily:'Arial',fill:'#447744'}));
    }

    _drawSBSlot() {
        const s=this._sbSlot,H=this.height;
        // SB 信号板槽位（S7-1200 正面特有）
        this._staticGroup.add(new Konva.Rect({x:s.x,y:s.y,width:s.w,height:s.h,fill:'#1a1e1a',stroke:'#2a3a2a',strokeWidth:1,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:s.x+s.w*0.30,y:s.y+s.h*0.20,text:'Signal Board Slot',fontSize:Math.max(5,H*0.017),fontFamily:'Arial',fill:'#3a5a3a'}));
        // 定位孔
        [0.10,0.90].forEach(px=>{this._staticGroup.add(new Konva.Circle({x:s.x+s.w*px,y:s.y+s.h*0.50,radius:H*0.010,fill:'#111',stroke:'#333',strokeWidth:0.8}));});
    }

    _drawTerminals() {
        const W=this.width,H=this.height;
        // 输入端子排
        const it=this._inputTerminals;
        this._staticGroup.add(new Konva.Rect({x:it.x,y:it.y,width:it.w,height:it.h,fill:'#2a2a2a',stroke:'#1a1a1a',strokeWidth:1,cornerRadius:2}));
        for(let i=0;i<14;i++){const tx=it.x+it.w*(0.03+i*0.068);this._staticGroup.add(new Konva.Rect({x:tx,y:it.y+it.h*0.14,width:it.w*0.050,height:it.h*0.72,fill:'#888',stroke:'#666',strokeWidth:0.5,cornerRadius:1}));}
        this._staticGroup.add(new Konva.Text({x:it.x+it.w*0.38,y:it.y-H*0.025,text:'INPUT (14点)',fontSize:Math.max(5,H*0.020),fontFamily:'Arial',fontStyle:'bold',fill:'#3a8abf'}));
        // 输出端子排
        const ot=this._outputTerminals;
        this._staticGroup.add(new Konva.Rect({x:ot.x,y:ot.y,width:ot.w,height:ot.h,fill:'#2a2a2a',stroke:'#1a1a1a',strokeWidth:1,cornerRadius:2}));
        for(let i=0;i<10;i++){const tx=ot.x+ot.w*(0.04+i*0.094);this._staticGroup.add(new Konva.Rect({x:tx,y:ot.y+ot.h*0.14,width:ot.w*0.070,height:ot.h*0.72,fill:'#888',stroke:'#666',strokeWidth:0.5,cornerRadius:1}));}
        this._staticGroup.add(new Konva.Text({x:ot.x+ot.w*0.22,y:ot.y-H*0.025,text:'OUTPUT (10点)',fontSize:Math.max(5,H*0.020),fontFamily:'Arial',fontStyle:'bold',fill:'#bf5c2a'}));
        // AI 端子
        const ai=this._aiTerminals;
        this._staticGroup.add(new Konva.Rect({x:ai.x,y:ai.y,width:ai.w,height:ai.h,fill:'#1a2820',stroke:'#2a4830',strokeWidth:1,cornerRadius:2}));
        for(let i=0;i<4;i++){const tx=ai.x+ai.w*(0.08+i*0.24);this._staticGroup.add(new Konva.Rect({x:tx,y:ai.y+ai.h*0.14,width:ai.w*0.14,height:ai.h*0.72,fill:'#60a870',stroke:'#406a50',strokeWidth:0.5,cornerRadius:1}));}
        this._staticGroup.add(new Konva.Text({x:ai.x,y:ai.y-H*0.020,text:'AI (2路)',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fontStyle:'bold',fill:'#44aa66'}));
        // 电源端子
        const pw=this._pwrTerminals;
        this._staticGroup.add(new Konva.Rect({x:pw.x,y:pw.y,width:pw.w,height:pw.h,fill:'#1a1810',stroke:'#443a20',strokeWidth:1,cornerRadius:2}));
        [0.15,0.55,0.80].forEach((px,i)=>{this._staticGroup.add(new Konva.Rect({x:pw.x+pw.w*px,y:pw.y+pw.h*0.14,width:pw.w*0.18,height:pw.h*0.72,fill:i===0?'#e04020':'#888',stroke:i===0?'#a02010':'#666',strokeWidth:0.5,cornerRadius:1}));});
        this._staticGroup.add(new Konva.Text({x:pw.x,y:pw.y-H*0.020,text:'24VDC',fontSize:Math.max(5,H*0.016),fontFamily:'Arial',fontStyle:'bold',fill:'#aaa020'}));
    }

    _drawSMBus() {
        const br=this._smBus,H=this.height;
        this._staticGroup.add(new Konva.Rect({x:br.x-2,y:br.y,width:br.w+2,height:br.h,fill:'#2a2a30',stroke:'#555',strokeWidth:1,cornerRadius:[0,2,2,0]}));
        for(let i=0;i<6;i++){this._staticGroup.add(new Konva.Circle({x:br.x+br.w-2,y:br.y+br.h*(0.12+i*0.155),radius:1.5,fill:'#c8b040'}));}
        this._staticGroup.add(new Konva.Text({x:br.x-2,y:br.y+br.h+2,text:'SM',fontSize:Math.max(5,H*0.015),fontFamily:'Arial',fill:'#7090b0'}));
    }

    _drawCMBus() {
        const cl=this._cmBus,H=this.height;
        this._staticGroup.add(new Konva.Rect({x:cl.x,y:cl.y,width:cl.w+2,height:cl.h,fill:'#e8e8e0',stroke:'#888',strokeWidth:1,cornerRadius:[2,0,0,2]}));
        for(let i=0;i<4;i++){this._staticGroup.add(new Konva.Circle({x:cl.x+2,y:cl.y+cl.h*(0.15+i*0.235),radius:1.5,fill:'#888'}));}
        this._staticGroup.add(new Konva.Text({x:cl.x+1,y:cl.y+cl.h+2,text:'CM',fontSize:Math.max(5,H*0.015),fontFamily:'Arial',fill:'#667'}));
    }

    _drawDINRail() {
        const dr=this._dinRail;
        this._staticGroup.add(new Konva.Rect({x:dr.x,y:dr.y,width:dr.w,height:dr.h,fill:'#b0b4b0',stroke:'#888',strokeWidth:0.5,cornerRadius:[0,0,3,3]}));
        [0.08,0.88].forEach(px=>{this._staticGroup.add(new Konva.Rect({x:dr.x+dr.w*px,y:dr.y,width:dr.w*0.06,height:dr.h*0.60,fill:'#777',stroke:'#555',strokeWidth:0.5,cornerRadius:[0,0,2,2]}));});
    }

    _drawVentSlots() {
        this._ventSlots.forEach(vs=>{this._staticGroup.add(new Konva.Rect({x:vs.x,y:vs.y,width:vs.w,height:vs.h,fill:'#b8bcb8',stroke:'#8a8e8a',strokeWidth:0.5,cornerRadius:1}));});
    }

    _drawNameplate() {
        const np=this._nameplate,H=this.height;
        this._staticGroup.add(new Konva.Rect({x:np.x,y:np.y,width:np.w,height:np.h,fill:'#e8ece4',stroke:'#aaa',strokeWidth:0.8,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:np.x+4,y:np.y+3,text:this._cpuVariant,fontSize:Math.max(8,H*0.034),fontFamily:'Arial Narrow, Arial, sans-serif',fontStyle:'bold',fill:'#1a1a1a'}));
        this._staticGroup.add(new Konva.Text({x:np.x+4,y:np.y+np.h*0.55,text:'DC/DC/DC  6ES7 214-1AG40-0XB0',fontSize:Math.max(4,H*0.016),fontFamily:'Consolas, monospace',fill:'#555'}));
    }

    _drawIOLabels() {
        const W=this.width,H=this.height;
        this._staticGroup.add(new Konva.Text({x:W*0.02,y:H*0.468,text:'I0:',fontSize:Math.max(6,H*0.022),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#3a8abf'}));
        this._staticGroup.add(new Konva.Text({x:W*0.02,y:H*0.516,text:'I1:',fontSize:Math.max(6,H*0.022),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#3a8abf'}));
        this._staticGroup.add(new Konva.Text({x:W*0.02,y:H*0.564,text:'Q0:',fontSize:Math.max(6,H*0.022),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#bf5c2a'}));
        this._staticGroup.add(new Konva.Text({x:W*0.02,y:H*0.612,text:'Q1:',fontSize:Math.max(6,H*0.022),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#bf5c2a'}));
        this._staticGroup.add(new Konva.Text({x:W*0.26,y:H*0.614,text:'AI:',fontSize:Math.max(6,H*0.022),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#44aa44'}));
    }

    _drawPortLabels() {
        const W=this.width,H=this.height;
        for(let i=0;i<8;i++) this._staticGroup.add(new Konva.Text({x:W*(0.028+i*0.118),y:H*0.515,text:`.${i}`,fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fill:'#3a8abf'}));
        for(let i=0;i<6;i++) this._staticGroup.add(new Konva.Text({x:W*(0.028+i*0.118),y:H*0.563,text:`.${i}`,fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fill:'#3a8abf'}));
        for(let i=0;i<8;i++) this._staticGroup.add(new Konva.Text({x:W*(0.028+i*0.118),y:H*0.611,text:`.${i}`,fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fill:'#bf5c2a'}));
        for(let i=0;i<2;i++) this._staticGroup.add(new Konva.Text({x:W*(0.028+i*0.118),y:H*0.659,text:`.${i}`,fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fill:'#bf5c2a'}));
        for(let i=0;i<2;i++) this._staticGroup.add(new Konva.Text({x:W*(0.290+i*0.118),y:H*0.659,text:`AI${i}`,fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fill:'#44aa44'}));
    }

    // ── 动态部件 ─────────────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawStatusLEDs_dyn();
        this._drawPNLEDs_dyn();
        this._drawIOLEDs_dyn();
        this._drawModeSwitch_dyn();
        this._drawPNInfoPanel_dyn();
        this._drawScanInfo_dyn();
        this._drawLabelText_dyn();
    }

    _drawLED(x,y,r,on,type) {
        const C={input:{on:'#f5c842',off:'#2a2000',glow:'#f5c842'},output:{on:'#f07030',off:'#2a0a00',glow:'#f07030'},run:{on:'#44cc44',off:'#002200',glow:'#44cc44'},stop:{on:'#ee3333',off:'#220000',glow:'#ee3333'},error:{on:'#ff8800',off:'#221000',glow:'#ff8800'},maint:{on:'#ffcc00',off:'#221a00',glow:'#ffcc00'},sf:{on:'#ee3333',off:'#220000',glow:'#ee3333'},bf:{on:'#f07030',off:'#1a0a00',glow:'#f07030'},pnok:{on:'#44dd44',off:'#002200',glow:'#44dd44'},pnact:{on:'#f07030',off:'#1a0500',glow:'#f07030'},ai:{on:'#44cc44',off:'#002200',glow:'#44cc44'}};
        const c=C[type]||C.input;
        this._dynamicGroup.add(new Konva.Circle({x,y,radius:r,fill:on?c.on:c.off,stroke:on?'#666':'#333',strokeWidth:0.8,shadowColor:on?c.glow:'transparent',shadowBlur:on?r*3:0,shadowOpacity:0.9}));
    }

    _drawStatusLEDs_dyn() {
        const sl=this._statusLEDs, H=this.height;
        const isRun=this._running&&!this._errorState, isStop=!this._running&&!this._errorState, isErr=this._errorState;
        const fs=Math.max(5,H*0.016);

        const draw=(led,on,type,label)=>{
            this._drawLED(led.x,led.y,led.r,on,type);
            this._dynamicGroup.add(new Konva.Text({x:led.x+led.r+4,y:led.y-led.r,text:label,fontSize:fs,fontFamily:'Arial',fontStyle:'bold',fill:on?({run:'#44cc44',stop:'#ee3333',error:'#ff8800',maint:'#ffcc00',sf:'#ee3333',bf:'#f07030'}[type]||'#ccc'):'#444'}));
        };

        draw(sl.run,   isRun,  'run',   'RUN');
        draw(sl.stop,  isStop, 'stop',  'STOP');
        draw(sl.error, isErr,  'error', 'ERROR');
        draw(sl.maint, this._maintMode, 'maint', 'MAINT');
        draw(sl.sf,    isErr,  'sf',    'SF');
        draw(sl.bf,    this._pn.devices.some(d=>d.diagAlarm), 'bf', 'BF1');
    }

    _drawPNLEDs_dyn() {
        const pl=this._pnLinkLED, pa=this._pnActLED;
        const linkOn=this._pn.p1.link;
        const actBlink=linkOn&&(Math.floor(performance.now()/120)%2===0);
        this._drawLED(pl.x,pl.y,pl.r,linkOn,'pnok');
        this._drawLED(pa.x,pa.y,pa.r,actBlink,'pnact');
    }

    _drawIOLEDs_dyn() {
        this._inputLEDs0.forEach(led=>{this._drawLED(led.x,led.y,led.r,!!(this._I[led.byte]&(1<<led.bit)),'input');});
        this._inputLEDs1.forEach(led=>{this._drawLED(led.x,led.y,led.r,!!(this._I[led.byte]&(1<<led.bit)),'input');});
        this._outputLEDs0.forEach(led=>{this._drawLED(led.x,led.y,led.r,!!(this._Q[led.byte]&(1<<led.bit)),'output');});
        this._outputLEDs1.forEach(led=>{this._drawLED(led.x,led.y,led.r,!!(this._Q[led.byte]&(1<<led.bit)),'output');});
        // AI LED（绑定 AIW64/AIW66 是否非零）
        this._aiLEDs.forEach(led=>{
            const off=led.ch*2;
            const raw=(this._AI[off]<<8)|this._AI[off+1];
            const hasSignal=raw>100;
            this._drawLED(led.x,led.y,led.r,hasSignal,'ai');
        });
    }

    _drawModeSwitch_dyn() {
        const k=this._modeSwitch, H=this.height;
        const pos=this._running?-35:35;
        const rad=pos*Math.PI/180;
        // 外圈
        this._dynamicGroup.add(new Konva.Circle({x:k.x,y:k.y,radius:k.r,fillRadialGradientStartPoint:{x:-k.r*0.3,y:-k.r*0.3},fillRadialGradientEndRadius:k.r*1.2,fillRadialGradientColorStops:[0,'#4a4a4a',1,'#1a1a1a'],stroke:'#222',strokeWidth:1}));
        // 三档刻度线
        [-35,0,35].forEach(ang=>{const a=ang*Math.PI/180;this._dynamicGroup.add(new Konva.Line({points:[k.x+Math.cos(a-(Math.PI/2))*k.r*0.68,k.y+Math.sin(a-(Math.PI/2))*k.r*0.68,k.x+Math.cos(a-(Math.PI/2))*k.r*0.90,k.y+Math.sin(a-(Math.PI/2))*k.r*0.90],stroke:'#666',strokeWidth:1}));});
        // 指针
        this._dynamicGroup.add(new Konva.Line({points:[k.x,k.y,k.x+Math.cos(rad-(Math.PI/2))*k.r*0.68,k.y+Math.sin(rad-(Math.PI/2))*k.r*0.68],stroke:this._running?'#44cc44':'#ee3333',strokeWidth:2,lineCap:'round'}));
        this._dynamicGroup.add(new Konva.Circle({x:k.x,y:k.y,radius:k.r*0.22,fill:'#888'}));
        // 档位标注
        const fs=Math.max(4,H*0.014);
        this._dynamicGroup.add(new Konva.Text({x:k.x-k.r*1.1,y:k.y+k.r*1.1,text:'STOP',fontSize:fs,fontFamily:'Arial',fill:'#ee3333'}));
        this._dynamicGroup.add(new Konva.Text({x:k.x-6,y:k.y+k.r*1.1,text:'MRES',fontSize:fs,fontFamily:'Arial',fill:'#888'}));
        this._dynamicGroup.add(new Konva.Text({x:k.x+k.r*0.4,y:k.y+k.r*1.1,text:'RUN',fontSize:fs,fontFamily:'Arial',fill:'#44cc44'}));
    }

    _drawPNInfoPanel_dyn() {
        const np=this._pnInfoPanel, H=this.height;
        const pn=this._pn;
        const stateColor={OPERATE:'#44dd44',STARTUP:'#f5c842',CLEAR:'#f07030',OFFLINE:'#444',STOP:'#ee3333'}[pn.state]||'#444';
        const onlineCount=pn.devices.filter(d=>d.online).length;
        const fs=Math.max(4,H*0.015);

        this._dynamicGroup.add(new Konva.Rect({x:np.x,y:np.y,width:np.w,height:np.h,fill:'#0a1010',stroke:'#1a2820',strokeWidth:0.8,cornerRadius:2}));
        this._dynamicGroup.add(new Konva.Text({x:np.x+3,y:np.y+2,text:`PN [${pn.state}]  IP: ${pn.ip}`,fontSize:Math.max(5,H*0.017),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:stateColor}));
        this._dynamicGroup.add(new Konva.Text({x:np.x+3,y:np.y+np.h*0.42,text:`Dev:${onlineCount}/${pn.devices.length}  Tx:${pn.txFrames}  HMI:${this._s7.clients.length}`,fontSize:fs,fontFamily:'Consolas, monospace',fill:'#2a9fd8'}));
        this._dynamicGroup.add(new Konva.Text({x:np.x+3,y:np.y+np.h*0.72,text:`${pn.stationName}  ${pn.mac}`,fontSize:Math.max(4,H*0.013),fontFamily:'Consolas, monospace',fill:'#2a4a5a'}));
    }

    _drawScanInfo_dyn() {
        const W=this.width, H=this.height;
        const s7Cnt=this._s7.clients.length;
        // S7 连接指示
        const s7On=s7Cnt>0;
        this._dynamicGroup.add(new Konva.Circle({x:W*0.095,y:H*0.468,radius:H*0.013,fill:s7On?'#2a9fd8':'#1a2030',stroke:s7On?'#2a9fd8':'#2a3a50',strokeWidth:0.8,shadowColor:s7On?'#2a9fd8':'transparent',shadowBlur:s7On?4:0,shadowOpacity:0.9}));
        this._dynamicGroup.add(new Konva.Text({x:W*0.112,y:H*0.460,text:s7On?`HMI:${s7Cnt}`:'S7',fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:s7On?'#2a9fd8':'#2a3a50'}));
        // 扫描信息
        if(this._running){
            this._dynamicGroup.add(new Konva.Text({x:W*0.38,y:H*0.460,text:`Scan#${this._scanCount}`,fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fill:'#2a9'}));
        }
        // 扩展模块
        if(this._expansionSlots.length>0){
            const txt=this._expansionSlots.map(s=>s.type.replace(/s7_1200_|s7200_smart_/,'').toUpperCase().slice(0,4)).join(' ');
            this._dynamicGroup.add(new Konva.Text({x:W*0.38,y:H*0.476,text:`SM:${txt}`,fontSize:Math.max(4,H*0.013),fontFamily:'Consolas, monospace',fill:'#2a7a9a'}));
        }
        // Axes
        const axOn=this._axes.filter(a=>a.enabled).length;
        if(axOn>0){
            this._dynamicGroup.add(new Konva.Text({x:W*0.38,y:H*0.492,text:`MC:${axOn}轴`,fontSize:Math.max(4,H*0.013),fontFamily:'Consolas, monospace',fill:'#8a60c0'}));
        }
    }

    _drawLabelText_dyn() {
        const W=this.width, H=this.height;
        this._dynamicGroup.add(new Konva.Text({x:W*0.24,y:H*0.318,text:this.label,fontSize:Math.max(8,H*0.028),fontFamily:'Arial',fontStyle:'bold',fill:'#1a3a1a'}));
        this._dynamicGroup.add(new Konva.Text({x:W*0.24,y:H*0.348,text:this._fwVersion,fontSize:Math.max(5,H*0.016),fontFamily:'Consolas, monospace',fill:'#4a6a4a'}));
    }

    // ── 交互绑定 ─────────────────────────────────────────────────────

    _bindInteraction() {
        // 旋转开关（RUN/STOP/MRES）
        const ms=this._modeSwitch;
        const knobHit=new Konva.Circle({x:ms.x,y:ms.y,radius:ms.r*2.5,fill:'transparent'});
        knobHit.on('click tap',()=>this.toggleRun()); this._interactGroup.add(knobHit);
        // 输入 LED 点击（模拟输入）
        this._inputLEDs0.forEach(led=>{const h=new Konva.Circle({x:led.x,y:led.y,radius:led.r*3,fill:'transparent'});h.on('click tap',()=>this.toggleInput(led.byte,led.bit));this._interactGroup.add(h);});
        this._inputLEDs1.forEach(led=>{const h=new Konva.Circle({x:led.x,y:led.y,radius:led.r*3,fill:'transparent'});h.on('click tap',()=>this.toggleInput(led.byte,led.bit));this._interactGroup.add(h);});
        // MAINT 按钮
        const mb=this._maintBtn;
        const maintHit=new Konva.Circle({x:mb.x,y:mb.y,radius:mb.r*2.5,fill:'transparent'});
        maintHit.on('click tap',()=>{this._maintMode=!this._maintMode;this._rebuildDynamic();this.markDirty();}); this._interactGroup.add(maintHit);
        // PROFINET 端口点击：启动/停止 PN
        const pn=this._pnPort;
        const pnHit=new Konva.Rect({x:pn.x,y:pn.y,width:pn.w,height:pn.h,fill:'transparent'});
        pnHit.on('click tap',()=>{if(this._pn.state==='OFFLINE')this.pnStart();else this.pnStop();});
        this._interactGroup.add(pnHit);
        // AI LED 点击：手动修改 AI 值
        this._aiLEDs.forEach(led=>{
            const h=new Konva.Circle({x:led.x,y:led.y,radius:led.r*3,fill:'transparent'});
            h.on('click tap',()=>{
                const off=led.ch*2;
                const cur=(this._AI[off]<<8)|this._AI[off+1];
                const v=parseInt(prompt(`AI${led.ch} 原始值 (0~27648)`,String(cur)));
                if(!isNaN(v)){const u=Math.max(0,Math.min(27648,v));this._AI[off]=(u>>8)&0xFF;this._AI[off+1]=u&0xFF;}
            });
            this._interactGroup.add(h);
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════════════════

    tick(dt) {
        const dtMs=dt*1000;

        // 时钟存储器
        this._tickClockMemory(dtMs);

        // IEC 定时器更新
        this._tickTimers(dtMs);

        // PROFINET 调度
        this._pnTickScheduler();
        this._pnTickStartup(dtMs);
        this._pnCycleExchange(dtMs);

        // 运动控制
        this._tickAxes(dt);

        if (this._running) {
            this._accumMs += dtMs;
            if (this._accumMs >= this._scanCycleMs) {
                this._accumMs -= this._scanCycleMs;

                // AI 物理量更新（扩展模块采样）
                this._expansionSlots.forEach(entry=>{if(entry.module&&typeof entry.module._pushToCPU==='function')entry.module._pushToCPU();});

                // 执行所有 OB（OB1 + OB30 + OB100 内部按周期触发）
                this._execScan();

                // 强制写入
                this._s7ApplyForceTable();

                // 扩展模块输出刷新
                this._expansionSlots.forEach(entry=>{if(entry.module&&typeof entry.module._pollCPU==='function')entry.module._pollCPU();});

                this._rebuildDynamic();
                this.markDirty();
            }
        }

        // S7 请求处理
        this._s7ProcessQueue();

        // S7 数据推送
        this._s7.pushAccumMs=(this._s7.pushAccumMs||0)+dtMs;
        if(this._s7.pushAccumMs>=this._s7.pushIntervalMs&&this._s7.clients.length>0){
            this._s7.pushAccumMs=0;
            this._s7DetectAndPush();
        }

        // 程序下载处理
        this._s7TickDownload(dtMs);

        // 扩展模块自身 tick
        this._expansionSlots.forEach(entry=>{if(entry.module&&typeof entry.module.tick==='function')entry.module.tick(dt);});

        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════════════

    toggleRun() {
        if(this._errorState){this._errorState=false;this._errorMsg='';}
        this._running=!this._running;
        if(this._running){this._firstScan=true;this._accumMs=0;this._ob[100].executed=false;}
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }
    run()  { if(!this._running) this.toggleRun(); }
    stop() { if(this._running)  this.toggleRun(); }
    toggleInput(byteN,bitN){this._I[byteN]^=(1<<bitN);this._rebuildDynamic();this.markDirty();}
    setInput(byteN,bitN,val){if(val)this._I[byteN]|=(1<<bitN);else this._I[byteN]&=~(1<<bitN);}
    getOutput(byteN,bitN){return !!(this._Q[byteN]&(1<<bitN));}

    // AI 本体模拟量（AIW64/AIW66 → 内部以索引0/1存储）
    readAI(ch){const off=ch*2;const r=(this._AI[off]<<8)|this._AI[off+1];return r>32767?r-65536:r;}
    writeAI(ch,raw){const off=ch*2;raw=Math.max(0,Math.min(27648,Math.round(raw)));this._AI[off]=(raw>>8)&0xFF;this._AI[off+1]=raw&0xFF;}

    // DB 快捷访问
    getDB(num)              { return this._dbGet(num); }
    readDBReal(dbNum,off)   { return this._dbReadReal(dbNum,off); }
    writeDBReal(dbNum,off,v){ this._dbWriteReal(dbNum,off,v); }
    readDBWord(dbNum,off)   { return this._dbReadWord(dbNum,off); }
    writeDBWord(dbNum,off,v){ this._dbWriteWord(dbNum,off,v); }

    // PID 快捷设置（DB 索引 = 10 + loop）
    setPIDParam(loop, param, val) {
        const offs={Setpoint:0,Input:4,Output:8,Kp:12,Ti:16,Td:20,OutputHigh:24,OutputLow:28,Mode:40,ManualValue:42};
        const dbNum=10+loop, off=offs[param];
        if(off===undefined) return;
        if(param==='Mode') this._dbWriteWord(dbNum,off,parseInt(val)||0);
        else               this._dbWriteReal(dbNum,off,parseFloat(val)||0);
    }

    getPIDState(loop) {
        const db=10+loop;
        return {
            Setpoint:   this._dbReadReal(db,0),
            Input:      this._dbReadReal(db,4),
            Output:     this._dbReadReal(db,8),
            Kp:         this._dbReadReal(db,12),
            Ti:         this._dbReadReal(db,16),
            Td:         this._dbReadReal(db,20),
            OutputHigh: this._dbReadReal(db,24),
            OutputLow:  this._dbReadReal(db,28),
            Mode:       this._dbReadWord(db,40),
            active:     this._pidCompact[loop]?.active||false,
        };
    }

    // Motion Control
    getAxisState(ax) { return ax<this._axes.length ? {...this._axes[ax]} : null; }

    // 程序管理
    loadOB(obNum, prog) {
        if(!this._ob[obNum]) return;
        try { this._ob[obNum].program = typeof prog==='string' ? JSON.parse(prog) : prog; }
        catch(e) { this._errorState=true; this._errorMsg=`OB${obNum} 格式错误`; }
        if(obNum===100) this._ob[100].executed=false;
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    loadProgram(prog) {
        // 兼容接口：与 ST20 相同签名
        if (typeof prog === 'string') {
            try { prog = JSON.parse(prog); } catch(e) { this._errorState=true; return; }
        }
        if (prog.ob1 || prog.networks) this.loadOB(1, prog.ob1 || prog);
        if (prog.ob30)  this.loadOB(30, prog.ob30);
        if (prog.ob100) this.loadOB(100, prog.ob100);
        this.config.ladderProgram = JSON.stringify(this._ob[1].program);
    }

    getMemorySnapshot() {
        const pids = [];
        for(let i=0;i<4;i++) pids.push(this.getPIDState(i));
        return {
            I:       Array.from(this._I.slice(0,14)),
            Q:       Array.from(this._Q.slice(0,10)),
            M:       Array.from(this._M.slice(0,32)),
            AI:      Array.from(this._AI.slice(0,4)),
            DB1:     Array.from(this._dbGet(1)?.data.slice(0,32)||[]),
            DB100:   Array.from(this._dbGet(100)?.data.slice(0,32)||[]),
            pn:      { state:this._pn.state, devices:this._pn.devices.map(d=>({slot:d.slot,name:d.deviceName,online:d.online})), txFrames:this._pn.txFrames },
            pids,
            axes:    this._axes.map(a=>({pos:a.position,vel:a.velocity,enabled:a.enabled})),
            s7:      { clients:this._s7.clients.length, totalPushes:this._s7.totalPushes },
        };
    }

    reset() {
        this._running=false; this._initMemory(); this._initDB();
        this._pidCompact.forEach(p=>{p.Ix=0;p.prevInput=0;p.active=false;p.prevEN=false;});
        this._iecTimers.clear(); this._iecCounters.clear();
        this._axes.forEach(a=>{a.enabled=false;a.position=0;a.velocity=0;a.inMotion=false;a.error=false;});
        this._scanCount=0; this._firstScan=true; this._errorState=false; this._errorMsg='';
        this._accumMs=0; this._ob[100].executed=false; this._ob[30].accumMs=0;
        this._diagEvents=[];
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    isRunning()    { return this._running; }
    hasError()     { return this._errorState; }
    getError()     { return this._errorMsg; }
    getScanCount() { return this._scanCount; }

    // PROFINET API
    pnGetState()       { return this._pn.state; }
    pnGetDevices()     { return this._pn.devices; }
    pnGetDiagBuffer()  { return this._pn.diagBuffer; }
    pnGetStats()       { return{txFrames:this._pn.txFrames,rxFrames:this._pn.rxFrames,missedCycles:this._pn.missedCycles,cycleUs:this._pn.measuredCycleUs,mrpState:this._pn.mrpState}; }
    pnIsOperating()    { return this._pn.state==='OPERATE'; }

    // ═══════════════════════════════════════════════════════════════════
    // 默认程序（OB1，含 S7-1200 特有指令示例）
    // ═══════════════════════════════════════════════════════════════════

    _defaultOB1() {
        return {
            name: 'S71200_Main_OB1',
            networks: [
                { comment: 'Network 1 · 启保停（I0.0=启 I0.1=停 Q0.0=运行）',
                  rungs: [[{op:'LD',addr:'I0.0'},{op:'O',addr:'Q0.0'},{op:'AN',addr:'I0.1'},{op:'=',addr:'Q0.0'}]] },
                { comment: 'Network 2 · IEC 定时器 TON（Q0.0→3s→Q0.1）',
                  rungs: [[
                    {op:'LD',addr:'Q0.0'},
                    {op:'TON',addr:'T_DB1',PT:'T#3s',addr2:'Q0.1',addr3:'MD10'},
                  ]] },
                { comment: 'Network 3 · IEC 计数器 CTU（I0.2 计数10→Q0.2，I0.3复位）',
                  rungs: [[
                    {op:'LD',addr:'I0.2'},
                    {op:'CTU',addr:'C_DB1',pv:10,addr2:'I0.3',addr3:'Q0.2'},
                  ]] },
                { comment: 'Network 4 · AI0 读取 → DB1.DBR0（实数工程值）',
                  rungs: [
                    [{op:'LD',addr:'M0.0'/*Clock 1Hz*/},{op:'MOV_W',addr:'AIW64',addr2:'MW100'}],
                    [{op:'LD',addr:'M0.0'},{op:'INT_TO_REAL',addr:'MW100',addr2:'MD200'}],
                    [{op:'LD',addr:'M0.0'},{op:'MUL_R',addr:'0.000362',addr2:'MD200'}],
                    [{op:'LD',addr:'M0.0'},{op:'DBW_R',addr:'DB1.DBR0',addr2:'MD200'}],
                  ]},
                { comment: 'Network 5 · PID_Compact（DB10，Q0.0使能）',
                  rungs: [[{op:'LD',addr:'Q0.0'},{op:'PID_COMPACT',dbRef:10}]] },
                { comment: 'Network 6 · PROFINET 设备状态（slot0→M1.0）',
                  rungs: [[{op:'LD',addr:'M0.0'},{op:'PNST',addr:'0',addr2:'M1.0'}]] },
                { comment: 'Network 7 · 时钟存储器 M0.2（1Hz）驱动 Q0.7',
                  rungs: [[{op:'LD',addr:'M0.2'},{op:'A',addr:'Q0.0'},{op:'=',addr:'Q0.7'}]] },
            ]
        };
    }

    // ═══════════════════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label:'位号',              key:'label',              type:'text'     },
            { label:'扫描周期 (ms)',      key:'scanCycleMs',        type:'number'   },
            { label:'CPU 型号',          key:'cpuVariant',         type:'select',  options:['CPU1214C','CPU1212C','CPU1215C','CPU1217C'] },
            { label:'固件版本',           key:'firmwareVersion',    type:'text'     },
            { label:'OB1 程序 (JSON)',    key:'ladderProgram',      type:'textarea' },
            { label:'OB30 程序 (JSON)',   key:'ob30Program',        type:'textarea' },
            { label:'OB30 周期 (ms)',     key:'ob30CycleMs',        type:'number'   },
            { label:'PN 站名',            key:'pnStationName',      type:'text'     },
            { label:'PN IP 地址',         key:'pnIP',               type:'text'     },
            { label:'PN 模式',            key:'pnMode',             type:'select',  options:['controller','device'] },
            { label:'PN 发送时钟 (ms)',   key:'pnSendClockMs',      type:'number'   },
            { label:'PN MRP 使能',        key:'pnMRPEnabled',       type:'number'   },
            { label:'SCADA Channel',      key:'scadaChannelName',   type:'text'     },
            { label:'SCADA 推送间隔(ms)', key:'scadaPushIntervalMs',type:'number'   },
            { label:'SCADA 写入权限',     key:'scadaWriteEnabled',  type:'number'   },
        ];
    }

    onConfigUpdate(cfg) {
        if(cfg.label              !==undefined) this.label=cfg.label;
        if(cfg.scanCycleMs        !==undefined) this._scanCycleMs=Math.max(1,parseFloat(cfg.scanCycleMs));
        if(cfg.cpuVariant         !==undefined) this._cpuVariant=cfg.cpuVariant;
        if(cfg.firmwareVersion    !==undefined) this._fwVersion=cfg.firmwareVersion;
        if(cfg.ladderProgram      !==undefined) this.loadProgram(cfg.ladderProgram);
        if(cfg.ob30Program        !==undefined) this.loadOB(30,cfg.ob30Program);
        if(cfg.ob30CycleMs        !==undefined) this._ob[30].cycleMs=Math.max(1,parseFloat(cfg.ob30CycleMs)||100);
        if(cfg.pnStationName      !==undefined) this._pn.stationName=cfg.pnStationName;
        if(cfg.pnIP               !==undefined) this._pn.ip=cfg.pnIP;
        if(cfg.pnMode             !==undefined) this._pn.mode=cfg.pnMode;
        if(cfg.pnSendClockMs      !==undefined) this._pn.sendClockMs=Math.max(0.25,parseFloat(cfg.pnSendClockMs)||1);
        if(cfg.pnMRPEnabled       !==undefined) this._pn.mrpEnabled=!!parseInt(cfg.pnMRPEnabled);
        if(cfg.scadaChannelName   !==undefined) this._s7.channelName=cfg.scadaChannelName;
        if(cfg.scadaPushIntervalMs!==undefined) this._s7.pushIntervalMs=Math.max(10,parseFloat(cfg.scadaPushIntervalMs)||50);
        if(cfg.scadaWriteEnabled  !==undefined) this._s7.writeEnabled=!!parseInt(cfg.scadaWriteEnabled);
        this.config={...this.config,...cfg};
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        this.scadaDisconnectAll();
        this._s7BroadcastChannel?.close();
        this.pnStop();
        [...this._expansionSlots].forEach(s=>this.unmountModule(s.slot));
        super.destroy?.();
    }
}
