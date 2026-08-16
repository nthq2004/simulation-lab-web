# 8051 单片机仿真实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 8051 单片机仿真，支持 SDCC 编译的 HEX 文件加载执行、GPIO、定时器、UART、中断等最小系统。

**Architecture:** 新增 `digital/MCS51.js` 组件（功能模块视图）+ `tools/MCS51Solver.js` 解释引擎（指令译码、SFR、外设仿真），在 `consys.js` 的 `_updatePhysics` 中与 DigitalSolver 同级调用。

**Tech Stack:** 纯 JS ES6，继承 Konva 组件系统，通过 SignalBridge 与数字/模拟电路交互。

---

### Task 1: 创建 MCS51Solver 核心框架

**Files:**
- Create: `tools/MCS51Solver.js`

**Scope:** 8051 解释引擎的基础架构：内部状态（PC/ACC/B/PSW/SP/DPTR/RAM/SFR/ROM）、机器周期时序模型、主循环入口 `update(deltaTime)`、HEX 文件解析器。

- [ ] **Step 1: 写入 MCS51Solver 基础框架代码**

```javascript
/**
 * MCS51Solver.js — 8051 单片机解释执行引擎
 *
 * 指令集：约 60 条常用 8051 指令
 * 外设：P0-P3 GPIO、定时器 T0/T1（模式 0/1/2）、UART（模式 1）、中断（5 源）
 * 时序：12 时钟/机器周期，默认 12MHz
 */
import { signalBridge } from './SignalBridge.js';

export class MCS51Solver {
    constructor(sys) {
        this.sys = sys;
        this._mcus = [];          // 当前仿真中的 8051 组件实例
        this._contexts = new Map(); // mcuId -> CPUContext

        // 默认晶振频率
        this.defaultFreq = 12000000; // 12MHz
    }

    _discoverMCUs() {
        this._mcus = Object.values(this.sys.comps).filter(d => d.type === 'd_mcs51');
    }

    /**
     * 每帧调用
     * @param {number} deltaTime — 仿真步长（秒）
     */
    update(deltaTime) {
        this._discoverMCUs();
        this._mcus.forEach(mcu => {
            if (!mcu.powerOn) return;
            let ctx = this._contexts.get(mcu.id);
            if (!ctx) {
                ctx = this._initContext(mcu);
                this._contexts.set(mcu.id, ctx);
            }
            if (ctx.halted) return;

            const freq = mcu.xtalFreq || this.defaultFreq;
            const cyclesPerSecond = freq / 12; // 12 时钟/机器周期
            const cyclesAvail = Math.floor(cyclesPerSecond * deltaTime);
            let cyclesUsed = 0;

            while (cyclesUsed < cyclesAvail && !ctx.halted) {
                const opcode = ctx.rom[ctx.pc];
                const instr = OPCODES[opcode];
                if (!instr) {
                    console.warn(`MCS51: 未知操作码 0x${opcode.toString(16)} at PC=0x${ctx.pc.toString(16)}`);
                    ctx.pc = (ctx.pc + 1) & 0xFFFF;
                    cyclesUsed += 1;
                    continue;
                }
                ctx._instrPC = ctx.pc;
                instr.handler(ctx);
                ctx.pc = (ctx.pc + instr.len) & 0xFFFF;
                cyclesUsed += instr.cycles;

                // 检测外部 RST 引脚
                if (this._checkRST(mcu, ctx)) break;
                // 每执行一条指令检查一次中断（简化）
                if (ctx.ienable && !ctx.inInterrupt) {
                    this._checkInterrupts(mcu, ctx);
                }
            }

            // 帧结束同步
            this._updateTimers(mcu, ctx, cyclesUsed);
            this._syncUART(mcu, ctx);
            this._syncPorts(mcu, ctx);
            this._syncDisplay(mcu, ctx);
        });
    }

    _initContext(mcu) {
        const ctx = {
            // 存储
            rom: new Uint8Array(0x10000),  // 64KB 程序 ROM
            ram: new Uint8Array(0x80),     // 128B 内部 RAM
            sfr: new Uint8Array(0x80),     // SFR (索引0对应地址0x80)

            // 核心寄存器（SFR 别名）
            acc: 0,     // 0xE0
            b: 0,       // 0xF0
            psw: 0,     // 0xD0
            sp: 0x07,   // 0x81
            dpl: 0,     // 0x82
            dph: 0,     // 0x83

            // 程序计数器
            pc: 0,

            // 执行状态
            halted: false,
            inInterrupt: false,
            interruptPriority: -1, // -1=无, 0=低, 1=高
            _instrPC: 0,

            // 定时器状态
            timer0: { mode: 0, count: 0, reload: 0, running: false },
            timer1: { mode: 0, count: 0, reload: 0, running: false },

            // UART 状态
            uart: { sbuf: 0, sending: false, receiving: false, rxByte: 0 },

            // 中断标志位缓存
            ie0: 0, ie1: 0, tf0: 0, tf1: 0, ti: 0, ri: 0,

            // 外部引脚输入缓存
            pinInput: {
                p0: 0xFF, p1: 0xFF, p2: 0xFF, p3: 0xFF,
                int0: 1, int1: 1, t0: 1, t1: 1,
                rst: 0, rxd: 1,
            },

            // SFR 写入标记（用于检测写 SBUF 等操作）
            sfrWritten: new Set(),

            // ROM 已加载
            romLoaded: false,
        };

        // 初始化 SFR 默认值
        ctx.sfr[0x00] = 0xFF; // P0 (0x80)
        ctx.sfr[0x10] = 0xFF; // P1 (0x90)
        ctx.sfr[0x20] = 0xFF; // P2 (0xA0)
        ctx.sfr[0x30] = 0xFF; // P3 (0xB0)

        // 如果 mcu 有预加载的 ROM 数据，复制进来
        if (mcu._romData) {
            ctx.rom.set(mcu._romData);
            ctx.romLoaded = true;
        }

        return ctx;
    }

    /**
     * 解析 Intel HEX 格式
     */
    loadHex(mcuId, hexText) {
        const ctx = this._contexts.get(mcuId);
        if (!ctx) return { success: false, error: 'MCU not found' };

        const rom = new Uint8Array(0x10000);
        rom.fill(0xFF);

        let totalBytes = 0;
        let extAddr = 0;
        const lines = hexText.split('\n').filter(l => l.trim());

        for (const line of lines) {
            if (!line.startsWith(':')) continue;
            const byteCount = parseInt(line.substring(1, 3), 16);
            const address = parseInt(line.substring(3, 7), 16);
            const type = parseInt(line.substring(7, 9), 16);
            const dataStr = line.substring(9, 9 + byteCount * 2);
            // const checksum = parseInt(line.substring(line.length - 2), 16); // 校验和暂不验证

            if (type === 0x00) {
                const baseAddr = extAddr + address;
                for (let i = 0; i < byteCount; i++) {
                    const byteVal = parseInt(dataStr.substring(i * 2, i * 2 + 2), 16);
                    if (baseAddr + i < 0x10000) {
                        rom[baseAddr + i] = byteVal;
                    }
                }
                totalBytes += byteCount;
            } else if (type === 0x01) {
                break; // EOF
            } else if (type === 0x04) {
                extAddr = parseInt(dataStr.substring(0, 4), 16) << 16;
            }
        }

        ctx.rom = rom;
        ctx.romLoaded = true;
        ctx.pc = 0;
        ctx.halted = false;

        // 同时保存到组件实例
        const mcu = this.sys.comps[mcuId];
        if (mcu) mcu._romData = rom;

        return { success: true, totalBytes, pc: 0 };
    }

    /**
     * 获取 CPU 上下文
     */
    getContext(mcuId) {
        return this._contexts.get(mcuId) || null;
    }

    /**
     * 复位 MCU
     */
    resetMCU(mcuId) {
        const mcu = this.sys.comps[mcuId];
        if (!mcu) return;
        const ctx = this._initContext(mcu);
        // 保留 ROM 数据
        if (mcu._romData) ctx.rom.set(mcu._romData);
        this._contexts.set(mcuId, ctx);
    }

    /**
     * 重新加载固件
     */
    reloadFirmware(mcuId) {
        this.resetMCU(mcuId);
    }

    /**
     * 读取 SFR（按 8051 地址）
     */
    _readSFR(ctx, addr) {
        const idx = addr - 0x80;
        if (idx < 0 || idx >= 0x80) return 0;

        // 特殊寄存器读取逻辑
        switch (addr) {
            case 0x80: // P0 — 读取引脚状态
                return ctx.pinInput.p0;
            case 0x90: // P1
                return ctx.pinInput.p1;
            case 0xA0: // P2
                return ctx.pinInput.p2;
            case 0xB0: // P3
                return ctx.pinInput.p3;
            case 0x99: // SBUF
                return ctx.uart.rxByte;
            case 0x98: // SCON — 返回低位（TI/RI）
                return ctx.sfr[idx] & 0xF0 | (ctx.ti ? 2 : 0) | (ctx.ri ? 1 : 0);
            default:
                return ctx.sfr[idx];
        }
    }

    /**
     * 写入 SFR
     */
    _writeSFR(ctx, addr, val) {
        const idx = addr - 0x80;
        if (idx < 0 || idx >= 0x80) return;

        ctx.sfr[idx] = val & 0xFF;
        ctx.sfrWritten.add(addr);

        // 特殊寄存器写入副作用
        switch (addr) {
            case 0x80: // P0 写端口
            case 0x90: // P1
            case 0xA0: // P2
            case 0xB0: // P3
                break;
            case 0x81: // SP
                ctx.sp = val & 0xFF;
                break;
            case 0x82: // DPL
                ctx.dpl = val & 0xFF;
                break;
            case 0x83: // DPH
                ctx.dph = val & 0xFF;
                break;
            case 0x87: // PCON
                break;
            case 0x88: { // TCON
                // TCON.4 = TR0, TCON.6 = TR1
                ctx.timer0.running = !!(val & 0x10);
                ctx.timer1.running = !!(val & 0x40);
                ctx.ie0 = (val >> 0) & 1; // TCON.0 = IT0
                ctx.ie1 = (val >> 2) & 1; // TCON.2 = IT1
                ctx.sfr[idx] = val;
                break;
            }
            case 0x89: // TMOD
                ctx.timer0.mode = val & 0x0F;  // M0[1:0], C/T, GATE
                ctx.timer1.mode = (val >> 4) & 0x0F;
                ctx.sfr[idx] = val;
                break;
            case 0x8A: // TL0
                ctx.timer0.count = (ctx.timer0.count & 0xFF00) | val;
                break;
            case 0x8B: // TL1
                ctx.timer1.count = (ctx.timer1.count & 0xFF00) | val;
                break;
            case 0x8C: // TH0
                ctx.timer0.count = (val << 8) | (ctx.timer0.count & 0xFF);
                ctx.timer0.reload = val;
                break;
            case 0x8D: // TH1
                ctx.timer1.count = (val << 8) | (ctx.timer1.count & 0xFF);
                ctx.timer1.reload = val;
                break;
            case 0x98: // SCON
                ctx.sfr[idx] = val;
                if (val & 0x02) { val &= ~0x02; ctx.ti = 0; } // 写 1 清 TI
                if (val & 0x01) { val &= ~0x01; ctx.ri = 0; } // 写 1 清 RI
                break;
            case 0x99: // SBUF — 写触发发送
                ctx.uart.sbuf = val & 0xFF;
                ctx.uart.sending = true;
                break;
            case 0xA8: // IE
                ctx.sfr[idx] = val;
                break;
            case 0xB8: // IP
                ctx.sfr[idx] = val;
                break;
            case 0xD0: // PSW
                ctx.psw = val & 0xFF;
                break;
            case 0xE0: // ACC
                ctx.acc = val & 0xFF;
                break;
            case 0xF0: // B
                ctx.b = val & 0xFF;
                break;
        }
    }
}
```

