import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 ET 200SP IO Device 仿真组件
 *
 * ══════════════════════════════════════════════════════════════════════
 *  硬件规格
 * ══════════════════════════════════════════════════════════════════════
 *
 *  接口模块（IM）：
 *    IM 155-6 PN ST  订货号：6ES7 155-6AU01-0BN0
 *    PROFINET IO Device，支持最多 32 个子模块槽位
 *    集成 2 端口 PROFINET 交换机（P1 / P2，支持菊花链）
 *    支持 MRP（Media Redundancy Protocol）
 *    支持 PROFIenergy（省电协议）
 *    最大 IO 数据：64 字节输入 + 64 字节输出
 *
 *  本仿真配置（8DI + 8DO + 4AI + 2AO）：
 *
 *    槽位 0：IM 155-6 PN ST（接口模块，DAP）
 *    槽位 1：DI 8×24VDC ST  6ES7 131-6BF01-0BA0  8 路数字量输入 24V
 *    槽位 2：DQ 8×24VDC/0.5A ST  6ES7 132-6BF00-0BA0  8 路数字量输出 24V
 *    槽位 3：AI 4×U/I 2-/4-Wire ST  6ES7 134-6GD01-0BA1  4 路模拟量输入
 *    槽位 4：AQ 2×U/I ST  6ES7 135-6FB01-0BA1  2 路模拟量输出
 *
 *  模拟量规格：
 *    AI  电压：±10V / 0~10V / 0~5V（12位，满量程 27648）
 *        电流：0~20mA / 4~20mA（12位）
 *    AO  电压：±10V / 0~10V（12位）
 *        电流：0~20mA / 4~20mA（12位）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  PROFINET IO 数据映射
 * ══════════════════════════════════════════════════════════════════════
 *
 *  IO Data（从 Controller 视角，ST20 CPU 的地址映射）：
 *
 *    输入数据区（Device → Controller，CPU 读取）：
 *      字节 0    : DI  8位数字量输入（Bit0=I0.0 … Bit7=I0.7）
 *      字节 1    : DI  状态字节（Bit0=数据有效，Bit1=模块故障）
 *      字节 2~3  : AI0 16位原始值（大端，有符号，-27648~27648）
 *      字节 4~5  : AI1 16位原始值
 *      字节 6~7  : AI2 16位原始值
 *      字节 8~9  : AI3 16位原始值
 *      字节 10   : AI 状态字节（Bit0~3=各通道有效位）
 *      字节 11   : 诊断字节（Bit0=DI模块故障, Bit1=AI模块故障）
 *      合计：12 字节输入
 *
 *    输出数据区（Controller → Device，CPU 写入）：
 *      字节 0    : DO  8位数字量输出（Bit0=Q0.0 … Bit7=Q0.7）
 *      字节 1    : DO  控制字节（Bit0=输出使能）
 *      字节 2~3  : AO0 16位原始值（-27648~27648）
 *      字节 4~5  : AO1 16位原始值
 *      字节 6    : AO 控制字节（Bit0~1=各通道使能）
 *      合计：7 字节输出
 *
 *  ST20 Controller 梯形图访问示例：
 *    读 DI：  LD   I2.0         （I2=iBaseAddr，取决于设备 slot）
 *    读 AI0： MOV_W AIW0, VW100 （AIW 地址由 Controller pnBindModule 分配）
 *    写 DO：  =    Q1.0
 *    写 AO0： MOV_W VW200, AQW0
 *
 * ══════════════════════════════════════════════════════════════════════
 *  连接方式（与 ST20 通信）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  方式1：直接绑定（推荐，无网络延迟）
 *    const et200sp = new ET200SP(config, sys);
 *    const st20    = new S7200SmartST20(config2, sys);
 *
 *    // ST20 侧：注册 ET200SP 为 PROFINET IO Device
 *    st20.pnAddDevice({
 *        slot:        0,
 *        deviceName: 'et200sp-1',
 *        deviceIP:   '192.168.0.10',
 *        deviceType: 'ET200SP',
 *        inputBytes:  12,
 *        outputBytes: 7,
 *        moduleRef:   et200sp,          // ← 直接引用
 *    });
 *    st20.pnStart();
 *    st20.pnConnectDevice('et200sp-1'); // 建立 AR
 *
 *    // ET200SP 侧：注册 Controller
 *    et200sp.connectToController(st20, {
 *        controllerIP:  '192.168.0.1',
 *        deviceSlot:    0,
 *    });
 *
 *  方式2：通过 pnBindModule（Controller 主动绑定）
 *    st20.pnBindModule(0, et200sp);     // Controller 绑定
 *    // ET200SP 自动收到 connectToCPU() 回调
 *
 *  方式3：BroadcastChannel（跨页面，仿真网络传输）
 *    et200sp.pnChannelName = 'et200sp_bus';
 *    // ST20 与 ET200SP 通过 BroadcastChannel 交换 IO 数据帧
 *
 * ══════════════════════════════════════════════════════════════════════
 *  信号发生器（Sensor Simulation）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  每个 AI 通道可配置独立的信号仿真模式：
 *    'manual'  ← 手动设定工程值（面板滑块 / setAIValue() API）
 *    'sine'    ← 正弦波（freq Hz, amp, offset, 量程自动钳制）
 *    'ramp'    ← 锯齿波斜坡（period s）
 *    'square'  ← 方波（period s, duty %）
 *    'noise'   ← 随机噪声叠加常量（noiseAmp）
 *    'const'   ← 固定常量
 *
 *  AO 通道接收 Controller 写入值后自动更新工程值显示。
 *
 * ══════════════════════════════════════════════════════════════════════
 *  外观描述（ET200SP 正面面板）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  机身颜色：浅米黄/暖白（ET200SP 标志性外观），铝质感质地
 *  尺寸比例：宽约 150px，高约 380px（组件默认）
 *
 *  ┌─────────────────────┐
 *  │ [IM 155-6 PN ST]    │  ← 顶部 IM 接口模块（橄榄绿顶带）
 *  │  ┌─P1─┐ ┌─P2─┐     │  ← 双 PROFINET RJ45 口（绿色）
 *  │  └────┘ └────┘     │
 *  │  ○RUN ○ERR ○BF ○MT │  ← 4 LED（绿/红/红/黄）
 *  │  ┌──────────────┐  │
 *  │  │ IM 铭牌       │  │
 *  │  └──────────────┘  │
 *  ├─────────────────────┤
 *  │ [DI 8×24VDC ST]     │  ← 槽1：数字量输入模块（浅蓝框）
 *  │  ●●●●●●●●           │  ← 8个输入指示灯（黄色）
 *  │  [8针端子 A/B/C/D]   │
 *  ├─────────────────────┤
 *  │ [DQ 8×24VDC ST]     │  ← 槽2：数字量输出模块（浅橙框）
 *  │  ●●●●●●●●           │  ← 8个输出指示灯（橙色）
 *  │  [8针端子]           │
 *  ├─────────────────────┤
 *  │ [AI 4×U/I ST]       │  ← 槽3：模拟量输入模块（浅绿框）
 *  │  CH0: ████ 5.234V   │  ← 4通道进度条+数值
 *  │  CH1: ██   2.100V   │
 *  │  CH2: █    1.020mA  │
 *  │  CH3: ████ 18.5mA   │
 *  │  [端子 + 信号选择]   │
 *  ├─────────────────────┤
 *  │ [AQ 2×U/I ST]       │  ← 槽4：模拟量输出模块（浅紫框）
 *  │  AO0: ██   3.500V   │  ← 2通道进度条+数值
 *  │  AO1: █    8.4mA    │
 *  │  [端子]              │
 *  ├─────────────────────┤
 *  │  [BusAdapter BA 2×RJ45]  ← 底部总线适配器（PN DIN 导轨）
 *  └─────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口
 * ══════════════════════════════════════════════════════════════════════
 *
 *  PN_P1    → PROFINET Port1（bus，顶部，连接 Controller / 交换机）
 *  PN_P2    → PROFINET Port2（bus，顶部，菊花链下一设备）
 *  DI_0~7   → 数字量输入端口（wire, passive，底部端子）
 *  DO_0~7   → 数字量输出端口（wire，底部端子）
 *  AI0_P / AI0_N → 模拟量输入 CH0 正/负端（wire, passive）
 *  AI1_P / AI1_N → 模拟量输入 CH1
 *  AI2_P / AI2_N → 模拟量输入 CH2
 *  AI3_P / AI3_N → 模拟量输入 CH3
 *  AO0_P / AO0_M → 模拟量输出 CH0
 *  AO1_P / AO1_M → 模拟量输出 CH1
 *  PWR_L+   → 24V DC 电源正
 *  PWR_M    → 24V DC 电源 M
 *
 * ══════════════════════════════════════════════════════════════════════
 *  可配置参数
 * ══════════════════════════════════════════════════════════════════════
 *
 *  label              : 位号（默认 'ET200SP-1'）
 *  pnStationName      : PROFINET 站名（默认 'et200sp-1'）
 *  pnIP               : IP 地址（默认 '192.168.0.10'）
 *  pnSubnet           : 子网掩码（'255.255.255.0'）
 *  pnGateway          : 网关（'192.168.0.254'）
 *  aiModes            : 4路AI量程（['V±10','V±10','I4-20','I0-20']）
 *  aiSigModes         : 4路AI信号仿真模式（['sine','const','ramp','manual']）
 *  aiSigParams        : 4路AI信号参数对象数组
 *  aoModes            : 2路AO量程（['V±10','I4-20']）
 *  pnChannelName      : BroadcastChannel 名（'et200sp_pn_bus'）
 *  watchdogMs         : 看门狗超时（3000ms）
 */
