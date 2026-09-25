import { BaseComponent } from './BaseComponent.js';

/**
 * 西门子 S7-200 SMART CPU ST20 仿真组件
 *
 * ── 硬件规格 ─────────────────────────────────────────────────────
 *
 *  CPU ST20：
 *    - 程序存储器：20 KB
 *    - 数据存储器：10 KB
 *    - 数字量输入：  I0.0 ~ I0.7（共 8 点）+ I1.0 ~ I1.3（共 4 点）= 12 点
 *    - 数字量输出：  Q0.0 ~ Q0.7（共 8 点）
 *    - 高速计数器：  4 路（最高 200 kHz）
 *    - 脉冲输出：    2 路（最高 100 kHz）
 *    - 供电：        DC 24V
 *    - 通信：        1× RS-485（端口0，PROFIBUS/自由口）
 *                   1× RJ45 以太网
 *
 * ── 梯形图执行引擎 ──────────────────────────────────────────────
 *
 *  支持指令：
 *    位逻辑：    LD / LDN / A / AN / O / ON / NOT / =
 *    置位复位：  S / R
 *    计时器：    TON / TOF / TONR（时基 10ms / 100ms / 1s）
 *    计数器：    CTU / CTD / CTUD（PV 0~32767）
 *    比较：      ==I / <>I / >=I / <=I / >I / <I
 *    传送：      MOV_B / MOV_W
 *    运算：      ADD_I / SUB_I / MUL_I / DIV_I
 *    跳转：      JMP / LBL
 *    子程序：    CALL / SBR / RET
 *
 *  执行方式：
 *    扫描周期模拟（默认 10 ms），支持 RUN / STOP / SINGLE SCAN
 *
 * ── 存储区 ──────────────────────────────────────────────────────
 *
 *  I   输入映像寄存器   IB0~IB1（12 位）
 *  Q   输出映像寄存器   QB0（8 位）
 *  M   内部标志位       MB0~MB31（256 位）
 *  T   定时器           T0~T255（当前值 + 位）
 *  C   计数器           C0~C255（当前值 + 位）
 *  V   变量存储器       VB0~VB4999
 *  L   局部存储器       LB0~LB63
 *  SM  特殊存储器       SM0.0(Always ON) SM0.1(首次扫描)
 *                      SM0.4(1min振荡) SM0.5(1s振荡)
 *
 * ── 端口 ────────────────────────────────────────────────────────
 *  动态注册：I0.0~I0.7, I1.0~I1.3  → 数字量输入端口
 *            Q0.0~Q0.7             → 数字量输出端口
 *            PWR_IN               → 24V DC 电源输入
 *
 * ── 可配置参数 ────────────────────────────────────────────────────
 *  label           : 位号（默认 'PLC1'）
 *  scanCycleMs     : 扫描周期 ms（默认 10）
 *  initRun         : 初始是否运行（默认 false）
 *  ladderProgram   : 梯形图 JSON 程序
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
        this._initLadderEngine();
        this._init();

        this.config = {
            label:        this.label,
            scanCycleMs:  this._scanCycleMs,
            initRun:      this._running,
            ladderProgram: JSON.stringify(this._program),
        };

        // 注册端口
        this._registerPorts();
    }

    // ═══════════════════════════════════════════════════════
    // 几何计算
    // ═══════════════════════════════════════════════════════

    _recalcGeometry() {
        const W = this.width, H = this.height;

        // 机身主体
        this._body = { x: 0, y: 0, w: W, h: H, rx: 4 };

        // 顶盖（深色带）
        this._topBar = { x: 0, y: 0, w: W, h: H * 0.10 };

        // 面板区（DIN导轨卡槽占底部8%）
        this._panel = { x: 2, y: H * 0.10, w: W - 4, h: H * 0.82 };

        // 以太网接口（左上区域）
        this._ethPort = { x: W * 0.04, y: H * 0.13, w: W * 0.12, h: H * 0.07 };

        // RS-485 接口（以太网右侧）
        this._rsPort  = { x: W * 0.18, y: H * 0.13, w: W * 0.10, h: H * 0.07 };

        // RUN/STOP 旋钮
        this._modeKnob = { x: W * 0.32, y: H * 0.165, r: H * 0.028 };

        // 状态LED区
        this._leds = {
            run:   { x: W * 0.44, y: H * 0.145, r: H * 0.018 },
            stop:  { x: W * 0.44, y: H * 0.185, r: H * 0.018 },
            error: { x: W * 0.44, y: H * 0.225, r: H * 0.018 },
        };

        // 输入LED行（I0.0~I1.3，两行）
        // 第一行 I0.0~I0.7
        this._inputLEDs0 = [];
        for (let i = 0; i < 8; i++) {
            this._inputLEDs0.push({
                x: W * (0.04 + i * 0.115),
                y: H * 0.38,
                r: H * 0.016,
                bit: i,
                byte: 0,
                label: `I0.${i}`,
            });
        }
        // 第二行 I1.0~I1.3
        this._inputLEDs1 = [];
        for (let i = 0; i < 4; i++) {
            this._inputLEDs1.push({
                x: W * (0.04 + i * 0.115),
                y: H * 0.48,
                r: H * 0.016,
                bit: i,
                byte: 1,
                label: `I1.${i}`,
            });
        }

        // 输出LED行（Q0.0~Q0.7）
        this._outputLEDs = [];
        for (let i = 0; i < 8; i++) {
            this._outputLEDs.push({
                x: W * (0.04 + i * 0.115),
                y: H * 0.60,
                r: H * 0.016,
                bit: i,
                byte: 0,
                label: `Q0.${i}`,
            });
        }

        // 输入端子排（底部 I 区）
        this._inputTerminals = { x: W * 0.02, y: H * 0.72, w: W * 0.56, h: H * 0.10 };

        // 输出端子排（底部 Q 区）
        this._outputTerminals = { x: W * 0.60, y: H * 0.72, w: W * 0.38, h: H * 0.10 };

        // DIN卡扣
        this._dinRail = { x: 0, y: H * 0.92, w: W, h: H * 0.08 };

        // 端口注册坐标（端子底端）
        this._portPositions = {};
        // I 端口
        const iCount = 12;
        for (let i = 0; i < 8; i++) {
            this._portPositions[`I0.${i}`] = {
                x: W * (0.04 + i * 0.115),
                y: H,
            };
        }
        for (let i = 0; i < 4; i++) {
            this._portPositions[`I1.${i}`] = {
                x: W * (0.04 + (i + 8) * 0.07),
                y: H,
            };
        }
        // Q 端口
        for (let i = 0; i < 8; i++) {
            this._portPositions[`Q0.${i}`] = {
                x: W * (0.60 + i * 0.046),
                y: H,
            };
        }
        // 电源端口
        this._portPositions['PWR_IN'] = { x: W * 0.88, y: 0 };

        // 铭牌位置
        this._nameplate = { x: W * 0.56, y: H * 0.13, w: W * 0.40, h: H * 0.10 };
    }

    // ═══════════════════════════════════════════════════════
    // 参数初始化
    // ═══════════════════════════════════════════════════════

    _initParameters(config) {
        this.label         = config.label        || 'PLC1';
        this._scanCycleMs  = config.scanCycleMs  !== undefined ? config.scanCycleMs : 10;
        this._running      = config.initRun      !== undefined ? !!config.initRun   : false;
        this._errorState   = false;
        this._errorMsg     = '';
        this._scanCount    = 0;
        this._accumMs      = 0;       // 累计时间(ms)，用于触发扫描
        this._elapsed      = 0;       // 当前扫描内已经过时间(ms)
        this._firstScan    = true;

        // 尝试加载梯形图程序
        try {
            if (config.ladderProgram) {
                const prog = typeof config.ladderProgram === 'string'
                    ? JSON.parse(config.ladderProgram)
                    : config.ladderProgram;
                this._program = prog;
            } else {
                this._program = this._getDefaultProgram();
            }
        } catch (e) {
            this._program = this._getDefaultProgram();
        }
    }

    // ═══════════════════════════════════════════════════════
    // 存储区初始化
    // ═══════════════════════════════════════════════════════

    _initMemory() {
        // 使用 Uint8Array 仿真字节存储区
        this._I  = new Uint8Array(2);   // IB0, IB1  → 12点输入
        this._Q  = new Uint8Array(1);   // QB0       → 8点输出
        this._M  = new Uint8Array(32);  // MB0~MB31
        this._V  = new Uint8Array(5000);// VB0~VB4999
        this._L  = new Uint8Array(64);  // LB0~LB63
        this._SM = new Uint8Array(256); // 特殊存储器

        // 定时器（当前值 + 位）
        this._T = Array.from({ length: 256 }, () => ({
            cv: 0,           // 当前值（整数，单位=时基）
            pv: 0,           // 预设值
            bit: false,      // 定时器位
            accMs: 0,        // 累计毫秒（内部）
            type: 'TON',     // TON/TOF/TONR
            timeBase: 100,   // 时基 ms
            enabled: false,  // 使能端
        }));

        // 计数器
        this._C = Array.from({ length: 256 }, () => ({
            cv: 0,
            pv: 0,
            bit: false,
            type: 'CTU',
            lastCU: false,  // 上次计数脉冲
            lastCD: false,
            lastR:  false,
        }));

        // SM 固定位
        this._SM[0] = 0xFF; // SM0.0 = 1 (始终为1)
        // SM0.1 在第一次扫描时置1（见 _execScan）
        // SM0.4 / SM0.5 由 tick 维护
        this._smOscMs4 = 0;   // SM0.4 (1min) 振荡计数
        this._smOscMs5 = 0;   // SM0.5 (1s)   振荡计数
        this._smFlip4  = false;
        this._smFlip5  = false;
    }

    // ═══════════════════════════════════════════════════════
    // 梯形图执行引擎
    // ═══════════════════════════════════════════════════════

    _initLadderEngine() {
        // 执行栈（用于括号/并联）
        this._stack = [];
        // 当前能流
        this._flow = false;
    }

    /**
     * 读取位存储（地址字符串，如 "I0.0", "Q0.3", "M1.2", "T5", "C10" 等）
     */
    _readBit(addr) {
        try {
            if (addr === 'SM0.0') return true;
            if (addr === 'SM0.1') return !!(this._SM[0] & 0x02);
            if (addr === 'SM0.4') return !!(this._SM[0] & 0x10);
            if (addr === 'SM0.5') return !!(this._SM[0] & 0x20);

            const m = addr.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
            if (m) {
                const zone = m[1].toUpperCase();
                const byteN = parseInt(m[2]);
                const bitN  = parseInt(m[3]);
                const mask  = 1 << bitN;
                if (zone === 'I')  return !!(this._I[byteN]  & mask);
                if (zone === 'Q')  return !!(this._Q[byteN]  & mask);
                if (zone === 'M')  return !!(this._M[byteN]  & mask);
                if (zone === 'V')  return !!(this._V[byteN]  & mask);
                if (zone === 'SM') return !!(this._SM[byteN] & mask);
                if (zone === 'L')  return !!(this._L[byteN]  & mask);
            }
            // T / C 位
            const tc = addr.match(/^([TC])(\d+)$/);
            if (tc) {
                const n = parseInt(tc[2]);
                if (tc[1] === 'T') return this._T[n].bit;
                if (tc[1] === 'C') return this._C[n].bit;
            }
        } catch (e) {}
        return false;
    }

    _writeBit(addr, val) {
        try {
            const m = addr.match(/^([A-Za-z]+)(\d+)\.(\d+)$/);
            if (m) {
                const zone = m[1].toUpperCase();
                const byteN = parseInt(m[2]);
                const bitN  = parseInt(m[3]);
                const mask  = 1 << bitN;
                const set = (arr) => {
                    if (val) arr[byteN] |= mask;
                    else     arr[byteN] &= ~mask;
                };
                if (zone === 'Q')  { set(this._Q);  return; }
                if (zone === 'M')  { set(this._M);  return; }
                if (zone === 'V')  { set(this._V);  return; }
                if (zone === 'L')  { set(this._L);  return; }
            }
        } catch (e) {}
    }

    /** 读整数字（Word = 2字节，有符号） */
    _readWord(addr) {
        const m = addr.match(/^([A-Za-z]+)W(\d+)$/i);
        if (!m) return 0;
        const zone  = m[1].toUpperCase();
        const byteN = parseInt(m[2]);
        let arr;
        if (zone === 'V')  arr = this._V;
        else if (zone === 'M') arr = this._M;
        else if (zone === 'Q') arr = this._Q;
        else if (zone === 'I') arr = this._I;
        else return 0;
        const raw = (arr[byteN] << 8) | arr[byteN + 1];
        return raw > 32767 ? raw - 65536 : raw;  // 有符号
    }

    _writeWord(addr, val) {
        const m = addr.match(/^([A-Za-z]+)W(\d+)$/i);
        if (!m) return;
        const zone  = m[1].toUpperCase();
        const byteN = parseInt(m[2]);
        val = Math.max(-32768, Math.min(32767, Math.round(val)));
        const u = val < 0 ? val + 65536 : val;
        let arr;
        if (zone === 'V')  arr = this._V;
        else if (zone === 'M') arr = this._M;
        else return;
        arr[byteN]     = (u >> 8) & 0xFF;
        arr[byteN + 1] = u & 0xFF;
    }

    _readByte(addr) {
        const m = addr.match(/^([A-Za-z]+)B?(\d+)$/i);
        if (!m) return 0;
        const zone  = m[1].toUpperCase();
        const byteN = parseInt(m[2]);
        if (zone === 'V')  return this._V[byteN]  || 0;
        if (zone === 'M')  return this._M[byteN]  || 0;
        if (zone === 'IB') return this._I[byteN]  || 0;
        if (zone === 'QB') return this._Q[byteN]  || 0;
        return 0;
    }

    _writeByte(addr, val) {
        const m = addr.match(/^([A-Za-z]+)B?(\d+)$/i);
        if (!m) return;
        const zone  = m[1].toUpperCase();
        const byteN = parseInt(m[2]);
        val = Math.max(0, Math.min(255, Math.round(val)));
        if (zone === 'V')  { this._V[byteN]  = val; return; }
        if (zone === 'M')  { this._M[byteN]  = val; return; }
        if (zone === 'QB') { this._Q[byteN]  = val; return; }
    }

    /**
     * 执行一个扫描周期
     * program 格式：
     * {
     *   networks: [
     *     {
     *       comment: "Network 1",
     *       rungs: [
     *         [
     *           { op: 'LD',  addr: 'I0.0' },
     *           { op: 'A',   addr: 'I0.1' },
     *           { op: '=',   addr: 'Q0.0' },
     *         ]
     *       ]
     *     }
     *   ]
     * }
     */
    _execScan() {
        if (!this._running) return;

        // SM0.1：首次扫描位
        if (this._firstScan) {
            this._SM[0] |= 0x02;
        } else {
            this._SM[0] &= ~0x02;
        }

        const prog = this._program;
        if (!prog || !prog.networks) return;

        try {
            for (const network of prog.networks) {
                for (const rung of (network.rungs || [])) {
                    this._execRung(rung);
                }
            }
        } catch (e) {
            this._errorState = true;
            this._errorMsg   = e.message || '执行错误';
            this._running    = false;
        }

        this._firstScan = false;
        this._scanCount++;
    }

    _execRung(instructions) {
        // 主栈帧：每条 rung 独立执行
        const stack  = [];   // 并联保存栈
        let flow     = false;
        let prevFlow = false; // 用于边沿检测

        for (let i = 0; i < instructions.length; i++) {
            const inst = instructions[i];
            const { op, addr, addr2, pv, timeBase } = inst;

            switch (op.toUpperCase()) {

                // ── 触点指令 ──────────────────────────────
                case 'LD':
                    stack.push(flow);
                    flow = this._readBit(addr);
                    break;
                case 'LDN':
                    stack.push(flow);
                    flow = !this._readBit(addr);
                    break;
                case 'A':
                    flow = flow && this._readBit(addr);
                    break;
                case 'AN':
                    flow = flow && !this._readBit(addr);
                    break;
                case 'O':
                    flow = flow || this._readBit(addr);
                    break;
                case 'ON':
                    flow = flow || !this._readBit(addr);
                    break;
                case 'NOT':
                    flow = !flow;
                    break;

                // ── 并联括号 ──────────────────────────────
                case 'OLD': {   // Or Load（合并并联分支）
                    const prev = stack.pop();
                    flow = flow || prev;
                    break;
                }
                case 'ALD': {   // And Load（合并串联分支）
                    const prev = stack.pop();
                    flow = flow && prev;
                    break;
                }
                case 'LPS': // Logic Push
                    stack.push(flow);
                    break;
                case 'LRD': // Logic Read
                    flow = stack[stack.length - 1];
                    break;
                case 'LPP': // Logic Pop
                    flow = stack.pop();
                    break;

                // ── 线圈输出 ──────────────────────────────
                case '=':
                    this._writeBit(addr, flow);
                    break;
                case 'S':   // 置位（SET）
                    if (flow) this._writeBit(addr, true);
                    break;
                case 'R':   // 复位（RESET）
                    if (flow) this._writeBit(addr, false);
                    break;

                // ── 定时器 ────────────────────────────────
                case 'TON': {
                    const tIdx = this._parseIndex(addr, 'T');
                    const t    = this._T[tIdx];
                    t.type     = 'TON';
                    t.pv       = pv !== undefined ? pv : t.pv;
                    t.timeBase = timeBase || 100;
                    t.enabled  = flow;
                    if (!flow) {
                        t.cv  = 0;
                        t.bit = false;
                        t.accMs = 0;
                    }
                    break;
                }
                case 'TOF': {
                    const tIdx = this._parseIndex(addr, 'T');
                    const t    = this._T[tIdx];
                    t.type     = 'TOF';
                    t.pv       = pv !== undefined ? pv : t.pv;
                    t.timeBase = timeBase || 100;
                    if (flow) {
                        t.bit = true;
                        t.cv  = 0;
                        t.accMs = 0;
                    }
                    t.enabled  = !flow;  // TOF：输入断开时才开始计时
                    break;
                }
                case 'TONR': {
                    const tIdx = this._parseIndex(addr, 'T');
                    const t    = this._T[tIdx];
                    t.type     = 'TONR';
                    t.pv       = pv !== undefined ? pv : t.pv;
                    t.timeBase = timeBase || 100;
                    t.enabled  = flow;
                    break;
                }

                // ── 计数器 ────────────────────────────────
                case 'CTU': {
                    const cIdx  = this._parseIndex(addr, 'C');
                    const c     = this._C[cIdx];
                    c.pv        = pv !== undefined ? pv : c.pv;
                    const cuNow = flow;
                    const rNow  = addr2 ? this._readBit(addr2) : false;
                    if (rNow) {
                        c.cv  = 0;
                        c.bit = false;
                    } else if (cuNow && !c.lastCU) {
                        c.cv++;
                    }
                    c.bit   = c.cv >= c.pv;
                    c.lastCU = cuNow;
                    c.lastR  = rNow;
                    break;
                }
                case 'CTD': {
                    const cIdx  = this._parseIndex(addr, 'C');
                    const c     = this._C[cIdx];
                    c.pv        = pv !== undefined ? pv : c.pv;
                    const cdNow = flow;
                    const ldNow = addr2 ? this._readBit(addr2) : false;
                    if (ldNow) {
                        c.cv  = c.pv;
                        c.bit = false;
                    } else if (cdNow && !c.lastCD) {
                        c.cv = Math.max(0, c.cv - 1);
                    }
                    c.bit    = c.cv === 0;
                    c.lastCD = cdNow;
                    break;
                }

                // ── 比较触点 ─────────────────────────────
                case '==I': case 'EQ_I':
                    flow = flow && (this._readWord(addr) === this._readWord(addr2));
                    break;
                case '<>I': case 'NEQ_I':
                    flow = flow && (this._readWord(addr) !== this._readWord(addr2));
                    break;
                case '>=I': case 'GEQ_I':
                    flow = flow && (this._readWord(addr) >= this._readWord(addr2));
                    break;
                case '<=I': case 'LEQ_I':
                    flow = flow && (this._readWord(addr) <= this._readWord(addr2));
                    break;
                case '>I': case 'GT_I':
                    flow = flow && (this._readWord(addr) > this._readWord(addr2));
                    break;
                case '<I': case 'LT_I':
                    flow = flow && (this._readWord(addr) < this._readWord(addr2));
                    break;

                // ── 传送 ──────────────────────────────────
                case 'MOV_B':
                    if (flow) this._writeByte(addr2, this._readByte(addr));
                    break;
                case 'MOV_W':
                    if (flow) this._writeWord(addr2, this._readWord(addr));
                    break;

                // ── 算术 ──────────────────────────────────
                case 'ADD_I':
                    if (flow) this._writeWord(addr2, this._readWord(addr) + this._readWord(addr2));
                    break;
                case 'SUB_I':
                    if (flow) this._writeWord(addr2, this._readWord(addr) - this._readWord(addr2));
                    break;
                case 'MUL_I':
                    if (flow) this._writeWord(addr2, this._readWord(addr) * this._readWord(addr2));
                    break;
                case 'DIV_I':
                    if (flow) {
                        const div = this._readWord(addr2);
                        if (div !== 0) this._writeWord(addr2, Math.trunc(this._readWord(addr) / div));
                    }
                    break;

                // ── NOP ──────────────────────────────────
                case 'NOP':
                    break;

                default:
                    break;
            }
        }
    }

    /** 解析地址中的索引（如 T5 → 5, C10 → 10） */
    _parseIndex(addr, prefix) {
        const n = parseInt(addr.replace(new RegExp(`^${prefix}`, 'i'), ''));
        return isNaN(n) ? 0 : Math.max(0, Math.min(255, n));
    }

    /** 更新所有定时器的当前值（在 tick 中调用，dt=毫秒） */
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
                    if (t.cv >= t.pv) {
                        t.bit = false;
                        t.enabled = false;
                    }
                }
            }
        }
    }

    /** 更新 SM 振荡位 */
    _tickSM(dtMs) {
        this._smOscMs4 += dtMs;
        this._smOscMs5 += dtMs;

        // SM0.5：1s 振荡（500ms on, 500ms off）
        if (this._smOscMs5 >= 500) {
            this._smOscMs5 -= 500;
            this._smFlip5 = !this._smFlip5;
            if (this._smFlip5) this._SM[0] |= 0x20;
            else               this._SM[0] &= ~0x20;
        }

        // SM0.4：1min 振荡（30s on, 30s off）
        if (this._smOscMs4 >= 30000) {
            this._smOscMs4 -= 30000;
            this._smFlip4 = !this._smFlip4;
            if (this._smFlip4) this._SM[0] |= 0x10;
            else               this._SM[0] &= ~0x10;
        }
    }

    // ═══════════════════════════════════════════════════════
    // 默认示例程序（电机启保停）
    // ═══════════════════════════════════════════════════════

    _getDefaultProgram() {
        return {
            name: '电机启保停控制',
            networks: [
                {
                    comment: 'Network 1 - 电机启停（I0.0=启动 I0.1=停止 Q0.0=电机）',
                    rungs: [
                        [
                            { op: 'LD',  addr: 'I0.0' },
                            { op: 'O',   addr: 'Q0.0' },
                            { op: 'AN',  addr: 'I0.1' },
                            { op: '=',   addr: 'Q0.0' },
                        ]
                    ]
                },
                {
                    comment: 'Network 2 - 1s 闪烁指示灯（Q0.7）',
                    rungs: [
                        [
                            { op: 'LD', addr: 'SM0.5' },
                            { op: 'A',  addr: 'Q0.0'  },
                            { op: '=',  addr: 'Q0.7'  },
                        ]
                    ]
                },
                {
                    comment: 'Network 3 - 延时 3s 启动辅助（I0.2→T0→Q0.1）',
                    rungs: [
                        [
                            { op: 'LD',  addr: 'I0.2',  },
                            { op: 'TON', addr: 'T0', pv: 30, timeBase: 100 },
                        ],
                        [
                            { op: 'LD', addr: 'T0' },
                            { op: '=',  addr: 'Q0.1' },
                        ]
                    ]
                },
            ]
        };
    }

    // ═══════════════════════════════════════════════════════
    // 端口注册
    // ═══════════════════════════════════════════════════════

    _registerPorts() {
        // 输入端口
        for (let i = 0; i < 8; i++) {
            const key = `I0.${i}`;
            const pos = this._portPositions[key];
            this.addPort(pos.x, pos.y, key, 'wire', 'p');
        }
        for (let i = 0; i < 4; i++) {
            const key = `I1.${i}`;
            const pos = this._portPositions[key];
            this.addPort(pos.x, pos.y, key, 'wire', 'p');
        }
        // 输出端口
        for (let i = 0; i < 8; i++) {
            const key = `Q0.${i}`;
            const pos = this._portPositions[key];
            this.addPort(pos.x, pos.y, key, 'wire');
        }
        // 电源
        const pwr = this._portPositions['PWR_IN'];
        this.addPort(pwr.x, pwr.y, 'PWR_IN', 'wire', 'p');
    }

    // ═══════════════════════════════════════════════════════
    // 初始化绘图
    // ═══════════════════════════════════════════════════════

    _init() {
        this._drawStaticParts();
        this._bindInteraction();
        this._rebuildDynamic();
    }

    // ── 静态部件 ────────────────────────────────────────────

    _drawStaticParts() {
        this._drawBody();
        this._drawTopBar();
        this._drawPorts();
        this._drawTerminalBlock();
        this._drawDINRail();
        this._drawLabels();
        this._drawNameplate();
        this._drawVentSlots();
        this._drawPortLabels();
    }

    _drawBody() {
        const b = this._body;
        // 主机身（灰白色，西门子风格）
        this._staticGroup.add(new Konva.Rect({
            x: b.x, y: b.y, width: b.w, height: b.h,
            fill: '#d8d8d8',
            stroke: '#888', strokeWidth: 1.5,
            cornerRadius: b.rx,
            shadowColor: '#000', shadowBlur: 8,
            shadowOffsetX: 2, shadowOffsetY: 3,
            shadowOpacity: 0.25,
        }));
        // 右侧高光
        this._staticGroup.add(new Konva.Rect({
            x: b.w - 6, y: 4, width: 4, height: b.h - 8,
            fill: 'rgba(255,255,255,0.35)',
            cornerRadius: [0, b.rx, b.rx, 0],
        }));
        // 左侧阴影
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 4, width: 4, height: b.h - 8,
            fill: 'rgba(0,0,0,0.10)',
            cornerRadius: [b.rx, 0, 0, b.rx],
        }));
    }

    _drawTopBar() {
        const W = this.width, H = this.height;
        // 西门子 SIMATIC 顶部深色标志带
        this._staticGroup.add(new Konva.Rect({
            x: 0, y: 0, width: W, height: H * 0.10,
            fill: '#1a6fa8',   // 西门子蓝
            cornerRadius: [4, 4, 0, 0],
        }));
        // SIMATIC 文字
        this._staticGroup.add(new Konva.Text({
            x: 6, y: H * 0.013,
            text: 'SIMATIC',
            fontSize: Math.max(7, H * 0.030),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#ffffff',
            letterSpacing: 1,
        }));
        // S7-200 SMART 文字
        this._staticGroup.add(new Konva.Text({
            x: 6, y: H * 0.052,
            text: 'S7-200 SMART',
            fontSize: Math.max(6, H * 0.024),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fill: '#b8d8f0',
            letterSpacing: 0.5,
        }));
    }

    _drawPorts() {
        const W = this.width, H = this.height;
        // 以太网口（RJ45 外形）
        const e = this._ethPort;
        this._staticGroup.add(new Konva.Rect({
            x: e.x, y: e.y, width: e.w, height: e.h,
            fill: '#2a2a2a', stroke: '#555', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: e.x, y: e.y + e.h + 2,
            text: 'ETH', fontSize: Math.max(5, H * 0.022),
            fontFamily: 'Arial', fill: '#555', align: 'center',
            width: e.w,
        }));

        // RS-485 接口（DB9 外形）
        const r = this._rsPort;
        this._staticGroup.add(new Konva.Rect({
            x: r.x, y: r.y, width: r.w, height: r.h,
            fill: '#2a2a2a', stroke: '#555', strokeWidth: 1,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: r.x, y: r.y + r.h + 2,
            text: '485', fontSize: Math.max(5, H * 0.022),
            fontFamily: 'Arial', fill: '#555', align: 'center',
            width: r.w,
        }));

        // 旋钮（RUN/STOP）
        const k = this._modeKnob;
        this._staticGroup.add(new Konva.Circle({
            x: k.x, y: k.y, radius: k.r,
            fill: '#333', stroke: '#222', strokeWidth: 1,
        }));
        this._staticGroup.add(new Konva.Text({
            x: k.x + k.r + 3, y: k.y - H * 0.018,
            text: 'RUN\nSTOP',
            fontSize: Math.max(5, H * 0.020),
            fontFamily: 'Arial', fill: '#444',
            lineHeight: 1.4,
        }));
    }

    _drawTerminalBlock() {
        const W = this.width, H = this.height;
        // 输入端子排
        const it = this._inputTerminals;
        this._staticGroup.add(new Konva.Rect({
            x: it.x, y: it.y, width: it.w, height: it.h,
            fill: '#333', stroke: '#222', strokeWidth: 1,
            cornerRadius: 2,
        }));
        // 绘制12个端子孔
        for (let i = 0; i < 12; i++) {
            const tx = it.x + it.w * (0.03 + i * 0.079);
            this._staticGroup.add(new Konva.Rect({
                x: tx, y: it.y + it.h * 0.15,
                width: it.w * 0.055, height: it.h * 0.70,
                fill: '#888', stroke: '#666', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
        }
        // I 标签
        this._staticGroup.add(new Konva.Text({
            x: it.x + it.w * 0.38, y: it.y - H * 0.035,
            text: 'INPUT',
            fontSize: Math.max(6, H * 0.024),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#2a7fbf',
        }));

        // 输出端子排
        const ot = this._outputTerminals;
        this._staticGroup.add(new Konva.Rect({
            x: ot.x, y: ot.y, width: ot.w, height: ot.h,
            fill: '#333', stroke: '#222', strokeWidth: 1,
            cornerRadius: 2,
        }));
        for (let i = 0; i < 8; i++) {
            const tx = ot.x + ot.w * (0.04 + i * 0.122);
            this._staticGroup.add(new Konva.Rect({
                x: tx, y: ot.y + ot.h * 0.15,
                width: ot.w * 0.08, height: ot.h * 0.70,
                fill: '#888', stroke: '#666', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
        }
        this._staticGroup.add(new Konva.Text({
            x: ot.x + ot.w * 0.25, y: ot.y - H * 0.035,
            text: 'OUTPUT',
            fontSize: Math.max(6, H * 0.024),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#bf5c2a',
        }));
    }

    _drawDINRail() {
        const dr = this._dinRail;
        this._staticGroup.add(new Konva.Rect({
            x: dr.x, y: dr.y, width: dr.w, height: dr.h,
            fill: '#b0b0b0', stroke: '#888', strokeWidth: 0.5,
            cornerRadius: [0, 0, 4, 4],
        }));
        // DIN导轨卡扣（左右各一）
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
        // LED区标签
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: H * 0.345,
            text: 'I  :', fontSize: Math.max(6, H * 0.028),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: '#2a7fbf',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: H * 0.445,
            text: 'I1:', fontSize: Math.max(6, H * 0.028),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: '#2a7fbf',
        }));
        this._staticGroup.add(new Konva.Text({
            x: W * 0.02, y: H * 0.565,
            text: 'Q  :', fontSize: Math.max(6, H * 0.028),
            fontFamily: 'Consolas, monospace', fontStyle: 'bold',
            fill: '#bf5c2a',
        }));
    }

    _drawPortLabels() {
        const W = this.width, H = this.height;
        // 输入端口标签
        for (let i = 0; i < 8; i++) {
            this._staticGroup.add(new Konva.Text({
                x: W * (0.028 + i * 0.115),
                y: H * 0.405,
                text: `.${i}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace',
                fill: '#2a7fbf',
                rotation: 0,
            }));
        }
        for (let i = 0; i < 4; i++) {
            this._staticGroup.add(new Konva.Text({
                x: W * (0.028 + i * 0.115),
                y: H * 0.505,
                text: `.${i}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace',
                fill: '#2a7fbf',
            }));
        }
        // 输出端口标签
        for (let i = 0; i < 8; i++) {
            this._staticGroup.add(new Konva.Text({
                x: W * (0.028 + i * 0.115),
                y: H * 0.628,
                text: `.${i}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace',
                fill: '#bf5c2a',
            }));
        }
    }

    _drawNameplate() {
        const np = this._nameplate;
        this._staticGroup.add(new Konva.Rect({
            x: np.x, y: np.y, width: np.w, height: np.h,
            fill: '#f5f0e0', stroke: '#aaa', strokeWidth: 0.8,
            cornerRadius: 2,
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 4, y: np.y + 3,
            text: 'CPU ST20',
            fontSize: Math.max(8, this.height * 0.038),
            fontFamily: 'Arial Narrow, Arial, sans-serif',
            fontStyle: 'bold',
            fill: '#1a1a1a',
        }));
        this._staticGroup.add(new Konva.Text({
            x: np.x + 4, y: np.y + np.h * 0.52,
            text: '6ES7 288-1ST20-0AA0',
            fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Consolas, monospace',
            fill: '#555',
        }));
    }

    _drawVentSlots() {
        const W = this.width, H = this.height;
        // 右侧散热槽
        for (let i = 0; i < 6; i++) {
            this._staticGroup.add(new Konva.Rect({
                x: W * 0.94, y: H * (0.32 + i * 0.052),
                width: W * 0.04, height: H * 0.030,
                fill: '#bbb', stroke: '#999', strokeWidth: 0.5,
                cornerRadius: 1,
            }));
        }
    }

    // ── 动态部件（每次状态变化重绘） ────────────────────────

    _rebuildDynamic() {
        this._dynamicGroup.destroyChildren();

        this._drawLEDs();
        this._drawRunIndicator();
        this._drawScanInfo();
        this._drawModeKnob();
        this._drawLabelText();
    }

    _drawLEDs() {
        // 输入 LED（黄色/暗）
        this._inputLEDs0.forEach(led => {
            const on = !!(this._I[led.byte] & (1 << led.bit));
            this._drawLED(led.x, led.y, led.r, on, 'input');
        });
        this._inputLEDs1.forEach(led => {
            const on = !!(this._I[led.byte] & (1 << led.bit));
            this._drawLED(led.x, led.y, led.r, on, 'input');
        });
        // 输出 LED（橙色/暗）
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
            x, y, radius: r,
            fill: on ? c.on : c.off,
            stroke: on ? '#888' : '#444',
            strokeWidth: 0.8,
            shadowColor: on ? c.glow : 'transparent',
            shadowBlur: on ? r * 3 : 0,
            shadowOpacity: 0.9,
        }));
    }

    _drawRunIndicator() {
        const leds = this._leds;
        const isRun  = this._running && !this._errorState;
        const isStop = !this._running && !this._errorState;
        const isErr  = this._errorState;

        // RUN LED
        this._drawLED(leds.run.x, leds.run.y, leds.run.r, isRun, 'run');
        this._dynamicGroup.add(new Konva.Text({
            x: leds.run.x + leds.run.r + 3,
            y: leds.run.y - leds.run.r,
            text: 'RUN',
            fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: isRun ? '#44cc44' : '#555',
        }));

        // STOP LED
        this._drawLED(leds.stop.x, leds.stop.y, leds.stop.r, isStop, 'stop');
        this._dynamicGroup.add(new Konva.Text({
            x: leds.stop.x + leds.stop.r + 3,
            y: leds.stop.y - leds.stop.r,
            text: 'STOP',
            fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: isStop ? '#ee3333' : '#555',
        }));

        // ERROR LED
        this._drawLED(leds.error.x, leds.error.y, leds.error.r, isErr, 'error');
        this._dynamicGroup.add(new Konva.Text({
            x: leds.error.x + leds.error.r + 3,
            y: leds.error.y - leds.error.r,
            text: 'ERR',
            fontSize: Math.max(5, this.height * 0.020),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: isErr ? '#ff8800' : '#555',
        }));
    }

    _drawScanInfo() {
        const W = this.width, H = this.height;
        // 扫描计数（在铭牌右侧小字显示）
        if (this._running) {
            this._dynamicGroup.add(new Konva.Text({
                x: W * 0.56, y: H * 0.265,
                text: `#${this._scanCount}`,
                fontSize: Math.max(5, H * 0.020),
                fontFamily: 'Consolas, monospace',
                fill: '#2a9',
            }));
        }
    }

    _drawModeKnob() {
        // 旋钮指针（指向当前模式）
        const k = this._modeKnob;
        const angle = this._running ? -30 : 30; // 度
        const rad   = angle * Math.PI / 180;
        const px    = k.x + Math.sin(rad) * k.r * 0.65;
        const py    = k.y - Math.cos(rad) * k.r * 0.65;

        this._dynamicGroup.add(new Konva.Line({
            points: [k.x, k.y, px, py],
            stroke: this._running ? '#44cc44' : '#ee3333',
            strokeWidth: 1.5,
            lineCap: 'round',
        }));
        // 旋钮中心点
        this._dynamicGroup.add(new Konva.Circle({
            x: k.x, y: k.y, radius: k.r * 0.25,
            fill: '#888',
        }));
    }

    _drawLabelText() {
        const W = this.width, H = this.height;
        this._dynamicGroup.add(new Konva.Text({
            x: W * 0.56, y: H * 0.235,
            text: this.label,
            fontSize: Math.max(8, H * 0.032),
            fontFamily: 'Arial', fontStyle: 'bold',
            fill: '#1a4f7a',
        }));
    }

    // ── 交互绑定 ─────────────────────────────────────────────

    _bindInteraction() {
        const W = this.width, H = this.height;

        // 旋钮点击：切换 RUN/STOP
        const knobHit = new Konva.Circle({
            x: this._modeKnob.x, y: this._modeKnob.y,
            radius: this._modeKnob.r * 2,
            fill: 'transparent',
        });
        knobHit.on('click tap', () => this.toggleRun());
        this._interactGroup.add(knobHit);

        // 输入点击区（I0.0~I0.7）
        this._inputLEDs0.forEach(led => {
            const hit = new Konva.Circle({
                x: led.x, y: led.y, radius: led.r * 3,
                fill: 'transparent',
            });
            hit.on('click tap', () => this.toggleInput(led.byte, led.bit));
            this._interactGroup.add(hit);
        });
        this._inputLEDs1.forEach(led => {
            const hit = new Konva.Circle({
                x: led.x, y: led.y, radius: led.r * 3,
                fill: 'transparent',
            });
            hit.on('click tap', () => this.toggleInput(led.byte, led.bit));
            this._interactGroup.add(hit);
        });
    }

    // ═══════════════════════════════════════════════════════
    // tick（主循环）
    // ═══════════════════════════════════════════════════════

    tick(dt) {
        const dtMs = dt * 1000;

        this._tickSM(dtMs);
        this._tickTimers(dtMs);

        if (this._running) {
            this._accumMs += dtMs;
            if (this._accumMs >= this._scanCycleMs) {
                this._accumMs -= this._scanCycleMs;
                this._execScan();
                this._rebuildDynamic();
                this.markDirty();
            }
        }

        this._refreshIfDirty();
    }

    // ═══════════════════════════════════════════════════════
    // 公开 API
    // ═══════════════════════════════════════════════════════

    /** 切换运行/停止 */
    toggleRun() {
        if (this._errorState) {
            this._errorState = false;
            this._errorMsg   = '';
        }
        this._running = !this._running;
        if (this._running) {
            this._firstScan  = true;
            this._accumMs    = 0;
        }
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    /** 强制 RUN */
    run() {
        if (!this._running) this.toggleRun();
    }

    /** 强制 STOP */
    stop() {
        if (this._running) this.toggleRun();
    }

    /** 切换输入位（模拟外部输入信号） */
    toggleInput(byteN, bitN) {
        this._I[byteN] ^= (1 << bitN);
        this._rebuildDynamic();
        this.markDirty();
    }

    /** 写入输入位 */
    setInput(byteN, bitN, val) {
        if (val) this._I[byteN] |=  (1 << bitN);
        else     this._I[byteN] &= ~(1 << bitN);
    }

    /** 读取输出位 */
    getOutput(byteN, bitN) {
        return !!(this._Q[byteN] & (1 << bitN));
    }

    /** 加载梯形图程序（JSON 对象或 JSON 字符串） */
    loadProgram(prog) {
        const wasRunning = this._running;
        this._running = false;

        try {
            this._program = typeof prog === 'string' ? JSON.parse(prog) : prog;
            this._scanCount = 0;
            this._firstScan = true;
            this._errorState = false;
            this._errorMsg   = '';

            this.config.ladderProgram = JSON.stringify(this._program);
        } catch (e) {
            this._errorState = true;
            this._errorMsg   = `程序格式错误：${e.message}`;
        }

        if (wasRunning && !this._errorState) {
            this._running = true;
        }
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    /** 获取当前存储区快照 */
    getMemorySnapshot() {
        return {
            I:  Array.from(this._I),
            Q:  Array.from(this._Q),
            M:  Array.from(this._M.slice(0, 8)),
            T:  this._T.slice(0, 16).map(t => ({ cv: t.cv, pv: t.pv, bit: t.bit })),
            C:  this._C.slice(0, 16).map(c => ({ cv: c.cv, pv: c.pv, bit: c.bit })),
        };
    }

    /** 复位 CPU（清除所有存储区） */
    reset() {
        this._running = false;
        this._initMemory();
        this._scanCount  = 0;
        this._firstScan  = true;
        this._errorState = false;
        this._errorMsg   = '';
        this._accumMs    = 0;
        this._rebuildDynamic();
        this.markDirty();
        this._refreshCache();
    }

    isRunning()   { return this._running; }
    hasError()    { return this._errorState; }
    getError()    { return this._errorMsg; }
    getScanCount(){ return this._scanCount; }

    // ═══════════════════════════════════════════════════════
    // 配置接口
    // ═══════════════════════════════════════════════════════

    getConfigFields() {
        return [
            { label: '位号',           key: 'label',         type: 'text'   },
            { label: '扫描周期 (ms)',   key: 'scanCycleMs',   type: 'number' },
            { label: '梯形图程序 (JSON)', key: 'ladderProgram', type: 'textarea' },
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
        super.destroy?.();
    }
}