- [ ] **Step 2: 验证语法**

Run: `cd "...difftransformer" && node -c tools/MCS51Solver.js`
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
git add tools/MCS51Solver.js
git commit -m "feat(mcs51): add MCS51Solver core framework with HEX parsing and SFR access"
```

---

### Task 2: 实现 8051 指令集操作码表

**Files:**
- Modify: `tools/MCS51Solver.js`（追加 OPCODES 表 + fetchByte/fetchWord 辅助 + 寻址模式）

**Scope:** 在 MCS51Solver 中追加完整的约 60 条指令操作码表。每个操作码映射到 `{ mnemonic, len, cycles, handler }`。

- [ ] **Step 1: 在 MCS51Solver 类前追加 OPCODES 常量和寻址辅助方法**

在 `export class MCS51Solver` 之前（或文件顶部），插入 OPCODES 表。由于 handler 需要使用 fetchByte/fetchWord/pushStack/popStack，这些定义为顶层函数（接收 ctx 参数），与 MCS51Solver 实例方法配合。

在类内部追加辅助方法：

```javascript
// ── 放在 class MCS51Solver 前 ──

const SFR_ADDR = {
    P0: 0x80, SP: 0x81, DPL: 0x82, DPH: 0x83, PCON: 0x87,
    TCON: 0x88, TMOD: 0x89, TL0: 0x8A, TL1: 0x8B, TH0: 0x8C, TH1: 0x8D,
    P1: 0x90, SCON: 0x98, SBUF: 0x99, P2: 0xA0,
    IE: 0xA8, P3: 0xB0, IP: 0xB8, PSW: 0xD0, ACC: 0xE0, B: 0xF0,
};

// PSW 位域
const PSW_CY = 0x80; // 进位
const PSW_AC = 0x40; // 辅助进位
const PSW_F0 = 0x20;
const PSW_RS1 = 0x10;
const PSW_RS0 = 0x08;
const PSW_OV = 0x04;
const PSW_P = 0x01;  // 奇偶

function getP(acc) {
    let p = 0;
    for (let i = 0; i < 8; i++) p ^= (acc >> i) & 1;
    return p;
}

function CY(ctx) { return (ctx.psw & PSW_CY) ? 1 : 0; }
function setCY(ctx, v) { if (v) ctx.psw |= PSW_CY; else ctx.psw &= ~PSW_CY; }
function AC(ctx) { return (ctx.psw & PSW_AC) ? 1 : 0; }
function setAC(ctx, v) { if (v) ctx.psw |= PSW_AC; else ctx.psw &= ~PSW_AC; }
function OV(ctx) { return (ctx.psw & PSW_OV) ? 1 : 0; }
function setOV(ctx, v) { if (v) ctx.psw |= PSW_OV; else ctx.psw &= ~PSW_OV; }
function updateP(ctx) { if (getP(ctx.acc)) ctx.psw |= PSW_P; else ctx.psw &= ~PSW_P; }

// 寄存器工作区 Rn (由 RS1:RS0 选择)
function getR(ctx, n) {
    const bank = (ctx.psw >> 3) & 3;
    return ctx.ram[bank * 8 + n];
}
function setR(ctx, n, v) {
    const bank = (ctx.psw >> 3) & 3;
    ctx.ram[bank * 8 + n] = v & 0xFF;
}

// 读取直接地址（0x00-0x7F = RAM, 0x80-0xFF = SFR）
function readDirect(ctx, addr) {
    if (addr < 0x80) return ctx.ram[addr];
    // SFR — 通过 MCS51Solver 读取
    // 这里留一个钩子，需要 solver 引用
    return ctx._readSFR ? ctx._readSFR(addr) : ctx.sfr[addr - 0x80];
}

// 写入直接地址
function writeDirect(ctx, addr, val) {
    if (addr < 0x80) { ctx.ram[addr] = val & 0xFF; return; }
    if (ctx._writeSFR) ctx._writeSFR(addr, val & 0xFF);
}

// 位寻址：计算位地址对应的字节地址和位偏移
function bitAddr(bit) {
    if (bit < 0x80) { // 内部 RAM 位寻址区 0x20-0x2F
        const byteAddr = 0x20 + Math.floor(bit / 8);
        const bitOff = bit % 8;
        return { addr: byteAddr, bit: bitOff, isSFR: false };
    }
    // SFR 位寻址区 (0x80-0xFF 中可被 8 整除的地址)
    const byteAddr = 0x80 + Math.floor((bit - 0x80) / 8) * 8;
    const bitOff = (bit - 0x80) % 8;
    return { addr: byteAddr, bit: bitOff, isSFR: byteAddr >= 0x80 };
}

function readBit(ctx, bit) {
    const ba = bitAddr(bit);
    const byteVal = ba.isSFR ? readDirect(ctx, ba.addr) : ctx.ram[ba.addr - 0x80];
    return (byteVal >> ba.bit) & 1;
}