export class ET200SP extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(150, config.width  || 190);
        this.height = Math.max(360, config.height || 460);

        this.type    = 'et200sp';
        this.special = 'io_device';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initIO();
        this._initSignalGenerators();
        this._initProfinet(config);
        this._init();

        this.config = {
            label:         this.label,
            pnStationName: this._pn.stationName,
            pnIP:          this._pn.ip,
            pnSubnet:      this._pn.subnet,
            pnGateway:     this._pn.gateway,
            aiModes:       [...this._aiModes],
            aiSigModes:    [...this._aiSigModes],
            aoModes:       [...this._aoModes],
            pnChannelName: this._pn.channelName,
            watchdogMs:    this._pn.watchdogMs,
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // ── 全局机身 ──
        this._body = { x: 0, y: 0, w: W, h: H, rx: 3 };

        // 按功能分区（竖向排列）：
        // IM 区：H*0.00 ~ H*0.24
        // DI 区：H*0.24 ~ H*0.43
        // DO 区：H*0.43 ~ H*0.61
        // AI 区：H*0.61 ~ H*0.80
        // AO 区：H*0.80 ~ H*0.93
        // 底部总线：H*0.93 ~ H*1.00

        // ── IM 模块区 ──
        this._imArea = { x: 0, y: 0, w: W, h: H * 0.235 };

        // IM 顶部绿色色带
        this._imTopBar = { x: 0, y: 0, w: W, h: H * 0.055 };

        // PROFINET 端口（双 RJ45，并排）
        const pnPortW = W * 0.30, pnPortH = H * 0.065;
        const pnPortY = H * 0.063;
        this._pnP1Port = { x: W * 0.06, y: pnPortY, w: pnPortW, h: pnPortH };
        this._pnP2Port = { x: W * 0.42, y: pnPortY, w: pnPortW, h: pnPortH };

        // PN Link/ACT LED（每端口）
        this._pnLEDs = {
            p1Link: { x: W * 0.085, y: H * 0.150, r: H * 0.012 },
            p1Act:  { x: W * 0.115, y: H * 0.150, r: H * 0.012 },
            p2Link: { x: W * 0.445, y: H * 0.150, r: H * 0.012 },
            p2Act:  { x: W * 0.475, y: H * 0.150, r: H * 0.012 },
        };

        // IM 状态 LED（RUN/ERR/BF/MT）
        const imLedY = H * 0.175;
        const imLedR = H * 0.014;
        this._imLEDs = {
            run:  { x: W * 0.120, y: imLedY, r: imLedR },
            err:  { x: W * 0.230, y: imLedY, r: imLedR },
            bf:   { x: W * 0.340, y: imLedY, r: imLedR },
            mt:   { x: W * 0.450, y: imLedY, r: imLedR },
        };

        // IM 铭牌
        this._imNameplate = { x: W * 0.05, y: H * 0.197, w: W * 0.90, h: H * 0.040 };

        // ── DI 模块区（槽 1）──
        const diY = H * 0.238;
        const diH = H * 0.188;
        this._diArea = { x: 0, y: diY, w: W, h: diH };

        // 8 个 DI LED（2行 × 4列）
        this._diLEDs = [];
        for (let i = 0; i < 8; i++) {
            const col = i % 4, row = Math.floor(i / 4);
            this._diLEDs.push({
                x: W * (0.12 + col * 0.210),
                y: diY + diH * (0.38 + row * 0.32),
                r: H * 0.013, bit: i,
            });
        }

        // DI 端子排
        this._diTerminals = { x: W * 0.04, y: diY + diH * 0.78, w: W * 0.92, h: diH * 0.18 };

        // ── DO 模块区（槽 2）──
        const doY = H * 0.427;
        const doH = H * 0.178;
        this._doArea = { x: 0, y: doY, w: W, h: doH };

        // 8 个 DO LED（同 DI 布局）
        this._doLEDs = [];
        for (let i = 0; i < 8; i++) {
            const col = i % 4, row = Math.floor(i / 4);
            this._doLEDs.push({
                x: W * (0.12 + col * 0.210),
                y: doY + doH * (0.35 + row * 0.32),
                r: H * 0.013, bit: i,
            });
        }

        // DO 端子排
        this._doTerminals = { x: W * 0.04, y: doY + doH * 0.78, w: W * 0.92, h: doH * 0.18 };

        // ── AI 模块区（槽 3）──
        const aiY = H * 0.610;
        const aiH = H * 0.188;
        this._aiArea = { x: 0, y: aiY, w: W, h: aiH };

        // 4 通道 AI 行
        this._aiRows = [];
        for (let i = 0; i < 4; i++) {
            this._aiRows.push({
                x:    W * 0.04,
                y:    aiY + aiH * (0.12 + i * 0.215),
                w:    W * 0.92,
                h:    aiH * 0.18,
                ch:   i,
            });
        }

        // ── AO 模块区（槽 4）──
        const aoY = H * 0.803;
        const aoH = H * 0.127;
        this._aoArea = { x: 0, y: aoY, w: W, h: aoH };

        // 2 通道 AO 行
        this._aoRows = [];
        for (let i = 0; i < 2; i++) {
            this._aoRows.push({
                x:  W * 0.04,
                y:  aoY + aoH * (0.12 + i * 0.440),
                w:  W * 0.92,
                h:  aoH * 0.36,
                ch: i,
            });
        }

        // ── 底部总线适配器（BusAdapter）──
        this._busAdapter = { x: 0, y: H * 0.933, w: W, h: H * 0.067 };

        // ── 端口坐标（底部中心线）──
        this._portPos = {
            PN_P1: { x: W * 0.21, y: 0 },
            PN_P2: { x: W * 0.57, y: 0 },
        };
        const termY = H;
        // DI
        for (let i = 0; i < 8; i++) this._portPos[`DI_${i}`] = { x: W*(0.06+i*0.118), y: termY };
        // DO
        for (let i = 0; i < 8; i++) this._portPos[`DO_${i}`] = { x: W*(0.06+i*0.118), y: termY };
        // AI
        for (let i = 0; i < 4; i++) {
            this._portPos[`AI${i}_P`] = { x: W*(0.06+i*0.23),      y: termY };
            this._portPos[`AI${i}_N`] = { x: W*(0.06+i*0.23+0.11), y: termY };
        }
        // AO
        for (let i = 0; i < 2; i++) {
            this._portPos[`AO${i}_P`] = { x: W*(0.06+i*0.23),      y: termY };
            this._portPos[`AO${i}_M`] = { x: W*(0.06+i*0.23+0.11), y: termY };
        }
        this._portPos['PWR_L+'] = { x: W * 0.80, y: 0 };
        this._portPos['PWR_M']  = { x: W * 0.92, y: 0 };
    }

    // ═══════════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label = config.label || 'ET200SP-1';
    }

    // ═══════════════════════════════════════════════════════════════
    // I/O 存储区初始化
    // ═══════════════════════════════════════════════════════════════

    _initIO() {
        // ── 数字量 ──
        this._DI = 0;   // 8位（Bit0~7 = DI0~DI7）
        this._DO = 0;   // 8位（由 Controller 写入）
        this._doEnabled = true;

        // ── 模拟量输入（4通道）──
        this._aiModes    = ['V±10', 'V±10', 'I4-20', 'I0-20'];
        this._aiRaw      = new Int16Array(4);    // 原始整数（-27648~27648）
        this._aiEng      = new Float64Array(4);  // 工程值（V 或 mA）
        this._aiOver     = new Uint8Array(4);    // 溢出标志
        this._aiUnder    = new Uint8Array(4);    // 欠量程标志
        this._aiWaveHist = Array.from({length:4}, () => new Float64Array(60));
        this._aiWavePtr  = new Uint8Array(4);
        this._aiGaugeAng = new Float64Array(4).fill(Math.PI);

        // ── 模拟量输出（2通道）──
        this._aoModes = ['V±10', 'I4-20'];
        this._aoRaw   = new Int16Array(2);
        this._aoEng   = new Float64Array(2);

        // ── PROFINET IO 数据缓冲区（与 Controller 交换的原始字节）──
        // 输入数据（Device → Controller）：12 字节
        this._pnInputData  = new Uint8Array(12);
        // 输出数据（Controller → Device）：7 字节
        this._pnOutputData = new Uint8Array(7);
    }

    // ═══════════════════════════════════════════════════════════════
    // 信号发生器初始化
    // ═══════════════════════════════════════════════════════════════

    _initSignalGenerators() {
        this._aiSigModes  = ['sine',  'const', 'ramp',   'manual'];
        this._aiSigParams = [
            { freq:0.5, amp:8.0,  offset:0.0, period:8.0,  duty:50, noiseAmp:0.5, constVal:5.0, manualVal:0.0 },
            { freq:0.0, amp:0.0,  offset:0.0, period:5.0,  duty:50, noiseAmp:0.2, constVal:8.0, manualVal:0.0 },
            { freq:0.0, amp:0.0,  offset:0.0, period:10.0, duty:50, noiseAmp:0.3, constVal:12.0,manualVal:0.0 },
            { freq:0.3, amp:10.0, offset:0.0, period:12.0, duty:50, noiseAmp:0.5, constVal:0.0, manualVal:0.0 },
        ];
        this._aiSigTime = new Float64Array(4);  // 每通道独立时钟（s）
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET 初始化（Device 模式）
    // ═══════════════════════════════════════════════════════════════

    _initProfinet(config) {
        const rnd = () => Math.floor(Math.random()*256).toString(16).padStart(2,'0').toUpperCase();
        this._pn = {
            // ── 标识 ──
            stationName:  config.pnStationName || 'et200sp-1',
            ip:           config.pnIP          || '192.168.0.10',
            subnet:       config.pnSubnet      || '255.255.255.0',
            gateway:      config.pnGateway     || '192.168.0.254',
            mac:          `00:1B:1B:${rnd()}:${rnd()}:${rnd()}`,
            vendorID:     0x002A,
            deviceID:     0x0307,  // ET200SP IM155-6
            fwVersion:    'V3.0',
            orderNumber:  '6ES7 155-6AU01-0BN0',

            // ── 状态 ──
            state:           'OFFLINE',  // OFFLINE|STARTUP|DATA_EXCHANGE|ERROR
            arEstablished:   false,
            controllerConnected: false,
            controllerIP:    '',
            controllerRef:   null,   // 直连时为 Controller CPU 实例引用
            deviceSlot:      -1,     // 在 Controller 设备表中的槽位号

            // ── 端口 ──
            p1: { link:false, act:false },
            p2: { link:false, act:false },

            // ── 周期数据 ──
            sendClockMs:     config.pnSendClockMs || 1,
            accumCycleMs:    0,
            cycleCounter:    0,
            txFrames:        0,
            rxFrames:        0,
            lastCycleTs:     0,
            measuredCycleUs: 0,
            missedCycles:    0,

            // ── 看门狗 ──
            watchdogMs:      config.watchdogMs || 3000,
            lastRxTs:        0,
            watchdogTripped: false,

            // ── MRP ──
            mrpEnabled:  config.pnMRPEnabled || false,
            mrpRole:     'client',
            mrpState:    'OPEN',

            // ── 诊断 ──
            diagBuffer:  [],
            diagAlarm:   false,

            // ── BroadcastChannel（可选，跨页面通信）──
            channelName:    config.pnChannelName || 'et200sp_pn_bus',
            bcChannel:      null,

            // ── 定时器 ──
            startupTimer:   0,
        };

        // BroadcastChannel（可选）
        try {
            this._pn.bcChannel = new BroadcastChannel(this._pn.channelName);
            this._pn.bcChannel.onmessage = (e) => this._onBCMessage(e.data);
            this._pnLog('info', `BroadcastChannel '${this._pn.channelName}' 就绪`);
        } catch(e) {}

        // 调度队列（轻量定时器）
        this._pnSchedulerQueue = [];
    }

    // ── PROFINET 调度器 ─────────────────────────────────────────────

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
        if (this._pn.diagBuffer.length > 48) this._pn.diagBuffer.pop();
    }

    // ── BroadcastChannel 消息处理 ──────────────────────────────────

    _onBCMessage(msg) {
        if (!msg?.type) return;
        switch (msg.type) {
            case 'pn_connect_device':
                // Controller 通过 Channel 发起 AR 建立
                if (msg.deviceName === this._pn.stationName) {
                    this._handleAREstablish(msg.controllerIP || '?');
                }
                break;
            case 'pn_output_data':
                // Controller 发送周期输出数据帧
                if (msg.deviceName === this._pn.stationName && msg.data) {
                    this._receiveOutputFrame(new Uint8Array(msg.data));
                }
                break;
            case 'pn_disconnect':
                if (msg.deviceName === this._pn.stationName) {
                    this._handleARRelease();
                }
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET Device 连接 API（公开）
    // ═══════════════════════════════════════════════════════════════

    /**
     * 直接连接到 Controller CPU 实例（无网络延迟）
     * @param {object} controllerCPU  ST20 / S7-1200 CPU 实例
     * @param {object} opts           { controllerIP, deviceSlot }
     */
    connectToController(controllerCPU, opts = {}) {
        if (!controllerCPU) return;
        this._pn.controllerRef   = controllerCPU;
        this._pn.controllerIP    = opts.controllerIP || controllerCPU._pn?.ip || '192.168.0.1';
        this._pn.deviceSlot      = opts.deviceSlot   !== undefined ? opts.deviceSlot : 0;
        this._pn.p1.link         = true;
        this._pn.state           = 'STARTUP';

        this._pnLog('info', `连接到 Controller ${this._pn.controllerIP}, 站名: ${this._pn.stationName}`);

        // 仿真启动序列（DCP + AR 建立）
        this._pn.startupTimer = 350 + Math.random() * 250;
        this._rebuildDynamic(); this.markDirty();
    }

    /**
     * 由 Controller pnBindModule 触发（connectToCPU 兼容接口）
     */
    connectToCPU(cpu) {
        this.connectToController(cpu, {
            controllerIP: cpu._pn?.ip || '192.168.0.1',
            deviceSlot:   0,
        });
    }

    /**
     * 断开 Controller 连接
     */
    disconnectFromController() {
        this._handleARRelease();
    }

    /** connectToCPU 的别名（BaseComponent 兼容） */
    disconnectFromCPU() {
        this.disconnectFromController();
    }

    _handleAREstablish(controllerIP) {
        this._pn.arEstablished      = true;
        this._pn.controllerConnected= true;
        this._pn.state              = 'DATA_EXCHANGE';
        this._pn.lastRxTs           = performance.now();
        this._pn.watchdogTripped    = false;
        this._pn.p1.link            = true;
        this._pn.p1.act             = true;
        this._pnLog('info', `✓ AR 建立，进入数据交换模式（Controller: ${controllerIP}）`);
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    _handleARRelease() {
        this._pn.arEstablished       = false;
        this._pn.controllerConnected = false;
        this._pn.state               = 'OFFLINE';
        this._pn.controllerRef       = null;
        this._pn.p1.link             = false;
        this._pn.p1.act              = false;
        this._pn.watchdogTripped     = false;
        this._pnLog('warn', 'AR 断开，退出数据交换');
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════
    // 量程与数值转换
    // ═══════════════════════════════════════════════════════════════

    _modeRange(mode) {
        switch (mode) {
            case 'V±10':  return { min:-10,  max:10,   unit:'V'  };
            case 'V0-10': return { min:0,    max:10,   unit:'V'  };
            case 'V0-5':  return { min:0,    max:5,    unit:'V'  };
            case 'I0-20': return { min:0,    max:20,   unit:'mA' };
            case 'I4-20': return { min:4,    max:20,   unit:'mA' };
            default:      return { min:0,    max:10,   unit:'V'  };
        }
    }

    _engToRaw(eng, mode) {
        const { min, max } = this._modeRange(mode);
        if (mode === 'V±10') return Math.round((eng / 10.0) * 27648);
        return Math.round(((Math.max(min, Math.min(max, eng)) - min) / (max - min)) * 27648);
    }

    _rawToEng(raw, mode) {
        const { min, max } = this._modeRange(mode);
        if (mode === 'V±10') return (raw / 27648) * 10.0;
        return min + (Math.max(0, raw) / 27648) * (max - min);
    }

    _engToPct(eng, mode) {
        const { min, max } = this._modeRange(mode);
        return Math.max(0, Math.min(1, (eng - min) / (max - min)));
    }

    _gaugeColor(pct, mode) {
        if (mode === 'V±10') {
            const d = Math.abs(pct - 0.5) * 2;
            return d < 0.6 ? '#44cc66' : d < 0.85 ? '#f5c842' : '#f07040';
        }
        return pct < 0.75 ? '#44aacc' : pct < 0.92 ? '#f5c842' : '#f07040';
    }

    // ═══════════════════════════════════════════════════════════════
    // AI 信号发生器
    // ═══════════════════════════════════════════════════════════════

    _genAISignal(ch, dtS) {
        const mode  = this._aiSigModes[ch];
        const p     = this._aiSigParams[ch];
        const range = this._modeRange(this._aiModes[ch]);
        const { min, max } = range;

        this._aiSigTime[ch] += dtS;
        const t = this._aiSigTime[ch];
        let eng = 0;

        switch (mode) {
            case 'manual': eng = p.manualVal; break;
            case 'const':  eng = p.constVal;  break;
            case 'sine':   eng = p.offset + p.amp * Math.sin(2 * Math.PI * p.freq * t); break;
            case 'ramp':   { const T=Math.max(0.1,p.period); eng=min+(t%T)/T*(max-min); break; }
            case 'square': { const T=Math.max(0.1,p.period); eng=((t%T)/T<p.duty/100)?(p.offset+p.amp):(p.offset-p.amp); break; }
            case 'noise':  eng=(p.constVal||0)+(Math.random()*2-1)*p.noiseAmp; break;
        }

        // 钳制
        if      (eng > max * 1.1) { this._aiOver[ch]=1;  this._aiUnder[ch]=0; eng=max; }
        else if (eng < min - (mode==='V±10'?Math.abs(min)*0.1:0)) { this._aiUnder[ch]=1; this._aiOver[ch]=0; eng=min; }
        else    { this._aiOver[ch]=0; this._aiUnder[ch]=0; }
        eng = Math.max(min, Math.min(max, eng));
        return eng;
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET IO 数据帧构建与解析
    // ═══════════════════════════════════════════════════════════════

    /** 构建输入帧（Device → Controller）：12 字节 */
    _buildInputFrame() {
        const buf = this._pnInputData;
        // 字节 0：DI 8位
        buf[0] = this._DI & 0xFF;
        // 字节 1：DI 状态（0x01=数据有效）
        buf[1] = this._pn.arEstablished ? 0x01 : 0x00;
        // 字节 2~9：AI0~AI3 各 2 字节（大端有符号）
        for (let i = 0; i < 4; i++) {
            const raw = Math.max(-32768, Math.min(32767, this._aiRaw[i]));
            const u   = raw < 0 ? raw + 65536 : raw;
            buf[2 + i*2]     = (u >> 8) & 0xFF;
            buf[2 + i*2 + 1] =  u       & 0xFF;
        }
        // 字节 10：AI 状态（Bit0~3=各通道有效）
        buf[10] = 0x0F;  // 全部有效
        // 字节 11：诊断（0=正常）
        buf[11] = (this._pn.watchdogTripped ? 0x01 : 0x00)
                | (this._pn.diagAlarm       ? 0x02 : 0x00);
        return buf;
    }

    /** 解析输出帧（Controller → Device）：7 字节 */
    _receiveOutputFrame(data) {
        if (!data || data.length < 7) return;
        // 字节 0：DO 8位
        if (data[1] & 0x01) {  // 输出使能位
            this._DO = data[0];
            this._doEnabled = true;
        } else {
            this._doEnabled = false;
        }
        // 字节 2~5：AO0/AO1 各 2 字节（大端有符号）
        for (let i = 0; i < 2; i++) {
            const hi  = data[2 + i*2], lo = data[2 + i*2 + 1];
            const raw = (hi << 8) | lo;
            const signed = raw > 32767 ? raw - 65536 : raw;
            this._aoRaw[i] = signed;
            this._aoEng[i] = this._rawToEng(signed, this._aoModes[i]);
        }
        // 字节 6：AO 控制字节
        this._pn.lastRxTs    = performance.now();
        this._pn.rxFrames++;
        this._pn.watchdogTripped = false;
        this._rebuildDynamic(); this.markDirty();
    }

    /** 向 Controller 推送输入数据（直连模式） */
    _pushToController() {
        const pn  = this._pn;
        if (!pn.arEstablished) return;
        const buf = this._buildInputFrame();

        if (pn.controllerRef) {
            // 直连：写入 Controller 的 PROFINET Device 数据结构
            const cpu = pn.controllerRef;
            // 找到对应的设备条目（通过 moduleRef 反查）
            const dev = cpu._pn?.devices?.find(d => d.moduleRef === this);
            if (dev) {
                dev.inputData.set(buf.slice(0, Math.min(buf.length, dev.inputData.length)));
                dev.rxCount++;
                dev.lastRxTs = performance.now();
                dev.online   = true;

                // 同步 DI 字节到 Controller 的 I 区
                cpu._I[dev.iBaseAddr] = buf[0];

                // 同步 AI 到 Controller 的 AIW 区
                if (cpu._AIW) {
                    const aiBase = dev.slot * 8;
                    for (let i = 0; i < 4; i++) {
                        cpu._AIW[aiBase + i*2]     = buf[2 + i*2];
                        cpu._AIW[aiBase + i*2 + 1] = buf[2 + i*2 + 1];
                    }
                }

                // 读取 Controller 输出（DO / AO）
                if (dev.outputData.length >= 7) {
                    this._receiveOutputFrame(dev.outputData);
                }
            }
            pn.txFrames++;
        }

        // BroadcastChannel 发送（跨页面）
        if (pn.bcChannel && pn.controllerConnected) {
            try {
                pn.bcChannel.postMessage({
                    type:       'pn_input_data',
                    deviceName: pn.stationName,
                    data:       Array.from(buf),
                    cycleCount: pn.cycleCounter,
                });
            } catch(e) {}
        }

        pn.txFrames++;
    }

    // ═══════════════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════════════

    _registerPorts() {
        const pp = this._portPos;
        this.addPort(pp['PN_P1'].x, pp['PN_P1'].y, 'PN_P1', 'bus');
        this.addPort(pp['PN_P2'].x, pp['PN_P2'].y, 'PN_P2', 'bus');
        for (let i=0;i<8;i++) { this.addPort(pp[`DI_${i}`].x, pp[`DI_${i}`].y, `DI_${i}`, 'wire','p'); }
        for (let i=0;i<8;i++) { this.addPort(pp[`DO_${i}`].x, pp[`DO_${i}`].y, `DO_${i}`, 'wire'); }
        for (let i=0;i<4;i++) {
            this.addPort(pp[`AI${i}_P`].x, pp[`AI${i}_P`].y, `AI${i}_P`, 'wire','p');
            this.addPort(pp[`AI${i}_N`].x, pp[`AI${i}_N`].y, `AI${i}_N`, 'wire','p');
        }
        for (let i=0;i<2;i++) {
            this.addPort(pp[`AO${i}_P`].x, pp[`AO${i}_P`].y, `AO${i}_P`, 'wire');
            this.addPort(pp[`AO${i}_M`].x, pp[`AO${i}_M`].y, `AO${i}_M`, 'wire');
        }
        this.addPort(pp['PWR_L+'].x, pp['PWR_L+'].y, 'PWR_L+', 'wire','p');
        this.addPort(pp['PWR_M'].x,  pp['PWR_M'].y,  'PWR_M',  'wire','p');
    }

    // ═══════════════════════════════════════════════════════════════
    // 初始化绘图
    // ═══════════════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ─────────────────────────────────────────────────────────────
    // 静态部件
    // ─────────────────────────────────────────────────────────────

    _drawStaticParts() {
        this._drawBody();
        this._drawIMModule();
        this._drawDIModule();
        this._drawDOModule();
        this._drawAIModule();
        this._drawAOModule();
        this._drawBusAdapter();
        this._drawTerminals();
    }

    _drawBody() {
        const b = this._body;
        // ET200SP 特有的暖米白色机身
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fillLinearGradientStartPoint:  { x: 0,   y: 0 },
            fillLinearGradientEndPoint:    { x: b.w, y: 0 },
            fillLinearGradientColorStops:  [0,'#e8e4dc', 0.3,'#f0ece4', 0.7,'#ece8e0', 1,'#e0dcD4'],
            stroke: '#a0a098', strokeWidth: 1.2,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 8, shadowOffsetX: 2, shadowOffsetY: 3, shadowOpacity: 0.22,
        }));
        // 右侧高光
        this._staticGroup.add(new Konva.Rect({
            x: b.w-4, y: 4, width: 2.5, height: b.h-8,
            fill: 'rgba(255,255,255,0.40)', cornerRadius: [0,b.rx,b.rx,0],
        }));
    }

    _drawIMModule() {
        const W=this.width, H=this.height;
        const im=this._imArea;

        // IM 模块背景（橄榄绿色带）
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: im.h,
            fillLinearGradientStartPoint:{x:0,y:0},fillLinearGradientEndPoint:{x:W,y:0},
            fillLinearGradientColorStops:[0,'#4a6a20',0.5,'#5a7a2a',1,'#4a6a20'],
            cornerRadius:[3,3,0,0],
        }));
        // SIMATIC 标志
        this._staticGroup.add(new Konva.Text({
            x:6, y:H*0.008, text:'SIMATIC',
            fontSize:Math.max(6,H*0.022), fontFamily:'Arial Narrow, Arial', fontStyle:'bold',
            fill:'#ffffff', letterSpacing:1,
        }));
        this._staticGroup.add(new Konva.Text({
            x:6, y:H*0.032, text:'ET 200SP',
            fontSize:Math.max(5,H*0.018), fontFamily:'Arial Narrow, Arial',
            fill:'#c0e080', letterSpacing:0.5,
        }));

        // PN P1/P2 端口外框（绿色 RJ45）
        [this._pnP1Port, this._pnP2Port].forEach((p, i) => {
            this._staticGroup.add(new Konva.Rect({
                x:p.x, y:p.y, width:p.w, height:p.h,
                fill:'#1a2018', stroke:'#3a6028', strokeWidth:1.2, cornerRadius:2,
            }));
            // 8针触点
            for(let k=0;k<8;k++){
                this._staticGroup.add(new Konva.Rect({
                    x:p.x+p.w*(0.06+k*0.112), y:p.y+p.h*0.20,
                    width:p.w*0.075, height:p.h*0.55, fill:'#c8b040',
                }));
            }
            this._staticGroup.add(new Konva.Text({
                x:p.x, y:p.y+p.h+2, text:`P${i+1}`,
                fontSize:Math.max(5,H*0.016), fontFamily:'Arial', fontStyle:'bold',
                fill:'#6a9a30', align:'center', width:p.w,
            }));
        });

        // IM 铭牌
        const np=this._imNameplate;
        this._staticGroup.add(new Konva.Rect({
            x:np.x, y:np.y, width:np.w, height:np.h,
            fill:'#d8d4cc', stroke:'#a0a098', strokeWidth:0.6, cornerRadius:1,
        }));
        this._staticGroup.add(new Konva.Text({
            x:np.x+3, y:np.y+2,
            text:'IM 155-6 PN ST  6ES7 155-6AU01-0BN0',
            fontSize:Math.max(4,H*0.013), fontFamily:'Consolas, monospace', fill:'#444',
        }));

        // 模块间分隔线
        this._staticGroup.add(new Konva.Line({
            points:[0,im.h, W,im.h], stroke:'#908a80', strokeWidth:1.5,
        }));
    }

    _drawDIModule() {
        const W=this.width, H=this.height;
        const di=this._diArea;

        // DI 模块背景（浅蓝色）
        this._staticGroup.add(new Konva.Rect({
            x:0, y:di.y, width:W, height:di.h,
            fill:'#e8f0f8', stroke:'#b0c0d8', strokeWidth:0.5,
        }));
        // 左侧彩色竖带（蓝色，DI 标识色）
        this._staticGroup.add(new Konva.Rect({
            x:0, y:di.y, width:5, height:di.h,
            fill:'#2a6ab0',
        }));
        // 模块标题
        this._staticGroup.add(new Konva.Text({
            x:8, y:di.y+3,
            text:'DI 8×24VDC ST',
            fontSize:Math.max(6,H*0.018), fontFamily:'Arial Narrow, Arial', fontStyle:'bold',
            fill:'#2a6ab0',
        }));
        this._staticGroup.add(new Konva.Text({
            x:8, y:di.y+H*0.020,
            text:'6ES7 131-6BF01-0BA0',
            fontSize:Math.max(4,H*0.013), fontFamily:'Consolas, monospace', fill:'#6080a0',
        }));
        // LED 标签（0~7）
        this._diLEDs.forEach(led=>{
            this._staticGroup.add(new Konva.Text({
                x:led.x-8, y:led.y+led.r+2,
                text:String(led.bit), fontSize:Math.max(4,H*0.013),
                fontFamily:'Arial', fill:'#4a6090',
            }));
        });
        // 分隔线
        this._staticGroup.add(new Konva.Line({ points:[0,di.y+di.h, W,di.y+di.h], stroke:'#908a80', strokeWidth:1.0 }));
    }

    _drawDOModule() {
        const W=this.width, H=this.height;
        const doA=this._doArea;

        this._staticGroup.add(new Konva.Rect({
            x:0, y:doA.y, width:W, height:doA.h, fill:'#faf0e8', stroke:'#d8c0a8', strokeWidth:0.5,
        }));
        this._staticGroup.add(new Konva.Rect({ x:0, y:doA.y, width:5, height:doA.h, fill:'#d06020' }));
        this._staticGroup.add(new Konva.Text({
            x:8, y:doA.y+3, text:'DQ 8×24VDC/0.5A ST',
            fontSize:Math.max(6,H*0.018), fontFamily:'Arial Narrow, Arial', fontStyle:'bold', fill:'#d06020',
        }));
        this._staticGroup.add(new Konva.Text({
            x:8, y:doA.y+H*0.020, text:'6ES7 132-6BF00-0BA0',
            fontSize:Math.max(4,H*0.013), fontFamily:'Consolas, monospace', fill:'#a07050',
        }));
        this._doLEDs.forEach(led=>{
            this._staticGroup.add(new Konva.Text({
                x:led.x-8, y:led.y+led.r+2, text:String(led.bit),
                fontSize:Math.max(4,H*0.013), fontFamily:'Arial', fill:'#a05020',
            }));
        });
        this._staticGroup.add(new Konva.Line({ points:[0,doA.y+doA.h, W,doA.y+doA.h], stroke:'#908a80', strokeWidth:1.0 }));
    }

    _drawAIModule() {
        const W=this.width, H=this.height;
        const ai=this._aiArea;

        this._staticGroup.add(new Konva.Rect({
            x:0, y:ai.y, width:W, height:ai.h, fill:'#e8f4ec', stroke:'#a0c8b0', strokeWidth:0.5,
        }));
        this._staticGroup.add(new Konva.Rect({ x:0, y:ai.y, width:5, height:ai.h, fill:'#2a9050' }));
        this._staticGroup.add(new Konva.Text({
            x:8, y:ai.y+3, text:'AI 4×U/I 2/4-Wire ST',
            fontSize:Math.max(6,H*0.018), fontFamily:'Arial Narrow, Arial', fontStyle:'bold', fill:'#2a9050',
        }));
        this._staticGroup.add(new Konva.Text({
            x:8, y:ai.y+H*0.020, text:'6ES7 134-6GD01-0BA1',
            fontSize:Math.max(4,H*0.013), fontFamily:'Consolas, monospace', fill:'#408060',
        }));
        this._staticGroup.add(new Konva.Line({ points:[0,ai.y+ai.h, W,ai.y+ai.h], stroke:'#908a80', strokeWidth:1.0 }));
    }

    _drawAOModule() {
        const W=this.width, H=this.height;
        const ao=this._aoArea;

        this._staticGroup.add(new Konva.Rect({
            x:0, y:ao.y, width:W, height:ao.h, fill:'#f0ecf8', stroke:'#c0b0d8', strokeWidth:0.5,
        }));
        this._staticGroup.add(new Konva.Rect({ x:0, y:ao.y, width:5, height:ao.h, fill:'#7050c0' }));
        this._staticGroup.add(new Konva.Text({
            x:8, y:ao.y+3, text:'AQ 2×U/I ST',
            fontSize:Math.max(6,H*0.018), fontFamily:'Arial Narrow, Arial', fontStyle:'bold', fill:'#7050c0',
        }));
        this._staticGroup.add(new Konva.Text({
            x:8, y:ao.y+H*0.020, text:'6ES7 135-6FB01-0BA1',
            fontSize:Math.max(4,H*0.013), fontFamily:'Consolas, monospace', fill:'#8060a0',
        }));
        this._staticGroup.add(new Konva.Line({ points:[0,ao.y+ao.h, W,ao.y+ao.h], stroke:'#908a80', strokeWidth:1.0 }));
    }

    _drawBusAdapter() {
        const W=this.width, H=this.height;
        const ba=this._busAdapter;
        this._staticGroup.add(new Konva.Rect({
            x:0, y:ba.y, width:W, height:ba.h,
            fill:'#c8c4bc', stroke:'#888880', strokeWidth:0.8, cornerRadius:[0,0,3,3],
        }));
        this._staticGroup.add(new Konva.Text({
            x:6, y:ba.y+H*0.010, text:'BusAdapter BA 2×RJ45',
            fontSize:Math.max(5,H*0.014), fontFamily:'Arial', fill:'#605850',
        }));
        // DIN 卡扣
        [0.10,0.88].forEach(px=>{
            this._staticGroup.add(new Konva.Rect({
                x:W*px, y:ba.y, width:W*0.06, height:ba.h*0.65,
                fill:'#888880', stroke:'#666860', strokeWidth:0.5, cornerRadius:[0,0,2,2],
            }));
        });
    }

    _drawTerminals() {
        const W=this.width, H=this.height;
        const termH = H*0.026;
        const drawTermRow = (area, count, color) => {
            const tW = area.w / count;
            for (let i=0;i<count;i++) {
                this._staticGroup.add(new Konva.Rect({
                    x:area.x+i*tW+area.w*0.01, y:area.y+area.h*0.15,
                    width:tW*0.80, height:area.h*0.70,
                    fill:'#888', stroke:'#666', strokeWidth:0.4, cornerRadius:1,
                }));
            }
            this._staticGroup.add(new Konva.Rect({
                x:area.x, y:area.y, width:area.w, height:area.h,
                fill:'#2a2a28', stroke:'#1a1a18', strokeWidth:0.8, cornerRadius:1,
            }));
            for (let i=0;i<count;i++) {
                this._staticGroup.add(new Konva.Rect({
                    x:area.x+area.w*(0.01+i/count*0.98), y:area.y+area.h*0.15,
                    width:area.w*0.9/count, height:area.h*0.70,
                    fill:'#888', stroke:'#666', strokeWidth:0.4, cornerRadius:1,
                }));
            }
        };
        drawTermRow(this._diTerminals, 8, '#3a8abf');
        drawTermRow(this._doTerminals, 8, '#d06020');
    }

    // ─────────────────────────────────────────────────────────────
    // 动态部件
    // ─────────────────────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawIMDynamic();
        this._drawDIDynamic();
        this._drawDODynamic();
        this._drawAIDynamic();
        this._drawAODynamic();
        this._drawLabelText();
    }

    _drawLED(x, y, r, on, type) {
        const C = {
            run:  { on:'#44cc44', off:'#002200', glow:'#44cc44' },
            err:  { on:'#ee4444', off:'#220000', glow:'#ee4444' },
            bf:   { on:'#ee4444', off:'#220000', glow:'#ee4444' },
            mt:   { on:'#f5c842', off:'#221500', glow:'#f5c842' },
            pnok: { on:'#44dd44', off:'#002200', glow:'#44dd44' },
            pnact:{ on:'#f07030', off:'#1a0500', glow:'#f07030' },
            di:   { on:'#f5c842', off:'#2a2000', glow:'#f5c842' },
            do_:  { on:'#f07030', off:'#2a0800', glow:'#f07030' },
        };
        const c = C[type] || C.di;
        this._dynamicGroup.add(new Konva.Circle({
            x, y, radius:r,
            fill: on ? c.on : c.off,
            stroke: on ? '#666' : '#333', strokeWidth:0.7,
            shadowColor: on ? c.glow : 'transparent',
            shadowBlur: on ? r*3 : 0, shadowOpacity: 0.9,
        }));
    }

    _drawIMDynamic() {
        const pn=this._pn, H=this.height;
        const isOperate = pn.state === 'DATA_EXCHANGE';
        const isErr     = pn.state === 'ERROR' || pn.watchdogTripped;

        // PN LED
        const p1=this._pnLEDs.p1Link, p1a=this._pnLEDs.p1Act;
        const p2=this._pnLEDs.p2Link, p2a=this._pnLEDs.p2Act;
        this._drawLED(p1.x, p1.y, p1.r, pn.p1.link, 'pnok');
        this._drawLED(p1a.x,p1a.y,p1a.r, pn.p1.link&&(Math.floor(performance.now()/100)%2===0), 'pnact');
        this._drawLED(p2.x, p2.y, p2.r, pn.p2.link, 'pnok');
        this._drawLED(p2a.x,p2a.y,p2a.r, pn.p2.link&&(Math.floor(performance.now()/130)%2===0), 'pnact');

        // 状态 LED（RUN/ERR/BF/MT）
        const il=this._imLEDs;
        this._drawLED(il.run.x, il.run.y, il.run.r, isOperate,  'run');
        this._drawLED(il.err.x, il.err.y, il.err.r, isErr,      'err');
        this._drawLED(il.bf.x,  il.bf.y,  il.bf.r,  pn.diagAlarm,'bf');
        this._drawLED(il.mt.x,  il.mt.y,  il.mt.r,  pn.state==='STARTUP','mt');

        // 状态标签
        const fs=Math.max(4,H*0.014);
        [['RUN',isOperate,'run'],['ERR',isErr,'err'],['BF',pn.diagAlarm,'bf'],['MT',pn.state==='STARTUP','mt']].forEach(([lbl,on,t],i)=>{
            const x=[il.run.x,il.err.x,il.bf.x,il.mt.x][i];
            const y=[il.run.y,il.err.y,il.bf.y,il.mt.y][i]+[il.run.r,il.err.r,il.bf.r,il.mt.r][i]+2;
            this._dynamicGroup.add(new Konva.Text({
                x:x-6, y, text:lbl, fontSize:fs, fontFamily:'Arial', fontStyle:'bold',
                fill:on?({run:'#44cc44',err:'#ee4444',bf:'#ee4444',mt:'#f5c842'}[t]||'#ccc'):'#444',
            }));
        });

        // PN 信息小面板（铭牌右侧）
        const np=this._imNameplate;
        const stateColor={DATA_EXCHANGE:'#44dd44',STARTUP:'#f5c842',ERROR:'#ee4444',OFFLINE:'#666'}[pn.state]||'#666';
        const stateText= {DATA_EXCHANGE:'运行',STARTUP:'启动中',ERROR:'错误',OFFLINE:'离线'}[pn.state]||'离线';
        this._dynamicGroup.add(new Konva.Text({
            x:np.x+np.w*0.55, y:np.y+2,
            text:`[${stateText}]  Tx:${pn.txFrames}`,
            fontSize:Math.max(4,H*0.013), fontFamily:'Consolas, monospace',
            fill:stateColor,
        }));
    }

    _drawDIDynamic() {
        const H=this.height;
        this._diLEDs.forEach(led=>{
            const on = !!(this._DI & (1<<led.bit));
            this._drawLED(led.x, led.y, led.r, on, 'di');
        });
        // DI 模块状态文字（右上角）
        const di=this._diArea;
        this._dynamicGroup.add(new Konva.Text({
            x: this.width*0.70, y: di.y+3,
            text: `0x${this._DI.toString(16).padStart(2,'0').toUpperCase()}`,
            fontSize: Math.max(6,H*0.020), fontFamily:'Consolas, monospace',
            fontStyle:'bold', fill:'#2a6ab0',
        }));
    }

    _drawDODynamic() {
        const H=this.height;
        this._doLEDs.forEach(led=>{
            const on = !!(this._DO & (1<<led.bit));
            this._drawLED(led.x, led.y, led.r, on, 'do_');
        });
        const doA=this._doArea;
        this._dynamicGroup.add(new Konva.Text({
            x: this.width*0.70, y: doA.y+3,
            text: `0x${this._DO.toString(16).padStart(2,'0').toUpperCase()}`,
            fontSize: Math.max(6,H*0.020), fontFamily:'Consolas, monospace',
            fontStyle:'bold', fill:'#d06020',
        }));
        if (!this._doEnabled) {
            this._dynamicGroup.add(new Konva.Text({
                x: this.width*0.55, y: doA.y+3, text:'[输出禁用]',
                fontSize: Math.max(5,H*0.015), fontFamily:'Arial', fill:'#ee4444',
            }));
        }
    }

    _drawAIDynamic() {
        const H=this.height;
        this._aiRows.forEach(row=>{
            const ch   = row.ch;
            const eng  = this._aiEng[ch];
            const mode = this._aiModes[ch];
            const pct  = this._engToPct(eng, mode);
            const col  = this._gaugeColor(pct, mode);
            const { unit } = this._modeRange(mode);

            // 通道背景
            this._dynamicGroup.add(new Konva.Rect({
                x:row.x, y:row.y, width:row.w, height:row.h,
                fill:'#0a1210', stroke:'#1a3024', strokeWidth:0.6, cornerRadius:1,
            }));

            // 进度条
            const barX=row.x+row.w*0.24, barY=row.y+row.h*0.20;
            const barW=row.w*0.48, barH=row.h*0.60;
            this._dynamicGroup.add(new Konva.Rect({ x:barX, y:barY, width:barW, height:barH, fill:'#0a1a14', stroke:'#1a3024', strokeWidth:0.4, cornerRadius:barH/2 }));
            if (pct>0) {
                this._dynamicGroup.add(new Konva.Rect({ x:barX, y:barY, width:barW*pct, height:barH, fill:col, cornerRadius:barH/2 }));
            }

            // 通道号标签
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+2, y:row.y+row.h*0.12, text:`CH${ch}`,
                fontSize:Math.max(5,H*0.017), fontFamily:'Consolas, monospace', fontStyle:'bold', fill:'#2a9050',
            }));
            // 量程标签
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+2, y:row.y+row.h*0.52, text:mode,
                fontSize:Math.max(4,H*0.013), fontFamily:'Consolas, monospace', fill:'#286040',
            }));

            // 工程值（大字，右侧）
            const valStr = Math.abs(eng)<10 ? eng.toFixed(3) : eng.toFixed(2);
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+row.w*0.73, y:row.y+row.h*0.10,
                text:valStr,
                fontSize:Math.max(7,H*0.025), fontFamily:'Consolas, monospace', fontStyle:'bold',
                fill:'#44ddaa', width:row.w*0.24, align:'right',
            }));
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+row.w*0.73, y:row.y+row.h*0.52,
                text:unit,
                fontSize:Math.max(5,H*0.015), fontFamily:'Arial', fill:'#3a8060',
                width:row.w*0.24, align:'right',
            }));

            // 信号模式标签
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+row.w*0.73, y:row.y+row.h*0.12,
                text:this._aiSigModes[ch].toUpperCase(),
                fontSize:Math.max(4,H*0.012), fontFamily:'Consolas', fill:'#1a4030',
            }));

            // 溢出标志
            if (this._aiOver[ch] || this._aiUnder[ch]) {
                this._dynamicGroup.add(new Konva.Text({
                    x:row.x+2, y:row.y-2,
                    text:this._aiOver[ch]?'OVR':'UNR',
                    fontSize:Math.max(5,H*0.015), fontFamily:'Consolas', fontStyle:'bold', fill:'#ff6644',
                }));
            }

            // 迷你波形（进度条下方微型 SVG 路径）
            this._drawAIWaveform(row, ch);
        });
    }

    _drawAIWaveform(row, ch) {
        const hist = this._aiWaveHist[ch];
        const ptr  = this._aiWavePtr[ch];
        const n    = hist.length;
        const mode = this._aiModes[ch];
        const { min, max } = this._modeRange(mode);
        const span = max - min || 1;

        const x0=row.x+row.w*0.24, y0=row.y+row.h*0.88;
        const wW=row.w*0.48, wH=row.h*0.20;

        // 背景
        this._dynamicGroup.add(new Konva.Rect({ x:x0, y:y0-wH, width:wW, height:wH, fill:'#040a08', cornerRadius:1 }));

        // 折线
        const pts = [];
        for (let k=0;k<n;k++) {
            const hi = (ptr+k) % n;
            const px = x0 + (k/(n-1)) * wW;
            const py = y0 - 1 - ((hist[hi]-min)/span) * (wH-2);
            pts.push(px, py);
        }
        if (pts.length >= 4) {
            this._dynamicGroup.add(new Konva.Line({
                points:pts, stroke:'#44ddaa', strokeWidth:0.8,
                lineCap:'round', lineJoin:'round', tension:0.3, listening:false,
            }));
        }
    }

    _drawAODynamic() {
        const H=this.height;
        this._aoRows.forEach(row=>{
            const ch   = row.ch;
            const eng  = this._aoEng[ch];
            const mode = this._aoModes[ch];
            const pct  = this._engToPct(eng, mode);
            const col  = this._gaugeColor(pct, mode);
            const { unit } = this._modeRange(mode);

            this._dynamicGroup.add(new Konva.Rect({
                x:row.x, y:row.y, width:row.w, height:row.h,
                fill:'#0c0a14', stroke:'#24183a', strokeWidth:0.6, cornerRadius:1,
            }));

            // 进度条
            const barX=row.x+row.w*0.24, barY=row.y+row.h*0.25;
            const barW=row.w*0.48, barH=row.h*0.50;
            this._dynamicGroup.add(new Konva.Rect({ x:barX, y:barY, width:barW, height:barH, fill:'#0a0818', stroke:'#241630', strokeWidth:0.4, cornerRadius:barH/2 }));
            if (pct>0) this._dynamicGroup.add(new Konva.Rect({ x:barX, y:barY, width:barW*pct, height:barH, fill:col, cornerRadius:barH/2 }));

            this._dynamicGroup.add(new Konva.Text({ x:row.x+2, y:row.y+row.h*0.10, text:`AO${ch}`, fontSize:Math.max(5,H*0.017), fontFamily:'Consolas', fontStyle:'bold', fill:'#7050c0' }));
            this._dynamicGroup.add(new Konva.Text({ x:row.x+2, y:row.y+row.h*0.55, text:mode, fontSize:Math.max(4,H*0.013), fontFamily:'Consolas', fill:'#503880' }));

            const valStr = Math.abs(eng)<10 ? eng.toFixed(3) : eng.toFixed(2);
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+row.w*0.73, y:row.y+row.h*0.10,
                text:valStr, fontSize:Math.max(7,H*0.025), fontFamily:'Consolas', fontStyle:'bold',
                fill:'#c080f0', width:row.w*0.24, align:'right',
            }));
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+row.w*0.73, y:row.y+row.h*0.55,
                text:unit, fontSize:Math.max(5,H*0.015), fontFamily:'Arial', fill:'#705090',
                width:row.w*0.24, align:'right',
            }));
            // 原始值
            this._dynamicGroup.add(new Konva.Text({
                x:row.x+2, y:row.y+row.h*0.78,
                text:`${this._aoRaw[ch]}`,
                fontSize:Math.max(4,H*0.012), fontFamily:'Consolas', fill:'#302050',
            }));
        });
    }

    _drawLabelText() {
        const W=this.width, H=this.height;
        const pn=this._pn;
        // 位号（IM 区内）
        this._dynamicGroup.add(new Konva.Text({
            x:W*0.65, y:H*0.030, text:this.label,
            fontSize:Math.max(6,H*0.022), fontFamily:'Arial', fontStyle:'bold', fill:'rgba(255,255,255,0.9)',
        }));
        // IP 地址
        this._dynamicGroup.add(new Konva.Text({
            x:W*0.05, y:H*0.055, text:pn.ip,
            fontSize:Math.max(5,H*0.016), fontFamily:'Consolas, monospace', fill:'#a0c080',
        }));
        // Station Name
        this._dynamicGroup.add(new Konva.Text({
            x:W*0.05, y:H*0.074, text:pn.stationName,
            fontSize:Math.max(4,H*0.014), fontFamily:'Consolas, monospace', fill:'#80a060',
        }));
    }

    // ── 交互绑定 ─────────────────────────────────────────────────────

    _bindInteraction() {
        const W=this.width, H=this.height;

        // DI LED 点击（模拟外部输入）
        this._diLEDs.forEach(led=>{
            const hit=new Konva.Circle({ x:led.x, y:led.y, radius:led.r*3.5, fill:'transparent' });
            hit.on('click tap', ()=>{ this._DI ^= (1<<led.bit); this._rebuildDynamic(); this.markDirty(); });
            this._interactGroup.add(hit);
        });

        // AI 通道行点击（弹出值设定）
        this._aiRows.forEach(row=>{
            const hit=new Konva.Rect({ x:row.x, y:row.y, width:row.w, height:row.h, fill:'transparent' });
            hit.on('click tap', ()=>{
                if (this._aiSigModes[row.ch]==='manual') {
                    const { min, max } = this._modeRange(this._aiModes[row.ch]);
                    const cur = this._aiEng[row.ch];
                    const v = parseFloat(prompt(`AI${row.ch} 手动值 (${min}~${max}):`, cur.toFixed(3)));
                    if (!isNaN(v)) this.setAIValue(row.ch, v);
                }
            });
            this._interactGroup.add(hit);
        });

        // PN P1 点击：连接/断开
        const p1=this._pnP1Port;
        const pnHit=new Konva.Rect({ x:p1.x, y:p1.y, width:p1.w, height:p1.h, fill:'transparent' });
        pnHit.on('click tap', ()=>{
            if (this._pn.state==='OFFLINE') {
                if (this._pn.controllerRef) this.connectToController(this._pn.controllerRef);
                else this._pnLog('warn','未绑定 Controller，请先调用 connectToController()');
            } else {
                this.disconnectFromController();
            }
        });
        this._interactGroup.add(pnHit);
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

        // 信号发生器（更新 AI 工程值）
        for (let ch=0; ch<4; ch++) {
            const eng = this._genAISignal(ch, dt);
            this._aiEng[ch] = eng;
            this._aiRaw[ch] = Math.max(-32768, Math.min(32767, this._engToRaw(eng, this._aiModes[ch])));

            // 波形历史
            this._aiWaveHist[ch][this._aiWavePtr[ch]] = eng;
            this._aiWavePtr[ch] = (this._aiWavePtr[ch]+1) % this._aiWaveHist[ch].length;
        }

        // AO 仪表角度平滑（波形/指针动画）

        // PROFINET 周期数据交换
        const pn = this._pn;
        if (pn.state === 'DATA_EXCHANGE') {
            pn.accumCycleMs += dtMs;
            const cyclePeriod = Math.max(1, pn.sendClockMs);
            if (pn.accumCycleMs >= cyclePeriod) {
                pn.accumCycleMs -= cyclePeriod;
                const now = performance.now();
                if (pn.lastCycleTs > 0) pn.measuredCycleUs = (now - pn.lastCycleTs) * 1000;
                pn.lastCycleTs  = now;
                pn.cycleCounter = (pn.cycleCounter + 1) & 0xFFFF || 1;

                // 推送输入数据到 Controller
                this._pushToController();
                pn.p1.act = (pn.txFrames % 4 < 2);
            }

            // 看门狗检测
            if (pn.lastRxTs > 0 && (performance.now() - pn.lastRxTs) > pn.watchdogMs) {
                if (!pn.watchdogTripped) {
                    pn.watchdogTripped = true;
                    pn.diagAlarm       = true;
                    pn.state           = 'ERROR';
                    this._pnLog('error', `看门狗超时（${pn.watchdogMs}ms），转入 ERROR 状态`);
                    this._rebuildDynamic(); this.markDirty();
                }
            }
        }

        // 重建动态层（每3帧更新一次，减少消耗）
        this._rebuildDynamic();
        this.markDirty();
        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════════

    /** 设置 DI 位（模拟外部传感器信号） */
    setDI(bit, val) {
        if (val) this._DI |=  (1 << (bit & 7));
        else     this._DI &= ~(1 << (bit & 7));
    }

    /** 读取 DO 位（读取 Controller 写入的输出值） */
    getDO(bit) { return !!(this._DO & (1 << (bit & 7))); }

    /** 读取 DO 字节 */
    getDOByte() { return this._DO; }

    /** 手动设定 AI 工程值（仅 'manual' 模式有效，或直接强制） */
    setAIValue(ch, eng) {
        const { min, max } = this._modeRange(this._aiModes[ch]);
        this._aiSigParams[ch].manualVal = Math.max(min, Math.min(max, eng));
        if (this._aiSigModes[ch] !== 'manual') this._aiSigModes[ch] = 'manual';
    }

    /** 读取 AI 工程值 */
    getAIValue(ch)   { return this._aiEng[ch] ?? 0; }

    /** 读取 AI 原始整数 */
    getAIRaw(ch)     { return this._aiRaw[ch] ?? 0; }

    /** 读取 AO 工程值（Controller 写入） */
    getAOValue(ch)   { return this._aoEng[ch] ?? 0; }

    /** 读取 AO 原始整数 */
    getAORaw(ch)     { return this._aoRaw[ch] ?? 0; }

    /** 设置 AI 信号仿真模式 */
    setAISigMode(ch, mode, params = {}) {
        const valid = ['manual','sine','ramp','square','noise','const'];
        if (!valid.includes(mode)) return;
        this._aiSigModes[ch] = mode;
        Object.assign(this._aiSigParams[ch], params);
        this._aiSigTime[ch]  = 0;
    }

    /** 设置 AI 量程模式 */
    setAIMode(ch, mode) {
        const valid = ['V±10','V0-10','V0-5','I0-20','I4-20'];
        if (valid.includes(mode)) this._aiModes[ch] = mode;
    }

    /** 设置 AO 量程模式 */
    setAOMode(ch, mode) {
        const valid = ['V±10','V0-10','I0-20','I4-20'];
        if (valid.includes(mode)) this._aoModes[ch] = mode;
    }

    /** 获取 PROFINET 状态快照 */
    getPNStatus() {
        const pn = this._pn;
        return {
            state:       pn.state,
            connected:   pn.arEstablished,
            stationName: pn.stationName,
            ip:          pn.ip,
            mac:         pn.mac,
            txFrames:    pn.txFrames,
            rxFrames:    pn.rxFrames,
            cycleUs:     pn.measuredCycleUs,
            watchdogTripped: pn.watchdogTripped,
            diagBuffer:  pn.diagBuffer.slice(0, 16),
        };
    }

    /** 获取当前 IO 快照 */
    getIOSnapshot() {
        return {
            DI:  this._DI,
            DO:  this._DO,
            AI:  [0,1,2,3].map(ch => ({ eng:this._aiEng[ch], raw:this._aiRaw[ch], mode:this._aiModes[ch] })),
            AO:  [0,1].map(ch => ({ eng:this._aoEng[ch], raw:this._aoRaw[ch], mode:this._aoModes[ch] })),
        };
    }

    /** 手动触发看门狗复位（清除 ERROR 状态）*/
    watchdogReset() {
        if (!this._pn.watchdogTripped) return;
        this._pn.watchdogTripped = false;
        this._pn.diagAlarm       = false;
        this._pn.state           = 'DATA_EXCHANGE';
        this._pn.lastRxTs        = performance.now();
        this._pnLog('info', '看门狗复位，恢复数据交换');
        this._rebuildDynamic(); this.markDirty();
    }

    /** 发送诊断报警到 Controller */
    sendDiagAlarm(msg) {
        this._pn.diagAlarm = true;
        this._pnLog('warn', `Diag: ${msg}`);
        // 下次输入帧将携带诊断标志
        this._rebuildDynamic(); this.markDirty();
    }

    clearDiagAlarm() {
        this._pn.diagAlarm = false;
        this._pnLog('info', '诊断报警已清除');
    }

    isConnected()   { return this._pn.arEstablished; }
    isInExchange()  { return this._pn.state === 'DATA_EXCHANGE'; }

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
            { label:'AI0 量程',         key:'ai0mode',        type:'select', options:['V±10','V0-10','V0-5','I0-20','I4-20'] },
            { label:'AI1 量程',         key:'ai1mode',        type:'select', options:['V±10','V0-10','V0-5','I0-20','I4-20'] },
            { label:'AI2 量程',         key:'ai2mode',        type:'select', options:['V±10','V0-10','V0-5','I0-20','I4-20'] },
            { label:'AI3 量程',         key:'ai3mode',        type:'select', options:['V±10','V0-10','V0-5','I0-20','I4-20'] },
            { label:'AO0 量程',         key:'ao0mode',        type:'select', options:['V±10','V0-10','I0-20','I4-20'] },
            { label:'AO1 量程',         key:'ao1mode',        type:'select', options:['V±10','V0-10','I0-20','I4-20'] },
            { label:'看门狗 (ms)',      key:'watchdogMs',     type:'number' },
            { label:'PN Channel 名',    key:'pnChannelName',  type:'text'   },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label         !== undefined) this.label = cfg.label;
        if (cfg.pnStationName !== undefined) this._pn.stationName = cfg.pnStationName;
        if (cfg.pnIP          !== undefined) this._pn.ip          = cfg.pnIP;
        if (cfg.pnSubnet      !== undefined) this._pn.subnet      = cfg.pnSubnet;
        if (cfg.pnGateway     !== undefined) this._pn.gateway     = cfg.pnGateway;
        if (cfg.watchdogMs    !== undefined) this._pn.watchdogMs  = Math.max(100, parseFloat(cfg.watchdogMs)||3000);
        ['ai0mode','ai1mode','ai2mode','ai3mode'].forEach((k,i) => { if(cfg[k]!==undefined) this.setAIMode(i,cfg[k]); });
        ['ao0mode','ao1mode'].forEach((k,i) => { if(cfg[k]!==undefined) this.setAOMode(i,cfg[k]); });
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
