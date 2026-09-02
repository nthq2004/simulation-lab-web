import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 S7-200 SMART CPU ST20 仿真组件 v2.0
 *
 * ══════════════════════════════════════════════════════════════════
 *  v2.0 新增功能
 * ══════════════════════════════════════════════════════════════════
 *
 *  1. 扩展总线管理（Expansion Bus Manager）
 *     - 支持最多 6 个扩展模块热插拔
 *     - 模块类型：AI04 / AQ04 / DT16 / DE8 / 及未来自定义模块
 *     - 自动地址分配：
 *         AI04 → AIWx（每模块 8 字节，x = 槽位 × 8）
 *         AQ04 → AQWx（每模块 8 字节）
 *         DT16 → 数字量扩展 I/Q（IB2 起，QB1 起）
 *         DE8  → 数字量输入扩展（IB4 起）
 *     - 总线时钟同步：每扫描周期向所有扩展模块推送 tick
 *
 *  2. 扩展存储区
 *     - AIW[0..63]  模拟量输入映像寄存器（支持 8 个 AI 模块）
 *     - AQW[0..63]  模拟量输出映像寄存器（支持 8 个 AQ 模块）
 *     - IB[2..9]    数字量扩展输入（DT16/DE8）
 *     - QB[1..4]    数字量扩展输出（DT16）
 *
 *  3. PID 控制器（最多 8 回路）
 *     指令：PID  loop, table
 *       loop  : 回路号（0~7）
 *       table : PID 参数表起始地址（VD 双字，每回路 9 个双精度参数）
 *
 *     参数表布局（每回路 36 字节，VD 地址）：
 *       +0   过程变量 PV（当前值，工程值，由梯形图写入）
 *       +4   设定值 SP（目标值）
 *       +8   输出 MX（0.0~1.0，归一化）
 *       +12  增益 Kc（比例增益）
 *       +16  采样时间 Ts（秒）
 *       +20  积分时间 Ti（分钟，0=禁用积分）
 *       +24  微分时间 Td（分钟，0=禁用微分）
 *       +28  输出上限 MX_MAX（默认 1.0）
 *       +32  输出下限 MX_MIN（默认 0.0）
 *
 *     内部状态（不在参数表，引擎内部维护）：
 *       积分项累积 Ix、上次偏差 e_prev、上次 PV prev_pv
 *
 *     算法（位置式 PID，离散化）：
 *       e  = SP - PV
 *       Ix += Kc × (Ts/Ti) × e       （积分项，防积分饱和）
 *       Dx  = Kc × (Td/Ts) × (PV_prev - PV)  （微分项，对 PV 微分避免设定值扰动）
 *       MX  = Kc × e + Ix + Dx
 *       限幅至 [MX_MIN, MX_MAX]
 *       输出 MX 写回参数表 +8
 *       将 MX × 27648 → AQWx 实现闭环控制
 *
 *  4. 新增梯形图指令
 *     PID   loop, table       PID 运算（见上）
 *     PIDX  loop, table       PID 扩展（同 PID，保留）
 *     CALL  subr              调用子程序（子程序由 SBR_x 网络组成）
 *     JMP   label             跳转
 *     LBL   label             标签
 *     FOR   idx,init,final    计数循环
 *     NEXT                    结束循环
 *     FILL_B n, addr, val     块填充（字节）
 *     LSHIFT_B n, addr        左移 n 位
 *     RSHIFT_B n, addr        右移 n 位
 *     ROL_B  n, addr          循环左移
 *     ROR_B  n, addr          循环右移
 *     INCB / DECB  addr       字节自增/自减
 *     INCW / DECW  addr       字自增/自减
 *     MOVD addr1, addr2       双字传送（32bit）
 *     +R / -R / *R / /R       实数（浮点）运算（VD 双字）
 *     SQRT  addr1, addr2      平方根（实数）
 *     LN / EXP                自然对数 / e 的指数
 *     ITD / DTI               整数↔双整数转换
 *     DTR / TRUNC             双整数↔实数转换
 *     ATH / HTA               ASCII ↔ 十六进制
 *
 *  5. 浮点（实数）存储区
 *     VD（双字，32bit IEEE754）存储于 _VD[n]（Float32Array，1250元素）
 *     读：readReal(addr)  'VDxx' → _VD[xx/4]
 *     写：writeReal(addr, val)
 *
 * ══════════════════════════════════════════════════════════════════
 *  硬件规格（不变）
 * ══════════════════════════════════════════════════════════════════
 *
 *  CPU ST20：20KB 程序 / 10KB 数据 / 12 DI / 8 DO
 *  扩展能力：最多 6 个扩展模块，总 I/O ≤ 188点
 *
 * ══════════════════════════════════════════════════════════════════
 *  存储区（完整）
 * ══════════════════════════════════════════════════════════════════
 *
 *  I    IB0~IB9      数字量输入（CPU 2字节 + 扩展模块）
 *  Q    QB0~QB4      数字量输出
 *  M    MB0~MB31     内部标志
 *  V    VB0~VB4999   变量存储（字节）
 *  VD   VD0~VD4996   双字实数（与 V 共享字节数组，4字节对齐）
 *  L    LB0~LB63     局部存储
 *  T    T0~T255      定时器
 *  C    C0~C255      计数器
 *  SM   SM0~SM255    特殊标志
 *  AIW  AIW0~AIW63   模拟量输入映像（扩展模块写入）
 *  AQW  AQW0~AQW63   模拟量输出映像（梯形图写入→扩展模块读取）
 *  HC   HC0~HC5      高速计数器当前值（32bit）
 *  AC   AC0~AC3      累加器（32bit）
 *
 * ══════════════════════════════════════════════════════════════════
 *  可配置参数
 * ══════════════════════════════════════════════════════════════════
 *  label          : 位号（默认 'PLC1'）
 *  scanCycleMs    : 扫描周期 ms（默认 10）
 *  initRun        : 初始是否运行
 *  ladderProgram  : 梯形图 JSON
 *  pidConfigs     : PID 初始配置数组（可选）
 */
export class S7200SmartST20 extends BaseComponent {