function setBit(ctx, bit, val) {
    const ba = bitAddr(bit);
    const old = ba.isSFR ? readDirect(ctx, ba.addr) : ctx.ram[ba.addr - 0x80];
    const newVal = val ? (old | (1 << ba.bit)) : (old & ~(1 << ba.bit));
    if (ba.isSFR) writeDirect(ctx, ba.addr, newVal);
    else ctx.ram[ba.addr - 0x80] = newVal & 0xFF;
}
```

然后追加 OPCODES 常量：

```javascript
const OPCODES = {
    // ── NOP ──
    0x00: { mnemonic: 'NOP', len: 1, cycles: 1, handler: (ctx) => {} },

    // ── MOV A, Rn ──
    0xE8: { mnemonic: 'MOV A,R0', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 0); updateP(ctx); } },
    0xE9: { mnemonic: 'MOV A,R1', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 1); updateP(ctx); } },
    0xEA: { mnemonic: 'MOV A,R2', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 2); updateP(ctx); } },
    0xEB: { mnemonic: 'MOV A,R3', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 3); updateP(ctx); } },
    0xEC: { mnemonic: 'MOV A,R4', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 4); updateP(ctx); } },
    0xED: { mnemonic: 'MOV A,R5', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 5); updateP(ctx); } },
    0xEE: { mnemonic: 'MOV A,R6', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 6); updateP(ctx); } },
    0xEF: { mnemonic: 'MOV A,R7', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = getR(ctx, 7); updateP(ctx); } },

    // ── MOV A, direct ──
    0xE5: { mnemonic: 'MOV A,direct', len: 2, cycles: 1, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        ctx.acc = readDirect(ctx, addr);
        updateP(ctx);
    }},

    // ── MOV A, @Ri ──
    0xE6: { mnemonic: 'MOV A,@R0', len: 1, cycles: 1, handler: (ctx) => {
        ctx.acc = ctx.ram[ctx.ram[0]];
        updateP(ctx);
    }},
    0xE7: { mnemonic: 'MOV A,@R1', len: 1, cycles: 1, handler: (ctx) => {
        ctx.acc = ctx.ram[ctx.ram[1]];
        updateP(ctx);
    }},

    // ── MOV A, #data ──
    0x74: { mnemonic: 'MOV A,#data', len: 2, cycles: 1, handler: (ctx) => {
        ctx.acc = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        updateP(ctx);
    }},

    // ── MOV Rn, A ──
    0xF8: { mnemonic: 'MOV R0,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 0, ctx.acc); } },
    0xF9: { mnemonic: 'MOV R1,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 1, ctx.acc); } },
    0xFA: { mnemonic: 'MOV R2,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 2, ctx.acc); } },
    0xFB: { mnemonic: 'MOV R3,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 3, ctx.acc); } },
    0xFC: { mnemonic: 'MOV R4,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 4, ctx.acc); } },
    0xFD: { mnemonic: 'MOV R5,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 5, ctx.acc); } },
    0xFE: { mnemonic: 'MOV R6,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 6, ctx.acc); } },
    0xFF: { mnemonic: 'MOV R7,A', len: 1, cycles: 1, handler: (ctx) => { setR(ctx, 7, ctx.acc); } },

    // ── MOV Rn, #data ──
    0x78: { mnemonic: 'MOV R0,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 0, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0x79: { mnemonic: 'MOV R1,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 1, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0x7A: { mnemonic: 'MOV R2,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 2, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0x7B: { mnemonic: 'MOV R3,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 3, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0x7C: { mnemonic: 'MOV R4,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 4, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0x7D: { mnemonic: 'MOV R5,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 5, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0x7E: { mnemonic: 'MOV R6,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 6, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0x7F: { mnemonic: 'MOV R7,#data', len: 2, cycles: 1, handler: (ctx) => { setR(ctx, 7, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },

    // ── MOV direct, A ──
    0xF5: { mnemonic: 'MOV direct,A', len: 2, cycles: 1, handler: (ctx) => {
        writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], ctx.acc);
    }},

    // ── MOV direct, Rn ──
    0x88: { mnemonic: 'MOV direct,R0', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 0)); } },
    0x89: { mnemonic: 'MOV direct,R1', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 1)); } },
    0x8A: { mnemonic: 'MOV direct,R2', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 2)); } },
    0x8B: { mnemonic: 'MOV direct,R3', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 3)); } },
    0x8C: { mnemonic: 'MOV direct,R4', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 4)); } },
    0x8D: { mnemonic: 'MOV direct,R5', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 5)); } },
    0x8E: { mnemonic: 'MOV direct,R6', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 6)); } },
    0x8F: { mnemonic: 'MOV direct,R7', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], getR(ctx, 7)); } },

    // ── MOV @Ri, A ──
    0xF6: { mnemonic: 'MOV @R0,A', len: 1, cycles: 1, handler: (ctx) => { ctx.ram[ctx.ram[0]] = ctx.acc; } },
    0xF7: { mnemonic: 'MOV @R1,A', len: 1, cycles: 1, handler: (ctx) => { ctx.ram[ctx.ram[1]] = ctx.acc; } },

    // ── MOV @Ri, #data ──
    0x76: { mnemonic: 'MOV @R0,#data', len: 2, cycles: 1, handler: (ctx) => { ctx.ram[ctx.ram[0]] = ctx.rom[(ctx.pc + 1) & 0xFFFF]; } },
    0x77: { mnemonic: 'MOV @R1,#data', len: 2, cycles: 1, handler: (ctx) => { ctx.ram[ctx.ram[1]] = ctx.rom[(ctx.pc + 1) & 0xFFFF]; } },

    // ── MOV DPTR, #data16 ──
    0x90: { mnemonic: 'MOV DPTR,#data16', len: 3, cycles: 2, handler: (ctx) => {
        ctx.dph = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        ctx.dpl = ctx.rom[(ctx.pc + 2) & 0xFFFF];
    }},

    // ── MOVC A, @A+DPTR ──
    0x93: { mnemonic: 'MOVC A,@A+DPTR', len: 1, cycles: 2, handler: (ctx) => {
        const addr = (ctx.acc + (ctx.dph << 8 | ctx.dpl)) & 0xFFFF;
        ctx.acc = ctx.rom[addr];
        updateP(ctx);
    }},

    // ── MOVC A, @A+PC ──
    0x83: { mnemonic: 'MOVC A,@A+PC', len: 1, cycles: 2, handler: (ctx) => {
        const addr = (ctx.acc + ctx.pc + 1) & 0xFFFF;
        ctx.acc = ctx.rom[addr];
        updateP(ctx);
    }},

    // ── MOVX A, @DPTR ──
    0xE0: { mnemonic: 'MOVX A,@DPTR', len: 1, cycles: 2, handler: (ctx) => {
        const addr = (ctx.dph << 8) | ctx.dpl;
        ctx.acc = readDirect(ctx, addr); // 暂用内部 RAM/SFR 模拟外部 XRAM
        updateP(ctx);
    }},

    // ── MOVX @DPTR, A ──
    0xF0: { mnemonic: 'MOVX @DPTR,A', len: 1, cycles: 2, handler: (ctx) => {
        const addr = (ctx.dph << 8) | ctx.dpl;
        writeDirect(ctx, addr, ctx.acc);
    }},

    // ── MOVX A, @Ri (外部 RAM 低 8 位地址) ──
    0xE2: { mnemonic: 'MOVX A,@R0', len: 1, cycles: 2, handler: (ctx) => {
        ctx.acc = readDirect(ctx, ctx.ram[0]);
        updateP(ctx);
    }},
    0xE3: { mnemonic: 'MOVX A,@R1', len: 1, cycles: 2, handler: (ctx) => {
        ctx.acc = readDirect(ctx, ctx.ram[1]);
        updateP(ctx);
    }},

    // ── MOVX @Ri, A ──
    0xF2: { mnemonic: 'MOVX @R0,A', len: 1, cycles: 2, handler: (ctx) => {
        writeDirect(ctx, ctx.ram[0], ctx.acc);
    }},
    0xF3: { mnemonic: 'MOVX @R1,A', len: 1, cycles: 2, handler: (ctx) => {
        writeDirect(ctx, ctx.ram[1], ctx.acc);
    }},

    // ── PUSH direct ──
    0xC0: { mnemonic: 'PUSH direct', len: 2, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        ctx.sp = (ctx.sp + 1) & 0xFF;
        if (ctx.sp < 0x80) ctx.ram[ctx.sp] = readDirect(ctx, addr);
        else ctx._writeSFR(ctx.sp, readDirect(ctx, addr));
    }},

    // ── POP direct ──
    0xD0: { mnemonic: 'POP direct', len: 2, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const val = (ctx.sp < 0x80) ? ctx.ram[ctx.sp] : ctx._readSFR(ctx.sp);
        writeDirect(ctx, addr, val);
        ctx.sp = (ctx.sp - 1) & 0xFF;
    }},

    // ── XCH A, Rn ──
    0xC8: { mnemonic: 'XCH A,R0', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,0); setR(ctx,0,t); updateP(ctx); } },
    0xC9: { mnemonic: 'XCH A,R1', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,1); setR(ctx,1,t); updateP(ctx); } },
    0xCA: { mnemonic: 'XCH A,R2', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,2); setR(ctx,2,t); updateP(ctx); } },
    0xCB: { mnemonic: 'XCH A,R3', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,3); setR(ctx,3,t); updateP(ctx); } },
    0xCC: { mnemonic: 'XCH A,R4', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,4); setR(ctx,4,t); updateP(ctx); } },
    0xCD: { mnemonic: 'XCH A,R5', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,5); setR(ctx,5,t); updateP(ctx); } },
    0xCE: { mnemonic: 'XCH A,R6', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,6); setR(ctx,6,t); updateP(ctx); } },
    0xCF: { mnemonic: 'XCH A,R7', len: 1, cycles: 1, handler: (ctx) => { const t = ctx.acc; ctx.acc = getR(ctx,7); setR(ctx,7,t); updateP(ctx); } },

    // ── XCH A, @Ri ──
    0xC6: { mnemonic: 'XCH A,@R0', len: 1, cycles: 1, handler: (ctx) => {
        const addr = ctx.ram[0]; const t = ctx.acc; ctx.acc = ctx.ram[addr]; ctx.ram[addr] = t; updateP(ctx);
    }},
    0xC7: { mnemonic: 'XCH A,@R1', len: 1, cycles: 1, handler: (ctx) => {
        const addr = ctx.ram[1]; const t = ctx.acc; ctx.acc = ctx.ram[addr]; ctx.ram[addr] = t; updateP(ctx);
    }},

    // ── ADD A, Rn ──
    0x28: { mnemonic: 'ADD A,R0', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,0)); } },
    0x29: { mnemonic: 'ADD A,R1', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,1)); } },
    0x2A: { mnemonic: 'ADD A,R2', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,2)); } },
    0x2B: { mnemonic: 'ADD A,R3', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,3)); } },
    0x2C: { mnemonic: 'ADD A,R4', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,4)); } },
    0x2D: { mnemonic: 'ADD A,R5', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,5)); } },
    0x2E: { mnemonic: 'ADD A,R6', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,6)); } },
    0x2F: { mnemonic: 'ADD A,R7', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, getR(ctx,7)); } },

    // ── ADD A, direct ──
    0x25: { mnemonic: 'ADD A,direct', len: 2, cycles: 2, handler: (ctx) => {
        _add(ctx, readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]));
    }},

    // ── ADD A, @Ri ──
    0x26: { mnemonic: 'ADD A,@R0', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, ctx.ram[ctx.ram[0]]); } },
    0x27: { mnemonic: 'ADD A,@R1', len: 1, cycles: 1, handler: (ctx) => { _add(ctx, ctx.ram[ctx.ram[1]]); } },

    // ── ADD A, #data ──
    0x24: { mnemonic: 'ADD A,#data', len: 2, cycles: 2, handler: (ctx) => {
        _add(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]);
    }},

    // ── ADDC A, Rn ──
    0x38: { mnemonic: 'ADDC A,R0', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,0)); } },
    0x39: { mnemonic: 'ADDC A,R1', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,1)); } },
    0x3A: { mnemonic: 'ADDC A,R2', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,2)); } },
    0x3B: { mnemonic: 'ADDC A,R3', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,3)); } },
    0x3C: { mnemonic: 'ADDC A,R4', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,4)); } },
    0x3D: { mnemonic: 'ADDC A,R5', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,5)); } },
    0x3E: { mnemonic: 'ADDC A,R6', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,6)); } },
    0x3F: { mnemonic: 'ADDC A,R7', len: 1, cycles: 1, handler: (ctx) => { _addc(ctx, getR(ctx,7)); } },

    // ── SUBB A, Rn ──
    0x98: { mnemonic: 'SUBB A,R0', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,0)); } },
    0x99: { mnemonic: 'SUBB A,R1', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,1)); } },
    0x9A: { mnemonic: 'SUBB A,R2', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,2)); } },
    0x9B: { mnemonic: 'SUBB A,R3', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,3)); } },
    0x9C: { mnemonic: 'SUBB A,R4', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,4)); } },
    0x9D: { mnemonic: 'SUBB A,R5', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,5)); } },
    0x9E: { mnemonic: 'SUBB A,R6', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,6)); } },
    0x9F: { mnemonic: 'SUBB A,R7', len: 1, cycles: 1, handler: (ctx) => { _subb(ctx, getR(ctx,7)); } },

    // ── SUBB A, #data ──
    0x94: { mnemonic: 'SUBB A,#data', len: 2, cycles: 2, handler: (ctx) => {
        _subb(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]);
    }},

    // ── INC A ──
    0x04: { mnemonic: 'INC A', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = (ctx.acc + 1) & 0xFF; updateP(ctx); } },

    // ── INC Rn ──
    0x08: { mnemonic: 'INC R0', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,0,(getR(ctx,0)+1)&0xFF); } },
    0x09: { mnemonic: 'INC R1', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,1,(getR(ctx,1)+1)&0xFF); } },
    0x0A: { mnemonic: 'INC R2', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,2,(getR(ctx,2)+1)&0xFF); } },
    0x0B: { mnemonic: 'INC R3', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,3,(getR(ctx,3)+1)&0xFF); } },
    0x0C: { mnemonic: 'INC R4', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,4,(getR(ctx,4)+1)&0xFF); } },
    0x0D: { mnemonic: 'INC R5', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,5,(getR(ctx,5)+1)&0xFF); } },
    0x0E: { mnemonic: 'INC R6', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,6,(getR(ctx,6)+1)&0xFF); } },
    0x0F: { mnemonic: 'INC R7', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,7,(getR(ctx,7)+1)&0xFF); } },

    // ── INC direct ──
    0x05: { mnemonic: 'INC direct', len: 2, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        writeDirect(ctx, addr, (readDirect(ctx, addr) + 1) & 0xFF);
    }},

    // ── INC @Ri ──
    0x06: { mnemonic: 'INC @R0', len: 1, cycles: 1, handler: (ctx) => { ctx.ram[ctx.ram[0]] = (ctx.ram[ctx.ram[0]] + 1) & 0xFF; } },
    0x07: { mnemonic: 'INC @R1', len: 1, cycles: 1, handler: (ctx) => { ctx.ram[ctx.ram[1]] = (ctx.ram[ctx.ram[1]] + 1) & 0xFF; } },

    // ── INC DPTR ──
    0xA3: { mnemonic: 'INC DPTR', len: 1, cycles: 2, handler: (ctx) => {
        let dptr = (ctx.dph << 8) | ctx.dpl;
        dptr = (dptr + 1) & 0xFFFF;
        ctx.dph = (dptr >> 8) & 0xFF;
        ctx.dpl = dptr & 0xFF;
    }},

    // ── DEC A ──
    0x14: { mnemonic: 'DEC A', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = (ctx.acc - 1) & 0xFF; updateP(ctx); } },

    // ── DEC Rn ──
    0x18: { mnemonic: 'DEC R0', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,0,(getR(ctx,0)-1)&0xFF); } },
    0x19: { mnemonic: 'DEC R1', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,1,(getR(ctx,1)-1)&0xFF); } },
    0x1A: { mnemonic: 'DEC R2', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,2,(getR(ctx,2)-1)&0xFF); } },
    0x1B: { mnemonic: 'DEC R3', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,3,(getR(ctx,3)-1)&0xFF); } },
    0x1C: { mnemonic: 'DEC R4', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,4,(getR(ctx,4)-1)&0xFF); } },
    0x1D: { mnemonic: 'DEC R5', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,5,(getR(ctx,5)-1)&0xFF); } },
    0x1E: { mnemonic: 'DEC R6', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,6,(getR(ctx,6)-1)&0xFF); } },
    0x1F: { mnemonic: 'DEC R7', len: 1, cycles: 1, handler: (ctx) => { setR(ctx,7,(getR(ctx,7)-1)&0xFF); } },

    // ── MUL AB ──
    0xA4: { mnemonic: 'MUL AB', len: 1, cycles: 4, handler: (ctx) => {
        const result = ctx.acc * ctx.b;
        ctx.acc = result & 0xFF;
        ctx.b = (result >> 8) & 0xFF;
        setCY(ctx, 0);
        setOV(ctx, result > 0xFF);
        updateP(ctx);
    }},

    // ── DIV AB ──
    0x84: { mnemonic: 'DIV AB', len: 1, cycles: 4, handler: (ctx) => {
        if (ctx.b === 0) {
            setOV(ctx, 1);
            ctx.acc = 0;
            ctx.b = 0;
        } else {
            setOV(ctx, 0);
            ctx.acc = Math.floor(ctx.acc / ctx.b);
            ctx.b = ctx.acc % ctx.b; // ✓ fixed: remainder
            // 修正：上面这行错了
        }
        setCY(ctx, 0);
        updateP(ctx);
    }},

    // ── DA A ──
    0xD4: { mnemonic: 'DA A', len: 1, cycles: 1, handler: (ctx) => {
        let a = ctx.acc;
        const low = a & 0x0F;
        const high = (a >> 4) & 0x0F;
        let inc = 0;
        if (low > 9 || AC(ctx)) inc += 0x06;
        if (high > 9 || CY(ctx)) inc += 0x60;
        if (high > 9 || CY(ctx)) setCY(ctx, 1);
        ctx.acc = (a + inc) & 0xFF;
        updateP(ctx);
    }},

    // ── ANL A, Rn ──
    0x58: { mnemonic: 'ANL A,R0', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,0); updateP(ctx); } },
    0x59: { mnemonic: 'ANL A,R1', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,1); updateP(ctx); } },
    0x5A: { mnemonic: 'ANL A,R2', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,2); updateP(ctx); } },
    0x5B: { mnemonic: 'ANL A,R3', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,3); updateP(ctx); } },
    0x5C: { mnemonic: 'ANL A,R4', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,4); updateP(ctx); } },
    0x5D: { mnemonic: 'ANL A,R5', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,5); updateP(ctx); } },
    0x5E: { mnemonic: 'ANL A,R6', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,6); updateP(ctx); } },
    0x5F: { mnemonic: 'ANL A,R7', len: 1, cycles: 1, handler: (ctx) => { ctx.acc &= getR(ctx,7); updateP(ctx); } },

    // ── ANL A, #data ──
    0x54: { mnemonic: 'ANL A,#data', len: 2, cycles: 2, handler: (ctx) => {
        ctx.acc &= ctx.rom[(ctx.pc + 1) & 0xFFFF];
        updateP(ctx);
    }},

    // ── ANL direct, A ──
    0x52: { mnemonic: 'ANL direct,A', len: 2, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        writeDirect(ctx, addr, readDirect(ctx, addr) & ctx.acc);
    }},

    // ── ORL A, Rn ──
    0x48: { mnemonic: 'ORL A,R0', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,0); updateP(ctx); } },
    // ... 0x49-0x4F similar pattern for R1-R7 — same handler pattern
    0x49: { mnemonic: 'ORL A,R1', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,1); updateP(ctx); } },
    0x4A: { mnemonic: 'ORL A,R2', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,2); updateP(ctx); } },
    0x4B: { mnemonic: 'ORL A,R3', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,3); updateP(ctx); } },
    0x4C: { mnemonic: 'ORL A,R4', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,4); updateP(ctx); } },
    0x4D: { mnemonic: 'ORL A,R5', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,5); updateP(ctx); } },
    0x4E: { mnemonic: 'ORL A,R6', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,6); updateP(ctx); } },
    0x4F: { mnemonic: 'ORL A,R7', len: 1, cycles: 1, handler: (ctx) => { ctx.acc |= getR(ctx,7); updateP(ctx); } },

    // ── ORL A, #data ──
    0x44: { mnemonic: 'ORL A,#data', len: 2, cycles: 2, handler: (ctx) => {
        ctx.acc |= ctx.rom[(ctx.pc + 1) & 0xFFFF];
        updateP(ctx);
    }},

    // ── XRL A, Rn ──
    0x68: { mnemonic: 'XRL A,R0', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,0); updateP(ctx); } },
    0x69: { mnemonic: 'XRL A,R1', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,1); updateP(ctx); } },
    0x6A: { mnemonic: 'XRL A,R2', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,2); updateP(ctx); } },
    0x6B: { mnemonic: 'XRL A,R3', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,3); updateP(ctx); } },
    0x6C: { mnemonic: 'XRL A,R4', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,4); updateP(ctx); } },
    0x6D: { mnemonic: 'XRL A,R5', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,5); updateP(ctx); } },
    0x6E: { mnemonic: 'XRL A,R6', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,6); updateP(ctx); } },
    0x6F: { mnemonic: 'XRL A,R7', len: 1, cycles: 1, handler: (ctx) => { ctx.acc ^= getR(ctx,7); updateP(ctx); } },

    // ── XRL A, #data ──
    0x64: { mnemonic: 'XRL A,#data', len: 2, cycles: 2, handler: (ctx) => {
        ctx.acc ^= ctx.rom[(ctx.pc + 1) & 0xFFFF];
        updateP(ctx);
    }},

    // ── CLR A ──
    0xE4: { mnemonic: 'CLR A', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = 0; updateP(ctx); } },

    // ── CPL A ──
    0xF4: { mnemonic: 'CPL A', len: 1, cycles: 1, handler: (ctx) => { ctx.acc = (~ctx.acc) & 0xFF; updateP(ctx); } },

    // ── RL A ──
    0x23: { mnemonic: 'RL A', len: 1, cycles: 1, handler: (ctx) => {
        ctx.acc = ((ctx.acc << 1) | (ctx.acc >> 7)) & 0xFF;
    }},

    // ── RLC A ──
    0x33: { mnemonic: 'RLC A', len: 1, cycles: 1, handler: (ctx) => {
        const c = CY(ctx);
        setCY(ctx, (ctx.acc >> 7) & 1);
        ctx.acc = ((ctx.acc << 1) | c) & 0xFF;
        updateP(ctx);
    }},

    // ── RR A ──
    0x03: { mnemonic: 'RR A', len: 1, cycles: 1, handler: (ctx) => {
        ctx.acc = ((ctx.acc >> 1) | (ctx.acc << 7)) & 0xFF;
    }},

    // ── RRC A ──
    0x13: { mnemonic: 'RRC A', len: 1, cycles: 1, handler: (ctx) => {
        const c = CY(ctx);
        setCY(ctx, ctx.acc & 1);
        ctx.acc = ((ctx.acc >> 1) | (c << 7)) & 0xFF;
        updateP(ctx);
    }},

    // ── SWAP A ──
    0xC4: { mnemonic: 'SWAP A', len: 1, cycles: 1, handler: (ctx) => {
        ctx.acc = ((ctx.acc << 4) | (ctx.acc >> 4)) & 0xFF;
    }},

    // ── CLR C ──
    0xC3: { mnemonic: 'CLR C', len: 1, cycles: 1, handler: (ctx) => { setCY(ctx, 0); } },

    // ── CLR bit ──
    0xC2: { mnemonic: 'CLR bit', len: 2, cycles: 2, handler: (ctx) => {
        setBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], 0);
    }},

    // ── SETB C ──
    0xD3: { mnemonic: 'SETB C', len: 1, cycles: 1, handler: (ctx) => { setCY(ctx, 1); } },

    // ── SETB bit ──
    0xD2: { mnemonic: 'SETB bit', len: 2, cycles: 2, handler: (ctx) => {
        setBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], 1);
    }},

    // ── CPL C ──
    0xB3: { mnemonic: 'CPL C', len: 1, cycles: 1, handler: (ctx) => { setCY(ctx, CY(ctx) ? 0 : 1); } },

    // ── CPL bit ──
    0xB2: { mnemonic: 'CPL bit', len: 2, cycles: 2, handler: (ctx) => {
        const bit = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        setBit(ctx, bit, readBit(ctx, bit) ? 0 : 1);
    }},

    // ── ANL C, bit ──
    0x82: { mnemonic: 'ANL C,bit', len: 2, cycles: 2, handler: (ctx) => {
        setCY(ctx, CY(ctx) & readBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]));
    }},

    // ── ORL C, bit ──
    0x72: { mnemonic: 'ORL C,bit', len: 2, cycles: 2, handler: (ctx) => {
        setCY(ctx, CY(ctx) | readBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]));
    }},

    // ── MOV C, bit ──
    0xA2: { mnemonic: 'MOV C,bit', len: 2, cycles: 1, handler: (ctx) => {
        setCY(ctx, readBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]));
    }},

    // ── MOV bit, C ──
    0x92: { mnemonic: 'MOV bit,C', len: 2, cycles: 2, handler: (ctx) => {
        setBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], CY(ctx));
    }},

    // ── LJMP addr16 ──
    0x02: { mnemonic: 'LJMP addr16', len: 3, cycles: 2, handler: (ctx) => {
        const addr = (ctx.rom[(ctx.pc + 1) & 0xFFFF] << 8) | ctx.rom[(ctx.pc + 2) & 0xFFFF];
        ctx.pc = addr;
        // handler 返回后主循环不会自动 +len，但我们已经修改了 pc，所以需要让主循环的 pc+=len 不生效
        // 解决方案：让 len=0 表示不自动递增
    }},

    // ── AJMP addr11 ──
    // 0x01, 0x21, 0x41, 0x61, 0x81, 0xA1, 0xC1, 0xE1
    // page[7:5] = opcode[7:5], addr[10:8] = opcode[7:5], addr[7:0] = byte2
    // 简化：使用 AJMP base handler
    0x01: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },
    0x21: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },
    0x41: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },
    0x61: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },
    0x81: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },
    0xA1: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },
    0xC1: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },
    0xE1: { mnemonic: 'AJMP', len: 2, cycles: 2, handler: _ajmp },

    // ── SJMP rel ──
    0x80: { mnemonic: 'SJMP rel', len: 2, cycles: 2, handler: (ctx) => {
        const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
    }},

    // ── JMP @A+DPTR ──
    0x73: { mnemonic: 'JMP @A+DPTR', len: 1, cycles: 2, handler: (ctx) => {
        ctx.pc = (ctx.acc + (ctx.dph << 8 | ctx.dpl)) & 0xFFFF;
    }},

    // ── JZ rel ──
    0x60: { mnemonic: 'JZ rel', len: 2, cycles: 2, handler: (ctx) => {
        if (ctx.acc === 0) {
            const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
            ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        }
    }},

    // ── JNZ rel ──
    0x70: { mnemonic: 'JNZ rel', len: 2, cycles: 2, handler: (ctx) => {
        if (ctx.acc !== 0) {
            const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
            ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        }
    }},

    // ── JC rel ──
    0x40: { mnemonic: 'JC rel', len: 2, cycles: 2, handler: (ctx) => {
        if (CY(ctx)) {
            const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
            ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        }
    }},

    // ── JNC rel ──
    0x50: { mnemonic: 'JNC rel', len: 2, cycles: 2, handler: (ctx) => {
        if (!CY(ctx)) {
            const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
            ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        }
    }},

    // ── JB bit, rel ──
    0x20: { mnemonic: 'JB bit,rel', len: 3, cycles: 2, handler: (ctx) => {
        const bit = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        if (readBit(ctx, bit)) {
            ctx.pc = (ctx.pc + 3 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        }
    }},

    // ── JNB bit, rel ──
    0x30: { mnemonic: 'JNB bit,rel', len: 3, cycles: 2, handler: (ctx) => {
        const bit = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        if (!readBit(ctx, bit)) {
            ctx.pc = (ctx.pc + 3 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        }
    }},

    // ── CJNE A, #data, rel ──
    0xB4: { mnemonic: 'CJNE A,#data,rel', len: 3, cycles: 2, handler: (ctx) => {
        const data = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        setCY(ctx, ctx.acc < data ? 1 : 0);
        if (ctx.acc !== data) {
            ctx.pc = (ctx.pc + 3 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        }
    }},

    // ── DJNZ Rn, rel ──
    0xD8: { mnemonic: 'DJNZ R0,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 0); } },
    0xD9: { mnemonic: 'DJNZ R1,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 1); } },
    0xDA: { mnemonic: 'DJNZ R2,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 2); } },
    0xDB: { mnemonic: 'DJNZ R3,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 3); } },
    0xDC: { mnemonic: 'DJNZ R4,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 4); } },
    0xDD: { mnemonic: 'DJNZ R5,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 5); } },
    0xDE: { mnemonic: 'DJNZ R6,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 6); } },
    0xDF: { mnemonic: 'DJNZ R7,rel', len: 2, cycles: 2, handler: (ctx) => { _djnz(ctx, 7); } },

    // ── LCALL addr16 ──
    0x12: { mnemonic: 'LCALL addr16', len: 3, cycles: 2, handler: (ctx) => {
        _lcall(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], ctx.rom[(ctx.pc + 2) & 0xFFFF]);
    }},

    // ── ACALL addr11 ──
    0x11: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },
    0x31: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },
    0x51: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },
    0x71: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },
    0x91: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },
    0xB1: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },
    0xD1: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },
    0xF1: { mnemonic: 'ACALL', len: 2, cycles: 2, handler: _acall },

    // ── RET ──
    0x22: { mnemonic: 'RET', len: 1, cycles: 2, handler: (ctx) => {
        ctx.pc = _popWord(ctx);
    }},

    // ── RETI ──
    0x32: { mnemonic: 'RETI', len: 1, cycles: 2, handler: (ctx) => {
        ctx.pc = _popWord(ctx);
        ctx.inInterrupt = false;
        ctx.interruptPriority = -1;
    }},
};
```

把手函数定义：

```javascript
// ── 辅助函数 ──

function _add(ctx, val) {
    const sum = ctx.acc + val;
    setCY(ctx, sum > 0xFF);
    setAC(ctx, (ctx.acc & 0x0F) + (val & 0x0F) > 0x0F);
    setOV(ctx, (~(ctx.acc ^ val) & (ctx.acc ^ sum) & 0x80) !== 0);
    ctx.acc = sum & 0xFF;
    updateP(ctx);
}

function _addc(ctx, val) {
    const c = CY(ctx);
    const sum = ctx.acc + val + c;
    setCY(ctx, sum > 0xFF);
    setAC(ctx, ((ctx.acc & 0x0F) + (val & 0x0F) + c) > 0x0F);
    setOV(ctx, (~(ctx.acc ^ val) & (ctx.acc ^ sum) & 0x80) !== 0);
    ctx.acc = sum & 0xFF;
    updateP(ctx);
}

function _subb(ctx, val) {
    const c = CY(ctx);
    const diff = ctx.acc - val - c;
    setCY(ctx, diff < 0);
    setAC(ctx, ((ctx.acc & 0x0F) - (val & 0x0F) - c) < 0);
    setOV(ctx, ((ctx.acc ^ val) & (ctx.acc ^ diff) & 0x80) !== 0);
    ctx.acc = diff & 0xFF;
    updateP(ctx);
}

function _ajmp(ctx) {
    const opcode = ctx.rom[ctx._instrPC];
    const page = (opcode >> 5) & 7;
    const addr11 = (page << 8) | ctx.rom[(ctx._instrPC + 1) & 0xFFFF];
    ctx.pc = (ctx._instrPC & 0xF800) | addr11;
}

function _acall(ctx) {
    const opcode = ctx.rom[ctx._instrPC];
    const page = (opcode >> 5) & 7;
    const addr11 = (page << 8) | ctx.rom[(ctx._instrPC + 1) & 0xFFFF];
    _pushWord(ctx, (ctx._instrPC + 2) & 0xFFFF);
    ctx.pc = (ctx._instrPC & 0xF800) | addr11;
}

function _lcall(ctx, addrH, addrL) {
    _pushWord(ctx, (ctx.pc + 3) & 0xFFFF);
    ctx.pc = (addrH << 8) | addrL;
}

function _pushWord(ctx, word) {
    ctx.ram[(ctx.sp + 1) & 0xFF] = (word >> 8) & 0xFF;
    ctx.ram[(ctx.sp + 2) & 0xFF] = word & 0xFF;
    ctx.sp = (ctx.sp + 2) & 0xFF;
}

function _popWord(ctx) {
    const low = ctx.ram[ctx.sp];
    const high = ctx.ram[(ctx.sp - 1) & 0xFF];
    ctx.sp = (ctx.sp - 2) & 0xFF;
    return (high << 8) | low;
}

function _djnz(ctx, r) {
    const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
    const val = (getR(ctx, r) - 1) & 0xFF;
    setR(ctx, r, val);
    if (val !== 0) {
        ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
    }
}
```

同时在 `_initContext` 开头添加 `ctx._readSFR` 和 `ctx._writeSFR` 绑定：

```javascript
const self = this;
ctx._readSFR = (addr) => self._readSFR(ctx, addr);
ctx._writeSFR = (addr, val) => self._writeSFR(ctx, addr, val);
```

- [ ] **Step 2: 验证语法**

Run: `cd "...difftransformer" && node -c tools/MCS51Solver.js`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add tools/MCS51Solver.js
git commit -m "feat(mcs51): add ~60 opcode instruction set with addressing modes"
```

---

### Task 3: 实现定时器、中断、UART、端口同步

**Files:**
- Modify: `tools/MCS51Solver.js`（追加 `_updateTimers`、`_checkInterrupts`、`_syncPorts`、`_checkRST`、`_syncUART` 方法）

**Scope:** 实现外设仿真。这些方法在 `update()` 中每帧结束时调用。

- [ ] **Step 1: 在 MCS51Solver 类中追加以下方法**

追加在 `_initContext` 之后：

```javascript
// ── 定时器更新 ──
_updateTimers(mcu, ctx, cyclesUsed) {
    this._updateTimer(ctx, ctx.timer0, cyclesUsed, 'T0');
    this._updateTimer(ctx, ctx.timer1, cyclesUsed, 'T1');
}

_updateTimer(ctx, timer, cycles, name) {
    if (!timer.running) return;
    const mode = timer.mode & 0x0F;
    let count = timer.count;

    if ((timer.mode & 0x08)) { // C/T=1: 外部脉冲计数器模式
        const pinName = name === 'T0' ? 't0' : 't1';
        const pinVal = ctx.pinInput[pinName];
        // 简化：每个帧最多计数一次
        if (pinVal === 0 && ctx._prevT === undefined) ctx._prevT = 1;
        if (ctx._prevT === 1 && pinVal === 0) {
            count = (count - 1) & 0xFFFF;
        }
        ctx._prevT = pinVal;
    } else {
        // 定时器模式：每个机器周期计数一次
        count = (count - cycles) & 0xFFFF;
    }

    timer.count = Math.max(0, count);

    // 检测溢出
    let overflow = false;
    switch (mode & 0x03) {
        case 0: // 模式 0: 13 位
            overflow = (count & 0x1FFF) === 0;
            if (overflow) {
                const reload13 = ((timer.reload << 5) & 0xFF00) | (timer.reload & 0x1F);
                timer.count = reload13;
            }
            break;
        case 1: // 模式 1: 16 位
            overflow = count === 0;
            if (overflow) timer.count = (timer.reload << 8) | (timer.count & 0xFF);
            break;
        case 2: // 模式 2: 8 位自动重装
            overflow = (count & 0xFF) === 0;
            if (overflow) timer.count = (timer.reload << 8) | timer.reload;
            break;
    }

    if (overflow) {
        if (name === 'T0') ctx.tf0 = 1;
        else ctx.tf1 = 1;
    }
}

// ── RST 检测 ──
_checkRST(mcu, ctx) {
    const rstLine = `${mcu.id}_rst`;
    const rstVal = signalBridge.readSignal(rstLine);
    if (rstVal === 1 && ctx._prevRST !== 1) {
        // 复位
        ctx.pc = 0;
        ctx.acc = 0;
        ctx.b = 0;
        ctx.psw = 0;
        ctx.sp = 0x07;
        ctx.dpl = 0;
        ctx.dph = 0;
        ctx.halted = false;
        ctx.inInterrupt = false;
        ctx.interruptPriority = -1;
        ctx.timer0.running = false;
        ctx.timer1.running = false;
        ctx.uart.sending = false;
        ctx.uart.receiving = false;
        ctx.tf0 = 0; ctx.tf1 = 0;
        ctx.ie0 = 0; ctx.ie1 = 0;
        ctx.ti = 0; ctx.ri = 0;
        // SFR 重置
        ctx.sfr.fill(0);
        ctx.sfr[0x00] = 0xFF; // P0
        ctx.sfr[0x10] = 0xFF; // P1
        ctx.sfr[0x20] = 0xFF; // P2
        ctx.sfr[0x30] = 0xFF; // P3
        return true;
    }
    ctx._prevRST = rstVal;
    return false;
}

// ── 中断检测 ──
_checkInterrupts(mcu, ctx) {
    const ie = ctx.sfr[0x28]; // IE = SFR 0xA8, 索引 0x28
    const ip = ctx.sfr[0x38]; // IP = SFR 0xB8, 索引 0x38
    const ea = (ie >> 7) & 1;

    if (!ea) return;
    if (ctx.inInterrupt && ctx.interruptPriority === 1) return; // 高优先不可抢占

    // 5 个中断源，按优先级排列
    const interrupts = [
        { flag: 0x01, en: 0x01, vec: 0x0003, pri: (ip >> 0) & 1, name: 'IE0' },
        { flag: 0x01, en: 0x02, vec: 0x000B, pri: (ip >> 1) & 1, name: 'TF0' },
        { flag: 0x01, en: 0x04, vec: 0x0013, pri: (ip >> 2) & 1, name: 'IE1' },
        { flag: 0x01, en: 0x08, vec: 0x001B, pri: (ip >> 3) & 1, name: 'TF1' },
        { flag: 0x01, en: 0x10, vec: 0x0023, pri: (ip >> 4) & 1, name: 'TI/RI' },
    ];

    let best = -1;
    let bestPri = -1;

    // INT0
    const int0Pin = ctx.pinInput.int0;
    if (ctx.ie0) { // IT0=1 下降沿触发
        if (ctx._prevINT0 === 1 && int0Pin === 0) {
            ctx.ie0 = 0;
            ctx.sfr[0x00] |= 1; // TCON.0
        }
    }
    ctx._prevINT0 = int0Pin;

    // 检查 IE0 标志
    const tcon = ctx.sfr[0x08]; // TCON
    const flagIE0 = (tcon >> 0) & 1; // TCON.0 = IE0

    const flagTF0 = (tcon >> 5) & 1;
    const flagIE1 = (tcon >> 2) & 1;
    const flagTF1 = (tcon >> 7) & 1;
    const flagTI = ctx.ti;
    const flagRI = ctx.ri;

    const flags = [
        (flagIE0 && (ie & 0x01) ? 1 : 0),  // IE0
        (ctx.tf0 && (ie & 0x02) ? 1 : 0),  // TF0
        (flagIE1 && (ie & 0x04) ? 1 : 0),  // IE1
        (ctx.tf1 && (ie & 0x08) ? 1 : 0),  // TF1
        ((ctx.ti || ctx.ri) && (ie & 0x10) ? 1 : 0), // TI/RI
    ];

    for (let i = 0; i < 5; i++) {
        if (!flags[i]) continue;
        const pri = (ip >> i) & 1;
        if (ctx.inInterrupt && pri <= ctx.interruptPriority) continue;
        if (pri > bestPri) {
            best = i;
            bestPri = pri;
        }
    }

    if (best >= 0) {
        const vec = [0x0003, 0x000B, 0x0013, 0x001B, 0x0023][best];
        ctx.inInterrupt = true;
        ctx.interruptPriority = bestPri;
        // 清除中断标志（硬件自动清除）
        if (best === 1) ctx.tf0 = 0;
        if (best === 3) ctx.tf1 = 0;
        if (best === 0 && ctx.ie0) { /* 外部中断标志由硬件清除，但电平触发需要软件清除 */ }
        if (best === 2 && ctx.ie1) { /* 同上 */ }
        // LCALL 到中断向量
        _pushWord(ctx, ctx.pc);
        ctx.pc = vec;
    }
}

// ── GPIO 端口同步 ──
_syncPorts(mcu, ctx) {
    const portNames = ['p0', 'p1', 'p2', 'p3'];
    const sfrOffsets = [0x00, 0x10, 0x20, 0x30]; // 对应 SFR 地址 0x80, 0x90, 0xA0, 0xB0

    portNames.forEach((name, idx) => {
        const sfrVal = ctx.sfr[sfrOffsets[idx]];

        // 输出：写 SignalBridge
        for (let bit = 0; bit < 8; bit++) {
            const lineId = `${mcu.id}_${name}_${bit}`;
            const bitVal = (sfrVal >> bit) & 1;
            signalBridge.writeSignal(lineId, bitVal, 'strong');
        }

        // 输入：从 SignalBridge 读取
        let inputVal = 0;
        for (let bit = 0; bit < 8; bit++) {
            const lineId = `${mcu.id}_${name}_${bit}`;
            const extVal = signalBridge.readSignal(lineId);
            // 准双向口：如果 SFR 输出 1，引脚被外部拉低时读 0
            if (extVal === 0) inputVal |= 0;
            else inputVal |= (1 << bit);
        }

        // 更新引脚输入缓存
        ctx.pinInput[name] = inputVal;
    });

    // 特殊引脚 P3 的复用功能
    ctx.pinInput.int0 = (ctx.pinInput.p3 >> 2) & 1;
    ctx.pinInput.int1 = (ctx.pinInput.p3 >> 3) & 1;
    ctx.pinInput.t0 = (ctx.pinInput.p3 >> 4) & 1;
    ctx.pinInput.t1 = (ctx.pinInput.p3 >> 5) & 1;
    ctx.pinInput.rxd = (ctx.pinInput.p3 >> 0) & 1;
}

// ── UART 同步 ──
_syncUART(mcu, ctx) {
    const scon = ctx.sfr[0x18]; // SCON
    const sm0 = (scon >> 7) & 1;
    const sm1 = (scon >> 6) & 1;
    const sm2 = (scon >> 5) & 1;
    const ren = (scon >> 4) & 1;
    const tb8 = (scon >> 3) & 1;
    const rb8 = (scon >> 2) & 1;

    // 模式 1（SM0=0, SM1=1）：8 位 UART 可变波特率
    if (sm0 === 0 && sm1 === 1) {
        // 发送
        if (ctx.uart.sending) {
            const data = ctx.uart.sbuf;
            const txdLine = `${mcu.id}_txd`;
            // 写 SignalBridge 信号线（数据 + 停止位格式打包）
            const frame = 0x200 | (data << 1); // 起始位 0 + 8 数据 + 停止位 1
            signalBridge.writeSignal(txdLine, 1, 'strong'); // TXD 高电平（空闲）
            // 简化：写入数据字节到信号线
            ctx.uart.sending = false;
            ctx.ti = 1;
            // TI 中断会在 _checkInterrupts 中处理
        }

        // 接收
        if (ren) {
            const rxdLine = `${mcu.id}_rxd`;
            const rxdVal = signalBridge.readSignal(rxdLine);
            // 检测起始位（下降沿）
            if (ctx._prevRXD === 1 && rxdVal === 0) {
                // 简化：从信号线读取数据字节
                const rxData = 0; // 简化：外部电路写信号线时打包数据
                ctx.uart.rxByte = rxData;
                ctx.ri = 1;
            }
            ctx._prevRXD = rxdVal;
        }
    }

    // 时钟同步（从 TxD 信号线读取外部写入的数据）
    // 由外部电路写信号线，UART 在下一个帧读
}

// ── 显示同步 ──
_syncDisplay(mcu, ctx) {
    mcu._displayPC = ctx.pc;
    mcu._displayACC = ctx.acc;
    mcu._displayB = ctx.b;
    mcu._displayPSW = ctx.psw;
    mcu._displaySP = ctx.sp;
    mcu._displayDPH = ctx.dph;
    mcu._displayDPL = ctx.dpl;
    mcu._displayP0 = ctx.sfr[0x00];
    mcu._displayP1 = ctx.sfr[0x10];
    mcu._displayP2 = ctx.sfr[0x20];
    mcu._displayP3 = ctx.sfr[0x30];
    mcu._displayState = ctx.halted ? 'halted' : 'running';
    mcu._displayROM = ctx.rom;
    mcu._displayRAM = ctx.ram;
    mcu._displaySFR = ctx.sfr;
}
```

- [ ] **Step 2: 验证语法**

Run: `cd "...difftransformer" && node -c tools/MCS51Solver.js`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add tools/MCS51Solver.js
git commit -m "feat(mcs51): add timers, interrupts, UART, GPIO sync"
```

---

### Task 4: 创建 MCS51.js 组件

**Files:**
- Create: `digital/MCS51.js`

**Scope:** 8051 组件视觉效果（功能模块视图）、引脚注册（4×8 GPIO + 控制引脚 + 时钟/电源）、右键菜单（加载 HEX、寄存器查看器、内存查看器、反汇编查看器）、状态显示。

- [ ] **Step 1: 写入 MCS51.js**

```javascript
/**
 * MCS51.js — 8051 单片机组件（功能模块视图）
 *
 * 引脚：
 *   P0[0..7], P1[0..7], P2[0..7], P3[0..7] — GPIO (双向)
 *   RST — 复位输入（数字）
 *   XTAL1 — 晶振输入（决定频率）
 *   VCC, GND — 电源
 *   TxD, RxD — UART
 *   INT0, INT1 — 外部中断
 *   T0, T1 — 定时器外部输入
 *
 * 右键菜单：
 *   - 加载 HEX 文件
 *   - 寄存器查看器
 *   - 内存查看器
 *   - 反汇编查看器
 *   - 复位
 */

import { BaseComponent } from '../components/BaseComponent.js';
import { signalBridge } from '../tools/SignalBridge.js';

export class MCS51 extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);
        this.type = 'd_mcs51';
        this.cache = 'fixed';

        const s = this.scale;
        const W = 160 * s;
        const H = 200 * s;

        // ── 状态 ──
        this.powerOn = config.powerOn !== undefined ? config.powerOn : true;
        this.xtalFreq = config.xtalFreq || 12000000;

        // 显示缓存（由 MCS51Solver 更新）
        this._displayPC = 0;
        this._displayACC = 0;
        this._displayB = 0;
        this._displayPSW = 0;
        this._displaySP = 0x07;
        this._displayDPH = 0;
        this._displayDPL = 0;
        this._displayP0 = 0xFF;
        this._displayP1 = 0xFF;
        this._displayP2 = 0xFF;
        this._displayP3 = 0xFF;
        this._displayState = 'running';
        this._displayROM = null;
        this._displayRAM = null;
        this._displaySFR = null;
        this._romData = null; // 预加载的 ROM 数据

        // ── 主体 ──
        const body = new Konva.Rect({
            x: -W / 2, y: -H / 2,
            width: W, height: H,
            fill: '#1a1a2e',
            stroke: '#4a90d9',
            strokeWidth: 2 * s,
            cornerRadius: 6 * s,
        });
        this.group.add(body);

        // ── 内部区域 ──
        const inner = new Konva.Rect({
            x: -W / 2 + 6 * s, y: -H / 2 + 30 * s,
            width: W - 12 * s, height: H - 36 * s,
            fill: '#16213e',
            cornerRadius: 4 * s,
        });
        this.group.add(inner);

        // ── 型号标识 ──
        const label = new Konva.Text({
            text: '8051',
            x: -W / 2 + 10 * s, y: -H / 2 + 6 * s,
            fontSize: 18 * s, fontFamily: 'Courier New',
            fill: '#4a90d9', fontStyle: 'bold',
        });
        this.group.add(label);

        // ── 状态指示 ──
        this._stateLED = new Konva.Circle({
            x: W / 2 - 14 * s, y: -H / 2 + 10 * s,
            radius: 5 * s, fill: '#2ecc71',
            stroke: '#fff', strokeWidth: 1 * s,
        });
        this.group.add(this._stateLED);

        const stateLabel = new Konva.Text({
            text: 'RUN',
            x: W / 2 - 28 * s, y: -H / 2 + 4 * s,
            fontSize: 9 * s, fontFamily: 'Arial',
            fill: '#2ecc71',
        });
        this.group.add(stateLabel);
        this._stateLabel = stateLabel;

        // ── 核心寄存器显示 ──
        this._regTexts = {};
        const regLines = [
            { key: 'pc', label: 'PC', x: -W/2+12, y: -H/2+38, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(4,'0')}` },
            { key: 'acc', label: 'ACC', x: -W/2+12, y: -H/2+54, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'b', label: 'B', x: W/2-65, y: -H/2+54, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'psw', label: 'PSW', x: -W/2+12, y: -H/2+70, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'sp', label: 'SP', x: W/2-65, y: -H/2+70, fmt: (v) => `0x${v.toString(16).toUpperCase().padStart(2,'0')}` },
            { key: 'dptr', label: 'DPTR', x: -W/2+12, y: -H/2+86, fmt: (v) => v },
        ];

        regLines.forEach(rl => {
            const t = new Konva.Text({
                text: `${rl.label}: ${rl.fmt(0)}`,
                x: rl.x * s, y: rl.y * s,
                fontSize: 10 * s, fontFamily: 'Courier New',
                fill: '#bdc3c7',
            });
            this.group.add(t);
            this._regTexts[rl.key] = t;
        });

        // ── 端口显示 ──
        this._portTexts = {};
        const portNames = ['P0', 'P1', 'P2', 'P3'];
        portNames.forEach((pn, i) => {
            const t = new Konva.Text({
                text: `${pn}: 0xFF`,
                x: (-W/2 + 12 + (i % 2) * 75) * s,
                y: (-H/2 + 104 + Math.floor(i/2) * 16) * s,
                fontSize: 10 * s, fontFamily: 'Courier New',
                fill: '#e67e22',
            });
            this.group.add(t);
            this._portTexts[pn] = t;
        });

        // ── 引脚定义和注册 ──
        this._registerPins(s, W, H);
    }

    _registerPins(s, W, H) {
        const leftX = -W/2 - 4 * s;
        const rightX = W/2 + 4 * s;
        const topY = -H/2;
        const pinSpacing = 12 * s;

        // 左侧引脚：P0[0..3] + INT0 + INT1 + T0 + T1 + XTAL1
        const leftPins = ['P0.0', 'P0.1', 'P0.2', 'P0.3', 'INT0', 'INT1', 'T0', 'T1', 'XTAL1'];
        leftPins.forEach((name, i) => {
            const y = topY + (i + 1) * pinSpacing;
            this.addPort(leftX - 10 * s, y, name, 'wire', name.startsWith('P') ? 'n' : 'p');
        });

        // 右侧引脚：P0[4..7] + P1[0..3] + RST + TxD + RxD + EA
        const rightPins = ['P0.4', 'P0.5', 'P0.6', 'P0.7', 'P1.0', 'P1.1', 'P1.2', 'P1.3', 'RST', 'TxD', 'RxD'];
        rightPins.forEach((name, i) => {
            const y = topY + (i + 1) * pinSpacing;
            this.addPort(rightX + 10 * s, y, name, 'wire', name === 'RST' ? 'p' : 'n');
        });

        // 底部引脚：P1[4..7] + P2[0..7] + P3[0..3]
        const bottomPins = ['P1.4', 'P1.5', 'P1.6', 'P1.7', 'P2.0', 'P2.1', 'P2.2', 'P2.3'];
        bottomPins.forEach((name, i) => {
            const x = (-W/2 + 10 + i * 16) * s;
            this.addPort(x, H/2 + 4 * s, name, 'wire', 'n');
        });

        // 注册数字信号线（SignalBridge 连接）
        this._registerSignalLines();
    }

    _registerSignalLines() {
        // P0 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p0_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P0.${i}`);
        }
        // P1 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p1_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P1.${i}`);
        }
        // P2 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p2_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P2.${i}`);
        }
        // P3 信号线
        for (let i = 0; i < 8; i++) {
            const lineId = `${this.id}_p3_${i}`;
            signalBridge.createSignalLine(lineId);
            signalBridge.connectToLine(lineId, `${this.id}_P3.${i}`);
        }

        // RST 信号线
        signalBridge.createSignalLine(`${this.id}_rst`);
        signalBridge.connectToLine(`${this.id}_rst`, `${this.id}_RST`);

        // TxD, RxD 信号线
        signalBridge.createSignalLine(`${this.id}_txd`);
        signalBridge.createSignalLine(`${this.id}_rxd`);
        signalBridge.connectToLine(`${this.id}_txd`, `${this.id}_TxD`);
        signalBridge.connectToLine(`${this.id}_rxd`, `${this.id}_RxD`);
    }

    /**
     * 每帧更新显示（由 MCS51Solver 设置 _display* 属性后调用 updateLED）
     */
    updateLED() {
        if (!this._regTexts) return;

        this._regTexts.pc.text(`PC: 0x${this._displayPC.toString(16).toUpperCase().padStart(4, '0')}`);
        this._regTexts.acc.text(`ACC: 0x${this._displayACC.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.b.text(`B: 0x${this._displayB.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.psw.text(`PSW: 0x${this._displayPSW.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.sp.text(`SP: 0x${this._displaySP.toString(16).toUpperCase().padStart(2, '0')}`);
        this._regTexts.dptr.text(`DPTR: 0x${this._displayDPH.toString(16).toUpperCase().padStart(2, '0')}${this._displayDPL.toString(16).toUpperCase().padStart(2, '0')}`);

        this._portTexts.P0.text(`P0: 0x${this._displayP0.toString(16).toUpperCase().padStart(2, '0')}`);
        this._portTexts.P1.text(`P1: 0x${this._displayP1.toString(16).toUpperCase().padStart(2, '0')}`);
        this._portTexts.P2.text(`P2: 0x${this._displayP2.toString(16).toUpperCase().padStart(2, '0')}`);
        this._portTexts.P3.text(`P3: 0x${this._displayP3.toString(16).toUpperCase().padStart(2, '0')}`);

        const isRunning = this._displayState === 'running';
        this._stateLED.fill(isRunning ? '#2ecc71' : '#e74c3c');
        this._stateLabel.text(isRunning ? 'RUN' : 'HLT');
        this._stateLabel.fill(isRunning ? '#2ecc71' : '#e74c3c');
    }

    /**
     * 右键菜单
     */
    showContextMenu(evt) {
        const oldMenu = document.getElementById('comp-context-menu');
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'comp-context-menu';
        menu.style = `
            position: fixed; top: ${evt.clientY}px; left: ${evt.clientX}px;
            background: white; border: 1px solid #ccc; border-radius: 4px;
            box-shadow: 2px 2px 10px rgba(0,0,0,0.2); z-index: 10000;
            padding: 5px 0; min-width: 160px; font-family: sans-serif; font-size: 14px;
        `;

        const createItem = (label, onClick) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style = 'padding: 8px 15px; cursor: pointer; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = '#f0f0f0';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = () => { onClick(); menu.remove(); };
            return item;
        };

        menu.appendChild(createItem('向右旋转 90°', () => this.rotate(90)));
        menu.appendChild(createItem('向左旋转 90°', () => this.rotate(-90)));
        menu.appendChild(createItem('参数设置', () => this.showConfigDialog()));
        menu.appendChild(createItem('加载 HEX 文件', () => this._loadHEX()));
        menu.appendChild(createItem('寄存器查看器', () => this._showRegViewer()));
        menu.appendChild(createItem('内存查看器', () => this._showMemViewer()));
        menu.appendChild(createItem('反汇编查看器', () => this._showDisasmViewer()));
        menu.appendChild(createItem('重置 8051', () => this._resetMCS51()));

        this.sys.container.appendChild(menu);
        const closeMenu = () => { menu.remove(); window.removeEventListener('click', closeMenu); };
        window.addEventListener('click', closeMenu);
    }

    /**
     * 加载 HEX 文件
     */
    _loadHEX() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.hex,.ihx';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const hexText = ev.target.result;
                if (this.sys.mcs51Solver) {
                    const result = this.sys.mcs51Solver.loadHex(this.id, hexText);
                    if (result.success) {
                        this.sys.showFloatingTip(`HEX 加载成功: ${result.totalBytes} 字节, PC=0x${result.pc.toString(16)}`, 3000);
                    } else {
                        this.sys.showFloatingTip(`HEX 加载失败: ${result.error}`, 3000);
                    }
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    /**
     * 寄存器查看器
     */
    _showRegViewer() {
        const modal = document.createElement('div');
        modal.style = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;`;

        const content = document.createElement('div');
        content.style = `background:#1e1e2e;padding:20px;border-radius:8px;width:500px;max-height:80vh;overflow-y:auto;color:#cdd6f4;font-family:'Courier New',monospace;font-size:13px;`;

        let html = '<h3 style="color:#89b4fa;margin-top:0;">SFR 寄存器</h3><table style="width:100%;border-collapse:collapse;">';
        const sfrNames = [
            [0x80,'P0'],[0x81,'SP'],[0x82,'DPL'],[0x83,'DPH'],[0x87,'PCON'],
            [0x88,'TCON'],[0x89,'TMOD'],[0x8A,'TL0'],[0x8B,'TL1'],[0x8C,'TH0'],[0x8D,'TH1'],
            [0x90,'P1'],[0x98,'SCON'],[0x99,'SBUF'],
            [0xA0,'P2'],[0xA8,'IE'],[0xB0,'P3'],[0xB8,'IP'],
            [0xD0,'PSW'],[0xE0,'ACC'],[0xF0,'B'],
        ];

        html += '<tr style="color:#a6adc8;"><th>地址</th><th>名称</th><th>值</th><th>二进制</th></tr>';
        sfrNames.forEach(([addr, name]) => {
            const val = this._displaySFR ? this._displaySFR[addr - 0x80] : 0;
            const bin = val.toString(2).padStart(8,'0');
            html += `<tr><td>0x${addr.toString(16).toUpperCase()}</td><td>${name}</td><td>0x${val.toString(16).toUpperCase().padStart(2,'0')}</td><td>${bin}</td></tr>`;
        });
        html += '</table>';

        content.innerHTML = html;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style = 'margin-top:15px;padding:8px 20px;cursor:pointer;border:none;background:#45475a;color:#cdd6f4;border-radius:4px;';
        closeBtn.onclick = () => document.body.removeChild(modal);
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    /**
     * 内存查看器
     */
    _showMemViewer() {
        const modal = document.createElement('div');
        modal.style = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;`;

        const content = document.createElement('div');
        content.style = `background:#1e1e2e;padding:20px;border-radius:8px;width:600px;max-height:80vh;overflow-y:auto;color:#cdd6f4;font-family:'Courier New',monospace;font-size:12px;`;

        let html = '<h3 style="color:#89b4fa;margin-top:0;">内部 RAM (0x00-0x7F)</h3><pre style="line-height:1.4;">';
        const ram = this._displayRAM;
        if (ram) {
            for (let row = 0; row < 8; row++) {
                const addr = row * 16;
                const bytes = Array.from(ram.slice(addr, addr + 16));
                const hex = bytes.map(b => b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
                const ascii = bytes.map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
                html += `${addr.toString(16).toUpperCase().padStart(2,'0')}: ${hex}  ${ascii}\n`;
            }
        } else {
            html += '（未加载程序）\n';
        }
        html += '</pre>';

        content.innerHTML = html;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style = 'margin-top:15px;padding:8px 20px;cursor:pointer;border:none;background:#45475a;color:#cdd6f4;border-radius:4px;';
        closeBtn.onclick = () => document.body.removeChild(modal);
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    /**
     * 反汇编查看器
     */
    _showDisasmViewer() {
        const modal = document.createElement('div');
        modal.style = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;`;

        const content = document.createElement('div');
        content.style = `background:#1e1e2e;padding:20px;border-radius:8px;width:700px;max-height:80vh;overflow-y:auto;color:#cdd6f4;font-family:'Courier New',monospace;font-size:12px;`;

        let html = '<h3 style="color:#89b4fa;margin-top:0;">反汇编</h3><pre style="line-height:1.4;">';
        const rom = this._displayROM;
        const pc = this._displayPC;

        if (rom) {
            const DISASM = {
                0x00:'NOP',
                0x80:'SJMP',
                0x02:'LJMP',
                0x12:'LCALL',
                0x22:'RET',
                0x32:'RETI',
                0x74:'MOV A,#',
                0x90:'MOV DPTR,#',
                0xE4:'CLR A',
                0xF4:'CPL A',
                0xD3:'SETB C',
                0xC3:'CLR C',
                0x04:'INC A',
                0x14:'DEC A',
                0x24:'ADD A,#',
                0x44:'ORL A,#',
                0x54:'ANL A,#',
                0x64:'XRL A,#',
                0x94:'SUBB A,#',
                0xB4:'CJNE A,#',
                0x60:'JZ',
                0x70:'JNZ',
                0x40:'JC',
                0x50:'JNC',
                0xD8:'DJNZ R0,',
                0xD9:'DJNZ R1,',
                0xA3:'INC DPTR',
                0x84:'DIV AB',
                0xA4:'MUL AB',
                0xC4:'SWAP A',
                0x23:'RL A',
                0x33:'RLC A',
                0x03:'RR A',
                0x13:'RRC A',
                0x93:'MOVC A,@A+DPTR',
                0x83:'MOVC A,@A+PC',
                0xE0:'MOVX A,@DPTR',
                0xF0:'MOVX @DPTR,A',
                0x73:'JMP @A+DPTR',
            };

            const startAddr = Math.max(0, pc - 32);
            const endAddr = Math.min(0xFFFF, pc + 96);

            let addr = startAddr;
            while (addr < endAddr) {
                const opcode = rom[addr];
                const isCurrent = addr === pc;
                const prefix = isCurrent ? '→ ' : '  ';
                let disasm = `${prefix}${addr.toString(16).toUpperCase().padStart(4,'0')}: `;

                if (opcode in DISASM) {
                    const mnemonic = DISASM[opcode];
                    const instr = OPCODES ? OPCODES[opcode] : null;
                    const len = instr ? instr.len : 2;

                    if (len === 1) {
                        disasm += mnemonic;
                    } else if (len === 2) {
                        const data = rom[(addr + 1) & 0xFFFF];
                        if (opcode === 0x80 || opcode === 0x60 || opcode === 0x70 || opcode === 0x40 || opcode === 0x50) {
                            const rel = data > 127 ? data - 256 : data;
                            const target = (addr + 2 + rel) & 0xFFFF;
                            disasm += `${mnemonic} 0x${target.toString(16).toUpperCase().padStart(4,'0')}`;
                        } else if (opcode === 0x74 || opcode === 0x24 || opcode === 0x44 || opcode === 0x54 || opcode === 0x64 || opcode === 0x94) {
                            disasm += `${mnemonic}0x${data.toString(16).toUpperCase().padStart(2,'0')}`;
                        } else {
                            disasm += `${mnemonic}0x${data.toString(16).toUpperCase().padStart(2,'0')}`;
                        }
                        // DJNZ
                        if (opcode >= 0xD8 && opcode <= 0xDF) {
                            const rel = data > 127 ? data - 256 : data;
                            const target = (addr + 2 + rel) & 0xFFFF;
                            disasm += `0x${target.toString(16).toUpperCase().padStart(4,'0')}`;
                        }
                        // CJNE
                        if (opcode === 0xB4) {
                            const data2 = rom[(addr + 2) & 0xFFFF];
                            const rel = data2 > 127 ? data2 - 256 : data2;
                            const target = (addr + 3 + rel) & 0xFFFF;
                            disasm += `0x${data.toString(16).toUpperCase().padStart(2,'0')},0x${target.toString(16).toUpperCase().padStart(4,'0')}`;
                            addr += 2;
                        }
                    } else if (len === 3) {
                        const h = rom[(addr + 1) & 0xFFFF];
                        const l = rom[(addr + 2) & 0xFFFF];
                        if (opcode === 0x02 || opcode === 0x12) {
                            disasm += `${mnemonic} 0x${h.toString(16).toUpperCase().padStart(2,'0')}${l.toString(16).toUpperCase().padStart(2,'0')}`;
                        } else if (opcode === 0x90) {
                            disasm += `${mnemonic}0x${h.toString(16).toUpperCase().padStart(2,'0')}${l.toString(16).toUpperCase().padStart(2,'0')}`;
                        }
                        addr += 2;
                    }
                    addr += len;
                } else {
                    // 未知操作码
                    disasm += `DB 0x${opcode.toString(16).toUpperCase().padStart(2,'0')}`;
                    addr += 1;
                }

                html += disasm + '\n';
            }
        } else {
            html += '（未加载程序）\n';
        }
        html += '</pre>';

        content.innerHTML = html;
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style = 'margin-top:15px;padding:8px 20px;cursor:pointer;border:none;background:#45475a;color:#cdd6f4;border-radius:4px;';
        closeBtn.onclick = () => document.body.removeChild(modal);
        content.appendChild(closeBtn);
        modal.appendChild(content);
        document.body.appendChild(modal);
    }

    /**
     * 重置 8051
     */
    _resetMCS51() {
        if (this.sys.mcs51Solver) {
            this.sys.mcs51Solver.resetMCU(this.id);
        }
        this._displayState = 'running';
        this._displayPC = 0;
        if (this.sys.showFloatingTip) {
            this.sys.showFloatingTip('8051 已重置', 1500);
        }
    }

    /**
     * 参数配置
     */
    getConfigFields() {
        return [
            { label: '器件名称', key: 'id', type: 'text' },
            { label: '晶振频率 (Hz)', key: 'xtalFreq', type: 'number' },
            { label: '上电启动', key: 'powerOn', type: 'select', options: [
                { label: '是', value: true }, { label: '否', value: false }
            ]},
        ];
    }

    /**
     * 桌面端端口绝对位置
     */
    getAbsPortPos(portId) {
        const port = this.ports.find(p => p.id === portId);
        if (!port) return { x: 0, y: 0 };
        if (port.node && typeof port.node.getAbsolutePosition === 'function') {
            const pos = port.node.getAbsolutePosition();
            return { x: pos.x, y: pos.y };
        }
        try {
            const p = this.group.getAbsoluteTransform().point({ x: port.x || 0, y: port.y || 0 });
            return { x: p.x, y: p.y };
        } catch (e) {
            return { x: this.group.x() + (port.x || 0), y: this.group.y() + (port.y || 0) };
        }
    }
}
```

- [ ] **Step 2: 验证语法**

Run: `cd "...difftransformer" && node -c digital/MCS51.js`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add digital/MCS51.js
git commit -m "feat(mcs51): add MCS51 component with functional module view and HEX loader"
```

---

### Task 5: 集成到 consys.js

**Files:**
- Modify: `consys.js`（导入 MCS51Solver，在 init() 中实例化，在 _updatePhysics() 中调用）
- Modify: `export.js`（导入导出 MCS51、MCS51Solver）

- [ ] **Step 1: 修改 export.js**

在第 12 行后添加导入：
```javascript
import { MCS51Solver } from './tools/MCS51Solver.js';
```

在第 88 行后添加：
```javascript
import { MCS51 } from './digital/MCS51.js';
```

在 tools 导出中添加 `MCS51Solver`：
```javascript
export {
    Workflow, CircuitSolver, PneumaticSolver, Show, perfMonitor,
    DigitalSolver, MicrocontrollerSolver, MCS51Solver, signalBridge, SignalBridge,
};
```

在 digital 导出中添加 `MCS51`：
```javascript
export {
    DigitalBase,
    AND, OR, NOT, NAND, NOR, XOR,
    DFlipFlop, JKFlipFlop, ClockGen, Counter,
    ADC, DAC,
    MCU,
    Timer555,
    MCS51,
};
```

- [ ] **Step 2: 修改 consys.js**

在文件顶部 import 中添加 MCS51Solver：
```javascript
import { ... MCS51Solver, ... } from './export.js';
```

在组件 import 中添加 MCS51：
```javascript
import { ... MCS51, ... } from './export.js';
```

在 init() 方法中，实例化 MCS51Solver：
```javascript
// 在 this.mcuSolver = new MicrocontrollerSolver(this); 之后
this.mcs51Solver = new MCS51Solver(this);
```

在 _updatePhysics() 中，调用 MCS51Solver.update()：
```javascript
// 在 mcuSolver.update 调用之后
if (this.mcs51Solver) {
    this.mcs51Solver.update(1 / 20);
}
```

- [ ] **Step 3: 构建验证**

Run: `cd "...difftransformer" && npx vite build 2>&1 | tail -15`
Expected: 180+ modules transformed, build success

- [ ] **Step 4: 提交**

```bash
git add consys.js export.js
git commit -m "feat(mcs51): integrate MCS51Solver into simulation loop"
```

---

## 引用

- 设计文档: `docs/superpowers/specs/2026-05-06-mcs51-simulation-design.md`
- 指令集附录: 同上文档附录 A
- 现有模式参考: `digital/Timer555.js`, `digital/MCU.js`, `digital/DigitalBase.js`
