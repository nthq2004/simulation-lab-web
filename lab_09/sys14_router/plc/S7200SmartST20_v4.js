import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 S7-200 SMART CPU ST20 仿真组件  v4.0（SCADA/HMI 通信升级版）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  v3.0 新增：PROFINET 通信栈完整仿真
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 1. PROFINET IO 控制器/设备双模式 ──────────────────────────────────
 *
 *  模式一：IO Controller（主站，默认）
 *    - ST20 作为 PROFINET IO Controller
 *    - 管理最多 16 个 IO Device（从站）
 *    - 周期性数据交换（Cyclic Data Exchange）：默认发送周期 1ms
 *    - 支持 RTC（实时通信）Class 1 / Class 2 / IRT
 *    - 使用梯形图指令 PNRD / PNWR 读写从站 IO 数据
 *    - 设备诊断（Device Diagnosis）：在线/离线/故障
 *
 *  模式二：IO Device（从站）
 *    - ST20 作为 PROFINET IO Device
 *    - 接受上位机/其他 Controller 的周期写入
 *    - 输入/输出数据映射到 CPU 的 I/Q 存储区
 *    - 支持 I&M（Identification & Maintenance）数据读写
 *
 * ── 2. PROFINET 物理层仿真 ─────────────────────────────────────────────
 *
 *  ETH 接口升级（RJ45 × 2，集成 PROFINET 交换机功能）：
 *    - Port1（P1）：连接 IO Controller / 上位机 / 交换机
 *    - Port2（P2）：Daisy-chain 菊花链连接下一个 IO Device
 *    - 端口状态：Link / ACT LED（绿色=Link，橙色=ACT数据帧）
 *    - 支持 MRP（Media Redundancy Protocol）环网冗余（仿真）
 *
 *  MAC 地址：自动生成（基于组件 ID）
 *    格式：00:1B:1B:xx:xx:xx（西门子 OUI）
 *
 * ── 3. PROFINET 协议栈仿真层次 ────────────────────────────────────────
 *
 *  ┌─────────────────────────────────────────┐
 *  │ 应用层      PROFINET IO 数据模型         │  ← 用户程序/梯形图
 *  ├─────────────────────────────────────────┤
 *  │ RT/IRT 层   实时帧（以太网帧头直接封装）  │  ← 周期数据交换引擎
 *  ├─────────────────────────────────────────┤
 *  │ DCP 层      设备发现与配置协议            │  ← 设备识别/IP分配
 *  ├─────────────────────────────────────────┤
 *  │ LLDP 层     链路层发现                   │  ← 拓扑检测
 *  ├─────────────────────────────────────────┤
 *  │ 以太网（802.3）  Ethertype 0x8892(RT)   │  ← 底层传输
 *  └─────────────────────────────────────────┘
 *
 * ── 4. PROFINET IO 数据区 ──────────────────────────────────────────────
 *
 *  控制器模式下，每个从站拥有独立的 IO 数据区：
 *
 *  _pn.devices[i] = {
 *    deviceName  : 'device-1'           // PROFINET Station Name
 *    deviceIP    : '192.168.1.10'       // IP 地址
 *    deviceType  : 'ET200S' | 'AI04' | 'AQ04' | 'custom'
 *    slot        : 0                    // 槽位（0~15）
 *    inputBytes  : 4                    // 输入数据长度（字节）
 *    outputBytes : 4                    // 输出数据长度（字节）
 *    inputData   : Uint8Array           // 从站 → 控制器（最新周期数据）
 *    outputData  : Uint8Array           // 控制器 → 从站
 *    ioCycleMs   : 1                    // 数据更新周期 ms
 *    online      : false                // 设备在线状态
 *    diagAlarm   : false                // 诊断报警
 *    moduleRef   : null                 // 关联的仿真模块对象
 *  }
 *
 *  IO 数据地址映射（CPU 存储区 ↔ PROFINET IO 数据区）：
 *    输入:  IB[PN_INPUT_BASE  + slot*inputBytes  .. +inputBytes-1]
 *    输出:  QB[PN_OUTPUT_BASE + slot*outputBytes .. +outputBytes-1]
 *    PN_INPUT_BASE  = 2   （IB2 起，避开本地 I/O IB0~IB1）
 *    PN_OUTPUT_BASE = 1   （QB1 起，避开本地 I/O QB0）
 *
 *  模拟量模块地址扩展：
 *    AI04 via PROFINET → AIW[slot*8] ~ AIW[slot*8+6]（4通道）
 *    AQ04 via PROFINET → AQW[slot*8] ~ AQW[slot*8+6]
 *
 * ── 5. PROFINET 梯形图指令 ────────────────────────────────────────────
 *
 *  PNRD  slot, offset, len, dest
 *    从 PROFINET 从站 slot 的输入数据区 offset 处读取 len 字节
 *    写入 CPU VB/MB dest 地址
 *    例：PNRD 1, 0, 4, VB200   → 从 slot1 输入区读4字节→VB200
 *
 *  PNWR  slot, offset, len, src
 *    将 CPU src 地址的 len 字节写入从站 slot 输出数据区 offset
 *    例：PNWR 1, 0, 2, VW100   → 将VW100写入slot1输出区
 *
 *  PNST  slot, dest_bit
 *    读取从站 slot 在线状态 → dest_bit（M/Q）
 *    例：PNST 1, M0.0          → M0.0=1 表示slot1在线
 *
 *  PNDIAG slot, dest_byte
 *    读取从站诊断字节 → dest_byte（VB/MB）
 *    位定义：Bit0=在线, Bit1=数据有效, Bit2=诊断报警, Bit3=配置错误
 *
 * ── 6. DCP 设备发现仿真 ────────────────────────────────────────────────
 *
 *  调用 pnDiscoverDevices() 触发 DCP Identify 广播，
 *  自动发现所有已通过 pnAddDevice() 注册的从站，
 *  仿真 300~800ms 发现延迟，更新设备在线状态。
 *
 * ── 7. PROFINET 连接建立流程（仿真） ──────────────────────────────────
 *
 *  ① Connect Request（AR建立）→ ②CRBlockReq（IO CR建立）
 *  → ③ DCP Set（IP/名称配置）→ ④ Param End → ⑤ Application Ready
 *  → ⑥ RTC 周期数据帧开始
 *  总计仿真耗时：500ms ~ 1200ms
 *
 * ── 8. MRP 环网冗余仿真 ────────────────────────────────────────────────
 *
 *  支持 MRP Ring 拓扑（最多 50 个节点）：
 *    - Ring Manager：ST20 CPU
 *    - Ring Clients：各从站
 *    - Interconnection Test 周期：20ms
 *    - 故障切换时间：<200ms（仿真值）
 *    - 状态：Open / Closed / Error
 *
 * ── 9. GSDML 设备描述（内嵌精简版） ──────────────────────────────────
 *
 *  ST20 作为 Device 时的自描述：
 *    VendorID  : 0x002A  (Siemens)
 *    DeviceID  : 0x0109  (S7-200 SMART)
 *    DAP slot  : 0
 *    Module 1  : 12 DI（IB0~IB1）
 *    Module 2  : 8  DO（QB0）
 *    Module 3  : 4  AI（16bit/ch，扩展 AI04）
 *    Module 4  : 4  AO（16bit/ch，扩展 AQ04）
 *
 * ── 10. PROFINET 新增面板元素 ─────────────────────────────────────────
 *
 *  机身变化：
 *    - ETH 端口升级为双口 PROFINET（P1/P2 标签）
 *    - 新增 PROFINET 状态 LED 组（绿=在线, 红=离线, 橙=诊断报警）
 *    - 铭牌追加 PROFINET 标志（绿色三角网格图标）
 *    - 屏幕区（可选）显示已连接设备数、周期时间、帧计数
 *
 * ══════════════════════════════════════════════════════════════════════
 *  PROFINET 地址规划
 * ══════════════════════════════════════════════════════════════════════
 *
 *  ST20 Controller IP : 192.168.0.1（可配）
 *  Station Name       : 'plc-st20'（可配，遵循 DNS 命名规则）
 *  IO Device IP 段    : 192.168.0.10 ~ 192.168.0.25（自动分配）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  端口（完整）
 * ══════════════════════════════════════════════════════════════════════
 *
 *  I0.0 ~ I1.3  → 本地数字量输入（bus, passive）
 *  Q0.0 ~ Q0.7  → 本地数字量输出（bus）
 *  PWR_IN       → 24V DC 电源
 *  BUS_R        → 扩展总线公头（连接 AI04/AQ04 等 EM 模块）
 *  PN_P1        → PROFINET Port1（bus，RJ45，连接控制器/交换机）
 *  PN_P2        → PROFINET Port2（bus，RJ45，菊花链下一设备）
 *
 * ══════════════════════════════════════════════════════════════════════
 *  可配置参数
 * ══════════════════════════════════════════════════════════════════════
 *
 *  label            : 位号（'PLC1'）
 *  scanCycleMs      : 扫描周期 ms（10）
 *  initRun          : 初始运行（false）
 *  ladderProgram    : 梯形图 JSON
 *
 *  pnStationName    : PROFINET 站名（'plc-st20'）
 *  pnIP             : PROFINET IP（'192.168.0.1'）
 *  pnSubnet         : 子网掩码（'255.255.255.0'）
 *  pnGateway        : 网关（'192.168.0.254'）
 *  pnMode           : 'controller' | 'device'（'controller'）
 *  pnSendClockMs    : 发送时钟（1 ms）
 *  pnReductionRatio : 发送比（1~512，1=每时钟发一次）
 *  pnMRPEnabled     : 启用 MRP（false）
 *  pnMRPRole        : 'manager' | 'client'（'manager'）
 *  pnDevices        : 初始设备配置数组（[]）
 */