    constructor(config, sys) {
        super(config, sys);

        this.width  = Math.max(340, config.width  || 420);
        this.height = Math.max(260, config.height || 320);

        this.type    = 's7200_smart_st20';
        this.special = 'plc';
        this.cache   = 'fixed';

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._initMemory();
        this._initExpansionBus();
        this._initPID(config.pidConfigs);
        this._initLadderEngine();
        this._init();

        this.config = {
            label:         this.label,
            scanCycleMs:   this._scanCycleMs,
            initRun:       this._running,
            ladderProgram: JSON.stringify(this._program),
        };

        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════
    // 几何计算（继承不变）
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;
        this._body     = { x: 0, y: 0, w: W, h: H, rx: 4 };
        this._topBar   = { x: 0, y: 0, w: W, h: H * 0.10 };
        this._panel    = { x: 2, y: H * 0.10, w: W - 4, h: H * 0.82 };
        this._ethPort  = { x: W * 0.04, y: H * 0.13, w: W * 0.12, h: H * 0.07 };
        this._rsPort   = { x: W * 0.18, y: H * 0.13, w: W * 0.10, h: H * 0.07 };
        this._modeKnob = { x: W * 0.32, y: H * 0.165, r: H * 0.028 };
        this._leds = {
            run:   { x: W * 0.44, y: H * 0.145, r: H * 0.018 },
            stop:  { x: W * 0.44, y: H * 0.185, r: H * 0.018 },
            error: { x: W * 0.44, y: H * 0.225, r: H * 0.018 },
        };
        this._inputLEDs0 = [];
        for (let i = 0; i < 8; i++) {
            this._inputLEDs0.push({
                x: W * (0.04 + i * 0.115), y: H * 0.38,
                r: H * 0.016, bit: i, byte: 0, label: `I0.${i}`,
            });
        }
        this._inputLEDs1 = [];
        for (let i = 0; i < 4; i++) {
            this._inputLEDs1.push({
                x: W * (0.04 + i * 0.115), y: H * 0.48,
                r: H * 0.016, bit: i, byte: 1, label: `I1.${i}`,
            });
        }
        this._outputLEDs = [];
        for (let i = 0; i < 8; i++) {
            this._outputLEDs.push({
                x: W * (0.04 + i * 0.115), y: H * 0.60,
                r: H * 0.016, bit: i, byte: 0, label: `Q0.${i}`,
            });
        }
        this._inputTerminals  = { x: W * 0.02, y: H * 0.72, w: W * 0.56, h: H * 0.10 };
        this._outputTerminals = { x: W * 0.60, y: H * 0.72, w: W * 0.38, h: H * 0.10 };
        this._dinRail  = { x: 0, y: H * 0.92, w: W, h: H * 0.08 };
        this._nameplate = { x: W * 0.56, y: H * 0.13, w: W * 0.40, h: H * 0.10 };

        // 扩展总线连接器（右侧公头）
        this._busRight = { x: W - 2, y: H * 0.14, w: 8, h: H * 0.20 };

        this._portPositions = {};
        for (let i = 0; i < 8; i++) {
            this._portPositions[`I0.${i}`] = { x: W * (0.04 + i * 0.115), y: H };
        }
        for (let i = 0; i < 4; i++) {
            this._portPositions[`I1.${i}`] = { x: W * (0.04 + (i + 8) * 0.07), y: H };
        }
        for (let i = 0; i < 8; i++) {
            this._portPositions[`Q0.${i}`] = { x: W * (0.60 + i * 0.046), y: H };
        }
        this._portPositions['PWR_IN'] = { x: W * 0.88, y: 0 };
        this._portPositions['BUS_R']  = { x: W + 8, y: H * 0.24 };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.label        = config.label        || 'PLC1';
        this._scanCycleMs = config.scanCycleMs !== undefined ? config.scanCycleMs : 10;
        this._running     = config.initRun      !== undefined ? !!config.initRun   : false;
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

    // ═══════════════════════════════════════════════════════
    // 存储区初始化（v2：新增 VD / AIW / AQW / HC / AC）
    // ═══════════════════════════════════════════════════════

    _initMemory() {
        this._I   = new Uint8Array(10);    // IB0~IB9（CPU 2 + 扩展 8）
        this._Q   = new Uint8Array(5);     // QB0~QB4
        this._M   = new Uint8Array(32);    // MB0~MB31
        this._V   = new Uint8Array(5000);  // VB0~VB4999
        this._L   = new Uint8Array(64);
        this._SM  = new Uint8Array(256);
        this._AIW = new Uint8Array(64);    // AIW0~AIW63（AI 扩展模块输入映像）
        this._AQW = new Uint8Array(64);    // AQW0~AQW63（AQ 扩展模块输出映像）
        this._HC  = new Int32Array(6);     // HC0~HC5 高速计数器
        this._AC  = new Int32Array(4);     // AC0~AC3 累加器

        this._T = Array.from({ length: 256 }, () => ({
            cv: 0, pv: 0, bit: false, accMs: 0,
            type: 'TON', timeBase: 100, enabled: false,
        }));
        this._C = Array.from({ length: 256 }, () => ({
            cv: 0, pv: 0, bit: false,
            lastCU: false, lastCD: false, lastR: false,
        }));

        this._SM[0] = 0xFF;  // SM0.0 = 1 始终
        this._smOscMs4 = 0; this._smOscMs5 = 0;
        this._smFlip4  = false; this._smFlip5 = false;

        // 循环控制栈（FOR/NEXT）
        this._forStack = [];

        // 跳转标签索引缓存
        this._labelCache = {};
    }

    // ═══════════════════════════════════════════════════════
    // 扩展总线管理
    // ═══════════════════════════════════════════════════════

    _initExpansionBus() {
        // 已挂载模块列表（按槽位排序）
        // 每项：{ slot, type, module, aiBase, aqBase, diBase, doBase }
        this._expansionSlots = [];
        this._expansionModules = [];  // 保持向后兼容（旧有 AQ04 的引用）
    }

    /**
     * 挂载扩展模块
     * @param {object} module  模块实例（S7200SmartAI04 / AQ04 / DT16 / DE8 等）
     * @param {number} slot    槽位号（0~5），不指定则自动分配
     * @returns {number}       实际槽位号
     */
    mountModule(module, slot) {
        if (this._expansionSlots.length >= 6) {
            console.warn('ST20: 最多支持 6 个扩展模块');
            return -1;
        }
        const usedSlots = this._expansionSlots.map(s => s.slot);
        if (slot === undefined || slot === null) {
            for (let i = 0; i < 6; i++) {
                if (!usedSlots.includes(i)) { slot = i; break; }
            }
        }
        if (usedSlots.includes(slot)) {
            console.warn(`ST20: 槽位 ${slot} 已被占用`);
            return -1;
        }

        const type    = (module.type || '').toLowerCase();
        const aiBase  = slot * 8;   // AIWx 字节偏移
        const aqBase  = slot * 8;   // AQWx 字节偏移
        const diBase  = 2 + slot;   // IB2 起（CPU 占 IB0/IB1）
        const doBase  = 1 + Math.floor(slot / 2);  // QB1 起

        const entry = { slot, type, module, aiBase, aqBase, diBase, doBase };
        this._expansionSlots.push(entry);
        this._expansionSlots.sort((a, b) => a.slot - b.slot);

        // 为模块设置槽位地址
        if (module._slotAddr !== undefined) {
            module._slotAddr = slot;
        }

        // Patch CPU 支持模块地址
        this._patchForModule(module, type, entry);

        // 注册到向后兼容列表
        if (!this._expansionModules.includes(module)) {
            this._expansionModules.push(module);
        }

        // 通知模块已连接
        if (typeof module.connectToCPU === 'function') {
            module.connectToCPU(this);
        }

        return slot;
    }

    /**
     * 卸载扩展模块
     */
    unmountModule(slotOrModule) {
        let idx;
        if (typeof slotOrModule === 'number') {
            idx = this._expansionSlots.findIndex(s => s.slot === slotOrModule);
        } else {
            idx = this._expansionSlots.findIndex(s => s.module === slotOrModule);
        }
        if (idx < 0) return;
        const entry = this._expansionSlots[idx];
        if (typeof entry.module.disconnectFromCPU === 'function') {
            entry.module.disconnectFromCPU();
        }
        this._expansionSlots.splice(idx, 1);
        const mi = this._expansionModules.indexOf(entry.module);
        if (mi >= 0) this._expansionModules.splice(mi, 1);
    }

    /**
     * 按槽位获取模块
     */
    getModule(slot) {
        const entry = this._expansionSlots.find(s => s.slot === slot);
        return entry ? entry.module : null;
    }

    /**
     * Patch CPU _readWord / _writeWord，支持 AIWx / AQWx / IWx / QWx
     */
    _patchForModule(module, type, entry) {
        // AIW 支持（AI 模块）
        if (!this._aiwPatched) {
            this._aiwPatched = true;
            const origRead  = this._readWord.bind(this);
            const origWrite = this._writeWord.bind(this);
            const self = this;

            this._readWord = function(addr) {
                const mAIW = addr.match(/^AIW(\d+)$/i);
                if (mAIW) {
                    const off = parseInt(mAIW[1]);
                    if (off + 1 < self._AIW.length) {
                        const raw = (self._AIW[off] << 8) | self._AIW[off + 1];
                        return raw > 32767 ? raw - 65536 : raw;
                    }
                    return 0;
                }
                const mAQW = addr.match(/^AQW(\d+)$/i);
                if (mAQW) {
                    const off = parseInt(mAQW[1]);
                    if (off + 1 < self._AQW.length) {
                        const raw = (self._AQW[off] << 8) | self._AQW[off + 1];
                        return raw > 32767 ? raw - 65536 : raw;
                    }
                    return 0;
                }
                const mHC = addr.match(/^HC(\d+)$/i);
                if (mHC) return self._HC[parseInt(mHC[1])] || 0;
                const mAC = addr.match(/^AC(\d+)$/i);
                if (mAC) return self._AC[parseInt(mAC[1])] || 0;
                return origRead(addr);
            };

            this._writeWord = function(addr, val) {
                const mAQW = addr.match(/^AQW(\d+)$/i);
                if (mAQW) {
                    const off = parseInt(mAQW[1]);
                    val = Math.max(-32768, Math.min(32767, Math.round(val)));
                    const u = val < 0 ? val + 65536 : val;
                    if (off + 1 < self._AQW.length) {
                        self._AQW[off]     = (u >> 8) & 0xFF;
                        self._AQW[off + 1] = u & 0xFF;
                    }
                    return;
                }
                const mAIW = addr.match(/^AIW(\d+)$/i);
                if (mAIW) {
                    const off = parseInt(mAIW[1]);
                    val = Math.max(-32768, Math.min(32767, Math.round(val)));
                    const u = val < 0 ? val + 65536 : val;
                    if (off + 1 < self._AIW.length) {
                        self._AIW[off]     = (u >> 8) & 0xFF;
                        self._AIW[off + 1] = u & 0xFF;
                    }
                    return;
                }
                const mAC = addr.match(/^AC(\d+)$/i);
                if (mAC) { self._AC[parseInt(mAC[1])] = Math.round(val); return; }
                origWrite(addr, val);
            };
        }
    }

    // ═══════════════════════════════════════════════════════
    // PID 控制器初始化
    // ═══════════════════════════════════════════════════════

    _initPID(pidConfigs) {
        // 8 个 PID 回路内部状态
        this._pidState = Array.from({ length: 8 }, () => ({
            Ix:      0,     // 积分累积项
            ePrev:   0,     // 上次偏差
            pvPrev:  0,     // 上次 PV（用于微分）
            active:  false, // 是否正在运算
            prevEN:  false, // 上次使能状态（边沿检测）
        }));

        // 可选：从配置预设 PID 参数到 VD 存储区
        if (pidConfigs && Array.isArray(pidConfigs)) {
            pidConfigs.forEach((cfg, loop) => {
                if (loop >= 8) return;
                const base = (cfg.tableBase !== undefined ? cfg.tableBase : loop * 36);
                if (cfg.Kc  !== undefined) this._writeReal(`VD${base + 12}`, cfg.Kc);
                if (cfg.Ts  !== undefined) this._writeReal(`VD${base + 16}`, cfg.Ts);
                if (cfg.Ti  !== undefined) this._writeReal(`VD${base + 20}`, cfg.Ti);
                if (cfg.Td  !== undefined) this._writeReal(`VD${base + 24}`, cfg.Td);
                if (cfg.SP  !== undefined) this._writeReal(`VD${base + 4}`,  cfg.SP);
                const mxMax = cfg.MX_MAX !== undefined ? cfg.MX_MAX : 1.0;
                const mxMin = cfg.MX_MIN !== undefined ? cfg.MX_MIN : 0.0;
                this._writeReal(`VD${base + 28}`, mxMax);
                this._writeReal(`VD${base + 32}`, mxMin);
            });
        }
    }

    // ═══════════════════════════════════════════════════════
    // 浮点（实数）存储区访问
    // ═══════════════════════════════════════════════════════

    /** 读取 VD 实数（addr: 'VDxx'，xx 必须 4 字节对齐） */
    readReal(addr) {
        const m = addr.match(/^VD(\d+)$/i);
        if (!m) {
            // 支持直接传入数字常量
            const n = parseFloat(addr);
            return isNaN(n) ? 0.0 : n;
        }
        const byteN = parseInt(m[1]);
        if (byteN + 3 >= this._V.length) return 0.0;
        // 从字节数组读取 IEEE754 32-bit float（大端）
        const buf  = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setUint8(0, this._V[byteN]);
        view.setUint8(1, this._V[byteN + 1]);
        view.setUint8(2, this._V[byteN + 2]);
        view.setUint8(3, this._V[byteN + 3]);
        return view.getFloat32(0, false);  // 大端
    }

    /** 写入 VD 实数 */
    _writeReal(addr, val) {
        const m = addr.match(/^VD(\d+)$/i);
        if (!m) return;
        const byteN = parseInt(m[1]);
        if (byteN + 3 >= this._V.length) return;
        const buf  = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setFloat32(0, val, false);  // 大端
        this._V[byteN]     = view.getUint8(0);
        this._V[byteN + 1] = view.getUint8(1);
        this._V[byteN + 2] = view.getUint8(2);
        this._V[byteN + 3] = view.getUint8(3);
    }

    // ═══════════════════════════════════════════════════════
    // PID 运算核心
    // ═══════════════════════════════════════════════════════

    /**
     * 执行 PID 运算
     * @param {number} loop   回路号 0~7
     * @param {number} table  参数表 VD 起始字节（如 0, 36, 72 …）
     * @param {boolean} en    使能信号（能流）
     */
    _execPID(loop, table, en) {
        if (loop < 0 || loop > 7) return;
        const state = this._pidState[loop];
        const T     = table;

        // 读取参数表
        const PV    = this.readReal(`VD${T}`);       // 过程变量
        const SP    = this.readReal(`VD${T + 4}`);   // 设定值
        let   MX    = this.readReal(`VD${T + 8}`);   // 上次输出
        const Kc    = this.readReal(`VD${T + 12}`);  // 比例增益
        const Ts    = this.readReal(`VD${T + 16}`);  // 采样时间（s）
        const Ti    = this.readReal(`VD${T + 20}`);  // 积分时间（min）
        const Td    = this.readReal(`VD${T + 24}`);  // 微分时间（min）
        const MXmax = this.readReal(`VD${T + 28}`) || 1.0;
        const MXmin = this.readReal(`VD${T + 32}`) || 0.0;

        // 使能下降沿：复位积分项和状态
        if (!en) {
            if (state.prevEN) {
                state.Ix     = MX;  // 无扰切换：保持当前输出
                state.ePrev  = SP - PV;
                state.pvPrev = PV;
            }
            state.prevEN = false;
            return;
        }
        state.prevEN = true;

        if (Ts <= 0 || isNaN(Ts)) return;

        const e    = SP - PV;
        const Ts_s = Ts;

        // 比例项
        const Pout = Kc * e;

        // 积分项（梯形积分，防饱和）
        if (Ti > 0) {
            const Ti_s = Ti * 60.0;  // min → s
            state.Ix  += Kc * (Ts_s / Ti_s) * ((e + state.ePrev) / 2.0);
        }

        // 微分项（对 PV 微分，避免设定值阶跃扰动）
        let Dout = 0;
        if (Td > 0) {
            const Td_s = Td * 60.0;  // min → s
            Dout = -Kc * (Td_s / Ts_s) * (PV - state.pvPrev);
        }

        // 输出合计
        MX = Pout + state.Ix + Dout;

        // 输出限幅 + 积分抗饱和
        if (MX > MXmax) {
            MX = MXmax;
            if (e > 0) state.Ix -= Kc * (Ts_s / (Ti > 0 ? Ti * 60 : 1)) * e;
        } else if (MX < MXmin) {
            MX = MXmin;
            if (e < 0) state.Ix -= Kc * (Ts_s / (Ti > 0 ? Ti * 60 : 1)) * e;
        }

        // 写回参数表
        this._writeReal(`VD${T + 8}`, MX);

        // 保存状态
        state.ePrev  = e;
        state.pvPrev = PV;
        state.active = true;
    }

    // ═══════════════════════════════════════════════════════
    // 存储区读写（升级版，支持更多地址类型）
    // ═══════════════════════════════════════════════════════

    _readBit(addr) {
        if (addr === 'SM0.0') return true;
        if (addr === 'SM0.1') return !!(this._SM[0] & 0x02);
        if (addr === 'SM0.4') return !!(this._SM[0] & 0x10);
        if (addr === 'SM0.5') return !!(this._SM[0] & 0x20);
        if (addr === 'SM0.6') return !!(this._SM[0] & 0x40);  // 扫描时钟（每次扫描翻转）
        const m = addr.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
        if (m) {
            const z = m[1].toUpperCase(), b = +m[2], bit = +m[3], mask = 1 << bit;
            if (z === 'I')  return !!(this._I[b]  & mask);
            if (z === 'Q')  return !!(this._Q[b]  & mask);
            if (z === 'M')  return !!(this._M[b]  & mask);
            if (z === 'V')  return !!(this._V[b]  & mask);
            if (z === 'SM') return !!(this._SM[b] & mask);
            if (z === 'L')  return !!(this._L[b]  & mask);
            if (z === 'T')  return this._T[b * 8 + bit]?.bit ?? false;  // 定时器字节访问
        }
        const tc = addr.match(/^([TC])(\d+)$/);
        if (tc) {
            const n = parseInt(tc[2]);
            return tc[1].toUpperCase() === 'T' ? this._T[n].bit : this._C[n].bit;
        }
        return false;
    }

    _writeBit(addr, val) {
        const m = addr.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
        if (!m) return;
        const z = m[1].toUpperCase(), b = +m[2], bit = +m[3], mask = 1 << bit;
        const setArr = arr => { if (val) arr[b] |= mask; else arr[b] &= ~mask; };
        if (z === 'Q')  { setArr(this._Q);  return; }
        if (z === 'M')  { setArr(this._M);  return; }
        if (z === 'V')  { setArr(this._V);  return; }
        if (z === 'L')  { setArr(this._L);  return; }
        if (z === 'SM') { setArr(this._SM); return; }
    }

    _readWord(addr) {
        // 直接数字
        const numericOnly = addr.match(/^-?\d+$/);
        if (numericOnly) return parseInt(addr);

        const m = addr.match(/^([A-Za-z]+)W?(\d+)$/i);
        if (!m) return 0;
        const z = m[1].toUpperCase(), b = +m[2];
        const readArr = arr => {
            const raw = (arr[b] << 8) | arr[b + 1];
            return raw > 32767 ? raw - 65536 : raw;
        };
        if (z === 'V')  return readArr(this._V);
        if (z === 'M')  return readArr(this._M);
        if (z === 'IW') return readArr(this._I);
        if (z === 'QW') return readArr(this._Q);
        if (z === 'I')  return readArr(this._I);
        // 定时器/计数器当前值
        const tv = addr.match(/^T(\d+)$/i);
        if (tv) return this._T[parseInt(tv[1])].cv || 0;
        const cv = addr.match(/^C(\d+)$/i);
        if (cv) return this._C[parseInt(cv[1])].cv || 0;
        const ac = addr.match(/^AC(\d+)$/i);
        if (ac) return this._AC[parseInt(ac[1])] || 0;
        return 0;
    }

    _writeWord(addr, val) {
        val = Math.max(-32768, Math.min(32767, Math.round(val)));
        const u = val < 0 ? val + 65536 : val;
        const m = addr.match(/^([A-Za-z]+)W?(\d+)$/i);
        if (!m) return;
        const z = m[1].toUpperCase(), b = +m[2];
        const writeArr = arr => { arr[b] = (u >> 8) & 0xFF; arr[b + 1] = u & 0xFF; };
        if (z === 'V')  { writeArr(this._V); return; }
        if (z === 'M')  { writeArr(this._M); return; }
        if (z === 'QW') { writeArr(this._Q); return; }
        const ac = addr.match(/^AC(\d+)$/i);
        if (ac) { this._AC[parseInt(ac[1])] = Math.round(val); return; }
    }

    _readByte(addr) {
        const m = addr.match(/^([A-Za-z]+)B?(\d+)$/i);
        if (!m) return 0;
        const z = m[1].toUpperCase(), b = +m[2];
        if (z === 'V')  return this._V[b]  || 0;
        if (z === 'M')  return this._M[b]  || 0;
        if (z === 'IB') return this._I[b]  || 0;
        if (z === 'QB') return this._Q[b]  || 0;
        if (z === 'I')  return this._I[b]  || 0;
        if (z === 'Q')  return this._Q[b]  || 0;
        if (z === 'L')  return this._L[b]  || 0;
        if (z === 'SM') return this._SM[b] || 0;
        const n = parseInt(addr); return isNaN(n) ? 0 : n & 0xFF;
    }

    _writeByte(addr, val) {
        val = Math.max(0, Math.min(255, Math.round(val)));
        const m = addr.match(/^([A-Za-z]+)B?(\d+)$/i);
        if (!m) return;
        const z = m[1].toUpperCase(), b = +m[2];
        if (z === 'V')  { this._V[b]  = val; return; }
        if (z === 'M')  { this._M[b]  = val; return; }
        if (z === 'QB') { this._Q[b]  = val; return; }
        if (z === 'Q')  { this._Q[b]  = val; return; }
        if (z === 'L')  { this._L[b]  = val; return; }
    }

    _parseIndex(addr, prefix) {
        const n = parseInt(addr.replace(new RegExp(`^${prefix}`, 'i'), ''));
        return isNaN(n) ? 0 : Math.max(0, Math.min(255, n));
    }

    // ═══════════════════════════════════════════════════════
    // 梯形图执行引擎（升级版）
    // ═══════════════════════════════════════════════════════

    _initLadderEngine() {
        this._stack = [];
        this._flow  = false;
    }

    _execScan() {
        if (!this._running) return;
        if (this._firstScan) this._SM[0] |= 0x02;
        else                 this._SM[0] &= ~0x02;

        // SM0.6 扫描时钟位（每次扫描翻转）
        this._SM[0] ^= 0x40;

        const prog = this._program;
        if (!prog?.networks) return;

        // 重建标签缓存
        this._labelCache = {};
        prog.networks.forEach((net, ni) => {
            (net.rungs || []).forEach((rung, ri) => {
                rung.forEach((inst, ii) => {
                    if (inst.op.toUpperCase() === 'LBL') {
                        this._labelCache[inst.addr] = { ni, ri, ii };
                    }
                });
            });
        });

        try {
            this._execNetworks(prog.networks, 0, prog.networks.length);
        } catch (e) {
            this._errorState = true;
            this._errorMsg   = e.message || '执行错误';
            this._running    = false;
        }

        this._firstScan = false;
        this._scanCount++;
    }

    _execNetworks(networks, startNi, endNi) {
        let ni = startNi;
        while (ni < endNi && ni < networks.length) {
            const network = networks[ni];
            let ri = 0;
            const rungs = network.rungs || [];
            while (ri < rungs.length) {
                const result = this._execRung(rungs[ri], ni, ri);
                if (result && result.jmp !== undefined) {
                    // JMP 指令处理
                    const target = this._labelCache[result.jmp];
                    if (target) { ni = target.ni; ri = target.ri; continue; }
                }
                ri++;
            }
            ni++;
        }
    }

    _execRung(instructions, netIdx, rungIdx) {
        const stack = [];
        let flow = false;

        for (let i = 0; i < instructions.length; i++) {
            const inst = instructions[i];
            const op   = inst.op.toUpperCase();
            const { addr, addr2, addr3, pv, timeBase, loop, table } = inst;

            switch (op) {
                // ── 触点 ─────────────────────────────────
                case 'LD':   stack.push(flow); flow = this._readBit(addr); break;
                case 'LDN':  stack.push(flow); flow = !this._readBit(addr); break;
                case 'A':    flow = flow && this._readBit(addr); break;
                case 'AN':   flow = flow && !this._readBit(addr); break;
                case 'O':    flow = flow || this._readBit(addr); break;
                case 'ON':   flow = flow || !this._readBit(addr); break;
                case 'NOT':  flow = !flow; break;

                // ── 上升/下降沿 ──────────────────────────
                case 'EU': { // Edge Up（正跳变触点）
                    const bitKey = `_eu_${netIdx}_${rungIdx}_${i}`;
                    const prev = this[bitKey] || false;
                    const cur  = this._readBit(addr);
                    this[bitKey] = cur;
                    flow = flow && (cur && !prev);
                    break;
                }
                case 'ED': { // Edge Down（负跳变触点）
                    const bitKey = `_ed_${netIdx}_${rungIdx}_${i}`;
                    const prev = this[bitKey] || false;
                    const cur  = this._readBit(addr);
                    this[bitKey] = cur;
                    flow = flow && (!cur && prev);
                    break;
                }

                // ── 栈操作 ──────────────────────────────
                case 'OLD':  { const p = stack.pop(); flow = flow || (p || false); break; }
                case 'ALD':  { const p = stack.pop(); flow = flow && (p || false); break; }
                case 'LPS':  stack.push(flow); break;
                case 'LRD':  flow = stack[stack.length - 1]; break;
                case 'LPP':  flow = stack.pop() || false; break;

                // ── 线圈 ─────────────────────────────────
                case '=':    this._writeBit(addr, flow); break;
                case 'S':    if (flow) this._writeBit(addr, true);  break;
                case 'R':    if (flow) this._writeBit(addr, false); break;

                // ── 中间输出 ─────────────────────────────
                case '=I': { // 中间线圈（不改变能流）
                    this._writeBit(addr, flow);
                    break;
                }

                // ── 定时器 ──────────────────────────────
                case 'TON': {
                    const t = this._T[this._parseIndex(addr, 'T')];
                    t.type = 'TON'; if (pv !== undefined) t.pv = pv;
                    t.timeBase = timeBase || 100; t.enabled = flow;
                    if (!flow) { t.cv = 0; t.bit = false; t.accMs = 0; }
                    break;
                }
                case 'TOF': {
                    const t = this._T[this._parseIndex(addr, 'T')];
                    t.type = 'TOF'; if (pv !== undefined) t.pv = pv;
                    t.timeBase = timeBase || 100;
                    if (flow) { t.bit = true; t.cv = 0; t.accMs = 0; }
                    t.enabled = !flow;
                    break;
                }
                case 'TONR': {
                    const t = this._T[this._parseIndex(addr, 'T')];
                    t.type = 'TONR'; if (pv !== undefined) t.pv = pv;
                    t.timeBase = timeBase || 100; t.enabled = flow;
                    break;
                }

                // ── 计数器 ──────────────────────────────
                case 'CTU': {
                    const c = this._C[this._parseIndex(addr, 'C')];
                    if (pv !== undefined) c.pv = pv;
                    const rNow = addr2 ? this._readBit(addr2) : false;
                    if (rNow) { c.cv = 0; c.bit = false; }
                    else if (flow && !c.lastCU) c.cv++;
                    c.bit = c.cv >= c.pv; c.lastCU = flow; c.lastR = rNow;
                    break;
                }
                case 'CTD': {
                    const c = this._C[this._parseIndex(addr, 'C')];
                    if (pv !== undefined) c.pv = pv;
                    const ldNow = addr2 ? this._readBit(addr2) : false;
                    if (ldNow) { c.cv = c.pv; c.bit = false; }
                    else if (flow && !c.lastCD) c.cv = Math.max(0, c.cv - 1);
                    c.bit = c.cv === 0; c.lastCD = flow;
                    break;
                }
                case 'CTUD': {
                    const c  = this._C[this._parseIndex(addr, 'C')];
                    if (pv !== undefined) c.pv = pv;
                    const cuNow = flow;
                    const cdNow = addr2 ? this._readBit(addr2) : false;
                    const rNow2 = addr3 ? this._readBit(addr3) : false;
                    if (rNow2) { c.cv = 0; c.bit = false; }
                    else {
                        if (cuNow && !c.lastCU) c.cv++;
                        if (cdNow && !c.lastCD) c.cv = Math.max(0, c.cv - 1);
                    }
                    c.bit = c.cv >= c.pv; c.lastCU = cuNow; c.lastCD = cdNow;
                    break;
                }

                // ── 整数比较 ─────────────────────────────
                case '==I': case 'EQ_I':  flow = flow && (this._readWord(addr) === this._readWord(addr2)); break;
                case '<>I': case 'NEQ_I': flow = flow && (this._readWord(addr) !== this._readWord(addr2)); break;
                case '>=I': case 'GEQ_I': flow = flow && (this._readWord(addr) >= this._readWord(addr2)); break;
                case '<=I': case 'LEQ_I': flow = flow && (this._readWord(addr) <= this._readWord(addr2)); break;
                case '>I':  case 'GT_I':  flow = flow && (this._readWord(addr) > this._readWord(addr2)); break;
                case '<I':  case 'LT_I':  flow = flow && (this._readWord(addr) < this._readWord(addr2)); break;

                // ── 实数比较 ─────────────────────────────
                case '==R': flow = flow && (Math.abs(this.readReal(addr) - this.readReal(addr2)) < 1e-7); break;
                case '>=R': flow = flow && (this.readReal(addr) >= this.readReal(addr2)); break;
                case '<=R': flow = flow && (this.readReal(addr) <= this.readReal(addr2)); break;
                case '>R':  flow = flow && (this.readReal(addr) > this.readReal(addr2)); break;
                case '<R':  flow = flow && (this.readReal(addr) < this.readReal(addr2)); break;

                // ── 传送 ─────────────────────────────────
                case 'MOV_B': if (flow) this._writeByte(addr2, this._readByte(addr)); break;
                case 'MOV_W': if (flow) this._writeWord(addr2, this._readWord(addr)); break;
                case 'MOV_R': if (flow) this._writeReal(addr2, this.readReal(addr));  break;
                case 'MOVD': {  // 双字传送（32bit）
                    if (flow) {
                        const lo = this._readWord(addr);
                        const hi = this._readWord(addr.replace(/(\d+)$/, n => String(parseInt(n) + 2)));
                        this._writeWord(addr2, lo);
                        this._writeWord(addr2.replace(/(\d+)$/, n => String(parseInt(n) + 2)), hi);
                    }
                    break;
                }

                // ── 整数算术 ─────────────────────────────
                case 'ADD_I': if (flow) this._writeWord(addr2, this._readWord(addr) + this._readWord(addr2)); break;
                case 'SUB_I': if (flow) this._writeWord(addr2, this._readWord(addr) - this._readWord(addr2)); break;
                case 'MUL_I': if (flow) this._writeWord(addr2, this._readWord(addr) * this._readWord(addr2)); break;
                case 'DIV_I': if (flow) { const d = this._readWord(addr2); if (d) this._writeWord(addr2, Math.trunc(this._readWord(addr) / d)); } break;
                case 'MOD_I': if (flow) { const d = this._readWord(addr2); if (d) this._writeWord(addr2, this._readWord(addr) % d); } break;
                case 'INCB':  if (flow) this._writeByte(addr, (this._readByte(addr) + 1) & 0xFF); break;
                case 'DECB':  if (flow) this._writeByte(addr, (this._readByte(addr) - 1 + 256) & 0xFF); break;
                case 'INCW':  if (flow) this._writeWord(addr, this._readWord(addr) + 1); break;
                case 'DECW':  if (flow) this._writeWord(addr, this._readWord(addr) - 1); break;

                // ── 实数算术 ─────────────────────────────
                case '+R':    if (flow) this._writeReal(addr2, this.readReal(addr) + this.readReal(addr2)); break;
                case '-R':    if (flow) this._writeReal(addr2, this.readReal(addr) - this.readReal(addr2)); break;
                case '*R':    if (flow) this._writeReal(addr2, this.readReal(addr) * this.readReal(addr2)); break;
                case '/R':    if (flow) { const d = this.readReal(addr2); if (d) this._writeReal(addr2, this.readReal(addr) / d); } break;
                case 'SQRT':  if (flow) this._writeReal(addr2, Math.sqrt(Math.max(0, this.readReal(addr)))); break;
                case 'LN':    if (flow) { const v = this.readReal(addr); if (v > 0) this._writeReal(addr2, Math.log(v)); } break;
                case 'EXP':   if (flow) this._writeReal(addr2, Math.exp(this.readReal(addr))); break;
                case 'SIN':   if (flow) this._writeReal(addr2, Math.sin(this.readReal(addr))); break;
                case 'COS':   if (flow) this._writeReal(addr2, Math.cos(this.readReal(addr))); break;
                case 'TAN':   if (flow) this._writeReal(addr2, Math.tan(this.readReal(addr))); break;

                // ── 类型转换 ─────────────────────────────
                case 'ITD':   if (flow) this._writeWord(addr2, this._readWord(addr)); break;  // Int→DInt
                case 'DTI':   if (flow) this._writeWord(addr2, this._readWord(addr)); break;  // DInt→Int
                case 'DTR':   if (flow) this._writeReal(addr2, this._readWord(addr)); break;  // DInt→Real
                case 'TRUNC': if (flow) this._writeWord(addr2, Math.trunc(this.readReal(addr))); break;
                case 'ROUND': if (flow) this._writeWord(addr2, Math.round(this.readReal(addr))); break;

                // ── 位移 ─────────────────────────────────
                case 'LSHIFT_B': if (flow) this._writeByte(addr, (this._readByte(addr) << (pv || 1)) & 0xFF); break;
                case 'RSHIFT_B': if (flow) this._writeByte(addr, (this._readByte(addr) >> (pv || 1)) & 0xFF); break;
                case 'LSHIFT_W': if (flow) this._writeWord(addr, (this._readWord(addr) << (pv || 1)) & 0xFFFF); break;
                case 'RSHIFT_W': if (flow) this._writeWord(addr, (this._readWord(addr) >> (pv || 1)) & 0xFFFF); break;
                case 'ROL_B': {
                    if (flow) {
                        const n  = (pv || 1) & 7;
                        const b  = this._readByte(addr) & 0xFF;
                        this._writeByte(addr, ((b << n) | (b >> (8 - n))) & 0xFF);
                    }
                    break;
                }
                case 'ROR_B': {
                    if (flow) {
                        const n  = (pv || 1) & 7;
                        const b  = this._readByte(addr) & 0xFF;
                        this._writeByte(addr, ((b >> n) | (b << (8 - n))) & 0xFF);
                    }
                    break;
                }

                // ── 逻辑运算 ─────────────────────────────
                case 'AND_B':  if (flow) this._writeByte(addr2, this._readByte(addr) & this._readByte(addr2)); break;
                case 'OR_B':   if (flow) this._writeByte(addr2, this._readByte(addr) | this._readByte(addr2)); break;
                case 'XOR_B':  if (flow) this._writeByte(addr2, this._readByte(addr) ^ this._readByte(addr2)); break;
                case 'INV_B':  if (flow) this._writeByte(addr,  (~this._readByte(addr)) & 0xFF); break;
                case 'AND_W':  if (flow) this._writeWord(addr2, this._readWord(addr) & this._readWord(addr2)); break;
                case 'OR_W':   if (flow) this._writeWord(addr2, this._readWord(addr) | this._readWord(addr2)); break;
                case 'XOR_W':  if (flow) this._writeWord(addr2, this._readWord(addr) ^ this._readWord(addr2)); break;

                // ── PID 控制器 ───────────────────────────
                case 'PID':
                case 'PIDX': {
                    const loopN  = loop  !== undefined ? loop  : (parseInt(addr)  || 0);
                    const tableN = table !== undefined ? table : (parseInt(addr2) || 0);
                    this._execPID(loopN, tableN, flow);
                    break;
                }

                // ── 跳转 ─────────────────────────────────
                case 'JMP':
                    if (flow) return { jmp: addr };
                    break;
                case 'LBL':
                    break;  // 标签本身不执行

                // ── 子程序 ──────────────────────────────
                case 'CALL': {
                    if (flow) {
                        // 查找以 SBR_addr 命名的 network
                        const subr = (this._program.networks || []).find(
                            n => n.name && n.name.toUpperCase() === `SBR_${String(addr).toUpperCase()}`
                        );
                        if (subr) {
                            for (const r of (subr.rungs || [])) {
                                this._execRung(r, 0, 0);
                            }
                        }
                    }
                    break;
                }

                // ── 其他 ─────────────────────────────────
                case 'FILL_B': {
                    if (flow) {
                        const n    = pv || 1;
                        const val  = this._readByte(addr);
                        const base = parseInt(addr2.replace(/[A-Za-z]/g, '')) || 0;
                        for (let k = 0; k < n; k++) {
                            this._V[base + k] = val & 0xFF;
                        }
                    }
                    break;
                }

                case 'NOP': break;
                default:    break;
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════
    // 定时器 / SM 更新
    // ═══════════════════════════════════════════════════════

    _tickTimers(dtMs) {
        for (let i = 0; i < 256; i++) {
            const t = this._T[i];
            if (!t.enabled) continue;
            t.accMs += dtMs;
            const ticks = Math.floor(t.accMs / t.timeBase);
            if (ticks > 0) {
                t.accMs -= ticks * t.timeBase;
                if (t.type === 'TON' || t.type === 'TONR') {
                    t.cv = Math.min(t.cv + ticks, 32767);
                    if (t.cv >= t.pv) t.bit = true;
                } else if (t.type === 'TOF') {
                    t.cv = Math.min(t.cv + ticks, 32767);
                    if (t.cv >= t.pv) { t.bit = false; t.enabled = false; }
                }
            }
        }
    }

    _tickSM(dtMs) {
        this._smOscMs4 += dtMs;
        this._smOscMs5 += dtMs;
        if (this._smOscMs5 >= 500) {
            this._smOscMs5 -= 500; this._smFlip5 = !this._smFlip5;
            if (this._smFlip5) this._SM[0] |= 0x20; else this._SM[0] &= ~0x20;
        }
        if (this._smOscMs4 >= 30000) {
            this._smOscMs4 -= 30000; this._smFlip4 = !this._smFlip4;
            if (this._smFlip4) this._SM[0] |= 0x10; else this._SM[0] &= ~0x10;
        }
    }

    // ═══════════════════════════════════════════════════════
    // 默认示例程序（含 PID 示例）
    // ═══════════════════════════════════════════════════════

    _getDefaultProgram() {
        return {
            name: 'ST20 v2 演示程序',
            networks: [
                {
                    comment: 'Network 1 · 启保停（I0.0=启 I0.1=停 Q0.0=运行）',
                    rungs: [[
                        { op:'LD', addr:'I0.0' },
                        { op:'O',  addr:'Q0.0' },
                        { op:'AN', addr:'I0.1' },
                        { op:'=',  addr:'Q0.0' },
                    ]]
                },
                {
                    comment: 'Network 2 · AI0→VD0（PV），SP=5.0V，PID输出→AQW0',
                    rungs: [
                        [{  // 读取 AI0 → 转工程值存入 PV（VD0）
                            op:'LD',    addr:'SM0.0',
                        },{
                            op:'MOV_W', addr:'AIW0', addr2:'VW100',
                        }],
                        [{  // 将整数 VW100 转实数 → VD0（PV）
                            op:'LD',   addr:'SM0.0',
                        },{
                            op:'DTR',  addr:'VW100', addr2:'VD0',
                        },{
                            op:'*R',   addr:'0.000362', addr2:'VD0',  // /27648×10
                        }],
                        [{  // PID 运算（回路0，参数表 VD0）
                            op:'LD',  addr:'Q0.0',
                        },{
                            op:'PID', addr:'0', addr2:'0', loop:0, table:0,
                        }],
                        [{  // PID 输出 × 27648 → AQW0
                            op:'LD',   addr:'SM0.0',
                        },{
                            op:'MOV_R', addr:'VD8', addr2:'VD200',
                        },{
                            op:'*R',   addr:'27648.0', addr2:'VD200',
                        },{
                            op:'TRUNC', addr:'VD200', addr2:'VW200',
                        },{
                            op:'MOV_W', addr:'VW200', addr2:'AQW0',
                        }],
                    ]
                },
                {
                    comment: 'Network 3 · SM0.5 闪烁（Q0.7，运行时）',
                    rungs: [[
                        { op:'LD', addr:'SM0.5' },
                        { op:'A',  addr:'Q0.0'  },
                        { op:'=',  addr:'Q0.7'  },
                    ]]
                },
                {
                    comment: 'Network 4 · 计时器 T0（3s→Q0.1）',
                    rungs: [
                        [{ op:'LD', addr:'I0.2' },{ op:'TON', addr:'T0', pv:30, timeBase:100 }],
                        [{ op:'LD', addr:'T0'   },{ op:'=',   addr:'Q0.1' }],
                    ]
                },
            ]
        };
    }

    // ═══════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════

    _registerPorts() {
        for (let i = 0; i < 8; i++) {
            const p = this._portPositions[`I0.${i}`];
            this.addPort(p.x, p.y, `I0.${i}`, 'wire', 'p');
        }
        for (let i = 0; i < 4; i++) {
            const p = this._portPositions[`I1.${i}`];
            this.addPort(p.x, p.y, `I1.${i}`, 'wire', 'p');
        }
        for (let i = 0; i < 8; i++) {
            const p = this._portPositions[`Q0.${i}`];
            this.addPort(p.x, p.y, `Q0.${i}`, 'wire');
        }
        const pwr = this._portPositions['PWR_IN'];
        this.addPort(pwr.x, pwr.y, 'PWR_IN', 'wire', 'p');
        const bus = this._portPositions['BUS_R'];
        this.addPort(bus.x, bus.y, 'BUS_R', 'bus');
    }

    // ═══════════════════════════════════════════════════════
    // 绘图（保持 v1 外观，追加扩展总线接头）
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    _drawStaticParts() {
        this._drawBody();
        this._drawTopBar();
        this._drawPorts();
        this._drawBusRight();
        this._drawTerminalBlock();
        this._drawDINRail();
        this._drawLabels();
        this._drawNameplate();
        this._drawVentSlots();
        this._drawPortLabels();
    }

    _drawBody() {
        const b = this._body;
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#d8d8d8', stroke: '#888', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetX: 2, shadowOffsetY: 3, shadowOpacity: 0.25,
        }));
        this._staticGroup.add(new Konva.Rect({
            x: b.w - 6, y: 4, width: 4, height: b.h - 8,
            fill: 'rgba(255,255,255,0.35)',
            cornerRadius: [0, b.rx, b.rx, 0],
        }));
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 4, width: 4, height: b.h - 8,
            fill: 'rgba(0,0,0,0.10)',
            cornerRadius: [b.rx, 0, 0, b.rx],
        }));
    }

    _drawTopBar() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.10,
            fill: '#1a6fa8', cornerRadius: [4, 4, 0, 0],
        }));
        this._staticGroup.add(new Konva.Text({
            x: 6, y: H * 0.013, text: 'SIMATIC',
            fontSize: Math.max(7, H * 0.030),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold', fill: '#ffffff', letterSpacing: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: 6, y: H * 0.052, text: 'S7-200 SMART',
            fontSize: Math.max(6, H * 0.024),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#b8d8f0', letterSpacing: 0.5,
        }));
    }

    _drawPorts() {
        const W = this.width, H = this.height;
        const e = this._ethPort;
        this._staticGroup.add(new Konva.Rect({
            x: e.x, y: e.y, width: e.w, height: e.h,
            fill: '#2a2a2a', stroke: '#555', strokeWidth: 1, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: e.x, y: e.y + e.h + 2, text: 'ETH',
            fontSize: Math.max(5, H * 0.022), fontFamily: 'Arial', fill: '#555',
            align: 'center', width: e.w,
        }));
        const r = this._rsPort;
        this._staticGroup.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.w, height: r.h,
            fill: '#2a2a2a', stroke: '#555', strokeWidth: 1, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: r.x, y: r.y + r.h + 2, text: '485',
            fontSize: Math.max(5, H * 0.022), fontFamily: 'Arial', fill: '#555',
            align: 'center', width: r.w,
        }));
        const k = this._modeKnob;
        this._staticGroup.add(new Konva.Circle({
            x: k.x, y: k.y, radius: k.r, fill: '#333', stroke: '#222', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: k.x + k.r + 3, y: k.y - H * 0.018,
            text: 'RUN\nSTOP', fontSize: Math.max(5, H * 0.020),
            fontFamily: 'Arial', fill: '#444', lineHeight: 1.4,
        }));
    }

    _drawBusRight() {
        // 右侧扩展总线公头（v2 新增）
        const W = this.width, H = this.height;
        const br = this._busRight;
        this._staticGroup.add(new Konva.Rect({
            x: br.x - 2, y: br.y, width: br.w + 2, height: br.h,
            fill: '#2a2a30', stroke: '#555', strokeWidth: 1,
            cornerRadius: [0, 2, 2, 0],
        }));
        for (let i = 0; i < 5; i++) {
            this._staticGroup.add(new Konva.Circle({
                x: br.x + br.w - 2,
                y: br.y + br.h * (0.15 + i * 0.175),
                radius: 1.5, fill: '#c8b040',
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: br.x - 2, y: br.y + br.h + 2,
            text: 'BUS', fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Arial', fill: '#6090b0',
        }));
    }

    _drawTerminalBlock() {
        const W = this.width, H = this.height;
        const it = this._inputTerminals;
        this._staticGroup.add(new Konva.Rect({
            x: it.x, y: it.y, width: it.w, height: it.h,
            fill: '#333', stroke: '#222', strokeWidth: 1, cornerRadius: 2,
        }));
        for (let i = 0; i < 12; i++) {
            const tx = it.x + it.w * (0.03 + i * 0.079);
            this._staticGroup.add(new Konva.Rect({
                x: tx, y: it.y + it.h * 0.15,
                width: it.w * 0.055, height: it.h * 0.70,
                fill: '#888', stroke: '#666', strokeWidth: 0.5, cornerRadius: 1,
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: it.x + it.w * 0.38, y: it.y - H * 0.035,
            text: 'INPUT', fontSize: Math.max(6, H * 0.024),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#2a7fbf',
        }));
        const ot = this._outputTerminals;
        this._staticGroup.add(new Konva.Rect({
            x: ot.x, y: ot.y, width: ot.w, height: ot.h,
            fill: '#333', stroke: '#222', strokeWidth: 1, cornerRadius: 2,
        }));
        for (let i = 0; i < 8; i++) {
            const tx = ot.x + ot.w * (0.04 + i * 0.122);
            this._staticGroup.add(new Konva.Rect({
                x: tx, y: ot.y + ot.h * 0.15,
                width: ot.w * 0.08, height: ot.h * 0.70,
                fill: '#888', stroke: '#666', strokeWidth: 0.5, cornerRadius: 1,
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: ot.x + ot.w * 0.25, y: ot.y - H * 0.035,
            text: 'OUTPUT', fontSize: Math.max(6, H * 0.024),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#bf5c2a',
        }));
    }

    _drawDINRail() {
        const dr = this._dinRail;
        this._staticGroup.add(new Konva.Rect({
            x: dr.x, y: dr.y, width: dr.w, height: dr.h,
            fill: '#b0b0b0', stroke: '#888', strokeWidth: 0.5,
            cornerRadius: [0, 0, 4, 4],
        }));
        [0.08, 0.88].forEach(px => {
            this._staticGroup.add(new Konva.Rect({
                x: dr.x + dr.w * px, y: dr.y,
                width: dr.w * 0.06, height: dr.h * 0.60,
                fill: '#777', stroke: '#555', strokeWidth: 0.5,
                cornerRadius: [0, 0, 2, 2],
            }));
        });
    }

    _drawLabels() {
        const W = this.width, H = this.height;
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: H * 0.345, text: 'I  :',
            fontSize: Math.max(6, H * 0.028),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold', fill: '#2a7fbf',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: H * 0.445, text: 'I1:',
            fontSize: Math.max(6, H * 0.028),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold', fill: '#2a7fbf',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: H * 0.565, text: 'Q  :',
            fontSize: Math.max(6, H * 0.028),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold', fill: '#bf5c2a',
        }));
    }

    _drawPortLabels() {
        const W = this.width, H = this.height;
        for (let i = 0; i < 8; i++) {
            this._staticGroup.add(new Konva.Text({
                x: W * (0.028 + i * 0.115), y: H * 0.405, text: `.${i}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace', fill: '#2a7fbf',
            }));
        }
        for (let i = 0; i < 4; i++) {
            this._staticGroup.add(new Konva.Text({
                x: W * (0.028 + i * 0.115), y: H * 0.505, text: `.${i}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace', fill: '#2a7fbf',
            }));
        }
        for (let i = 0; i < 8; i++) {
            this._staticGroup.add(new Konva.Text({
                x: W * (0.028 + i * 0.115), y: H * 0.628, text: `.${i}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace', fill: '#bf5c2a',
            }));
        }
    }

    _drawNameplate() {
        const np = this._nameplate;
        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fill: '#f5f0e0', stroke: '#aaa', strokeWidth: 0.8, cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 4, y: np.y + 3, text: 'CPU ST20',
            fontSize: Math.max(8, this.height * 0.038),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold', fill: '#1a1a1a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 4, y: np.y + np.h * 0.52,
            text: '6ES7 288-1ST20-0AA0',
            fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Consolas, monospace', fill: '#555',
        }));
    }

    _drawVentSlots() {
        const W = this.width, H = this.height;
        for (let i = 0; i < 6; i++) {
            this._staticGroup.add(new Konva.Rect({
                x: W * 0.94, y: H * (0.32 + i * 0.052),
                width: W * 0.04, height: H * 0.030,
                fill: '#bbb', stroke: '#999', strokeWidth: 0.5, cornerRadius: 1,
            }));
        }
    }

    // ── 动态部件 ─────────────────────────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();
        this._drawLEDs();
        this._drawRunIndicator();
        this._drawScanInfo();
        this._drawModeKnob();
        this._drawLabelText();
        this._drawExpansionStatus();
        this._drawPIDStatus();
    }

    _drawLEDs() {
        this._inputLEDs0.forEach(led => {
            const on = !!(this._I[led.byte] & (1 << led.bit));
            this._drawLED(led.x, led.y, led.r, on, 'input');
        });
        this._inputLEDs1.forEach(led => {
            const on = !!(this._I[led.byte] & (1 << led.bit));
            this._drawLED(led.x, led.y, led.r, on, 'input');
        });
        this._outputLEDs.forEach(led => {
            const on = !!(this._Q[led.byte] & (1 << led.bit));
            this._drawLED(led.x, led.y, led.r, on, 'output');
        });
    }

    _drawLED(x, y, r, on, type) {
        const colors = {
            input:  { on: '#f5c842', off: '#3a3000', glow: '#f5c842' },
            output: { on: '#f07030', off: '#3a1500', glow: '#f07030' },
            run:    { on: '#44cc44', off: '#003300', glow: '#44cc44' },
            stop:   { on: '#ee3333', off: '#330000', glow: '#ee3333' },
            error:  { on: '#ff8800', off: '#331500', glow: '#ff8800' },
        };
        const c = colors[type] || colors.input;
        this._dynamicGroup.add(new Konva.Circle({
            x, y, radius: r, fill: on ? c.on : c.off,
            stroke: on ? '#888' : '#444', strokeWidth: 0.8,
            shadowColor: on ? c.glow : 'transparent',
            shadowBlur:  on ? r * 3 : 0, shadowOpacity: 0.9,
        }));
    }

    _drawRunIndicator() {
        const leds = this._leds;
        const isRun  = this._running && !this._errorState;
        const isStop = !this._running && !this._errorState;
        const isErr  = this._errorState;

        this._drawLED(leds.run.x,  leds.run.y,  leds.run.r,  isRun,  'run');
        this._dynamicGroup.add(new Konva.Text({
            x: leds.run.x + leds.run.r + 3, y: leds.run.y - leds.run.r,
            text: 'RUN', fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: isRun ? '#44cc44' : '#555',
        }));

        this._drawLED(leds.stop.x, leds.stop.y, leds.stop.r, isStop, 'stop');
        this._dynamicGroup.add(new Konva.Text({
            x: leds.stop.x + leds.stop.r + 3, y: leds.stop.y - leds.stop.r,
            text: 'STOP', fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: isStop ? '#ee3333' : '#555',
        }));

        this._drawLED(leds.error.x, leds.error.y, leds.error.r, isErr, 'error');
        this._dynamicGroup.add(new Konva.Text({
            x: leds.error.x + leds.error.r + 3, y: leds.error.y - leds.error.r,
            text: 'ERR', fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: isErr ? '#ff8800' : '#555',
        }));
    }

    _drawScanInfo() {
        const W = this.width, H = this.height;
        if (this._running) {
            this._dynamicGroup.add(new Konva.Text({
                x: W * 0.56, y: H * 0.265,
                text: `#${this._scanCount}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace', fill: '#2a9',
            }));
        }
    }

    _drawExpansionStatus() {
        const W = this.width, H = this.height;
        if (this._expansionSlots.length === 0) return;
        const text = `EXP: ${this._expansionSlots.map(s =>
            s.type.replace('s7200_smart_','').toUpperCase().slice(0,4)
        ).join(' ')}`;
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.56, y: H * 0.285,
            text,
            fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Consolas, monospace', fill: '#2a8aaa',
        }));
    }

    _drawPIDStatus() {
        const W = this.width, H = this.height;
        const activeLoops = this._pidState
            .map((s, i) => s.active ? i : -1)
            .filter(i => i >= 0);
        if (activeLoops.length === 0) return;
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.56, y: H * 0.302,
            text: `PID: ${activeLoops.map(i => {
                const base = i * 36;
                const mx   = this.readReal(`VD${base + 8}`);
                return `L${i}=${(mx * 100).toFixed(0)}%`;
            }).join(' ')}`,
            fontSize: Math.max(5, H * 0.018),
            fontFamily: 'Consolas, monospace', fill: '#aa9a22',
        }));
    }

    _drawModeKnob() {
        const k = this._modeKnob;
        const angle = this._running ? -30 : 30;
        const rad   = angle * Math.PI / 180;
        const px    = k.x + Math.sin(rad) * k.r * 0.65;
        const py    = k.y - Math.cos(rad) * k.r * 0.65;
        this._dynamicGroup.add(new Konva.Line({
            points: [k.x, k.y, px, py],
            stroke: this._running ? '#44cc44' : '#ee3333',
            strokeWidth: 1.5, lineCap: 'round',
        }));
        this._dynamicGroup.add(new Konva.Circle({
            x: k.x, y: k.y, radius: k.r * 0.25, fill: '#888',
        }));
    }

    _drawLabelText() {
        const W = this.width, H = this.height;
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.56, y: H * 0.235, text: this.label,
            fontSize: Math.max(8, H * 0.032),
            fontFamily: 'Arial', fontStyle: 'bold', fill: '#1a4f7a',
        }));
    }

    // ── 交互 ─────────────────────────────────────────────────

    _bindInteraction() {
        const knobHit = new Konva.Circle({
            x: this._modeKnob.x, y: this._modeKnob.y,
            radius: this._modeKnob.r * 2, fill: 'transparent',
        });
        knobHit.on('click tap', () => this.toggleRun());
        this._interactGroup.add(knobHit);

        this._inputLEDs0.forEach(led => {
            const hit = new Konva.Circle({
                x: led.x, y: led.y, radius: led.r * 3, fill: 'transparent',
            });
            hit.on('click tap', () => this.toggleInput(led.byte, led.bit));
            this._interactGroup.add(hit);
        });
        this._inputLEDs1.forEach(led => {
            const hit = new Konva.Circle({
                x: led.x, y: led.y, radius: led.r * 3, fill: 'transparent',
            });
            hit.on('click tap', () => this.toggleInput(led.byte, led.bit));
            this._interactGroup.add(hit);
        });
    }

    // ═══════════════════════════════════════════════════════
    // tick（主循环，v2：驱动扩展模块）
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const dtMs = dt * 1000;

        this._tickSM(dtMs);
        this._tickTimers(dtMs);

        if (this._running) {
            this._accumMs += dtMs;
            if (this._accumMs >= this._scanCycleMs) {
                this._accumMs -= this._scanCycleMs;

                // 先让输入模块更新 AIW（采样阶段）
                for (const entry of this._expansionSlots) {
                    const m = entry.module;
                    if (m && typeof m._pushToCPU === 'function') {
                        m._pushToCPU();          // AI04 等主动推数据
                    }
                }

                // 执行梯形图扫描
                this._execScan();

                // 输出模块刷新（输出阶段）
                for (const entry of this._expansionSlots) {
                    const m = entry.module;
                    if (m && typeof m._pollCPU === 'function') {
                        m._pollCPU();            // AQ04 等从 AQW 读数据
                    }
                    // DT16/DE8 数字量扩展：同步 I/Q 字节
                    if (entry.type === 's7200_smart_dt16') {
                        this._syncDT16(entry);
                    }
                    if (entry.type === 's7200_smart_de8') {
                        this._syncDE8(entry);
                    }
                }

                this._rebuildDynamic();
                this.markDirty();
            }
        }

        // 驱动扩展模块自身 tick（波形/动画更新）
        for (const entry of this._expansionSlots) {
            if (entry.module && typeof entry.module.tick === 'function') {
                entry.module.tick(dt);
            }
        }

        this._refreshIfDirty();
    }

    /** DT16 数字量扩展同步（IB 读入 / QB 写出） */
    _syncDT16(entry) {
        const m = entry.module;
        if (!m) return;
        // 读 DT16 输入（16点）→ CPU IB[diBase], IB[diBase+1]
        if (m._I) {
            this._I[entry.diBase]     = m._I[0] || 0;
            this._I[entry.diBase + 1] = m._I[1] || 0;
        }
        // CPU QB[doBase] → DT16 输出（16点）
        if (m._Q) {
            m._Q[0] = this._Q[entry.doBase] || 0;
            m._Q[1] = this._Q[entry.doBase + 1] || 0;
        }
    }

    /** DE8 数字量输入扩展同步（8点输入） */
    _syncDE8(entry) {
        const m = entry.module;
        if (!m || !m._I) return;
        this._I[entry.diBase] = m._I[0] || 0;
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API（v2 新增）
    // ═══════════════════════════════════════════════════════

    toggleRun() {
        if (this._errorState) { this._errorState = false; this._errorMsg = ''; }
        this._running = !this._running;
        if (this._running) { this._firstScan = true; this._accumMs = 0; }
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    run()  { if (!this._running) this.toggleRun(); }
    stop() { if (this._running)  this.toggleRun(); }

    toggleInput(byteN, bitN) {
        this._I[byteN] ^= (1 << bitN);
        this._rebuildDynamic(); this.markDirty();
    }

    setInput(byteN, bitN, val) {
        if (val) this._I[byteN] |=  (1 << bitN);
        else     this._I[byteN] &= ~(1 << bitN);
    }

    getOutput(byteN, bitN) { return !!(this._Q[byteN] & (1 << bitN)); }

    /** 读 AIW（原始整数） */
    readAIW(channel) {
        const off = channel * 2;
        const raw = (this._AIW[off] << 8) | this._AIW[off + 1];
        return raw > 32767 ? raw - 65536 : raw;
    }

    /** 写 AQW（原始整数） */
    writeAQW(channel, val) {
        const off = channel * 2;
        val = Math.max(-32768, Math.min(32767, Math.round(val)));
        const u = val < 0 ? val + 65536 : val;
        this._AQW[off]     = (u >> 8) & 0xFF;
        this._AQW[off + 1] = u & 0xFF;
    }

    /** 读 AQW */
    readAQW(channel) {
        const off = channel * 2;
        const raw = (this._AQW[off] << 8) | this._AQW[off + 1];
        return raw > 32767 ? raw - 65536 : raw;
    }

    /** 读取/写入 VD 实数（外部接口） */
    getVD(byteAddr)          { return this.readReal(`VD${byteAddr}`); }
    setVD(byteAddr, val)     { this._writeReal(`VD${byteAddr}`, val); }

    /** 设置 PID 参数（loop 回路号，tableBase VD 字节地址） */
    setPIDParam(loop, param, val) {
        const offsets = { PV:0, SP:4, MX:8, Kc:12, Ts:16, Ti:20, Td:24, MXmax:28, MXmin:32 };
        const base    = loop * 36;
        const off     = offsets[param];
        if (off !== undefined) this._writeReal(`VD${base + off}`, val);
    }

    getPIDState(loop) {
        const base = loop * 36;
        return {
            PV:    this.readReal(`VD${base}`),
            SP:    this.readReal(`VD${base + 4}`),
            MX:    this.readReal(`VD${base + 8}`),
            Kc:    this.readReal(`VD${base + 12}`),
            Ts:    this.readReal(`VD${base + 16}`),
            Ti:    this.readReal(`VD${base + 20}`),
            Td:    this.readReal(`VD${base + 24}`),
            MXmax: this.readReal(`VD${base + 28}`),
            MXmin: this.readReal(`VD${base + 32}`),
            Ix:    this._pidState[loop]?.Ix    ?? 0,
            active:this._pidState[loop]?.active ?? false,
        };
    }

    /** 加载梯形图 */
    loadProgram(prog) {
        const wasRunning = this._running;
        this._running = false;
        try {
            this._program    = typeof prog === 'string' ? JSON.parse(prog) : prog;
            this._scanCount  = 0;
            this._firstScan  = true;
            this._errorState = false;
            this._errorMsg   = '';
            this._labelCache = {};
            this.config.ladderProgram = JSON.stringify(this._program);
        } catch (e) {
            this._errorState = true;
            this._errorMsg   = `程序格式错误：${e.message}`;
        }
        if (wasRunning && !this._errorState) this._running = true;
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    /** 完整存储区快照 */
    getMemorySnapshot() {
        return {
            I:   Array.from(this._I.slice(0, 10)),
            Q:   Array.from(this._Q.slice(0, 5)),
            M:   Array.from(this._M.slice(0, 8)),
            AIW: Array.from(this._AIW.slice(0, 16)),
            AQW: Array.from(this._AQW.slice(0, 16)),
            T:   this._T.slice(0, 16).map(t => ({ cv: t.cv, pv: t.pv, bit: t.bit })),
            C:   this._C.slice(0, 16).map(c => ({ cv: c.cv, pv: c.pv, bit: c.bit })),
            VW:  [0,2,4,6,8,10,100,102,200,202].map(a => this._readWord(`VW${a}`)),
            VD:  [0,4,8,12,16].map(a => this.readReal(`VD${a}`)),
        };
    }

    reset() {
        this._running = false;
        this._initMemory();
        this._initPID([]);
        this._scanCount  = 0;
        this._firstScan  = true;
        this._errorState = false;
        this._errorMsg   = '';
        this._accumMs    = 0;
        this._labelCache = {};
        this._rebuildDynamic(); this.markDirty(); this._refreshCache();
    }

    isRunning()    { return this._running; }
    hasError()     { return this._errorState; }
    getError()     { return this._errorMsg; }
    getScanCount() { return this._scanCount; }

    /** 获取已挂载模块信息 */
    getExpansionInfo() {
        return this._expansionSlots.map(s => ({
            slot: s.slot,
            type: s.type,
            aiBase: s.aiBase,
            aqBase: s.aqBase,
        }));
    }

    // ═══════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号',              key: 'label',         type: 'text'     },
            { label: '扫描周期 (ms)',      key: 'scanCycleMs',   type: 'number'   },
            { label: '梯形图程序 (JSON)',  key: 'ladderProgram', type: 'textarea' },
        ];
    }

    onConfigUpdate(cfg) {
        if (cfg.label         !== undefined) this.label = cfg.label;
        if (cfg.scanCycleMs   !== undefined) this._scanCycleMs = Math.max(1, parseFloat(cfg.scanCycleMs));
        if (cfg.ladderProgram !== undefined) this.loadProgram(cfg.ladderProgram);
        this.config = { ...this.config, ...cfg };
        this._recalcGeometry();
        this._refreshCache();
    }

    destroy() {
        // 卸载所有扩展模块
        [...this._expansionSlots].forEach(s => this.unmountModule(s.slot));
        super.destroy?.();
    }
}