export class S7200SmartST20 extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 420);
        this.height = Math.max(280, config.height || 340);

        this.type    = 's7200_smart_st20';
        this.special = 'plc';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initMemory();
        this._initExpansionBus();
        this._initProfinet(config);
        this._initSCADA(config);
        this._initLadderEngine();
        this._init();

        this.config = {
            label:          this.label,
            scanCycleMs:    this._scanCycleMs,
            initRun:        this._running,
            ladderProgram:  JSON.stringify(this._program),
            pnStationName:  this._pn.stationName,
            pnIP:           this._pn.ip,
            pnSubnet:       this._pn.subnet,
            pnGateway:      this._pn.gateway,
            pnMode:         this._pn.mode,
            pnSendClockMs:  this._pn.sendClockMs,
            pnMRPEnabled:   this._pn.mrpEnabled,
            pnMRPRole:      this._pn.mrpRole,
            scadaChannelName:    this._s7.channelName,
            scadaMaxClients:     this._s7.maxClients,
            scadaPushIntervalMs: this._s7.pushIntervalMs,
            scadaWriteEnabled:   this._s7.writeEnabled,
            scadaAutoAccept:     this._s7.autoAccept,
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        this._body    = { x: 0, y: 0, w: W, h: H, rx: 4 };
        this._topBar  = { x: 0, y: 0, w: W, h: H * 0.09 };

        // ── 通信接口区（顶部，扩展为3个接口）──
        // ETH 普通（保留，向后兼容）
        this._ethPort = { x: W * 0.04, y: H * 0.12, w: W * 0.11, h: H * 0.065 };
        // RS-485
        this._rsPort  = { x: W * 0.17, y: H * 0.12, w: W * 0.09, h: H * 0.065 };
        // PROFINET P1（新增，专用口）
        this._pnP1Port = { x: W * 0.28, y: H * 0.12, w: W * 0.115, h: H * 0.065 };
        // PROFINET P2（新增，菊花链口）
        this._pnP2Port = { x: W * 0.41, y: H * 0.12, w: W * 0.115, h: H * 0.065 };

        // ── PROFINET 状态 LED 组（P1/P2 下方）──
        this._pnLEDs = {
            p1Link: { x: W * 0.290, y: H * 0.215, r: H * 0.015 },
            p1Act:  { x: W * 0.330, y: H * 0.215, r: H * 0.015 },
            p2Link: { x: W * 0.420, y: H * 0.215, r: H * 0.015 },
            p2Act:  { x: W * 0.460, y: H * 0.215, r: H * 0.015 },
            pnBus:  { x: W * 0.360, y: H * 0.215, r: H * 0.015 },  // 总线状态
        };

        // ── RUN/STOP 旋钮 ──
        this._modeKnob = { x: W * 0.565, y: H * 0.165, r: H * 0.028 };

        // ── 状态 LED（RUN/STOP/ERR）──
        this._leds = {
            run:   { x: W * 0.680, y: H * 0.140, r: H * 0.017 },
            stop:  { x: W * 0.680, y: H * 0.183, r: H * 0.017 },
            error: { x: W * 0.680, y: H * 0.226, r: H * 0.017 },
        };

        // ── 铭牌（含 PROFINET 标志）──
        this._nameplate = { x: W * 0.54, y: H * 0.12, w: W * 0.43, h: H * 0.085 };

        // ── IO LED 行 ──
        this._inputLEDs0 = [];
        for (let i = 0; i < 8; i++) {
            this._inputLEDs0.push({
                x: W * (0.04 + i * 0.115), y: H * 0.35,
                r: H * 0.016, bit: i, byte: 0, label: `I0.${i}`,
            });
        }
        this._inputLEDs1 = [];
        for (let i = 0; i < 4; i++) {
            this._inputLEDs1.push({
                x: W * (0.04 + i * 0.115), y: H * 0.44,
                r: H * 0.016, bit: i, byte: 1, label: `I1.${i}`,
            });
        }
        this._outputLEDs = [];
        for (let i = 0; i < 8; i++) {
            this._outputLEDs.push({
                x: W * (0.04 + i * 0.115), y: H * 0.55,
                r: H * 0.016, bit: i, byte: 0, label: `Q0.${i}`,
            });
        }

        // ── 端子排 ──
        this._inputTerminals  = { x: W * 0.02, y: H * 0.66, w: W * 0.56, h: H * 0.095 };
        this._outputTerminals = { x: W * 0.60, y: H * 0.66, w: W * 0.38, h: H * 0.095 };

        // ── PROFINET 信息小面板（右下）──
        this._pnInfoPanel = { x: W * 0.54, y: H * 0.24, w: W * 0.43, h: H * 0.105 };

        // ── DIN 导轨 ──
        this._dinRail = { x: 0, y: H * 0.92, w: W, h: H * 0.08 };

        // ── 扩展总线接头（右侧公头）──
        this._busRight = { x: W - 2, y: H * 0.13, w: 8, h: H * 0.18 };

        // ── 端口坐标 ──
        this._portPositions = {};
        for (let i = 0; i < 8; i++) this._portPositions[`I0.${i}`] = { x: W*(0.04+i*0.115), y: H };
        for (let i = 0; i < 4; i++) this._portPositions[`I1.${i}`] = { x: W*(0.04+(i+8)*0.07), y: H };
        for (let i = 0; i < 8; i++) this._portPositions[`Q0.${i}`] = { x: W*(0.60+i*0.046), y: H };
        this._portPositions['PWR_IN'] = { x: W * 0.88, y: 0 };
        this._portPositions['BUS_R']  = { x: W + 8,    y: H * 0.22 };
        this._portPositions['PN_P1']  = { x: W * 0.335, y: 0 };
        this._portPositions['PN_P2']  = { x: W * 0.465, y: 0 };
        this._portPositions['ETH_S7'] = { x: W * 0.090, y: 0 };

        // ── 散热槽 ──
        this._ventSlots = [];
        for (let i = 0; i < 6; i++) {
            this._ventSlots.push({ x: W*0.945, y: H*(0.32+i*0.050), w: W*0.040, h: H*0.028 });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label       || 'PLC1';
        this._scanCycleMs = config.scanCycleMs !== undefined ? config.scanCycleMs : 10;
        this._running     = config.initRun     !== undefined ? !!config.initRun   : false;
        this._errorState  = false;
        this._errorMsg    = '';
        this._scanCount   = 0;
        this._accumMs     = 0;
        this._firstScan   = true;

        try {
            this._program = config.ladderProgram
                ? (typeof config.ladderProgram === 'string'
                    ? JSON.parse(config.ladderProgram)
                    : config.ladderProgram)
                : this._getDefaultProgram();
        } catch (e) {
            this._program = this._getDefaultProgram();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 存储区初始化
    // ═══════════════════════════════════════════════════════════════

    _initMemory() {
        this._I   = new Uint8Array(16);   // IB0~IB15（本地2 + PN扩展14）
        this._Q   = new Uint8Array(8);    // QB0~QB7
        this._M   = new Uint8Array(32);
        this._V   = new Uint8Array(5000);
        this._L   = new Uint8Array(64);
        this._SM  = new Uint8Array(256);
        this._AIW = new Uint8Array(64);   // 模拟量输入（EM + PN）
        this._AQW = new Uint8Array(64);   // 模拟量输出
        this._AC  = new Int32Array(4);    // 累加器

        this._T = Array.from({length:256}, () => ({
            cv:0, pv:0, bit:false, accMs:0, type:'TON', timeBase:100, enabled:false,
        }));
        this._C = Array.from({length:256}, () => ({
            cv:0, pv:0, bit:false, lastCU:false, lastCD:false, lastR:false,
        }));

        this._SM[0]    = 0xFF;
        this._smOscMs4 = 0; this._smOscMs5 = 0;
        this._smFlip4  = false; this._smFlip5 = false;

        this._expansionModules  = [];
        this._expansionSlots    = [];
        this._aiwPatched        = false;
        this._labelCache        = {};
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET 栈初始化
    // ═══════════════════════════════════════════════════════════════

    _initProfinet(config) {
        // 生成 MAC 地址（基于组件实例）
        const rnd  = (n) => Math.floor(Math.random() * 256).toString(16).padStart(2,'0').toUpperCase();
        const mac  = `00:1B:1B:${rnd()}:${rnd()}:${rnd()}`;

        this._pn = {
            // ── 基本标识 ──
            stationName:    config.pnStationName || 'plc-st20',
            ip:             config.pnIP          || '192.168.0.1',
            subnet:         config.pnSubnet      || '255.255.255.0',
            gateway:        config.pnGateway     || '192.168.0.254',
            mac:            mac,
            vendorID:       0x002A,  // Siemens
            deviceID:       0x0109,  // S7-200 SMART

            // ── 运行模式 ──
            mode:           config.pnMode        || 'controller',   // 'controller'|'device'
            state:          'OFFLINE',  // OFFLINE|STARTUP|OPERATE|CLEAR|STOP

            // ── 周期时间 ──
            sendClockMs:    config.pnSendClockMs    !== undefined ? config.pnSendClockMs    : 1,
            reductionRatio: config.pnReductionRatio !== undefined ? config.pnReductionRatio : 1,
            // 实际发送周期 = sendClockMs × reductionRatio
            accumCycleMs:   0,   // 周期累积计数器
            cycleCounter:   0,   // 帧序号（1~65535 循环）
            txFrames:       0,   // 总发送帧数
            rxFrames:       0,   // 总接收帧数
            lastCycleTs:    0,   // 上次周期时间戳（ms）
            measuredCycleUs:0,   // 实测周期（μs）

            // ── 端口状态 ──
            p1: { link:false, act:false, speed:'100Mbps', duplex:'Full', actTimer:0 },
            p2: { link:false, act:false, speed:'100Mbps', duplex:'Full', actTimer:0 },

            // ── IO 设备表（Controller 模式）──
            devices:        [],   // ProfinetDevice[]
            maxDevices:     16,

            // ── Device 模式下的 IO 数据 ──
            deviceInputData:  new Uint8Array(128),   // 控制器写入 → 设备接收
            deviceOutputData: new Uint8Array(128),   // 设备写入  → 控制器读取
            deviceConnected:  false,
            deviceControllerIP: '',

            // ── AR（Application Relationship）表 ──
            // 每个 AR 对应一个与 Device 的连接
            arTable:        [],

            // ── DCP ──
            dcpIdentifyPending: false,
            dcpResponses:       [],

            // ── MRP ──
            mrpEnabled:  config.pnMRPEnabled !== undefined ? !!config.pnMRPEnabled : false,
            mrpRole:     config.pnMRPRole    || 'manager',  // 'manager'|'client'
            mrpState:    'OPEN',   // 'OPEN'|'CLOSED'|'ERROR'
            mrpTestMs:   0,
            mrpRingPort: 'p1',    // 环网入口

            // ── 诊断 ──
            diagBuffer:  [],  // 最近32条诊断报文

            // ── 周期数据块（按 AR 索引）──
            cycleData: [],

            // ── 统计 ──
            missedCycles:    0,
            frameErrors:     0,
            consecutiveMiss: 0,
        };

        // 加载初始设备配置
        if (config.pnDevices && Array.isArray(config.pnDevices)) {
            config.pnDevices.forEach(d => this.pnAddDevice(d));
        }

        // 启动 PROFINET（若配置为自动）
        if (config.pnAutoStart) {
            setTimeout(() => this.pnStart(), 100);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 扩展总线（继承 v2，保持兼容）
    // ═══════════════════════════════════════════════════════════════

    _initExpansionBus() { /* 已在 _initMemory 中初始化 */ }

    mountModule(module, slot) {
        if (this._expansionSlots.length >= 6) return -1;
        const usedSlots = this._expansionSlots.map(s => s.slot);
        if (slot === undefined || slot === null) {
            for (let i = 0; i < 6; i++) { if (!usedSlots.includes(i)) { slot = i; break; } }
        }
        if (usedSlots.includes(slot)) return -1;
        const type    = (module.type || '').toLowerCase();
        const entry   = { slot, type, module,
            aiBase: slot * 8, aqBase: slot * 8,
            diBase: 2 + slot, doBase: 1 + Math.floor(slot / 2),
        };
        this._expansionSlots.push(entry);
        this._expansionSlots.sort((a,b) => a.slot - b.slot);
        if (module._slotAddr !== undefined) module._slotAddr = slot;
        if (!this._aiwPatched) this._patchAIWAQW();
        if (!this._expansionModules.includes(module)) this._expansionModules.push(module);
        if (typeof module.connectToCPU === 'function') module.connectToCPU(this);
        return slot;
    }

    unmountModule(slotOrModule) {
        let idx = typeof slotOrModule === 'number'
            ? this._expansionSlots.findIndex(s => s.slot === slotOrModule)
            : this._expansionSlots.findIndex(s => s.module === slotOrModule);
        if (idx < 0) return;
        const entry = this._expansionSlots[idx];
        if (typeof entry.module.disconnectFromCPU === 'function') entry.module.disconnectFromCPU();
        this._expansionSlots.splice(idx, 1);
        const mi = this._expansionModules.indexOf(entry.module);
        if (mi >= 0) this._expansionModules.splice(mi, 1);
    }

    _patchAIWAQW() {
        if (this._aiwPatched) return;
        this._aiwPatched = true;
        const orig_rw = this._readWord.bind(this);
        const orig_ww = this._writeWord.bind(this);
        const self = this;
        this._readWord = function(addr) {
            const mAIW = addr.match(/^AIW(\d+)$/i);
            if (mAIW) { const off=+mAIW[1]; const r=(self._AIW[off]<<8)|self._AIW[off+1]; return r>32767?r-65536:r; }
            const mAQW = addr.match(/^AQW(\d+)$/i);
            if (mAQW) { const off=+mAQW[1]; const r=(self._AQW[off]<<8)|self._AQW[off+1]; return r>32767?r-65536:r; }
            const mAC  = addr.match(/^AC(\d+)$/i);
            if (mAC)  return self._AC[+mAC[1]] || 0;
            return orig_rw(addr);
        };
        this._writeWord = function(addr, val) {
            const mAQW = addr.match(/^AQW(\d+)$/i);
            if (mAQW) { const off=+mAQW[1]; val=Math.max(-32768,Math.min(32767,Math.round(val)));const u=val<0?val+65536:val;self._AQW[off]=(u>>8)&0xFF;self._AQW[off+1]=u&0xFF;return; }
            const mAIW = addr.match(/^AIW(\d+)$/i);
            if (mAIW) { const off=+mAIW[1]; val=Math.max(-32768,Math.min(32767,Math.round(val)));const u=val<0?val+65536:val;self._AIW[off]=(u>>8)&0xFF;self._AIW[off+1]=u&0xFF;return; }
            orig_ww(addr, val);
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // PROFINET 公开 API
    // ═══════════════════════════════════════════════════════════════

    /**
     * 启动 PROFINET 协议栈
     * 仿真初始化 → DCP → AR 建立 → 进入 OPERATE 状态
     */
    pnStart() {
        const pn = this._pn;
        if (pn.state !== 'OFFLINE') return;
        pn.state      = 'STARTUP';
        pn.p1.link    = true;
        pn.p2.link    = (pn.devices.length > 0 || pn.mrpEnabled);
        pn.accumCycleMs = 0;

        this._pnLog('info', `PROFINET 启动 (${pn.mode}, IP=${pn.ip}, Name=${pn.stationName})`);

        // 仿真启动序列：STARTUP → DCP发现 → AR建立 → OPERATE
        const startupDur = 400 + pn.devices.length * 120;
        this._pnStartupTimer = startupDur;
        this._rebuildDynamic(); this.markDirty();
    }

    /**
     * 停止 PROFINET 协议栈
     */
    pnStop() {
        const pn = this._pn;
        pn.state    = 'OFFLINE';
        pn.p1.link  = false;
        pn.p2.link  = false;
        pn.p1.act   = false;
        pn.p2.act   = false;
        pn.devices.forEach(d => { d.online = false; d.arEstablished = false; });
        pn.arTable  = [];
        this._pnLog('warn', 'PROFINET 已停止');
        this._rebuildDynamic(); this.markDirty();
    }

    /**
     * 添加 IO Device 到设备表
     * @param {object} cfg 设备配置
     */
    pnAddDevice(cfg) {
        const pn = this._pn;
        if (pn.devices.length >= pn.maxDevices) {
            this._pnLog('error', '设备表已满（最多16个）');
            return null;
        }
        const slot = cfg.slot !== undefined ? cfg.slot : pn.devices.length;
        const dev = {
            slot:          slot,
            deviceName:    cfg.deviceName   || `device-${slot}`,
            deviceIP:      cfg.deviceIP     || `192.168.0.${10 + slot}`,
            deviceType:    cfg.deviceType   || 'generic',
            vendorID:      cfg.vendorID     || 0x0000,
            deviceID:      cfg.deviceID     || 0x0000,
            // IO 数据规格
            inputBytes:    cfg.inputBytes   !== undefined ? cfg.inputBytes   : 4,
            outputBytes:   cfg.outputBytes  !== undefined ? cfg.outputBytes  : 4,
            inputData:     new Uint8Array(cfg.inputBytes  || 4),
            outputData:    new Uint8Array(cfg.outputBytes || 4),
            // 状态
            online:        false,
            arEstablished: false,
            diagAlarm:     false,
            configError:   false,
            watchdogMs:    cfg.watchdogMs   || 3000,  // 看门狗超时 ms
            lastRxTs:      0,
            // 地址映射（CPU 存储区）
            iBaseAddr:     2 + slot * 4,   // IB 起始（IB2+）
            qBaseAddr:     1 + slot,       // QB 起始（QB1+）
            // 关联仿真模块对象
            moduleRef:     cfg.moduleRef    || null,
            // 统计
            txCount:       0,
            rxCount:       0,
            missCount:     0,
        };
        pn.devices.push(dev);
        this._pnLog('info', `添加设备: slot=${slot} name=${dev.deviceName} IP=${dev.deviceIP}`);
        return dev;
    }

    /**
     * 移除 IO Device
     */
    pnRemoveDevice(slotOrName) {
        const pn = this._pn;
        const idx = typeof slotOrName === 'number'
            ? pn.devices.findIndex(d => d.slot === slotOrName)
            : pn.devices.findIndex(d => d.deviceName === slotOrName);
        if (idx >= 0) {
            this._pnLog('info', `移除设备: ${pn.devices[idx].deviceName}`);
            pn.devices.splice(idx, 1);
        }
    }

    /**
     * 获取设备对象
     */
    pnGetDevice(slotOrName) {
        const pn = this._pn;
        return typeof slotOrName === 'number'
            ? pn.devices.find(d => d.slot === slotOrName)
            : pn.devices.find(d => d.deviceName === slotOrName);
    }

    /**
     * 触发 DCP 设备发现（Identify All）
     */
    pnDiscoverDevices() {
        const pn = this._pn;
        if (pn.state === 'OFFLINE') { this._pnLog('warn','PROFINET 未启动，无法发现设备'); return; }
        this._pnLog('info', 'DCP Identify Req → 广播 (FF:FF:FF:FF:FF:FF)');
        pn.dcpIdentifyPending = true;
        pn.dcpResponses       = [];
        // 仿真：200~600ms 内设备陆续响应
        pn.devices.forEach((dev, i) => {
            const delay = 200 + i * 80 + Math.random() * 100;
            this._pnSchedule(delay, () => {
                pn.dcpResponses.push({
                    deviceName: dev.deviceName,
                    ip:         dev.deviceIP,
                    mac:        `00:1B:1B:${(dev.slot+1).toString(16).padStart(2,'0')}:00:01`,
                    vendorID:   dev.vendorID,
                    deviceID:   dev.deviceID,
                });
                dev.online = true;
                dev.lastRxTs = performance.now();
                this._pnLog('info', `DCP Identify Res ← ${dev.deviceName} (${dev.deviceIP})`);
                this._rebuildDynamic(); this.markDirty();
            });
        });
        this._pnSchedule(700, () => {
            pn.dcpIdentifyPending = false;
            this._pnLog('info', `DCP 发现完成：${pn.dcpResponses.length} 个设备响应`);
        });
    }

    /**
     * 建立与设备的 AR（Application Relationship）
     */
    pnConnectDevice(slotOrName) {
        const pn  = this._pn;
        const dev = this.pnGetDevice(slotOrName);
        if (!dev) { this._pnLog('error', `设备 ${slotOrName} 不存在`); return; }
        if (dev.arEstablished) { this._pnLog('warn', `${dev.deviceName} AR 已建立`); return; }
        this._pnLog('info', `Connect Req → ${dev.deviceName} (${dev.deviceIP})`);

        // 仿真 AR 建立序列（5步，总耗时约 500~1000ms）
        const steps = [
            { label:'Connect Req',     delay: 80  + Math.random()*60  },
            { label:'Connect Res',     delay: 50  + Math.random()*40  },
            { label:'Write Param',     delay: 100 + Math.random()*80  },
            { label:'Param End',       delay: 50  + Math.random()*30  },
            { label:'App Ready',       delay: 100 + Math.random()*100 },
        ];
        let accDelay = 0;
        steps.forEach(step => {
            accDelay += step.delay;
            this._pnSchedule(accDelay, () => {
                this._pnLog('info', `  [AR ${dev.deviceName}] ${step.label}`);
                this._rebuildDynamic(); this.markDirty();
            });
        });
        this._pnSchedule(accDelay + 50, () => {
            dev.arEstablished = true;
            dev.online        = true;
            dev.lastRxTs      = performance.now();
            pn.p1.link        = true;
            pn.p1.act         = true;
            pn.arTable.push({ arUUID: this._pnGenUUID(), deviceSlot: dev.slot, established: true });
            if (pn.state !== 'OPERATE') pn.state = 'OPERATE';
            this._pnLog('info', `✓ AR 建立成功: ${dev.deviceName} → 进入数据交换`);
            this._rebuildDynamic(); this.markDirty();
        });
    }

    /**
     * 断开设备 AR
     */
    pnDisconnectDevice(slotOrName) {
        const pn  = this._pn;
        const dev = this.pnGetDevice(slotOrName);
        if (!dev) return;
        dev.arEstablished = false;
        dev.online        = false;
        pn.arTable = pn.arTable.filter(ar => ar.deviceSlot !== dev.slot);
        this._pnLog('warn', `AR 断开: ${dev.deviceName}`);
        if (pn.arTable.length === 0) pn.state = 'CLEAR';
        this._rebuildDynamic(); this.markDirty();
    }

    /**
     * Device 模式：连接到上位机 Controller
     */
    pnConnectToController(controllerIP) {
        const pn = this._pn;
        if (pn.mode !== 'device') { this._pnLog('error', '需切换到 Device 模式'); return; }
        this._pnLog('info', `等待 Controller (${controllerIP}) 连接…`);
        pn.deviceControllerIP = controllerIP;
        pn.p1.link            = true;
        this._pnSchedule(600 + Math.random()*400, () => {
            pn.deviceConnected = true;
            pn.state           = 'OPERATE';
            this._pnLog('info', `✓ 已被 Controller ${controllerIP} 连接`);
            this._rebuildDynamic(); this.markDirty();
        });
    }

    /**
     * 直接绑定 IO Device 到仿真模块（内部总线）
     * 绑定后在周期循环中直接读写模块的 I/O 存储区，无需实际网络
     * @param {number} slot   设备槽位
     * @param {object} module 仿真模块（AI04/AQ04/DE8/DT16）
     */
    pnBindModule(slot, module) {
        const dev = this.pnGetDevice(slot);
        if (!dev) { this._pnLog('error', `槽位 ${slot} 无设备`); return; }
        dev.moduleRef = module;
        this._pnLog('info', `绑定模块 ${module.type||'?'} → slot ${slot}`);
        // 若模块有 connectToCPU 方法，同时调用（建立扩展总线连接）
        if (typeof module.connectToCPU === 'function') module.connectToCPU(this);
    }

    // ── 周期数据交换（每 PROFINET 周期调用） ───────────────────────────

    _pnCycleExchange(dtMs) {
        const pn = this._pn;
        pn.accumCycleMs += dtMs;
        const cyclePeriodMs = pn.sendClockMs * pn.reductionRatio;
        if (pn.accumCycleMs < cyclePeriodMs) return;

        const now = performance.now();
        if (pn.lastCycleTs > 0) {
            pn.measuredCycleUs = (now - pn.lastCycleTs) * 1000;
        }
        pn.lastCycleTs  = now;
        pn.accumCycleMs = 0;
        pn.cycleCounter = (pn.cycleCounter + 1) & 0xFFFF;
        if (pn.cycleCounter === 0) pn.cycleCounter = 1;

        if (pn.state === 'OFFLINE' || pn.state === 'STOP') return;

        if (pn.mode === 'controller') {
            this._pnControllerCycle();
        } else {
            this._pnDeviceCycle();
        }

        // 更新 ACT LED（数据活动指示）
        pn.p1.act       = (pn.txFrames % 4 < 2);
        pn.p1.actTimer -= dtMs;
        if (pn.p1.actTimer < 0) pn.p1.actTimer = 0;

        // MRP 心跳
        if (pn.mrpEnabled) this._pnMRPTick(dtMs);
    }

    _pnControllerCycle() {
        const pn = this._pn;

        pn.devices.forEach(dev => {
            if (!dev.arEstablished) return;

            // 看门狗超时检测
            if (dev.lastRxTs > 0 && (performance.now() - dev.lastRxTs) > dev.watchdogMs) {
                if (dev.online) {
                    dev.online      = false;
                    dev.diagAlarm   = true;
                    dev.missCount++;
                    pn.missedCycles++;
                    this._pnLog('error', `看门狗超时: ${dev.deviceName}`);
                }
                return;
            }

            // ① 输出：CPU QB → 设备 outputData（Controller → Device）
            for (let b = 0; b < dev.outputBytes; b++) {
                const qByteAddr = dev.qBaseAddr + b;
                dev.outputData[b] = this._Q[qByteAddr] || 0;
            }

            // ② 输入：设备 inputData → CPU IB（Device → Controller）
            for (let b = 0; b < dev.inputBytes; b++) {
                const iByteAddr = dev.iBaseAddr + b;
                this._I[iByteAddr] = dev.inputData[b] || 0;
            }

            // ③ 若有绑定模块：从模块读取真实 I/O 数据
            if (dev.moduleRef) {
                const mod = dev.moduleRef;
                const modType = (mod.type || '').toLowerCase();

                // AI04 模块：从模块 AIW 读取 → CPU AIW
                if (modType.includes('ai04') || modType.includes('ai_04')) {
                    if (mod._AIW || mod.AIW) {
                        const src = mod._AIW || mod.AIW;
                        for (let i = 0; i < Math.min(src.length, 8); i++) {
                            this._AIW[dev.slot * 8 + i] = src[i];
                        }
                    }
                }
                // AQ04 模块：CPU AQW → 模块 AQW
                if (modType.includes('aq04') || modType.includes('aq_04')) {
                    if (mod._AQW || mod.AQW) {
                        const dst = mod._AQW || mod.AQW;
                        for (let i = 0; i < Math.min(dst.length, 8); i++) {
                            dst[i] = this._AQW[dev.slot * 8 + i];
                        }
                    }
                }
                // DT16 数字量混合模块
                if (modType.includes('dt16')) {
                    if (mod._I) {
                        for (let i = 0; i < 2; i++) this._I[dev.iBaseAddr + i] = mod._I[i] || 0;
                    }
                    if (mod._Q) {
                        for (let i = 0; i < 2; i++) mod._Q[i] = this._Q[dev.qBaseAddr + i] || 0;
                    }
                }
                // DE8 数字量输入
                if (modType.includes('de8')) {
                    if (mod._I) this._I[dev.iBaseAddr] = mod._I[0] || 0;
                }
                // 通用：模块 isOnline 标志
                dev.online   = true;
                dev.lastRxTs = performance.now();
            } else {
                // 无绑定模块：标记在线，模拟随机数据（仅演示）
                dev.lastRxTs = performance.now();
            }

            dev.txCount++;
            dev.rxCount++;
            pn.txFrames++;
            pn.rxFrames++;
        });
    }

    _pnDeviceCycle() {
        // Device 模式：处理 Controller 写入的数据
        const pn = this._pn;
        if (!pn.deviceConnected) return;

        // Controller → Device 方向：更新本地输入映像
        for (let i = 0; i < Math.min(pn.deviceInputData.length, this._I.length); i++) {
            this._I[i] = pn.deviceInputData[i];
        }
        // Device → Controller 方向：将本地输出映像写出
        for (let i = 0; i < Math.min(pn.deviceOutputData.length, this._Q.length); i++) {
            pn.deviceOutputData[i] = this._Q[i];
        }
        // 模拟量同步
        pn.deviceOutputData.set(this._AIW.slice(0, Math.min(64, pn.deviceOutputData.length)), 64);

        pn.txFrames++;
        pn.rxFrames++;
    }

    // ── MRP 心跳 ───────────────────────────────────────────────────

    _pnMRPTick(dtMs) {
        const pn = this._pn;
        if (!pn.mrpEnabled) return;
        pn.mrpTestMs += dtMs;
        if (pn.mrpTestMs >= 20) {  // 20ms 测试周期
            pn.mrpTestMs = 0;
            // 仿真：随机 0.2% 概率模拟环路中断事件
            if (Math.random() < 0.002 && pn.mrpState === 'CLOSED') {
                pn.mrpState = 'OPEN';
                this._pnLog('warn', 'MRP Ring 断路检测，正在切换…');
                this._pnSchedule(150, () => {
                    pn.mrpState = 'CLOSED';
                    this._pnLog('info', 'MRP Ring 切换完成，环路恢复');
                });
            }
        }
    }

    // ── 延迟调度器（轻量版，不依赖 setTimeout）──────────────────────

    _pnSchedulerQueue = [];

    _pnSchedule(delayMs, callback) {
        this._pnSchedulerQueue.push({
            fireAt: performance.now() + delayMs,
            cb:     callback,
        });
    }

    _pnTickScheduler() {
        const now = performance.now();
        this._pnSchedulerQueue = this._pnSchedulerQueue.filter(item => {
            if (now >= item.fireAt) { item.cb(); return false; }
            return true;
        });
    }

    // ── 启动序列 tick ────────────────────────────────────────────────

    _pnTickStartup(dtMs) {
        if (this._pnStartupTimer === undefined || this._pnStartupTimer <= 0) return;
        this._pnStartupTimer -= dtMs;
        if (this._pnStartupTimer <= 0) {
            this._pnStartupTimer = 0;
            const pn = this._pn;
            pn.state = 'OPERATE';
            pn.p1.link = true;
            // 自动发现并连接所有预配置设备
            pn.devices.forEach(dev => {
                dev.online        = true;
                dev.arEstablished = true;
                dev.lastRxTs      = performance.now();
                this._pnLog('info', `✓ 设备上线: ${dev.deviceName}`);
            });
            if (pn.mrpEnabled) {
                pn.mrpState = 'CLOSED';
                pn.p2.link  = true;
                this._pnLog('info', 'MRP Ring 已闭合');
            }
            this._pnLog('info', `PROFINET 进入 OPERATE（${pn.devices.filter(d=>d.online).length}/${pn.devices.length} 设备在线）`);
            this._rebuildDynamic(); this.markDirty();
        }
    }

    // ── 诊断日志 ─────────────────────────────────────────────────────

    _pnLog(level, msg) {
        const pn = this._pn;
        const ts  = new Date().toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 });
        pn.diagBuffer.unshift({ level, msg, ts });
        if (pn.diagBuffer.length > 32) pn.diagBuffer.pop();
    }

    // ── UUID 生成 ────────────────────────────────────────────────────

    _pnGenUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    // ── PNRD / PNWR / PNST / PNDIAG 指令实现 ──────────────────────

    _execPNRD(inst) {
        // PNRD slot, offset, len, dest
        const slot   = parseInt(inst.addr)  || 0;
        const offset = parseInt(inst.addr2) || 0;
        const len    = parseInt(inst.pv)    || 1;
        const dest   = inst.addr3           || 'VB0';
        const dev    = this.pnGetDevice(slot);
        if (!dev || !dev.online) return;
        const destByteN = parseInt(dest.replace(/[A-Za-z]/g,'')) || 0;
        for (let i = 0; i < len; i++) {
            this._V[destByteN + i] = dev.inputData[offset + i] || 0;
        }
    }

    _execPNWR(inst) {
        // PNWR slot, offset, len, src
        const slot   = parseInt(inst.addr)  || 0;
        const offset = parseInt(inst.addr2) || 0;
        const len    = parseInt(inst.pv)    || 1;
        const src    = inst.addr3           || 'VB0';
        const dev    = this.pnGetDevice(slot);
        if (!dev || !dev.arEstablished) return;
        const srcByteN = parseInt(src.replace(/[A-Za-z]/g,'')) || 0;
        for (let i = 0; i < len; i++) {
            dev.outputData[offset + i] = this._V[srcByteN + i] || 0;
        }
        dev.txCount++;
    }

    _execPNST(inst) {
        // PNST slot, dest_bit
        const slot    = parseInt(inst.addr)  || 0;
        const destBit = inst.addr2 || 'M0.0';
        const dev     = this.pnGetDevice(slot);
        const online  = dev ? dev.online : false;
        this._writeBit(destBit, online);
    }

    _execPNDIAG(inst) {
        // PNDIAG slot, dest_byte
        const slot     = parseInt(inst.addr)  || 0;
        const destByte = inst.addr2 || 'VB0';
        const dev      = this.pnGetDevice(slot);
        let   diagByte = 0;
        if (dev) {
            if (dev.online)        diagByte |= 0x01;
            if (dev.arEstablished) diagByte |= 0x02;
            if (dev.diagAlarm)     diagByte |= 0x04;
            if (dev.configError)   diagByte |= 0x08;
        }
        const destByteN = parseInt(destByte.replace(/[A-Za-z]/g,'')) || 0;
        this._V[destByteN] = diagByte;
    }

    // ═══════════════════════════════════════════════════════════════
    // 浮点数存储区（VD）
    // ═══════════════════════════════════════════════════════════════

    readReal(addr) {
        const m = addr.match(/^VD(\d+)$/i);
        if (!m) { const n = parseFloat(addr); return isNaN(n) ? 0 : n; }
        const b = +m[1]; if (b+3 >= this._V.length) return 0;
        const buf=new ArrayBuffer(4), dv=new DataView(buf);
        dv.setUint8(0,this._V[b]); dv.setUint8(1,this._V[b+1]);
        dv.setUint8(2,this._V[b+2]); dv.setUint8(3,this._V[b+3]);
        return dv.getFloat32(0, false);
    }

    _writeReal(addr, val) {
        const m = addr.match(/^VD(\d+)$/i); if (!m) return;
        const b = +m[1]; if (b+3 >= this._V.length) return;
        const buf=new ArrayBuffer(4), dv=new DataView(buf);
        dv.setFloat32(0, val, false);
        this._V[b]=dv.getUint8(0); this._V[b+1]=dv.getUint8(1);
        this._V[b+2]=dv.getUint8(2); this._V[b+3]=dv.getUint8(3);
    }

    // ═══════════════════════════════════════════════════════════════
    // 存储区访问
    // ═══════════════════════════════════════════════════════════════

    _readBit(addr) {
        if (addr==='SM0.0') return true;
        if (addr==='SM0.1') return !!(this._SM[0]&0x02);
        if (addr==='SM0.4') return !!(this._SM[0]&0x10);
        if (addr==='SM0.5') return !!(this._SM[0]&0x20);
        if (addr==='SM0.6') return !!(this._SM[0]&0x40);
        const m = addr.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
        if (m) {
            const z=m[1].toUpperCase(), b=+m[2], bit=+m[3], mask=1<<bit;
            if(z==='I') return !!(this._I[b]&mask); if(z==='Q') return !!(this._Q[b]&mask);
            if(z==='M') return !!(this._M[b]&mask); if(z==='V') return !!(this._V[b]&mask);
            if(z==='SM') return !!(this._SM[b]&mask); if(z==='L') return !!(this._L[b]&mask);
        }
        const tc = addr.match(/^([TC])(\d+)$/);
        if (tc) { const n=+tc[2]; return tc[1]==='T'?this._T[n].bit:this._C[n].bit; }
        return false;
    }

    _writeBit(addr, val) {
        const m = addr.match(/^([A-Za-z]+)(\d+)\.(\d+)$/); if (!m) return;
        const z=m[1].toUpperCase(), b=+m[2], bit=+m[3], mask=1<<bit;
        const set=arr=>{if(val)arr[b]|=mask;else arr[b]&=~mask;};
        if(z==='Q'){set(this._Q);return;} if(z==='M'){set(this._M);return;}
        if(z==='V'){set(this._V);return;} if(z==='L'){set(this._L);return;}
        if(z==='SM'){set(this._SM);return;}
    }

    _readWord(addr) {
        if (/^-?\d+$/.test(addr)) return parseInt(addr);
        const m = addr.match(/^([A-Za-z]+)W?(\d+)$/i); if (!m) return 0;
        const z=m[1].toUpperCase(), b=+m[2];
        const rA=arr=>{const r=(arr[b]<<8)|arr[b+1];return r>32767?r-65536:r;};
        if(z==='V') return rA(this._V); if(z==='M') return rA(this._M);
        if(z==='IW'||z==='I') return rA(this._I); if(z==='QW') return rA(this._Q);
        const tv=addr.match(/^T(\d+)$/i); if(tv) return this._T[+tv[1]].cv||0;
        const cv=addr.match(/^C(\d+)$/i); if(cv) return this._C[+cv[1]].cv||0;
        return 0;
    }

    _writeWord(addr, val) {
        val=Math.max(-32768,Math.min(32767,Math.round(val)));const u=val<0?val+65536:val;
        const m=addr.match(/^([A-Za-z]+)W?(\d+)$/i); if (!m) return;
        const z=m[1].toUpperCase(), b=+m[2];
        const wA=arr=>{arr[b]=(u>>8)&0xFF;arr[b+1]=u&0xFF;};
        if(z==='V'){wA(this._V);return;} if(z==='M'){wA(this._M);return;} if(z==='QW'){wA(this._Q);return;}
    }

    _readByte(addr) {
        const m=addr.match(/^([A-Za-z]+)B?(\d+)$/i); if(!m){const n=parseInt(addr);return isNaN(n)?0:n&0xFF;}
        const z=m[1].toUpperCase(),b=+m[2];
        if(z==='V')return this._V[b]||0; if(z==='M')return this._M[b]||0;
        if(z==='IB'||z==='I')return this._I[b]||0; if(z==='QB'||z==='Q')return this._Q[b]||0;
        if(z==='L')return this._L[b]||0; return 0;
    }

    _writeByte(addr, val) {
        val=Math.max(0,Math.min(255,Math.round(val)));
        const m=addr.match(/^([A-Za-z]+)B?(\d+)$/i); if(!m) return;
        const z=m[1].toUpperCase(),b=+m[2];
        if(z==='V'){this._V[b]=val;return;} if(z==='M'){this._M[b]=val;return;}
        if(z==='QB'||z==='Q'){this._Q[b]=val;return;} if(z==='L'){this._L[b]=val;return;}
    }

    _parseIndex(addr, prefix) {
        const n=parseInt(addr.replace(new RegExp(`^${prefix}`,'i'),''));return isNaN(n)?0:Math.max(0,Math.min(255,n));
    }

    // ═══════════════════════════════════════════════════════════════
    // 梯形图引擎
    // ═══════════════════════════════════════════════════════════════

    _initLadderEngine() { this._stack=[]; this._flow=false; }

    _execScan() {
        if (!this._running) return;
        if (this._firstScan) this._SM[0]|=0x02; else this._SM[0]&=~0x02;
        this._SM[0]^=0x40;
        const prog=this._program; if (!prog?.networks) return;
        try {
            for (const net of prog.networks)
                for (const rung of (net.rungs||[]))
                    this._execRung(rung);
        } catch(e) { this._errorState=true; this._errorMsg=e.message||'执行错误'; this._running=false; }
        this._firstScan=false; this._scanCount++;
    }

    _execRung(insts) {
        const stack=[]; let flow=false;
        for (const inst of insts) {
            const op=inst.op.toUpperCase();
            const {addr,addr2,addr3,pv,timeBase,loop,table}=inst;
            switch(op){
                case 'LD':  stack.push(flow);flow=this._readBit(addr);break;
                case 'LDN': stack.push(flow);flow=!this._readBit(addr);break;
                case 'A':   flow=flow&&this._readBit(addr);break;
                case 'AN':  flow=flow&&!this._readBit(addr);break;
                case 'O':   flow=flow||this._readBit(addr);break;
                case 'ON':  flow=flow||!this._readBit(addr);break;
                case 'NOT': flow=!flow;break;
                case 'EU':  {const k=`_eu_${inst._id||Math.random()}`;const p=this[k]||false;const c=this._readBit(addr);this[k]=c;flow=flow&&(c&&!p);break;}
                case 'ED':  {const k=`_ed_${inst._id||Math.random()}`;const p=this[k]||false;const c=this._readBit(addr);this[k]=c;flow=flow&&(!c&&p);break;}
                case 'OLD': {const p=stack.pop();flow=flow||(p||false);break;}
                case 'ALD': {const p=stack.pop();flow=flow&&(p||false);break;}
                case 'LPS': stack.push(flow);break;
                case 'LRD': flow=stack[stack.length-1];break;
                case 'LPP': flow=stack.pop()||false;break;
                case '=':   this._writeBit(addr,flow);break;
                case 'S':   if(flow)this._writeBit(addr,true);break;
                case 'R':   if(flow)this._writeBit(addr,false);break;
                case 'TON':{const t=this._T[this._parseIndex(addr,'T')];t.type='TON';if(pv!==undefined)t.pv=pv;t.timeBase=timeBase||100;t.enabled=flow;if(!flow){t.cv=0;t.bit=false;t.accMs=0;}break;}
                case 'TOF':{const t=this._T[this._parseIndex(addr,'T')];t.type='TOF';if(pv!==undefined)t.pv=pv;t.timeBase=timeBase||100;if(flow){t.bit=true;t.cv=0;t.accMs=0;}t.enabled=!flow;break;}
                case 'TONR':{const t=this._T[this._parseIndex(addr,'T')];t.type='TONR';if(pv!==undefined)t.pv=pv;t.timeBase=timeBase||100;t.enabled=flow;break;}
                case 'CTU':{const c=this._C[this._parseIndex(addr,'C')];if(pv!==undefined)c.pv=pv;const r=addr2?this._readBit(addr2):false;if(r){c.cv=0;c.bit=false;}else if(flow&&!c.lastCU)c.cv++;c.bit=c.cv>=c.pv;c.lastCU=flow;break;}
                case 'CTD':{const c=this._C[this._parseIndex(addr,'C')];if(pv!==undefined)c.pv=pv;const ld=addr2?this._readBit(addr2):false;if(ld){c.cv=c.pv;c.bit=false;}else if(flow&&!c.lastCD)c.cv=Math.max(0,c.cv-1);c.bit=c.cv===0;c.lastCD=flow;break;}
                case '==I':flow=flow&&(this._readWord(addr)===this._readWord(addr2));break;
                case '<>I':flow=flow&&(this._readWord(addr)!==this._readWord(addr2));break;
                case '>=I':flow=flow&&(this._readWord(addr)>=this._readWord(addr2));break;
                case '<=I':flow=flow&&(this._readWord(addr)<=this._readWord(addr2));break;
                case '>I': flow=flow&&(this._readWord(addr)>this._readWord(addr2));break;
                case '<I': flow=flow&&(this._readWord(addr)<this._readWord(addr2));break;
                case '>=R':flow=flow&&(this.readReal(addr)>=this.readReal(addr2));break;
                case '<=R':flow=flow&&(this.readReal(addr)<=this.readReal(addr2));break;
                case 'MOV_B':if(flow)this._writeByte(addr2,this._readByte(addr));break;
                case 'MOV_W':if(flow)this._writeWord(addr2,this._readWord(addr));break;
                case 'MOV_R':if(flow)this._writeReal(addr2,this.readReal(addr));break;
                case 'ADD_I':if(flow)this._writeWord(addr2,this._readWord(addr)+this._readWord(addr2));break;
                case 'SUB_I':if(flow)this._writeWord(addr2,this._readWord(addr)-this._readWord(addr2));break;
                case 'MUL_I':if(flow)this._writeWord(addr2,this._readWord(addr)*this._readWord(addr2));break;
                case 'DIV_I':if(flow){const d=this._readWord(addr2);if(d)this._writeWord(addr2,Math.trunc(this._readWord(addr)/d));}break;
                case '+R':if(flow)this._writeReal(addr2,this.readReal(addr)+this.readReal(addr2));break;
                case '-R':if(flow)this._writeReal(addr2,this.readReal(addr)-this.readReal(addr2));break;
                case '*R':if(flow)this._writeReal(addr2,this.readReal(addr)*this.readReal(addr2));break;
                case '/R':if(flow){const d=this.readReal(addr2);if(d)this._writeReal(addr2,this.readReal(addr)/d);}break;
                case 'SQRT':if(flow)this._writeReal(addr2,Math.sqrt(Math.max(0,this.readReal(addr))));break;
                case 'DTR': if(flow)this._writeReal(addr2,this._readWord(addr));break;
                case 'TRUNC':if(flow)this._writeWord(addr2,Math.trunc(this.readReal(addr)));break;
                case 'ROUND':if(flow)this._writeWord(addr2,Math.round(this.readReal(addr)));break;
                case 'INCW':if(flow)this._writeWord(addr,this._readWord(addr)+1);break;
                case 'DECW':if(flow)this._writeWord(addr,this._readWord(addr)-1);break;
                case 'PID': case 'PIDX':{const lp=loop!==undefined?loop:(parseInt(addr)||0);const tb=table!==undefined?table:(parseInt(addr2)||0);this._execPID(lp,tb,flow);break;}
                // ── PROFINET 专用指令 ──
                case 'PNRD':  if(flow)this._execPNRD(inst);break;
                case 'PNWR':  if(flow)this._execPNWR(inst);break;
                case 'PNST':  this._execPNST(inst);break;
                case 'PNDIAG':this._execPNDIAG(inst);break;
                case 'NOP':break; default:break;
            }
        }
    }

    // ── PID ────────────────────────────────────────────────────────
    _execPID(loop, table, en) {
        if (loop<0||loop>7) return;
        if (!this._pidState) {
            this._pidState=Array.from({length:8},()=>({Ix:0,ePrev:0,pvPrev:0,active:false,prevEN:false}));
        }
        const s=this._pidState[loop],T=table;
        const PV=this.readReal(`VD${T}`),SP=this.readReal(`VD${T+4}`);
        let MX=this.readReal(`VD${T+8}`);
        const Kc=this.readReal(`VD${T+12}`),Ts=this.readReal(`VD${T+16}`);
        const Ti=this.readReal(`VD${T+20}`),Td=this.readReal(`VD${T+24}`);
        const MXmax=this.readReal(`VD${T+28}`)||1,MXmin=this.readReal(`VD${T+32}`)||0;
        if (!en){if(s.prevEN){s.Ix=MX;s.ePrev=SP-PV;s.pvPrev=PV;}s.prevEN=false;return;}
        s.prevEN=true; if(Ts<=0||isNaN(Ts)) return;
        const e=SP-PV;
        if(Ti>0){const Ti_s=Ti*60;s.Ix+=Kc*(Ts/Ti_s)*((e+s.ePrev)/2);}
        let Dout=0; if(Td>0){Dout=-Kc*(Td*60/Ts)*(PV-s.pvPrev);}
        MX=Kc*e+s.Ix+Dout;
        if(MX>MXmax){MX=MXmax;}else if(MX<MXmin){MX=MXmin;}
        this._writeReal(`VD${T+8}`,MX);s.ePrev=e;s.pvPrev=PV;s.active=true;
    }

    // ── 定时器 / SM tick ────────────────────────────────────────────
    _tickTimers(dtMs) {
        for(let i=0;i<256;i++){const t=this._T[i];if(!t.enabled)continue;t.accMs+=dtMs;const ticks=Math.floor(t.accMs/t.timeBase);if(ticks>0){t.accMs-=ticks*t.timeBase;if(t.type==='TON'||t.type==='TONR'){t.cv=Math.min(t.cv+ticks,32767);if(t.cv>=t.pv)t.bit=true;}else if(t.type==='TOF'){t.cv=Math.min(t.cv+ticks,32767);if(t.cv>=t.pv){t.bit=false;t.enabled=false;}}}}
    }

    _tickSM(dtMs) {
        this._smOscMs5+=dtMs; this._smOscMs4+=dtMs;
        if(this._smOscMs5>=500){this._smOscMs5-=500;this._smFlip5=!this._smFlip5;if(this._smFlip5)this._SM[0]|=0x20;else this._SM[0]&=~0x20;}
        if(this._smOscMs4>=30000){this._smOscMs4-=30000;this._smFlip4=!this._smFlip4;if(this._smFlip4)this._SM[0]|=0x10;else this._SM[0]&=~0x10;}
    }

    // ═══════════════════════════════════════════════════════════════
    // 默认示例程序（含 PROFINET 指令示例）
    // ═══════════════════════════════════════════════════════════════

    _getDefaultProgram() {
        return {
            name: 'ST20_PROFINET_演示',
            networks: [
                { comment:'Network 1 · 启保停（I0.0启 I0.1停 Q0.0运行）',
                  rungs:[[{op:'LD',addr:'I0.0'},{op:'O',addr:'Q0.0'},{op:'AN',addr:'I0.1'},{op:'=',addr:'Q0.0'}]]},
                { comment:'Network 2 · PROFINET设备状态检测（slot0在线→M0.0）',
                  rungs:[
                    [{op:'LD',addr:'SM0.0'},{op:'PNST', addr:'0',addr2:'M0.0'}],
                    [{op:'LD',addr:'SM0.0'},{op:'PNDIAG',addr:'0',addr2:'VB10'}],
                  ]},
                { comment:'Network 3 · 从 PN slot0 读4字节→VB100（仅在线时）',
                  rungs:[[{op:'LD',addr:'M0.0'},{op:'PNRD',addr:'0',addr2:'0',pv:4,addr3:'VB100'}]]},
                { comment:'Network 4 · 写Q0.0状态→PN slot0 输出第0字节',
                  rungs:[[{op:'LD',addr:'Q0.0'},{op:'PNWR',addr:'0',addr2:'0',pv:1,addr3:'QB0'}]]},
                { comment:'Network 5 · SM0.5 闪烁灯 Q0.7',
                  rungs:[[{op:'LD',addr:'SM0.5'},{op:'A',addr:'Q0.0'},{op:'=',addr:'Q0.7'}]]},
                { comment:'Network 6 · 延时 3s（I0.2→T0→Q0.1）',
                  rungs:[
                    [{op:'LD',addr:'I0.2'},{op:'TON',addr:'T0',pv:30,timeBase:100}],
                    [{op:'LD',addr:'T0'},{op:'=',addr:'Q0.1'}],
                  ]},
            ]
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════════════

    _registerPorts() {
        for(let i=0;i<8;i++){const p=this._portPositions[`I0.${i}`];this.addPort(p.x,p.y,`I0.${i}`,'wire','p');}
        for(let i=0;i<4;i++){const p=this._portPositions[`I1.${i}`];this.addPort(p.x,p.y,`I1.${i}`,'wire','p');}
        for(let i=0;i<8;i++){const p=this._portPositions[`Q0.${i}`];this.addPort(p.x,p.y,`Q0.${i}`,'wire');}
        const pwr=this._portPositions['PWR_IN']; this.addPort(pwr.x,pwr.y,'PWR_IN','wire','p');
        const bus=this._portPositions['BUS_R'];  this.addPort(bus.x,bus.y,'BUS_R','bus');
        const pnp1=this._portPositions['PN_P1']; this.addPort(pnp1.x,pnp1.y,'PN_P1','bus');
        const pnp2=this._portPositions['PN_P2']; this.addPort(pnp2.x,pnp2.y,'PN_P2','bus');
        const eths7=this._portPositions['ETH_S7']; this.addPort(eths7.x,eths7.y,'ETH_S7','bus');
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
        this._drawTopBar();
        this._drawCommPorts();
        this._drawBusRight();
        this._drawTerminalBlock();
        this._drawDINRail();
        this._drawIOLabels();
        this._drawPortLabels();
        this._drawNameplate();
        this._drawVentSlots();
    }

    _drawBody() {
        const b=this._body;
        this._staticGroup.add(new Konva.Rect({x:b.x,y:b.y,width:b.w,height:b.h,fill:'#d8d8d8',stroke:'#888',strokeWidth:1.5,cornerRadius:b.rx,shadowColor:'#000',shadowBlur:8,shadowOffsetX:2,shadowOffsetY:3,shadowOpacity:0.25}));
        this._staticGroup.add(new Konva.Rect({x:b.w-6,y:4,width:4,height:b.h-8,fill:'rgba(255,255,255,0.35)',cornerRadius:[0,b.rx,b.rx,0]}));
        this._staticGroup.add(new Konva.Rect({x:0,y:4,width:4,height:b.h-8,fill:'rgba(0,0,0,0.10)',cornerRadius:[b.rx,0,0,b.rx]}));
    }

    _drawTopBar() {
        const W=this.width, H=this.height;
        this._staticGroup.add(new Konva.Rect({x:0,y:0,width:W,height:H*0.09,fill:'#1a6fa8',cornerRadius:[4,4,0,0]}));
        this._staticGroup.add(new Konva.Text({x:6,y:H*0.010,text:'SIMATIC',fontSize:Math.max(7,H*0.030),fontFamily:'Arial Narrow, Arial, sans-serif',fontStyle:'bold',fill:'#ffffff',letterSpacing:1}));
        this._staticGroup.add(new Konva.Text({x:6,y:H*0.048,text:'S7-200 SMART',fontSize:Math.max(5,H*0.022),fontFamily:'Arial Narrow, Arial, sans-serif',fill:'#b8d8f0',letterSpacing:0.5}));
        // PROFINET 标志（右上角绿色三角形网格图标简化版）
        const H_=this.height;
        this._staticGroup.add(new Konva.Text({x:W*0.75,y:H*0.008,text:'PROFINET',fontSize:Math.max(5,H*0.018),fontFamily:'Arial Narrow',fontStyle:'bold',fill:'#44dd88',letterSpacing:0.5}));
        // 三角网格符号（简化）
        this._staticGroup.add(new Konva.RegularPolygon({x:W*0.905,y:H*0.047,sides:3,radius:H*0.028,fill:'#44dd88',stroke:'#22aa66',strokeWidth:0.8}));
    }

    _drawCommPorts() {
        const W=this.width, H=this.height;
        // ── 普通 ETH ──
        const e=this._ethPort;
        this._staticGroup.add(new Konva.Rect({x:e.x,y:e.y,width:e.w,height:e.h,fill:'#2a2a2a',stroke:'#555',strokeWidth:1,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:e.x,y:e.y+e.h+2,text:'ETH',fontSize:Math.max(5,H*0.020),fontFamily:'Arial',fill:'#555',align:'center',width:e.w}));
        // ── RS-485 ──
        const r=this._rsPort;
        this._staticGroup.add(new Konva.Rect({x:r.x,y:r.y,width:r.w,height:r.h,fill:'#2a2a2a',stroke:'#555',strokeWidth:1,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:r.x,y:r.y+r.h+2,text:'485',fontSize:Math.max(5,H*0.020),fontFamily:'Arial',fill:'#555',align:'center',width:r.w}));
        // ── PN P1 ──
        const p1=this._pnP1Port;
        this._staticGroup.add(new Konva.Rect({x:p1.x,y:p1.y,width:p1.w,height:p1.h,fill:'#1a2820',stroke:'#2a5a38',strokeWidth:1.2,cornerRadius:2}));
        // P1 内部金属触点（8针 RJ45）
        for(let k=0;k<8;k++){
            this._staticGroup.add(new Konva.Rect({x:p1.x+p1.w*(0.10+k*0.106),y:p1.y+p1.h*0.20,width:p1.w*0.070,height:p1.h*0.55,fill:'#c8c060'}));
        }
        this._staticGroup.add(new Konva.Text({x:p1.x,y:p1.y+p1.h+2,text:'PN P1',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fontStyle:'bold',fill:'#44aa66',align:'center',width:p1.w}));
        // ── PN P2 ──
        const p2=this._pnP2Port;
        this._staticGroup.add(new Konva.Rect({x:p2.x,y:p2.y,width:p2.w,height:p2.h,fill:'#1a2820',stroke:'#2a5a38',strokeWidth:1.2,cornerRadius:2}));
        for(let k=0;k<8;k++){
            this._staticGroup.add(new Konva.Rect({x:p2.x+p2.w*(0.10+k*0.106),y:p2.y+p2.h*0.20,width:p2.w*0.070,height:p2.h*0.55,fill:'#c8c060'}));
        }
        this._staticGroup.add(new Konva.Text({x:p2.x,y:p2.y+p2.h+2,text:'PN P2',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fontStyle:'bold',fill:'#44aa66',align:'center',width:p2.w}));
        // ── 旋钮 ──
        const k=this._modeKnob;
        this._staticGroup.add(new Konva.Circle({x:k.x,y:k.y,radius:k.r,fill:'#333',stroke:'#222',strokeWidth:1}));
        this._staticGroup.add(new Konva.Text({x:k.x+k.r+3,y:k.y-H*0.018,text:'RUN\nSTOP',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fill:'#444',lineHeight:1.4}));
    }

    _drawBusRight() {
        const W=this.width, H=this.height, br=this._busRight;
        this._staticGroup.add(new Konva.Rect({x:br.x-2,y:br.y,width:br.w+2,height:br.h,fill:'#2a2a30',stroke:'#555',strokeWidth:1,cornerRadius:[0,2,2,0]}));
        for(let i=0;i<5;i++){
            this._staticGroup.add(new Konva.Circle({x:br.x+br.w-2,y:br.y+br.h*(0.15+i*0.175),radius:1.5,fill:'#c8b040'}));
        }
        this._staticGroup.add(new Konva.Text({x:br.x-2,y:br.y+br.h+2,text:'BUS',fontSize:Math.max(5,H*0.016),fontFamily:'Arial',fill:'#6090b0'}));
    }

    _drawTerminalBlock() {
        const W=this.width, H=this.height;
        const it=this._inputTerminals;
        this._staticGroup.add(new Konva.Rect({x:it.x,y:it.y,width:it.w,height:it.h,fill:'#333',stroke:'#222',strokeWidth:1,cornerRadius:2}));
        for(let i=0;i<12;i++){const tx=it.x+it.w*(0.03+i*0.079);this._staticGroup.add(new Konva.Rect({x:tx,y:it.y+it.h*0.15,width:it.w*0.055,height:it.h*0.70,fill:'#888',stroke:'#666',strokeWidth:0.5,cornerRadius:1}));}
        this._staticGroup.add(new Konva.Text({x:it.x+it.w*0.38,y:it.y-H*0.030,text:'INPUT',fontSize:Math.max(6,H*0.022),fontFamily:'Arial',fontStyle:'bold',fill:'#2a7fbf'}));
        const ot=this._outputTerminals;
        this._staticGroup.add(new Konva.Rect({x:ot.x,y:ot.y,width:ot.w,height:ot.h,fill:'#333',stroke:'#222',strokeWidth:1,cornerRadius:2}));
        for(let i=0;i<8;i++){const tx=ot.x+ot.w*(0.04+i*0.122);this._staticGroup.add(new Konva.Rect({x:tx,y:ot.y+ot.h*0.15,width:ot.w*0.08,height:ot.h*0.70,fill:'#888',stroke:'#666',strokeWidth:0.5,cornerRadius:1}));}
        this._staticGroup.add(new Konva.Text({x:ot.x+ot.w*0.25,y:ot.y-H*0.030,text:'OUTPUT',fontSize:Math.max(6,H*0.022),fontFamily:'Arial',fontStyle:'bold',fill:'#bf5c2a'}));
    }

    _drawDINRail() {
        const dr=this._dinRail;
        this._staticGroup.add(new Konva.Rect({x:dr.x,y:dr.y,width:dr.w,height:dr.h,fill:'#b0b0b0',stroke:'#888',strokeWidth:0.5,cornerRadius:[0,0,4,4]}));
        [0.08,0.88].forEach(px=>{this._staticGroup.add(new Konva.Rect({x:dr.x+dr.w*px,y:dr.y,width:dr.w*0.06,height:dr.h*0.60,fill:'#777',stroke:'#555',strokeWidth:0.5,cornerRadius:[0,0,2,2]}));});
    }

    _drawIOLabels() {
        const W=this.width, H=this.height;
        this._staticGroup.add(new Konva.Text({x:W*0.02,y:H*0.315,text:'I :',fontSize:Math.max(6,H*0.025),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#2a7fbf'}));
        this._staticGroup.add(new Konva.Text({x:W*0.02,y:H*0.408,text:'I1:',fontSize:Math.max(6,H*0.025),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#2a7fbf'}));
        this._staticGroup.add(new Konva.Text({x:W*0.02,y:H*0.516,text:'Q :',fontSize:Math.max(6,H*0.025),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#bf5c2a'}));
    }

    _drawPortLabels() {
        const W=this.width, H=this.height;
        for(let i=0;i<8;i++) this._staticGroup.add(new Konva.Text({x:W*(0.028+i*0.115),y:H*0.368,text:`.${i}`,fontSize:Math.max(5,H*0.018),fontFamily:'Consolas, monospace',fill:'#2a7fbf'}));
        for(let i=0;i<4;i++) this._staticGroup.add(new Konva.Text({x:W*(0.028+i*0.115),y:H*0.460,text:`.${i}`,fontSize:Math.max(5,H*0.018),fontFamily:'Consolas, monospace',fill:'#2a7fbf'}));
        for(let i=0;i<8;i++) this._staticGroup.add(new Konva.Text({x:W*(0.028+i*0.115),y:H*0.567,text:`.${i}`,fontSize:Math.max(5,H*0.018),fontFamily:'Consolas, monospace',fill:'#bf5c2a'}));
    }

    _drawNameplate() {
        const np=this._nameplate;
        this._staticGroup.add(new Konva.Rect({x:np.x,y:np.y,width:np.w,height:np.h,fill:'#f5f0e0',stroke:'#aaa',strokeWidth:0.8,cornerRadius:2}));
        this._staticGroup.add(new Konva.Text({x:np.x+4,y:np.y+3,text:'CPU ST20',fontSize:Math.max(8,this.height*0.036),fontFamily:'Arial Narrow, Arial, sans-serif',fontStyle:'bold',fill:'#1a1a1a'}));
        this._staticGroup.add(new Konva.Text({x:np.x+4,y:np.y+np.h*0.53,text:'6ES7 288-1ST20-0AA0',fontSize:Math.max(5,this.height*0.018),fontFamily:'Consolas, monospace',fill:'#555'}));
    }

    _drawVentSlots() {
        this._ventSlots.forEach(vs=>{
            this._staticGroup.add(new Konva.Rect({x:vs.x,y:vs.y,width:vs.w,height:vs.h,fill:'#bbb',stroke:'#999',strokeWidth:0.5,cornerRadius:1}));
        });
    }

    // ── 动态部件 ─────────────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawLEDs();
        this._drawRunIndicator();
        this._drawPNLEDs();
        this._drawPNInfoPanel();
        this._drawModeKnob();
        this._drawScanInfo();
        this._drawLabelText();
    }

    _drawLEDs() {
        this._inputLEDs0.forEach(led=>{this._drawLED(led.x,led.y,led.r,!!(this._I[led.byte]&(1<<led.bit)),'input');});
        this._inputLEDs1.forEach(led=>{this._drawLED(led.x,led.y,led.r,!!(this._I[led.byte]&(1<<led.bit)),'input');});
        this._outputLEDs.forEach(led=>{this._drawLED(led.x,led.y,led.r,!!(this._Q[led.byte]&(1<<led.bit)),'output');});
    }

    _drawLED(x,y,r,on,type) {
        const colors={input:{on:'#f5c842',off:'#3a3000',glow:'#f5c842'},output:{on:'#f07030',off:'#3a1500',glow:'#f07030'},run:{on:'#44cc44',off:'#003300',glow:'#44cc44'},stop:{on:'#ee3333',off:'#330000',glow:'#ee3333'},error:{on:'#ff8800',off:'#331500',glow:'#ff8800'},pnok:{on:'#44dd88',off:'#003322',glow:'#44dd88'},pnact:{on:'#f07030',off:'#331500',glow:'#f07030'},pnerr:{on:'#ee3333',off:'#330000',glow:'#ee3333'}};
        const c=colors[type]||colors.input;
        this._dynamicGroup.add(new Konva.Circle({x,y,radius:r,fill:on?c.on:c.off,stroke:on?'#888':'#444',strokeWidth:0.8,shadowColor:on?c.glow:'transparent',shadowBlur:on?r*3:0,shadowOpacity:0.9}));
    }

    _drawRunIndicator() {
        const leds=this._leds, H=this.height;
        const isRun=this._running&&!this._errorState, isStop=!this._running&&!this._errorState, isErr=this._errorState;
        this._drawLED(leds.run.x,leds.run.y,leds.run.r,isRun,'run');
        this._dynamicGroup.add(new Konva.Text({x:leds.run.x+leds.run.r+3,y:leds.run.y-leds.run.r,text:'RUN',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fontStyle:'bold',fill:isRun?'#44cc44':'#555'}));
        this._drawLED(leds.stop.x,leds.stop.y,leds.stop.r,isStop,'stop');
        this._dynamicGroup.add(new Konva.Text({x:leds.stop.x+leds.stop.r+3,y:leds.stop.y-leds.stop.r,text:'STOP',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fontStyle:'bold',fill:isStop?'#ee3333':'#555'}));
        this._drawLED(leds.error.x,leds.error.y,leds.error.r,isErr,'error');
        this._dynamicGroup.add(new Konva.Text({x:leds.error.x+leds.error.r+3,y:leds.error.y-leds.error.r,text:'ERR',fontSize:Math.max(5,H*0.018),fontFamily:'Arial',fontStyle:'bold',fill:isErr?'#ff8800':'#555'}));
    }

    _drawPNLEDs() {
        const pn=this._pn, leds=this._pnLEDs, H=this.height;
        // P1 Link（绿色）
        this._drawLED(leds.p1Link.x,leds.p1Link.y,leds.p1Link.r,pn.p1.link,'pnok');
        // P1 ACT（橙色，数据活动）
        const p1ActBlink = pn.p1.link && (Math.floor(performance.now()/120)%2===0);
        this._drawLED(leds.p1Act.x,leds.p1Act.y,leds.p1Act.r,p1ActBlink,'pnact');
        // 总线状态（绿=OPERATE，红=ERROR/OFFLINE，橙=STARTUP）
        const busOn  = pn.state==='OPERATE';
        const busErr = pn.state==='OFFLINE'||pn.state==='STOP';
        const busTyp = busErr?'pnerr':busOn?'pnok':'pnact';
        this._drawLED(leds.pnBus.x,leds.pnBus.y,leds.pnBus.r,!busErr,'pnok');
        // P2 Link
        this._drawLED(leds.p2Link.x,leds.p2Link.y,leds.p2Link.r,pn.p2.link,'pnok');
        // P2 ACT
        const p2ActBlink = pn.p2.link && (Math.floor(performance.now()/180)%2===0);
        this._drawLED(leds.p2Act.x,leds.p2Act.y,leds.p2Act.r,p2ActBlink,'pnact');
        // LED 标签
        const ledLabelY = leds.p1Link.y + leds.p1Link.r + 2;
        const fs = Math.max(4,H*0.015);
        this._dynamicGroup.add(new Konva.Text({x:leds.p1Link.x-5,y:ledLabelY,text:'P1',fontSize:fs,fontFamily:'Arial',fontStyle:'bold',fill:'#44aa66'}));
        this._dynamicGroup.add(new Konva.Text({x:leds.pnBus.x-5,y:ledLabelY,text:'BUS',fontSize:fs,fontFamily:'Arial',fill:busOn?'#44dd88':'#777'}));
        this._dynamicGroup.add(new Konva.Text({x:leds.p2Link.x-5,y:ledLabelY,text:'P2',fontSize:fs,fontFamily:'Arial',fontStyle:'bold',fill:'#44aa66'}));
    }

    _drawPNInfoPanel() {
        const pn=this._pn, np=this._pnInfoPanel, H=this.height;
        // 背景
        this._dynamicGroup.add(new Konva.Rect({x:np.x,y:np.y,width:np.w,height:np.h,fill:'#0a1018',stroke:'#1a2a3a',strokeWidth:0.8,cornerRadius:2}));

        const stateColor  = {OPERATE:'#44dd88',STARTUP:'#f5c842',CLEAR:'#f07030',OFFLINE:'#555',STOP:'#ee3333'}[pn.state]||'#555';
        const fs          = Math.max(5,H*0.017);
        const onlineCount = pn.devices.filter(d=>d.online).length;

        this._dynamicGroup.add(new Konva.Text({x:np.x+3,y:np.y+2,text:`PN ${pn.mode==='controller'?'Ctrl':'Dev'} [${pn.state}]`,fontSize:Math.max(5,H*0.019),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:stateColor}));
        this._dynamicGroup.add(new Konva.Text({x:np.x+3,y:np.y+np.h*0.30,text:`IP: ${pn.ip}`,fontSize:fs,fontFamily:'Consolas, monospace',fill:'#4a6070'}));
        this._dynamicGroup.add(new Konva.Text({x:np.x+3,y:np.y+np.h*0.52,text:`Name: ${pn.stationName}`,fontSize:fs,fontFamily:'Consolas, monospace',fill:'#4a6070'}));
        this._dynamicGroup.add(new Konva.Text({x:np.x+3,y:np.y+np.h*0.74,
            text:`Dev:${onlineCount}/${pn.devices.length} Tx:${pn.txFrames} HMI:${this._s7.clients.length} Push:${this._s7.totalPushes}`,
            fontSize:Math.max(4,H*0.015),fontFamily:'Consolas, monospace',fill:'#2a9fd8'}));
    }

    _drawModeKnob() {
        const k=this._modeKnob, angle=this._running?-30:30, rad=angle*Math.PI/180;
        this._dynamicGroup.add(new Konva.Line({points:[k.x,k.y,k.x+Math.sin(rad)*k.r*0.65,k.y-Math.cos(rad)*k.r*0.65],stroke:this._running?'#44cc44':'#ee3333',strokeWidth:1.5,lineCap:'round'}));
        this._dynamicGroup.add(new Konva.Circle({x:k.x,y:k.y,radius:k.r*0.25,fill:'#888'}));
    }

    _drawScanInfo() {
        const W=this.width, H=this.height;
        // S7 SCADA 连接指示
        const s7Cnt=this._s7.clients.length;
        if(s7Cnt>0){
            this._dynamicGroup.add(new Konva.Circle({x:W*0.092,y:H*0.215,radius:H*0.015,fill:'#2a9fd8',shadowColor:'#2a9fd8',shadowBlur:4,shadowOpacity:0.9}));
            this._dynamicGroup.add(new Konva.Text({x:W*0.110,y:H*0.207,text:`HMI:${s7Cnt}`,fontSize:Math.max(4,H*0.017),fontFamily:'Consolas, monospace',fontStyle:'bold',fill:'#2a9fd8'}));
        } else {
            this._dynamicGroup.add(new Konva.Circle({x:W*0.092,y:H*0.215,radius:H*0.015,fill:'#1a2030',stroke:'#2a3a50',strokeWidth:0.8}));
            this._dynamicGroup.add(new Konva.Text({x:W*0.110,y:H*0.207,text:'S7',fontSize:Math.max(4,H*0.017),fontFamily:'Consolas, monospace',fill:'#2a3a50'}));
        }
        if(this._running){
            this._dynamicGroup.add(new Konva.Text({x:W*0.54,y:H*0.375,text:`#${this._scanCount}`,fontSize:Math.max(5,H*0.018),fontFamily:'Consolas, monospace',fill:'#2a9'}));
        }
        // 扩展模块状态
        if(this._expansionSlots.length>0){
            const txt=this._expansionSlots.map(s=>s.type.replace('s7200_smart_','').toUpperCase().slice(0,4)).join(' ');
            this._dynamicGroup.add(new Konva.Text({x:W*0.54,y:H*0.396,text:`EXP:${txt}`,fontSize:Math.max(4,H*0.016),fontFamily:'Consolas, monospace',fill:'#2a8aaa'}));
        }
    }

    _drawLabelText() {
        const W=this.width, H=this.height;
        this._dynamicGroup.add(new Konva.Text({x:W*0.54,y:H*0.345,text:this.label,fontSize:Math.max(8,H*0.030),fontFamily:'Arial',fontStyle:'bold',fill:'#1a4f7a'}));
    }

    // ── 交互 ─────────────────────────────────────────────────────────

    _bindInteraction() {
        const knobHit=new Konva.Circle({x:this._modeKnob.x,y:this._modeKnob.y,radius:this._modeKnob.r*2,fill:'transparent'});
        knobHit.on('click tap',()=>this.toggleRun()); this._interactGroup.add(knobHit);
        this._inputLEDs0.forEach(led=>{const hit=new Konva.Circle({x:led.x,y:led.y,radius:led.r*3,fill:'transparent'});hit.on('click tap',()=>this.toggleInput(led.byte,led.bit));this._interactGroup.add(hit);});
        this._inputLEDs1.forEach(led=>{const hit=new Konva.Circle({x:led.x,y:led.y,radius:led.r*3,fill:'transparent'});hit.on('click tap',()=>this.toggleInput(led.byte,led.bit));this._interactGroup.add(hit);});
        // PN P1/P2 端口点击：切换 PROFINET
        const p1=this._pnP1Port;
        const hitP1=new Konva.Rect({x:p1.x,y:p1.y,width:p1.w,height:p1.h,fill:'transparent'});
        hitP1.on('click tap',()=>{if(this._pn.state==='OFFLINE')this.pnStart();else this.pnStop();});
        this._interactGroup.add(hitP1);
    }

    // ═══════════════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════════════

    tick(dt) {
        const dtMs=dt*1000;

        this._tickSM(dtMs);
        this._tickTimers(dtMs);

        // PROFINET 调度
        this._pnTickScheduler();
        this._pnTickStartup(dtMs);
        this._pnCycleExchange(dtMs);

        if (this._running) {
            this._accumMs += dtMs;
            if (this._accumMs >= this._scanCycleMs) {
                this._accumMs -= this._scanCycleMs;
                // 扩展模块采样
                this._expansionSlots.forEach(entry=>{
                    if(entry.module && typeof entry.module._pushToCPU==='function') entry.module._pushToCPU();
                });
                this._execScan();
                // 扩展模块输出刷新
                this._expansionSlots.forEach(entry=>{
                    if(entry.module && typeof entry.module._pollCPU==='function') entry.module._pollCPU();
                });
                this._rebuildDynamic();
                this.markDirty();
            }
        }

        // 扩展模块自身 tick
        this._expansionSlots.forEach(entry=>{
            if(entry.module && typeof entry.module.tick==='function') entry.module.tick(dt);
        });

        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════════════

    toggleRun() {
        if(this._errorState){this._errorState=false;this._errorMsg='';}
        this._running=!this._running;
        if(this._running){this._firstScan=true;this._accumMs=0;}
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }
    run()  { if(!this._running) this.toggleRun(); }
    stop() { if(this._running)  this.toggleRun(); }
    toggleInput(byteN,bitN) { this._I[byteN]^=(1<<bitN); this._rebuildDynamic(); this.markDirty(); }
    setInput(byteN,bitN,val) { if(val)this._I[byteN]|=(1<<bitN);else this._I[byteN]&=~(1<<bitN); }
    getOutput(byteN,bitN) { return !!(this._Q[byteN]&(1<<bitN)); }

    readAIW(ch) { const off=ch*2,r=(this._AIW[off]<<8)|this._AIW[off+1];return r>32767?r-65536:r; }
    writeAQW(ch,val) { const off=ch*2;val=Math.max(-32768,Math.min(32767,Math.round(val)));const u=val<0?val+65536:val;this._AQW[off]=(u>>8)&0xFF;this._AQW[off+1]=u&0xFF; }
    readAQW(ch) { const off=ch*2,r=(this._AQW[off]<<8)|this._AQW[off+1];return r>32767?r-65536:r; }
    getVD(addr) { return this.readReal(`VD${addr}`); }
    setVD(addr,val) { this._writeReal(`VD${addr}`,val); }

    loadProgram(prog) {
        const wasRunning=this._running; this._running=false;
        try { this._program=typeof prog==='string'?JSON.parse(prog):prog;this._scanCount=0;this._firstScan=true;this._errorState=false;this._errorMsg='';this.config.ladderProgram=JSON.stringify(this._program); }
        catch(e) { this._errorState=true;this._errorMsg=`程序格式错误：${e.message}`; }
        if(wasRunning&&!this._errorState)this._running=true;
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    getMemorySnapshot() {
        return {
            I:Array.from(this._I.slice(0,10)),Q:Array.from(this._Q.slice(0,5)),M:Array.from(this._M.slice(0,8)),
            AIW:Array.from(this._AIW.slice(0,16)),AQW:Array.from(this._AQW.slice(0,16)),
            T:this._T.slice(0,16).map(t=>({cv:t.cv,pv:t.pv,bit:t.bit})),
            C:this._C.slice(0,16).map(c=>({cv:c.cv,pv:c.pv,bit:c.bit})),
            pn: {
                state:       this._pn.state,
                devices:     this._pn.devices.map(d=>({slot:d.slot,name:d.deviceName,online:d.online,txCount:d.txCount,rxCount:d.rxCount})),
                txFrames:    this._pn.txFrames,
                rxFrames:    this._pn.rxFrames,
                cycleUs:     this._pn.measuredCycleUs,
                mrpState:    this._pn.mrpState,
                diagBuffer:  this._pn.diagBuffer.slice(0,10),
            },
        };
    }

    reset() {
        this._running=false; this._initMemory(); if(this._pidState)this._pidState.forEach(s=>{s.Ix=0;s.ePrev=0;s.pvPrev=0;s.active=false;});
        this._scanCount=0;this._firstScan=true;this._errorState=false;this._errorMsg='';this._accumMs=0;this._labelCache={};
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    isRunning()    { return this._running; }
    hasError()     { return this._errorState; }
    getError()     { return this._errorMsg; }
    getScanCount() { return this._scanCount; }

    // PROFINET 专用 API
    pnGetState()       { return this._pn.state; }
    pnGetDevices()     { return this._pn.devices; }
    pnGetDiagBuffer()  { return this._pn.diagBuffer; }
    pnGetStats()       { return { txFrames:this._pn.txFrames, rxFrames:this._pn.rxFrames, missedCycles:this._pn.missedCycles, cycleUs:this._pn.measuredCycleUs, mrpState:this._pn.mrpState }; }
    pnIsOperating()    { return this._pn.state === 'OPERATE'; }
    pnGetExpansionInfo() { return this._expansionSlots.map(s=>({slot:s.slot,type:s.type})); }

    // ═══════════════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label:'位号',              key:'label',          type:'text'     },
            { label:'扫描周期 (ms)',      key:'scanCycleMs',    type:'number'   },
            { label:'梯形图程序 (JSON)',  key:'ladderProgram',  type:'textarea' },
            { label:'PN 站名',           key:'pnStationName',  type:'text'     },
            { label:'PN IP 地址',        key:'pnIP',           type:'text'     },
            { label:'PN 子网掩码',       key:'pnSubnet',       type:'text'     },
            { label:'PN 网关',           key:'pnGateway',      type:'text'     },
            { label:'PN 模式',           key:'pnMode',         type:'select',  options:['controller','device'] },
            { label:'PN 发送时钟 (ms)',  key:'pnSendClockMs',  type:'number'   },
            { label:'PN MRP 使能',       key:'pnMRPEnabled',   type:'number'   },
            { label:'PN MRP 角色',       key:'pnMRPRole',      type:'select',  options:['manager','client'] },
            { label:'SCADA Channel 名',   key:'scadaChannelName',    type:'text'   },
            { label:'SCADA 推送间隔(ms)', key:'scadaPushIntervalMs', type:'number' },
            { label:'SCADA 写入权限',     key:'scadaWriteEnabled',   type:'number' },
        ];
    }

    onConfigUpdate(cfg) {
        if(cfg.label          !==undefined) this.label=cfg.label;
        if(cfg.scanCycleMs    !==undefined) this._scanCycleMs=Math.max(1,parseFloat(cfg.scanCycleMs));
        if(cfg.ladderProgram  !==undefined) this.loadProgram(cfg.ladderProgram);
        if(cfg.pnStationName  !==undefined) this._pn.stationName=cfg.pnStationName;
        if(cfg.pnIP           !==undefined) this._pn.ip=cfg.pnIP;
        if(cfg.pnSubnet       !==undefined) this._pn.subnet=cfg.pnSubnet;
        if(cfg.pnGateway      !==undefined) this._pn.gateway=cfg.pnGateway;
        if(cfg.pnMode         !==undefined) this._pn.mode=cfg.pnMode;
        if(cfg.pnSendClockMs  !==undefined) this._pn.sendClockMs=Math.max(0.25,parseFloat(cfg.pnSendClockMs)||1);
        if(cfg.pnMRPEnabled   !==undefined) this._pn.mrpEnabled=!!parseInt(cfg.pnMRPEnabled);
        if(cfg.pnMRPRole          !==undefined) this._pn.mrpRole=cfg.pnMRPRole;
        if(cfg.scadaChannelName    !==undefined) this._s7.channelName=cfg.scadaChannelName;
        if(cfg.scadaPushIntervalMs !==undefined) this._s7.pushIntervalMs=Math.max(10,parseFloat(cfg.scadaPushIntervalMs)||50);
        if(cfg.scadaWriteEnabled   !==undefined) this._s7.writeEnabled=!!parseInt(cfg.scadaWriteEnabled);
        this.config={...this.config,...cfg};
        this._recalcGeometry();
        this._refreshCache();
    }

    // ═══════════════════════════════════════════════════════════════
    // SCADA/HMI 通信层  —  S7 Communication Server
    // ═══════════════════════════════════════════════════════════════

    // ── 初始化 ─────────────────────────────────────────────────────

    _initSCADA(config) {
        this._s7 = {
            // 配置
            channelName:     config.scadaChannelName    || 'st20_scada_bus',
            maxClients:      config.scadaMaxClients      !== undefined ? config.scadaMaxClients      : 8,
            pushIntervalMs:  config.scadaPushIntervalMs  !== undefined ? config.scadaPushIntervalMs  : 50,
            writeEnabled:    config.scadaWriteEnabled    !== undefined ? !!config.scadaWriteEnabled   : true,
            autoAccept:      config.scadaAutoAccept      !== undefined ? !!config.scadaAutoAccept     : true,
            password:        config.scadaPassword        || '',

            // 会话状态
            clients:         [],       // 已连接的 SCADA/HMI 实例 + Channel 虚拟会话
            requestQueue:    [],       // 待处理请求 FIFO
            subscriptions:   [],       // 订阅表

            // 数据推送
            pushAccumMs:     0,
            totalPushes:     0,
            lastPushTs:      0,
            lastSnapshot:    null,     // 上次推送的存储区快照（用于变化检测）

            // 强制写入表（不受程序覆盖）
            forceTable:      {},       // { 'Q0.0': true, 'VD0': 3.14, … }

            // 统计
            totalRxRequests: 0,
            totalTxResponses:0,
            totalTxBytes:    0,
            totalRxBytes:    0,

            // 诊断缓冲区（S7 层）
            diagLog:         [],

            // 下载进度
            downloadProg:    null,
            downloadTimer:   0,
        };

        // 建立 BroadcastChannel（跨标签页通信）
        this._s7BroadcastChannel = null;
        try {
            this._s7BroadcastChannel = new BroadcastChannel(this._s7.channelName);
            this._s7BroadcastChannel.onmessage = (e) => this._s7OnChannelMessage(e.data);
            this._s7Log('info', `BroadcastChannel '${this._s7.channelName}' 已就绪`);
        } catch(e) {
            this._s7Log('warn', 'BroadcastChannel 不可用（降级为直连模式）');
        }

        // 初始化快照（全零基线）
        this._s7.lastSnapshot = this._s7TakeSnapshot();
    }

    // ── BroadcastChannel 消息处理 ─────────────────────────────────

    _s7OnChannelMessage(msg) {
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case 'scada_connect':
                this._s7HandleChannelConnect(msg);
                break;
            case 'scada_disconnect':
                this._s7HandleChannelDisconnect(msg.clientId);
                break;
            case 'scada_request':
                this._s7EnqueueRequest({ ...msg.req, clientId: msg.clientId, via: 'channel' });
                break;
            case 'scada_ping':
                this._s7BroadcastChannel?.postMessage({
                    type: 'st20_pong',
                    ts:   performance.now(),
                    state: { running: this._running, scanCount: this._scanCount },
                });
                break;
        }
    }

    _s7HandleChannelConnect(msg) {
        const clientId = msg.clientId || this._s7GenId();
        // 检查密码
        if (this._s7.password && msg.password !== this._s7.password) {
            this._s7BroadcastChannel?.postMessage({
                type: 's7_connect_ack', clientId,
                ok: false, reason: 'WRONG_PASSWORD',
            });
            return;
        }
        if (this._s7.clients.length >= this._s7.maxClients) {
            this._s7BroadcastChannel?.postMessage({
                type: 's7_connect_ack', clientId,
                ok: false, reason: 'MAX_CLIENTS',
            });
            return;
        }
        const session = this._s7CreateSession(clientId, msg.clientName || 'Channel-Client', msg.clientIP || '?', 'channel');
        this._s7Log('info', `Channel 客户端连接: ${session.name} (${clientId})`);
        this._s7BroadcastChannel?.postMessage({
            type: 's7_connect_ack', clientId, ok: true,
            serverInfo: this._s7GetServerInfo(),
        });
        this._rebuildDynamic(); this.markDirty();
    }

    _s7HandleChannelDisconnect(clientId) {
        const idx = this._s7.clients.findIndex(c => c.id === clientId);
        if (idx >= 0) {
            this._s7Log('info', `Channel 客户端断开: ${this._s7.clients[idx].name}`);
            this._s7.clients.splice(idx, 1);
            this._s7.subscriptions = this._s7.subscriptions.filter(s => s.clientId !== clientId);
            this._rebuildDynamic(); this.markDirty();
        }
    }

    // ── 会话管理 ─────────────────────────────────────────────────────

    _s7CreateSession(id, name, ip, via) {
        const session = {
            id, name, ip, via,
            connectedAt:   performance.now(),
            lastActivity:  performance.now(),
            txBytes:       0,
            rxBytes:       0,
            subscriptions: [],
            ref:           null,   // 直连时为 SCADA 组件实例引用
        };
        this._s7.clients.push(session);
        return session;
    }

    _s7GetSession(clientId) {
        return this._s7.clients.find(c => c.id === clientId) || null;
    }

    // ── 请求队列 ─────────────────────────────────────────────────────

    _s7EnqueueRequest(req) {
        this._s7.requestQueue.push(req);
        this._s7.totalRxRequests++;
    }

    _s7ProcessQueue() {
        // 每次最多处理 8 条请求（避免阻塞 tick）
        const toProcess = this._s7.requestQueue.splice(0, 8);
        toProcess.forEach(req => {
            try {
                const result = this._s7ExecuteRequest(req);
                if (req.callback) req.callback(null, result);
                // Channel 回应
                if (req.via === 'channel' && this._s7BroadcastChannel) {
                    this._s7BroadcastChannel.postMessage({
                        type: 's7_response',
                        clientId:  req.clientId,
                        requestId: req.requestId,
                        ok:        true,
                        result,
                    });
                }
                this._s7.totalTxResponses++;
            } catch(e) {
                if (req.callback) req.callback(e, null);
                if (req.via === 'channel' && this._s7BroadcastChannel) {
                    this._s7BroadcastChannel.postMessage({
                        type: 's7_response',
                        clientId:  req.clientId,
                        requestId: req.requestId,
                        ok:        false,
                        error:     e.message,
                    });
                }
            }
            // 更新会话活动时间
            const sess = this._s7GetSession(req.clientId);
            if (sess) sess.lastActivity = performance.now();
        });
    }

    _s7ExecuteRequest(req) {
        const type = (req.type || '').toUpperCase();

        switch (type) {
            // ── READ ────────────────────────────────────────────────
            case 'READ': {
                const addr = req.addr || '';
                if (addr.startsWith('VD'))           return { addr, value: this.readReal(addr), type: 'REAL' };
                if (addr.match(/^[IQMV][WBD]/i))     return { addr, value: this._readWord(addr), type: 'INT' };
                if (addr.match(/^AIW|AQW/i))          return { addr, value: this._readWord(addr), type: 'INT' };
                if (addr.match(/^[TC]\d+$/))          return { addr, value: this._readWord(addr), type: 'INT' };
                return { addr, value: this._readBit(addr), type: 'BOOL' };
            }

            // ── READ_AREA（批量读取）───────────────────────────────
            case 'READ_AREA': {
                const area  = (req.area || 'V').toUpperCase();
                const start = req.start || 0;
                const len   = Math.min(req.length || 4, 256);
                let data = [];
                const getArr = () => {
                    if (area==='I')   return this._I;
                    if (area==='Q')   return this._Q;
                    if (area==='M')   return this._M;
                    if (area==='V')   return this._V;
                    if (area==='AIW') return this._AIW;
                    if (area==='AQW') return this._AQW;
                    return this._V;
                };
                const arr = getArr();
                for (let i = start; i < start + len && i < arr.length; i++) data.push(arr[i]);
                return { area, start, length: data.length, data };
            }

            // ── WRITE ────────────────────────────────────────────────
            case 'WRITE': {
                if (!this._s7.writeEnabled) throw new Error('写入权限已关闭');
                const addr = req.addr || '';
                const val  = req.value;
                if (addr.startsWith('VD')) {
                    this._writeReal(addr, parseFloat(val)||0);
                } else if (addr.match(/^AQW|VW|MW/i)) {
                    this._writeWord(addr, parseInt(val)||0);
                } else {
                    this._writeBit(addr, !!val);
                }
                return { addr, written: val };
            }

            // ── WRITE_AREA ──────────────────────────────────────────
            case 'WRITE_AREA': {
                if (!this._s7.writeEnabled) throw new Error('写入权限已关闭');
                const area  = (req.area || 'V').toUpperCase();
                const start = req.start || 0;
                const data  = req.data  || [];
                const getArr = () => {
                    if (area==='Q')   return this._Q;
                    if (area==='M')   return this._M;
                    if (area==='V')   return this._V;
                    if (area==='AQW') return this._AQW;
                    return null;
                };
                const arr = getArr();
                if (!arr) throw new Error(`区域 ${area} 不可写`);
                data.forEach((v, i) => { if (start + i < arr.length) arr[start + i] = v & 0xFF; });
                return { area, start, written: data.length };
            }

            // ── FORCE ────────────────────────────────────────────────
            case 'FORCE': {
                if (!this._s7.writeEnabled) throw new Error('写入权限已关闭');
                this._s7.forceTable[req.addr] = req.value;
                this._s7Log('warn', `强制: ${req.addr} = ${req.value}`);
                return { addr: req.addr, forced: req.value };
            }

            // ── UNFORCE ──────────────────────────────────────────────
            case 'UNFORCE': {
                delete this._s7.forceTable[req.addr];
                return { addr: req.addr, unforced: true };
            }

            // ── CTRL（CPU 控制）──────────────────────────────────────
            case 'CPU_RUN':  this.run();   this._s7Log('info', 'SCADA → CPU RUN');  return { state: 'RUN'  };
            case 'CPU_STOP': this.stop();  this._s7Log('info', 'SCADA → CPU STOP'); return { state: 'STOP' };
            case 'CPU_RESET':this.reset(); this._s7Log('info', 'SCADA → CPU RESET');return { state: 'RESET'};

            // ── LOAD_PROGRAM ─────────────────────────────────────────
            case 'LOAD_PROGRAM': {
                if (!this._s7.writeEnabled) throw new Error('写入权限已关闭');
                const prog = req.program || req.data;
                if (!prog) throw new Error('无程序数据');
                this._s7.downloadProg  = prog;
                this._s7.downloadTimer = 800 + (JSON.stringify(prog).length / 50);  // 仿真下载延迟
                this._s7Log('info', `接收程序下载请求（${JSON.stringify(prog).length} 字节）`);
                return { accepted: true, estimatedMs: this._s7.downloadTimer };
            }

            // ── GET_PROGRAM ──────────────────────────────────────────
            case 'GET_PROGRAM': {
                return { program: JSON.parse(JSON.stringify(this._program)), name: this._program?.name || 'OB1' };
            }

            // ── GET_SNAPSHOT ─────────────────────────────────────────
            case 'GET_SNAPSHOT': {
                return this._s7TakeFullSnapshot();
            }

            // ── SUBSCRIBE ────────────────────────────────────────────
            case 'SUBSCRIBE': {
                const areas    = req.areas    || ['I','Q','M','V','AIW','AQW'];
                const interval = req.interval || this._s7.pushIntervalMs;
                // 移除旧订阅
                this._s7.subscriptions = this._s7.subscriptions.filter(s => s.clientId !== req.clientId);
                this._s7.subscriptions.push({ clientId: req.clientId, areas, minIntervalMs: interval });
                return { subscribed: true, areas, interval };
            }

            // ── UNSUBSCRIBE ───────────────────────────────────────────
            case 'UNSUBSCRIBE': {
                this._s7.subscriptions = this._s7.subscriptions.filter(s => s.clientId !== req.clientId);
                return { unsubscribed: true };
            }

            // ── READ_SZL（系统状态列表）────────────────────────────────
            case 'READ_SZL': {
                return this._s7ReadSZL(req.id || 0x0011);
            }

            // ── SET_PID_SP ───────────────────────────────────────────
            case 'SET_SP': {
                if (!this._s7.writeEnabled) throw new Error('写入权限已关闭');
                const loop = req.loop !== undefined ? req.loop : 0;
                const val  = parseFloat(req.value) || 0;
                this._writeReal(`VD${loop * 36 + 4}`, val);
                this._s7Log('info', `PID Loop${loop} SP = ${val}`);
                return { loop, sp: val };
            }

            // ── PN 控制 ──────────────────────────────────────────────
            case 'PN_START':    this.pnStart();          return { pnState: this._pn.state };
            case 'PN_STOP':     this.pnStop();           return { pnState: this._pn.state };
            case 'PN_DISCOVER': this.pnDiscoverDevices();return { triggered: true };

            // ── PING ─────────────────────────────────────────────────
            case 'PING': return { pong: true, ts: performance.now(), scanCount: this._scanCount };

            default: throw new Error(`未知请求类型: ${type}`);
        }
    }

    // ── 快照构建 ──────────────────────────────────────────────────────

    _s7TakeSnapshot() {
        return {
            I:   new Uint8Array(this._I.slice(0,10)),
            Q:   new Uint8Array(this._Q.slice(0,5)),
            M:   new Uint8Array(this._M.slice(0,32)),
            V:   new Uint8Array(this._V.slice(0,256)),    // 仅监控前256字节（性能优化）
            AIW: new Uint8Array(this._AIW.slice(0,16)),
            AQW: new Uint8Array(this._AQW.slice(0,16)),
            T:   this._T.slice(0,16).map(t=>({ cv:t.cv, bit:t.bit })),
            C:   this._C.slice(0,16).map(c=>({ cv:c.cv, bit:c.bit })),
        };
    }

    _s7TakeFullSnapshot() {
        return {
            I:        Array.from(this._I.slice(0,10)),
            Q:        Array.from(this._Q.slice(0,5)),
            M:        Array.from(this._M.slice(0,32)),
            V:        Array.from(this._V.slice(0,500)),
            AIW:      Array.from(this._AIW.slice(0,32)),
            AQW:      Array.from(this._AQW.slice(0,32)),
            T:        this._T.slice(0,16).map(t=>({cv:t.cv,pv:t.pv,bit:t.bit})),
            C:        this._C.slice(0,16).map(c=>({cv:c.cv,pv:c.pv,bit:c.bit})),
            running:  this._running,
            errorState: this._errorState,
            errorMsg:   this._errorMsg,
            scanCount:  this._scanCount,
            pnState:    this._pn.state,
            pnDevices:  this._pn.devices.map(d=>({slot:d.slot,name:d.deviceName,online:d.online})),
            s7Clients:  this._s7.clients.length,
        };
    }

    // ── 变化检测与推送 ────────────────────────────────────────────────

    _s7DetectAndPush() {
        const cur  = this._s7TakeSnapshot();
        const prev = this._s7.lastSnapshot;
        if (!prev) { this._s7.lastSnapshot = cur; return; }

        const changes = { I:{}, Q:{}, M:{}, V:{}, AIW:{}, AQW:{}, T:{}, C:{} };
        let   hasChange = false;

        // 逐字节比对
        const cmpArr = (key, len) => {
            for (let i = 0; i < len; i++) {
                if (cur[key][i] !== prev[key][i]) {
                    changes[key][i] = cur[key][i];
                    hasChange = true;
                }
            }
        };
        cmpArr('I',   cur.I.length);
        cmpArr('Q',   cur.Q.length);
        cmpArr('M',   cur.M.length);
        cmpArr('V',   cur.V.length);
        cmpArr('AIW', cur.AIW.length);
        cmpArr('AQW', cur.AQW.length);

        // 定时器/计数器
        cur.T.forEach((t, i) => {
            const p = prev.T[i];
            if (t.cv !== p.cv || t.bit !== p.bit) { changes.T[i] = { cv:t.cv, bit:t.bit }; hasChange = true; }
        });
        cur.C.forEach((c, i) => {
            const p = prev.C[i];
            if (c.cv !== p.cv || c.bit !== p.bit) { changes.C[i] = { cv:c.cv, bit:c.bit }; hasChange = true; }
        });

        if (!hasChange) return;

        const meta = {
            scanCount:   this._scanCount,
            running:     this._running,
            errorState:  this._errorState,
            ts:          performance.now(),
            pnState:     this._pn.state,
        };

        // 推送给直连 SCADA 客户端
        this._s7.clients.forEach(sess => {
            if (sess.via === 'direct' && sess.ref) {
                try {
                    const sub = this._s7.subscriptions.find(s => s.clientId === sess.id);
                    const filteredChanges = this._s7FilterChanges(changes, sub?.areas);
                    sess.ref.onCPUDataChange?.(filteredChanges, meta);
                    sess.txBytes += JSON.stringify(filteredChanges).length;
                } catch(e) {}
            }
        });

        // 推送到 BroadcastChannel
        if (this._s7BroadcastChannel && this._s7.subscriptions.some(s => s.clientId.startsWith('ch_'))) {
            try {
                this._s7BroadcastChannel.postMessage({
                    type:    'data_push',
                    changes: changes,
                    meta:    meta,
                });
                this._s7.totalTxBytes += JSON.stringify(changes).length;
            } catch(e) {}
        }

        this._s7.lastSnapshot = cur;
        this._s7.totalPushes++;
        this._s7.lastPushTs = performance.now();
    }

    _s7FilterChanges(changes, areas) {
        if (!areas) return changes;
        const filtered = {};
        areas.forEach(a => { if (changes[a]) filtered[a] = changes[a]; });
        if (changes.T) filtered.T = changes.T;
        if (changes.C) filtered.C = changes.C;
        return filtered;
    }

    // ── 强制写入执行（每次扫描后覆盖 CPU 值）──────────────────────────

    _s7ApplyForceTable() {
        Object.entries(this._s7.forceTable).forEach(([addr, val]) => {
            try {
                if (addr.startsWith('VD')) this._writeReal(addr, parseFloat(val)||0);
                else if (addr.match(/^[AQ]QW|VW|MW/i)) this._writeWord(addr, parseInt(val)||0);
                else this._writeBit(addr, !!val);
            } catch(e) {}
        });
    }

    // ── 程序下载处理（仿真延迟后执行）────────────────────────────────

    _s7TickDownload(dtMs) {
        if (!this._s7.downloadProg || this._s7.downloadTimer <= 0) return;
        this._s7.downloadTimer -= dtMs;
        if (this._s7.downloadTimer <= 0) {
            this._s7.downloadTimer = 0;
            this.loadProgram(this._s7.downloadProg);
            const progName = this._s7.downloadProg?.name || 'OB1';
            this._s7.downloadProg = null;
            this._s7Log('info', `程序下载完成: ${progName}`);
            // 通知所有直连客户端
            this._s7.clients.forEach(sess => {
                if (sess.via === 'direct' && sess.ref) {
                    sess.ref.onProgramDownloaded?.({ name: progName, ts: performance.now() });
                }
            });
            if (this._s7BroadcastChannel) {
                this._s7BroadcastChannel.postMessage({
                    type: 'program_downloaded', name: progName, ts: performance.now(),
                });
            }
            this._rebuildDynamic(); this.markDirty();
        }
    }

    // ── SZL 系统状态列表 ──────────────────────────────────────────────

    _s7ReadSZL(id) {
        const szl = { id, data: null };
        switch (id) {
            case 0x0011:
                szl.data = { moduleType:'CPU ST20', orderNumber:'6ES7 288-1ST20-0AA0', firmwareVersion:'V02.04.00.00', serialNumber:this._pn.mac };
                break;
            case 0x0025:
                szl.data = { programMemoryKB:20, dataMemoryKB:10, retainMemoryKB:2 };
                break;
            case 0x0124:
                szl.data = { diPoints:12, doPoints:8, aiPoints:this._AIW.length/2, aoPoints:this._AQW.length/2, ethernetPorts:3, rs485Ports:1 };
                break;
            case 0x0232:
                szl.data = { s7Clients:this._s7.clients.length, s7MaxClients:this._s7.maxClients, pnDevices:this._pn.devices.length, pnState:this._pn.state };
                break;
            case 0x0F00:
                szl.data = { diagEvents: [...this._pn.diagBuffer.slice(0,16), ...this._s7.diagLog.slice(0,8)] };
                break;
            default:
                throw new Error(`SZL-ID 0x${id.toString(16).toUpperCase()} 不支持`);
        }
        return szl;
    }

    // ── 诊断日志 ─────────────────────────────────────────────────────

    _s7Log(level, msg) {
        const ts = new Date().toLocaleTimeString('zh-CN', { hour12:false, fractionalSecondDigits:3 });
        this._s7.diagLog.unshift({ level, msg, ts });
        if (this._s7.diagLog.length > 32) this._s7.diagLog.pop();
    }

    // ── ID 生成 ──────────────────────────────────────────────────────

    _s7GenId() {
        return 'c' + Math.random().toString(36).slice(2,10);
    }

    _s7GetServerInfo() {
        return {
            cpuType:      'CPU ST20',
            orderNumber:  '6ES7 288-1ST20-0AA0',
            firmware:     'V02.04.00.00',
            ip:           this._pn.ip,
            stationName:  this._pn.stationName,
            mac:          this._pn.mac,
            pnState:      this._pn.state,
            running:      this._running,
            scanCount:    this._scanCount,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // SCADA 公开 API
    // ═══════════════════════════════════════════════════════════════

    /**
     * 直连 SCADA/HMI 组件实例（方式1：组件直接引用）
     *
     * SCADA 组件需实现以下回调（可选）：
     *   onCPUDataChange(changes, meta)   — 数据变化通知
     *   onProgramDownloaded(info)        — 程序下载完成
     *   onCPUStateChange(state)          — CPU 运行状态变化
     *
     * @param {object} scadaInstance  SCADA/HMI 组件实例
     * @param {string} [clientName]   客户端名称标识
     * @returns {string}              会话 ID
     */
    scadaConnect(scadaInstance, clientName) {
        if (!scadaInstance) return null;
        if (this._s7.clients.length >= this._s7.maxClients) {
            this._s7Log('warn', `SCADA 连接被拒绝：已达最大连接数 ${this._s7.maxClients}`);
            return null;
        }
        const clientId = this._s7GenId();
        const name     = clientName || scadaInstance.label || scadaInstance.type || 'SCADA';
        const session  = this._s7CreateSession(clientId, name, 'direct', 'direct');
        session.ref    = scadaInstance;

        // 自动订阅所有区域
        this._s7.subscriptions.push({
            clientId, areas: ['I','Q','M','V','AIW','AQW'], minIntervalMs: this._s7.pushIntervalMs,
        });

        // 立即推送当前完整快照给新连接的客户端
        try {
            scadaInstance.onCPUDataChange?.(this._s7TakeFullSnapshot(), {
                scanCount: this._scanCount, running: this._running,
                errorState: this._errorState, ts: performance.now(), pnState: this._pn.state,
                isInitialSnapshot: true,
            });
        } catch(e) {}

        this._s7Log('info', `直连 SCADA: ${name} (${clientId})`);
        this._rebuildDynamic(); this.markDirty();
        return clientId;
    }

    /**
     * 断开 SCADA 连接
     * @param {string} clientId  由 scadaConnect 返回的会话 ID
     */
    scadaDisconnect(clientId) {
        this._s7HandleChannelDisconnect(clientId);
    }

    /**
     * 断开所有 SCADA 连接
     */
    scadaDisconnectAll() {
        const ids = this._s7.clients.map(c => c.id);
        ids.forEach(id => this._s7HandleChannelDisconnect(id));
        this._s7.requestQueue = [];
        this._s7Log('info', '所有 SCADA 连接已断开');
    }

    /**
     * 发送 S7 请求（供外部调用，用于脚本测试）
     * @param {object} req  请求对象 { type, addr, value, … }
     * @returns {Promise}   resolve(result) / reject(error)
     */
    scadaRequest(req) {
        return new Promise((resolve, reject) => {
            this._s7EnqueueRequest({
                ...req,
                clientId:  req.clientId || '_direct',
                via:       'promise',
                callback:  (err, res) => err ? reject(err) : resolve(res),
            });
        });
    }

    /**
     * 同步读取 CPU 地址（立即执行，无队列延迟）
     * @param {string} addr  地址字符串（VD0 / Q0.0 / AIW0 等）
     * @returns {number|boolean}
     */
    scadaRead(addr) {
        if (addr.startsWith('VD')) return this.readReal(addr);
        if (addr.match(/^[AQ]QW|AIW|VW|MW/i)) return this._readWord(addr);
        return this._readBit(addr);
    }

    /**
     * 同步写入 CPU 地址（立即执行，受 writeEnabled 控制）
     * @param {string}           addr  地址
     * @param {number|boolean}   val   值
     */
    scadaWrite(addr, val) {
        if (!this._s7.writeEnabled) { this._s7Log('warn', `写入被拒绝（writeEnabled=false）: ${addr}`); return; }
        if (addr.startsWith('VD')) this._writeReal(addr, parseFloat(val)||0);
        else if (addr.match(/^AQW|VW|MW/i)) this._writeWord(addr, parseInt(val)||0);
        else this._writeBit(addr, !!val);
        this._s7Log('info', `直写: ${addr} = ${val}`);
    }

    /**
     * 获取 S7 通信层状态信息
     */
    scadaGetStatus() {
        return {
            clients:         this._s7.clients.map(c => ({
                id:          c.id,
                name:        c.name,
                via:         c.via,
                connectedSec: ((performance.now() - c.connectedAt) / 1000).toFixed(1),
                txBytes:     c.txBytes,
            })),
            totalPushes:     this._s7.totalPushes,
            totalRequests:   this._s7.totalRxRequests,
            forceTable:      { ...this._s7.forceTable },
            pushIntervalMs:  this._s7.pushIntervalMs,
            writeEnabled:    this._s7.writeEnabled,
            channelName:     this._s7.channelName,
            diagLog:         this._s7.diagLog.slice(0, 16),
        };
    }

    /**
     * 强制写入（不受梯形图程序覆盖，直至 scadaUnforce 解除）
     */
    scadaForce(addr, val) {
        if (!this._s7.writeEnabled) return;
        this._s7.forceTable[addr] = val;
        this._s7Log('warn', `强制: ${addr} = ${val}`);
    }

    scadaUnforce(addr) {
        delete this._s7.forceTable[addr];
        this._s7Log('info', `解除强制: ${addr}`);
    }

    scadaClearForce() {
        this._s7.forceTable = {};
        this._s7Log('info', '清除所有强制');
    }

    destroy() {
        this.scadaDisconnectAll();
        this._s7BroadcastChannel?.close();
        this.pnStop();
        [...this._expansionSlots].forEach(s=>this.unmountModule(s.slot));
        super.destroy?.();
    }
}
