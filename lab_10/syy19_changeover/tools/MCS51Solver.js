/**
 * MCS51Solver.js — 8051 单片机解释执行引擎
 *
 * 指令集：约 60 条常用 8051 指令
 * 外设：P0-P3 GPIO、定时器 T0/T1（模式 0/1/2）、UART（模式 1）、中断（5 源）
 * 时序：12 时钟/机器周期，默认 12MHz
 */
import { signalBridge } from './SignalBridge.js';

// ── SFR 地址常量 ──
const SFR_ADDR = {
    P0: 0x80, SP: 0x81, DPL: 0x82, DPH: 0x83, PCON: 0x87,
    TCON: 0x88, TMOD: 0x89, TL0: 0x8A, TL1: 0x8B, TH0: 0x8C, TH1: 0x8D,
    P1: 0x90, SCON: 0x98, SBUF: 0x99, P2: 0xA0,
    IE: 0xA8, P3: 0xB0, IP: 0xB8, PSW: 0xD0, ACC: 0xE0, B: 0xF0,
};

// PSW 位域
const PSW_CY = 0x80;
const PSW_AC = 0x40;
const PSW_F0 = 0x20;
const PSW_RS1 = 0x10;
const PSW_RS0 = 0x08;
const PSW_OV = 0x04;
const PSW_P = 0x01;

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
    return ctx._readSFR ? ctx._readSFR(addr) : ctx.sfr[addr - 0x80];
}

function writeDirect(ctx, addr, val) {
    if (addr < 0x80) { ctx.ram[addr] = val & 0xFF; return; }
    if (ctx._writeSFR) ctx._writeSFR(addr, val & 0xFF);
}

// 位寻址
function bitAddr(bit) {
    if (bit < 0x80) {
        const byteAddr = 0x20 + Math.floor(bit / 8);
        const bitOff = bit % 8;
        return { addr: byteAddr, bit: bitOff, isSFR: false };
    }
    const byteAddr = 0x80 + Math.floor((bit - 0x80) / 8) * 8;
    const bitOff = (bit - 0x80) % 8;
    return { addr: byteAddr, bit: bitOff, isSFR: byteAddr >= 0x80 };
}

function readBit(ctx, bit) {
    const ba = bitAddr(bit);
    const byteVal = ba.isSFR ? readDirect(ctx, ba.addr) : ctx.ram[ba.addr];
    return (byteVal >> ba.bit) & 1;
}

// 位运算的读-改-写按 8051 语义读"端口锁存器"（而非引脚）
function readBitLatch(ctx, bit) {
    const ba = bitAddr(bit);
    const byteVal = ba.isSFR ? (ctx.sfr[ba.addr - 0x80] || 0) : ctx.ram[ba.addr];
    return (byteVal >> ba.bit) & 1;
}

function setBit(ctx, bit, val) {
    const ba = bitAddr(bit);
    const old = ba.isSFR ? (ctx.sfr[ba.addr - 0x80] || 0) : ctx.ram[ba.addr];
    const newVal = val ? (old | (1 << ba.bit)) : (old & ~(1 << ba.bit));
    if (ba.isSFR) writeDirect(ctx, ba.addr, newVal);
    else ctx.ram[ba.addr] = newVal & 0xFF;
}

// ── OPCODES 表 ──
// len=0 for unconditional jumps (handlers fully set ctx.pc)
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
        const addr = (ctx.acc + ((ctx.dph << 8) | ctx.dpl)) & 0xFFFF;
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
        ctx.acc = readDirect(ctx, addr);
        updateP(ctx);
    }},

    // ── MOVX @DPTR, A ──
    0xF0: { mnemonic: 'MOVX @DPTR,A', len: 1, cycles: 2, handler: (ctx) => {
        const addr = (ctx.dph << 8) | ctx.dpl;
        writeDirect(ctx, addr, ctx.acc);
    }},

    // ── MOVX A, @Ri ──
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
        ctx.ram[ctx.sp] = readDirect(ctx, addr);
    }},

    // ── POP direct ──
    0xD0: { mnemonic: 'POP direct', len: 2, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const val = ctx.ram[ctx.sp];
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
            const quot = Math.floor(ctx.acc / ctx.b);
            const rem = ctx.acc % ctx.b;
            ctx.acc = quot;
            ctx.b = rem;
        }
        setCY(ctx, 0);
        updateP(ctx);
    }},

    // ── DA A ──
    0xD4: { mnemonic: 'DA A', len: 1, cycles: 1, handler: (ctx) => {
        let a = ctx.acc;
        let inc = 0;
        if ((a & 0x0F) > 9 || AC(ctx)) inc += 0x06;
        if (((a >> 4) & 0x0F) > 9 || CY(ctx)) inc += 0x60;
        if (((a >> 4) & 0x0F) > 9 || CY(ctx)) setCY(ctx, 1);
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
        setBit(ctx, bit, readBitLatch(ctx, bit) ? 0 : 1);
    }},

    // ── ANL C, bit ──
    0x82: { mnemonic: 'ANL C,bit', len: 2, cycles: 2, handler: (ctx) => {
        setCY(ctx, CY(ctx) & readBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]));
    }},

    // ── ORL C, bit ──
    0x72: { mnemonic: 'ORL C,bit', len: 2, cycles: 2, handler: (ctx) => {
        setCY(ctx, CY(ctx) | readBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]));
    }},

    // ── ANL C, /bit ──
    0xB0: { mnemonic: 'ANL C,/bit', len: 2, cycles: 2, handler: (ctx) => {
        setCY(ctx, CY(ctx) & (readBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]) ? 0 : 1));
    }},

    // ── ORL C, /bit ──
    0xA0: { mnemonic: 'ORL C,/bit', len: 2, cycles: 2, handler: (ctx) => {
        setCY(ctx, CY(ctx) | (readBit(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]) ? 0 : 1));
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
    0x02: { mnemonic: 'LJMP addr16', len: 0, cycles: 2, handler: (ctx) => {
        const addr = (ctx.rom[(ctx.pc + 1) & 0xFFFF] << 8) | ctx.rom[(ctx.pc + 2) & 0xFFFF];
        ctx.pc = addr;
    }},

    // ── AJMP addr11 ──
    0x01: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },
    0x21: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },
    0x41: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },
    0x61: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },
    0x81: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },
    0xA1: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },
    0xC1: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },
    0xE1: { mnemonic: 'AJMP', len: 0, cycles: 2, handler: _ajmp },

    // ── SJMP rel ──
    0x80: { mnemonic: 'SJMP rel', len: 0, cycles: 2, handler: (ctx) => {
        const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
    }},

    // ── JMP @A+DPTR ──
    0x73: { mnemonic: 'JMP @A+DPTR', len: 0, cycles: 2, handler: (ctx) => {
        ctx.pc = (ctx.acc + (ctx.dph << 8 | ctx.dpl)) & 0xFFFF;
    }},

    // ── JZ rel ──
    0x60: { mnemonic: 'JZ rel', len: 0, cycles: 2, handler: _jz },

    // ── JNZ rel ──
    0x70: { mnemonic: 'JNZ rel', len: 0, cycles: 2, handler: _jnz },

    // ── JC rel ──
    0x40: { mnemonic: 'JC rel', len: 0, cycles: 2, handler: _jc },

    // ── JNC rel ──
    0x50: { mnemonic: 'JNC rel', len: 0, cycles: 2, handler: _jnc },

    // ── JB bit, rel ──
    0x20: { mnemonic: 'JB bit,rel', len: 0, cycles: 2, handler: (ctx) => {
        const bit = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        if (readBit(ctx, bit)) {
            ctx.pc = (ctx.pc + 3 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        } else {
            ctx.pc = (ctx.pc + 3) & 0xFFFF;
        }
    }},

    // ── JNB bit, rel ──
    0x30: { mnemonic: 'JNB bit,rel', len: 0, cycles: 2, handler: (ctx) => {
        const bit = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        if (!readBit(ctx, bit)) {
            ctx.pc = (ctx.pc + 3 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        } else {
            ctx.pc = (ctx.pc + 3) & 0xFFFF;
        }
    }},

    // ── CJNE A, #data, rel ──
    0xB4: { mnemonic: 'CJNE A,#data,rel', len: 0, cycles: 2, handler: (ctx) => {
        const data = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        setCY(ctx, ctx.acc < data ? 1 : 0);
        if (ctx.acc !== data) {
            ctx.pc = (ctx.pc + 3 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
        } else {
            ctx.pc = (ctx.pc + 3) & 0xFFFF;
        }
    }},

    // ── DJNZ Rn, rel ──
    0xD8: { mnemonic: 'DJNZ R0,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 0); } },
    0xD9: { mnemonic: 'DJNZ R1,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 1); } },
    0xDA: { mnemonic: 'DJNZ R2,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 2); } },
    0xDB: { mnemonic: 'DJNZ R3,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 3); } },
    0xDC: { mnemonic: 'DJNZ R4,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 4); } },
    0xDD: { mnemonic: 'DJNZ R5,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 5); } },
    0xDE: { mnemonic: 'DJNZ R6,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 6); } },
    0xDF: { mnemonic: 'DJNZ R7,rel', len: 0, cycles: 2, handler: (ctx) => { _djnz(ctx, 7); } },

    // ── LCALL addr16 ──
    0x12: { mnemonic: 'LCALL addr16', len: 0, cycles: 2, handler: (ctx) => {
        _lcall(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], ctx.rom[(ctx.pc + 2) & 0xFFFF]);
    }},

    // ── ACALL addr11 ──
    0x11: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },
    0x31: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },
    0x51: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },
    0x71: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },
    0x91: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },
    0xB1: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },
    0xD1: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },
    0xF1: { mnemonic: 'ACALL', len: 0, cycles: 2, handler: _acall },

    // ── RET ──
    0x22: { mnemonic: 'RET', len: 0, cycles: 2, handler: (ctx) => {
        ctx.pc = _popWord(ctx);
    }},

    // ── RETI ──
    0x32: { mnemonic: 'RETI', len: 0, cycles: 2, handler: (ctx) => {
        ctx.pc = _popWord(ctx);
        ctx.inInterrupt = false;
        ctx.interruptPriority = -1;
    }},

    // ═══════════════════════════════════════════════════════════
    // 补充操作码（原表未收录；供 C 编译器代码生成使用）
    // ═══════════════════════════════════════════════════════════
    // ── MOV direct,#data ──
    0x75: { mnemonic: 'MOV direct,#data', len: 3, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const data = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        writeDirect(ctx, addr, data);
    }},

    // ── MOV direct,direct ──
    0x85: { mnemonic: 'MOV direct,direct', len: 3, cycles: 2, handler: (ctx) => {
        const src = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const dst = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        writeDirect(ctx, dst, readDirect(ctx, src));
    }},

    // ── MOV direct,@Ri ──
    0x86: { mnemonic: 'MOV direct,@R0', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], ctx.ram[ctx.ram[0]]); } },
    0x87: { mnemonic: 'MOV direct,@R1', len: 2, cycles: 2, handler: (ctx) => { writeDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF], ctx.ram[ctx.ram[1]]); } },

    // ── MOV @Ri,direct ──
    0xA6: { mnemonic: 'MOV @R0,direct', len: 2, cycles: 2, handler: (ctx) => { ctx.ram[ctx.ram[0]] = readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },
    0xA7: { mnemonic: 'MOV @R1,direct', len: 2, cycles: 2, handler: (ctx) => { ctx.ram[ctx.ram[1]] = readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },

    // ── ADDC A,direct ──
    0x35: { mnemonic: 'ADDC A,direct', len: 2, cycles: 2, handler: (ctx) => { _addc(ctx, readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF])); } },

    // ── ADDC A,#data ──
    0x34: { mnemonic: 'ADDC A,#data', len: 2, cycles: 1, handler: (ctx) => { _addc(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]); } },

    // ── ORL A,direct ──
    0x45: { mnemonic: 'ORL A,direct', len: 2, cycles: 2, handler: (ctx) => { ctx.acc |= readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]); updateP(ctx); } },

    // ── ANL A,direct ──
    0x55: { mnemonic: 'ANL A,direct', len: 2, cycles: 2, handler: (ctx) => { ctx.acc &= readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]); updateP(ctx); } },

    // ── XRL A,direct ──
    0x65: { mnemonic: 'XRL A,direct', len: 2, cycles: 2, handler: (ctx) => { ctx.acc ^= readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]); updateP(ctx); } },

    // ── SUBB A,direct ──
    0x95: { mnemonic: 'SUBB A,direct', len: 2, cycles: 2, handler: (ctx) => { _subb(ctx, readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF])); } },

    // ── DEC direct ──
    0x15: { mnemonic: 'DEC direct', len: 2, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        writeDirect(ctx, addr, (readDirect(ctx, addr) - 1) & 0xFF);
    }},

    // ── CJNE A,direct,rel ──
    0xB5: { mnemonic: 'CJNE A,direct,rel', len: 0, cycles: 2, handler: (ctx) => {
        const data = readDirect(ctx, ctx.rom[(ctx.pc + 1) & 0xFFFF]);
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        setCY(ctx, ctx.acc < data ? 1 : 0);
        const off = (rel > 127 ? rel - 256 : rel);
        ctx.pc = (ctx.acc !== data) ? ((ctx.pc + 3 + off) & 0xFFFF) : ((ctx.pc + 3) & 0xFFFF);
    }},

    // ── DJNZ direct,rel ──
    0xD5: { mnemonic: 'DJNZ direct,rel', len: 0, cycles: 2, handler: (ctx) => {
        const addr = ctx.rom[(ctx.pc + 1) & 0xFFFF];
        const rel = ctx.rom[(ctx.pc + 2) & 0xFFFF];
        const val = (readDirect(ctx, addr) - 1) & 0xFF;
        writeDirect(ctx, addr, val);
        const off = (rel > 127 ? rel - 256 : rel);
        ctx.pc = (val !== 0) ? ((ctx.pc + 3 + off) & 0xFFFF) : ((ctx.pc + 3) & 0xFFFF);
    }},

    // ── MATH（仿真数学协处理器，非标准 8051 指令；供 C 编译器的 long/float 与 * / % 使用）──
    //   格式：A5 func a1 a2 dst   （a1/a2/dst 为内部 RAM 地址）
    0xA5: { mnemonic: 'MATH', len: 5, cycles: 4, handler: (ctx) => { mathUnit(ctx); } },
};

// ── 算术辅助函数 ──

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

// ── 跳转辅助函数 ──

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
    } else {
        ctx.pc = (ctx.pc + 2) & 0xFFFF;
    }
}

// Conditional jump helpers (len=0 instructions, handler sets pc for both taken and not-taken)
function _jz(ctx) {
    const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
    if (ctx.acc === 0) {
        ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
    } else {
        ctx.pc = (ctx.pc + 2) & 0xFFFF;
    }
}
function _jnz(ctx) {
    const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
    if (ctx.acc !== 0) {
        ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
    } else {
        ctx.pc = (ctx.pc + 2) & 0xFFFF;
    }
}
function _jc(ctx) {
    const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
    if (CY(ctx)) {
        ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
    } else {
        ctx.pc = (ctx.pc + 2) & 0xFFFF;
    }
}
function _jnc(ctx) {
    const rel = ctx.rom[(ctx.pc + 1) & 0xFFFF];
    if (!CY(ctx)) {
        ctx.pc = (ctx.pc + 2 + (rel > 127 ? rel - 256 : rel)) & 0xFFFF;
    } else {
        ctx.pc = (ctx.pc + 2) & 0xFFFF;
    }
}

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

            // 调试暂停：不自动执行，仅同步端口与显示（单步由 step() 驱动）
            if (ctx.debug && ctx.debug.paused) {
                this._syncPorts(mcu, ctx);
                this._syncDisplay(mcu, ctx);
                return;
            }

            const freq = mcu.xtalFreq || this.defaultFreq;
            const cyclesPerSecond = freq / 12; // 12 时钟/机器周期
            const cyclesAvail = Math.floor(cyclesPerSecond * deltaTime);
            let cyclesUsed = 0;

            while (cyclesUsed < cyclesAvail && !ctx.halted) {
                // 断点命中（在本条指令执行前停下）
                if (ctx.debug && ctx.debug.breakpoints.size && ctx.debug.breakpoints.has(ctx.pc)) {
                    ctx.debug.paused = true;
                    ctx.debug.hit = true;
                    break;
                }
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
                this._checkInterrupts(mcu, ctx);
            }

            // 帧结束同步
            this._updateTimers(mcu, ctx, cyclesUsed);
            this._syncUART(mcu, ctx);
            this._syncPorts(mcu, ctx);
            this._syncDisplay(mcu, ctx);
        });
    }

    _initContext(mcu) {
        const self = this;
        const ctx = {
            // 存储
            rom: new Uint8Array(0x10000),  // 64KB 程序 ROM
            ram: new Uint8Array(0x100),    // 256B 内部 RAM / idata（8052）
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

            // 调试状态（供上位机单步/断点/源行映射/变量监视使用）
            debug: {
                paused: false,          // 暂停自动执行
                breakpoints: new Set(), // 断点地址集合
                hit: false,             // 上次是否因断点而停
                lineMap: null,          // addr → C 行号
                lineAddrs: null,        // C 行号 → [addr]
                symbols: null,          // 变量符号表 [{name,addr,size,type,scope}]
                // 外部输入覆盖（按键/矩阵键盘）：pinInput = (回读 & ~mask) | (val & mask)
                forcedInput: { mask: { p0: 0, p1: 0, p2: 0, p3: 0 }, val: { p0: 0, p1: 0, p2: 0, p3: 0 } },
                inputProvider: null,    // (portName, sfrVal) => byte|null，实时输入（矩阵键盘）
                portLog: [],            // 端口写日志（P0/P2），供 LCD 等时序外设仿真
            },
        };

        // 绑定 SFR 读写钩子（供 readDirect/writeDirect 使用）
        ctx._readSFR = (addr) => self._readSFR(ctx, addr);
        ctx._writeSFR = (addr, val) => self._writeSFR(ctx, addr, val);

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
            if (ctx._prevT === undefined) ctx._prevT = 1;
            if (ctx._prevT === 1 && pinVal === 0) {
                count = (count - 1) & 0xFFFF;
            }
            ctx._prevT = pinVal;
        } else {
            // 定时器模式：每个机器周期计数一次
            count = (count - cycles) & 0xFFFF;
        }

        // 检测溢出：timer.count 递减前保存旧值，看是否跨过 0
        const oldCount = timer.count;
        let newCount = count;
        let overflow = false;
        switch (mode & 0x03) {
            case 0: // 模式 0: 13 位计数器
                // 13 位范围 0x0000-0x1FFF，溢出是从 0x0000 到 0x1FFF（向下计数）
                overflow = (oldCount & 0x1FFF) > 0 && (newCount & 0x1FFF) === 0;
                if (overflow) {
                    // 13 位 wrap: reload 高位 + 低位
                    newCount = ((timer.reload << 5) & 0xFF00) | (timer.reload & 0x1F);
                }
                break;
            case 1: // 模式 1: 16 位计数器，wrap from 0 to 0xFFFF
                overflow = oldCount > 0 && newCount === 0;
                break;
            case 2: // 模式 2: 8 位自动重装
                overflow = (oldCount & 0xFF) > 0 && (newCount & 0xFF) === 0;
                if (overflow) {
                    newCount = (timer.reload << 8) | timer.reload;
                }
                break;
        }
        timer.count = newCount;

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

        // 检测外部中断引脚边沿
        const int0Pin = ctx.pinInput.int0;
        if (ctx._prevINT0 === 1 && int0Pin === 0) {
            // IE0 下降沿 (IT0=1) 或低电平 (IT0=0)
            if ((ctx.sfr[0x08] & 1)) { // IT0 = TCON.0
                ctx.sfr[0x08] |= 1; // 设置 IE0 标志
            }
        }
        ctx._prevINT0 = int0Pin;

        const int1Pin = ctx.pinInput.int1;
        if (ctx._prevINT1 === 1 && int1Pin === 0) {
            if ((ctx.sfr[0x08] & 4)) { // IT1 = TCON.2
                ctx.sfr[0x08] |= 4; // 设置 IE1 标志
            }
        }
        ctx._prevINT1 = int1Pin;

        // 检查各中断标志
        const tcon = ctx.sfr[0x08]; // TCON
        const flagIE0 = (tcon >> 0) & 1;
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

        let best = -1;
        let bestPri = -1;

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
            // 清除自动清除的中断标志
            if (best === 1) { ctx.tf0 = 0; ctx.sfr[0x08] &= ~0x20; } // 清 TF0
            if (best === 3) { ctx.tf1 = 0; ctx.sfr[0x08] &= ~0x80; } // 清 TF1
            if (best === 0) { ctx.sfr[0x08] &= ~0x01; } // 清 IE0
            if (best === 2) { ctx.sfr[0x08] &= ~0x04; } // 清 IE1
            // LCALL 到中断向量
            _pushWord(ctx, ctx.pc);
            ctx.pc = vec;
        }
    }

    // ── GPIO 端口同步 ──
    _syncPorts(mcu, ctx) {
        const portNames = ['p0', 'p1', 'p2', 'p3'];
        const sfrOffsets = [0x00, 0x10, 0x20, 0x30];

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
                if (extVal) inputVal |= (1 << bit);
            }

            // 更新引脚输入缓存（回读 + 外部输入覆盖）
            const fi = ctx.debug && ctx.debug.forcedInput;
            const m = (fi && fi.mask) ? (fi.mask[name] | 0) : 0;
            const vv = (fi && fi.val) ? (fi.val[name] | 0) : 0;
            ctx.pinInput[name] = ((inputVal & ~m) | (vv & m)) & 0xFF;
        });

        // 特殊引脚 P3 的复用功能
        ctx.pinInput.int0 = (ctx.pinInput.p3 >> 2) & 1;
        ctx.pinInput.int1 = (ctx.pinInput.p3 >> 3) & 1;
        ctx.pinInput.t0 = (ctx.pinInput.p3 >> 4) & 1;
        ctx.pinInput.t1 = (ctx.pinInput.p3 >> 5) & 1;
        ctx.pinInput.rxd = (ctx.pinInput.p3 >> 1) & 1;
    }

    // ── UART 同步 ──
    _syncUART(mcu, ctx) {
        const scon = ctx.sfr[0x18]; // SCON at SFR address 0x98, idx = 0x18
        const sm0 = (scon >> 7) & 1;
        const sm1 = (scon >> 6) & 1;
        const ren = (scon >> 4) & 1;

        // 模式 1（SM0=0, SM1=1）：8 位 UART 可变波特率
        if (sm0 === 0 && sm1 === 1) {
            // 发送
            if (ctx.uart.sending) {
                const txdLine = `${mcu.id}_txd`;
                signalBridge.writeSignal(txdLine, 1, 'strong');
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
                    // 实际应由外部电路驱动
                    if (ctx._rxData !== undefined) {
                        ctx.uart.rxByte = ctx._rxData;
                        ctx.ri = 1;
                    }
                }
                ctx._prevRXD = rxdVal;
            }
        }
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
        const old = this._contexts.get(mcuId);
        const ctx = this._initContext(mcu);
        // 保留 ROM 数据
        if (mcu._romData) ctx.rom.set(mcu._romData);
        // 保留调试元数据（源行映射/符号表/断点）
        if (old && old.debug) {
            ctx.debug.lineMap = old.debug.lineMap;
            ctx.debug.lineAddrs = old.debug.lineAddrs;
            ctx.debug.symbols = old.debug.symbols;
            old.debug.breakpoints.forEach(a => ctx.debug.breakpoints.add(a));
        }
        this._contexts.set(mcuId, ctx);
    }

    /**
     * 重新加载固件
     */
    reloadFirmware(mcuId) {
        this.resetMCU(mcuId);
    }

    // ═══════════════════════════════════════════════════════════
    // 调试 API（供上位机 KeilUI 使用）
    // ═══════════════════════════════════════════════════════════

    pause(mcuId) { const ctx = this._contexts.get(mcuId); if (ctx && ctx.debug) ctx.debug.paused = true; }
    resume(mcuId) { const ctx = this._contexts.get(mcuId); if (ctx && ctx.debug) { ctx.debug.paused = false; ctx.debug.hit = false; } }
    isPaused(mcuId) { const ctx = this._contexts.get(mcuId); return !!(ctx && ctx.debug && ctx.debug.paused); }

    setBreakpoints(mcuId, addrs) {
        const ctx = this._contexts.get(mcuId); if (!ctx || !ctx.debug) return;
        ctx.debug.breakpoints = new Set((addrs || []).map(a => a & 0xFFFF));
    }
    toggleBreakpoint(mcuId, addr) {
        const ctx = this._contexts.get(mcuId); if (!ctx || !ctx.debug) return false;
        addr &= 0xFFFF;
        if (ctx.debug.breakpoints.has(addr)) ctx.debug.breakpoints.delete(addr);
        else ctx.debug.breakpoints.add(addr);
        return ctx.debug.breakpoints.has(addr);
    }
    clearBreakpoints(mcuId) { const ctx = this._contexts.get(mcuId); if (ctx && ctx.debug) ctx.debug.breakpoints.clear(); }

    /** 单步执行 n 条指令（不受帧周期预算限制），执行后同步端口与显示，返回最新调试状态 */
    step(mcuId, n = 1) {
        const mcu = this.sys.comps[mcuId];
        const ctx = this._contexts.get(mcuId);
        if (!mcu || !ctx) return null;
        if (ctx.debug) ctx.debug.paused = true;
        for (let i = 0; i < n; i++) {
            if (ctx.halted) break;
            const opcode = ctx.rom[ctx.pc];
            const instr = OPCODES[opcode];
            if (!instr) { ctx.pc = (ctx.pc + 1) & 0xFFFF; continue; }
            ctx._instrPC = ctx.pc;
            try { instr.handler(ctx); } catch (e) { /* 容错 */ }
            ctx.pc = (ctx.pc + instr.len) & 0xFFFF;
            if (this._checkRST(mcu, ctx)) break;
            this._checkInterrupts(mcu, ctx);
        }
        this._updateTimers(mcu, ctx, 0);
        this._syncUART(mcu, ctx);
        this._syncPorts(mcu, ctx);
        this._syncDisplay(mcu, ctx);
        return this.getDebugState(mcuId);
    }

    getDebugState(mcuId) {
        const ctx = this._contexts.get(mcuId);
        if (!ctx) return null;
        const dbg = ctx.debug || {};
        return {
            id: mcuId,
            pc: ctx.pc, acc: ctx.acc, b: ctx.b, psw: ctx.psw, sp: ctx.sp,
            dph: ctx.dph, dpl: ctx.dpl,
            sfr: ctx.sfr, ram: ctx.ram, rom: ctx.rom,
            paused: !!dbg.paused, hit: !!dbg.hit, halted: !!ctx.halted,
            ti: !!ctx.ti, ri: !!ctx.ri, tf0: !!ctx.tf0, tf1: !!ctx.tf1,
            breakpoints: dbg.breakpoints ? Array.from(dbg.breakpoints) : [],
            lineMap: dbg.lineMap || null,
            symbols: dbg.symbols || null,
            currentLine: (dbg.lineMap && dbg.lineMap.get) ? (dbg.lineMap.has(ctx.pc) ? dbg.lineMap.get(ctx.pc) : null) : null,
        };
    }

    setRegister(mcuId, key, val) {
        const ctx = this._contexts.get(mcuId); if (!ctx) return;
        val = val & 0xFF;
        switch (key) {
            case 'acc': ctx.acc = val; ctx.sfr[0x60] = val; break;   // ACC = 0xE0
            case 'b':   ctx.b   = val; ctx.sfr[0x70] = val; break;   // B   = 0xF0
            case 'psw': ctx.psw = val; ctx.sfr[0x50] = val; break;   // PSW = 0xD0
            case 'sp':  ctx.sp  = val; ctx.sfr[0x01] = val; break;   // SP  = 0x81
            case 'dpl': ctx.dpl = val; ctx.sfr[0x02] = val; break;   // DPL = 0x82
            case 'dph': ctx.dph = val; ctx.sfr[0x03] = val; break;   // DPH = 0x83
            case 'pc':  ctx.pc  = val; break;
        }
    }

    setMemory(mcuId, addr, val) {
        const ctx = this._contexts.get(mcuId); if (!ctx) return;
        addr &= 0xFFFF; val &= 0xFF;
        if (addr < 0x80) ctx.ram[addr] = val;
        else this._writeSFR(ctx, addr, val);
    }

    /**
     * 设置外部强制输入（按键等）——使 MCU 能"读到"外部电平。
     * 由于本引擎端口每帧先写后读，普通信号线写会被自身输出覆盖，
     * 故这里单独维护 forcedInput，在 _syncPorts 中并入 pinInput。
     * @param {'p0'|'p1'|'p2'|'p3'} port
     * @param {number} bit 0..7
     * @param {number} val 1=高（按键未按/IDLE），0=低（按下）
     */
    setInputPin(mcuId, port, bit, val) {
        const ctx = this._contexts.get(mcuId); if (!ctx || !ctx.debug) return;
        const fi = ctx.debug.forcedInput;
        if (!fi.mask || !fi.val) { fi.mask = { p0: 0, p1: 0, p2: 0, p3: 0 }; fi.val = { p0: 0, p1: 0, p2: 0, p3: 0 }; }
        const mask = 1 << (bit & 7);
        fi.mask[port] = (fi.mask[port] | mask) & 0xFF;
        if (val) fi.val[port] = (fi.val[port] | mask) & 0xFF;
        else fi.val[port] = fi.val[port] & (~mask & 0xFF);
        // 同时驱动信号线，供画布外设/指示灯显示
        signalBridge.writeSignal(`${mcuId}_${port}_${bit & 7}`, val ? 1 : 0, 'strong');
    }

    /**
     * 注册实时端口输入提供者（矩阵键盘等）：程序每次读端口时实时计算返回字节。
     * @param {string} mcuId
     * @param {(port:'p0'|'p1'|'p2'|'p3', sfrVal:number)=>number|null} fn
     */
    setPortInputProvider(mcuId, fn) {
        const ctx = this._contexts.get(mcuId);
        if (!ctx || !ctx.debug) return false;
        ctx.debug.inputProvider = fn || null;
        return true;
    }

    /** 取出并清空端口写日志（P0/P2），供 LCD 等帧内时序外设处理 */
    drainPortLog(mcuId) {
        const ctx = this._contexts.get(mcuId);
        if (!ctx || !ctx.debug || !ctx.debug.portLog || !ctx.debug.portLog.length) return [];
        const log = ctx.debug.portLog;
        ctx.debug.portLog = [];
        return log;
    }

    /**
     * 下载程序（机器码）到指定 MCU 的 ROM，并建立调试信息
     * @param {string} mcuId
     * @param {Uint8Array|number[]} bytes 机器码
     * @param {{lineMap?:Map,lineAddrs?:Map,symbols?:Array}|null} debug
     * @param {{pause?:boolean}} opts  pause=true 时下载后停在复位向量（默认 false，下载即运行）
     */
    downloadProgram(mcuId, bytes, debug = null, opts = {}) {
        const mcu = this.sys.comps[mcuId];
        let ctx = this._contexts.get(mcuId);
        if (!ctx) {
            if (!mcu) return { ok: false, error: 'MCU not found' };
            ctx = this._initContext(mcu);
            this._contexts.set(mcuId, ctx);
        }
        let arr;
        if (bytes && bytes.length !== undefined) arr = Uint8Array.from(bytes);
        else arr = new Uint8Array(0);
        const rom = new Uint8Array(0x10000).fill(0xFF);
        rom.set(arr.subarray(0, Math.min(arr.length, 0x10000)), 0);
        ctx.rom = rom;
        ctx.romLoaded = true;
        // CPU 复位
        ctx.pc = 0; ctx.halted = false;
        ctx.acc = 0; ctx.b = 0; ctx.psw = 0; ctx.sp = 0x07; ctx.dpl = 0; ctx.dph = 0;
        ctx.inInterrupt = false; ctx.interruptPriority = -1;
        ctx.tf0 = 0; ctx.tf1 = 0; ctx.ti = 0; ctx.ri = 0;
        ctx.sfr.fill(0);
        ctx.sfr[0x00] = 0xFF; ctx.sfr[0x10] = 0xFF; ctx.sfr[0x20] = 0xFF; ctx.sfr[0x30] = 0xFF;
        if (!ctx.debug) ctx.debug = { paused: false, breakpoints: new Set(), hit: false, lineMap: null, lineAddrs: null, symbols: null, forcedInput: { mask: { p0: 0, p1: 0, p2: 0, p3: 0 }, val: { p0: 0, p1: 0, p2: 0, p3: 0 } }, inputProvider: null, portLog: [] };
        ctx.debug.hit = false;
        ctx.debug.paused = !!opts.pause;
        ctx.debug.portLog = [];
        if (debug) {
            ctx.debug.lineMap = debug.lineMap || null;
            ctx.debug.lineAddrs = debug.lineAddrs || null;
            ctx.debug.symbols = debug.symbols || null;
        }
        if (mcu) mcu._romData = rom;
        this._syncPorts(mcu, ctx);
        this._syncDisplay(mcu, ctx);
        return { ok: true, size: arr.length, entry: 0 };
    }

    /** 反汇编：从 start 起反汇编 count 条指令 */
    disassemble(mcuId, start, count = 20) {
        const ctx = this._contexts.get(mcuId);
        if (!ctx) return [];
        const out = [];
        let addr = start & 0xFFFF;
        for (let i = 0; i < count; i++) {
            const d = this._disasmAt(ctx, addr);
            out.push(d);
            addr = (addr + d.len) & 0xFFFF;
        }
        return out;
    }

    _disasmAt(ctx, addr) {
        const opcode = ctx.rom[addr];
        const instr = OPCODES[opcode];
        const b1 = ctx.rom[(addr + 1) & 0xFFFF];
        const b2 = ctx.rom[(addr + 2) & 0xFFFF];
        const rel = (b) => (b > 127 ? b - 256 : b);
        const H2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');
        const H4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');
        if (!instr) {
            return { addr, len: 1, bytes: [opcode], text: `DB 0x${H2(opcode)}` };
        }
        const len = instrLen(opcode, instr);
        const m = instr.mnemonic;
        let text = m;
        if (len === 1) {
            text = m;
        } else if (opcode === 0xA5) {                                   // MATH 协处理器
            const b3 = ctx.rom[(addr + 3) & 0xFFFF], b4 = ctx.rom[(addr + 4) & 0xFFFF];
            const FN = { 0x01: 'UMUL16', 0x02: 'UDIV16', 0x03: 'UMOD16', 0x04: 'SMUL16', 0x05: 'SDIV16', 0x06: 'SMOD16', 0x07: 'UMUL32', 0x08: 'UDIV32', 0x09: 'UMOD32', 0x0A: 'SMUL32', 0x0B: 'SDIV32', 0x0C: 'SMOD32', 0x10: 'FADD', 0x11: 'FSUB', 0x12: 'FMUL', 0x13: 'FDIV', 0x14: 'FCMP', 0x15: 'I16TOF', 0x16: 'FTOI16', 0x17: 'I32TOF', 0x18: 'FTOI32', 0x1A: 'UCMP32', 0x1B: 'SCMP32' };
            text = `MATH ${FN[b1] || ('0x' + H2(b1))} 0x${H2(b2)},0x${H2(b3)}→0x${H2(b4)}`;
        } else if (opcode === 0x02 || opcode === 0x12) {                 // LJMP / LCALL
            text = `${m.split(' ')[0]} 0x${H2(b1)}${H2(b2)}`;
        } else if ((opcode & 0x1F) === 0x01 || (opcode & 0x1F) === 0x11) { // AJMP / ACALL
            const page = (opcode >> 5) & 7;
            const tgt = (addr & 0xF800) | (page << 8) | b1;
            text = `${m} 0x${H4(tgt)}`;
        } else if (opcode === 0x90) {                                   // MOV DPTR,#data16
            text = `MOV DPTR,#0x${H2(b1)}${H2(b2)}`;
        } else if (opcode === 0x75) {                                   // MOV direct,#data
            text = `MOV 0x${H2(b1)},#0x${H2(b2)}`;
        } else if (opcode === 0x85) {                                   // MOV direct,direct
            text = `MOV 0x${H2(b2)},0x${H2(b1)}`;
        } else if (opcode === 0x80 || opcode === 0x60 || opcode === 0x70 || opcode === 0x40 || opcode === 0x50) {
            text = `${m.split(' ')[0]} 0x${H4((addr + 2 + rel(b1)) & 0xFFFF)}`;
        } else if (opcode === 0x20 || opcode === 0x30) {                // JB / JNB
            text = `${m.split(' ')[0]} ${this._bitName(b1)},0x${H4((addr + 3 + rel(b2)) & 0xFFFF)}`;
        } else if (opcode === 0xB4 || opcode === 0xB5) {                // CJNE
            const first = (opcode === 0xB4) ? `#0x${H2(b1)}` : `0x${H2(b1)}`;
            text = `CJNE A,${first},0x${H4((addr + 3 + rel(b2)) & 0xFFFF)}`;
        } else if (opcode === 0xD5) {                                   // DJNZ direct,rel
            text = `DJNZ 0x${H2(b1)},0x${H4((addr + 3 + rel(b2)) & 0xFFFF)}`;
        } else if (opcode >= 0xD8 && opcode <= 0xDF) {                  // DJNZ Rn,rel
            text = `DJNZ R${opcode - 0xD8},0x${H4((addr + 2 + rel(b1)) & 0xFFFF)}`;
        } else if (m.includes('#data')) {                               // 立即数
            text = `${m.replace('#data', '').trim()} #0x${H2(b1)}`;
        } else if (m.includes('direct,direct')) {
            text = `MOV 0x${H2(b2)},0x${H2(b1)}`;
        } else if (m.includes('bit')) {                                 // 位地址
            text = `${m} ${this._bitName(b1)}`;
        } else if (m.includes('direct')) {                              // 直接地址
            text = `${m} 0x${H2(b1)}`;
        } else {
            text = `${m} 0x${H2(b1)}`;
        }
        const bytes = [];
        for (let k = 0; k < len; k++) bytes.push(ctx.rom[(addr + k) & 0xFFFF]);
        return { addr, len, bytes, text };
    }

    _bitName(bit) {
        const H2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');
        if (bit < 0x80) return `0x${H2(bit)}`;      // 位区 RAM：0x20+n 的某位
        const tables = {
            0x80: ['P0.0','P0.1','P0.2','P0.3','P0.4','P0.5','P0.6','P0.7'],
            0x88: ['IT0','IE0','IT1','IE1','TR0','TF0','TR1','TF1'],
            0x90: ['P1.0','P1.1','P1.2','P1.3','P1.4','P1.5','P1.6','P1.7'],
            0x98: ['RI','TI','RB8','TB8','REN','SM2','SM1','SM0'],
            0xA0: ['P2.0','P2.1','P2.2','P2.3','P2.4','P2.5','P2.6','P2.7'],
            0xA8: ['EX0','ET0','EX1','ET1','ES','—','—','EA'],
            0xB0: ['P3.0','P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7'],
            0xB8: ['PX0','PT0','PX1','PT1','PS','—','—','—'],
            0xD0: ['P','OV','RS0','RS1','F0','AC','F1','CY'],
            0xE0: ['ACC.0','ACC.1','ACC.2','ACC.3','ACC.4','ACC.5','ACC.6','ACC.7'],
            0xF0: ['B.0','B.1','B.2','B.3','B.4','B.5','B.6','B.7'],
        };
        const base = 0x80 + Math.floor((bit - 0x80) / 8) * 8;
        const off = (bit - 0x80) % 8;
        if (tables[base]) return tables[base][off];
        return `0x${H2(bit)}`;
    }

    /**
     * 读取 SFR（按 8051 地址）
     */
    _readSFR(ctx, addr) {
        const idx = addr - 0x80;
        if (idx < 0 || idx >= 0x80) return 0;

        // 端口：优先使用实时输入提供者（矩阵键盘等）
        const PORT_NAMES = { 0x80: 'p0', 0x90: 'p1', 0xA0: 'p2', 0xB0: 'p3' };
        if (PORT_NAMES[addr] && ctx.debug && typeof ctx.debug.inputProvider === 'function') {
            const v = ctx.debug.inputProvider(PORT_NAMES[addr], ctx.sfr[idx] || 0);
            if (v !== null && v !== undefined) return v & 0xFF;
        }

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

        // 端口写日志（供 LCD 等"帧内脉冲时序"外设仿真：P0 数据、P2 控制）
        if (ctx.debug && (addr === 0x80 || addr === 0xA0)) {
            if (!ctx.debug.portLog) ctx.debug.portLog = [];
            ctx.debug.portLog.push({ a: addr, v: val & 0xFF });
            if (ctx.debug.portLog.length > 4096) ctx.debug.portLog.splice(0, 2048);
        }

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
                break;
            }
            case 0x89: // TMOD
                ctx.timer0.mode = val & 0x0F;
                ctx.timer1.mode = (val >> 4) & 0x0F;
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
            case 0x98: // SCON — SFR latch already written by default above
                break;
            case 0x99: // SBUF — 写触发发送
                ctx.uart.sbuf = val & 0xFF;
                ctx.uart.sending = true;
                break;
            case 0xA8: // IE — SFR latch already written by default
                break;
            case 0xB8: // IP — SFR latch already written
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

// ═══════════════════════════════════════════════════════════
// 反汇编辅助：指令字节长度（len=0 的跳转类需按操作码判定）
// ═══════════════════════════════════════════════════════════
function instrLen(opcode, instr) {
    if (instr && instr.len && instr.len > 0) return instr.len;
    if (opcode === 0xD5) return 3;                              // DJNZ direct,rel
    if (opcode >= 0xD8 && opcode <= 0xDF) return 2;             // DJNZ Rn,rel
    if (opcode === 0xB4 || opcode === 0xB5) return 3;           // CJNE
    if (opcode === 0x20 || opcode === 0x30) return 3;           // JB / JNB
    if (opcode === 0x02 || opcode === 0x12) return 3;           // LJMP / LCALL
    if ((opcode & 0x1F) === 0x01) return 2;                     // AJMP
    if ((opcode & 0x1F) === 0x11) return 2;                     // ACALL
    if (opcode === 0x80 || opcode === 0x60 || opcode === 0x70 || opcode === 0x40 || opcode === 0x50) return 2;
    return 1;                                                   // SJMP/JZ/.../RET/RETI/JMP @A+DPTR
}

// ═══════════════════════════════════════════════════════════
// 仿真数学协处理器（MATH 指令 0xA5）
//   指令格式：A5 func a1 a2 dst（a1/a2/dst 为内部 RAM 地址，小端）
//   整数 16/32 位乘除取余、IEEE-754 单精度浮点四则/比较/转换、32 位比较
// ═══════════════════════════════════════════════════════════
function _s16(v) { v &= 0xFFFF; return v >= 0x8000 ? v - 0x10000 : v; }
function _s32(v) { v >>>= 0; return v >= 0x80000000 ? v - 0x100000000 : v; }

function mathUnit(ctx) {
    const base = ctx._instrPC;
    const rom = ctx.rom;
    const func = rom[(base + 1) & 0xFFFF];
    const a1 = rom[(base + 2) & 0xFFFF];
    const a2 = rom[(base + 3) & 0xFFFF];
    const dst = rom[(base + 4) & 0xFFFF];
    const ram = ctx.ram;
    const rd = (a, n) => { let v = 0 >>> 0; for (let i = 0; i < n; i++) v |= (ram[(a + i) & 0xFF] & 0xFF) << (8 * i); return v >>> 0; };
    const wr = (a, v, n) => { v = v >>> 0; for (let i = 0; i < n; i++) ram[(a + i) & 0xFF] = (v >>> (8 * i)) & 0xFF; };
    const dv = new DataView(new ArrayBuffer(4));
    const rf = (a) => { dv.setUint32(0, rd(a, 4), true); return dv.getFloat32(0, true); };
    const wf = (a, f) => { dv.setFloat32(0, f, true); wr(a, dv.getUint32(0, true), 4); };
    const div = (x, y) => (y === 0 ? 0 : x / y);

    switch (func) {
        // ── 16 位整型 ──
        case 0x01: wr(dst, (rd(a1, 2) * rd(a2, 2)) & 0xFFFF, 2); break;                 // UMUL16
        case 0x02: wr(dst, Math.floor(div(rd(a1, 2), rd(a2, 2))) & 0xFFFF, 2); break;    // UDIV16
        case 0x03: { const d = rd(a2, 2); wr(dst, d ? rd(a1, 2) % d : rd(a1, 2), 2); break; } // UMOD16
        case 0x04: wr(dst, (rd(a1, 2) * rd(a2, 2)) & 0xFFFF, 2); break;                 // SMUL16（低 16 位相同）
        case 0x05: wr(dst, Math.trunc(div(_s16(rd(a1, 2)), _s16(rd(a2, 2)))) & 0xFFFF, 2); break; // SDIV16
        case 0x06: { const s2 = _s16(rd(a2, 2)); wr(dst, (s2 ? (_s16(rd(a1, 2)) % s2) : _s16(rd(a1, 2))) & 0xFFFF, 2); break; } // SMOD16
        // ── 32 位整型 ──
        case 0x07: wr(dst, Number((BigInt(rd(a1, 4)) * BigInt(rd(a2, 4))) & 0xFFFFFFFFn), 4); break; // UMUL32
        case 0x08: { const d = rd(a2, 4); wr(dst, d ? Math.floor(rd(a1, 4) / d) : 0xFFFFFFFF, 4); break; } // UDIV32
        case 0x09: { const d = rd(a2, 4); wr(dst, d ? (rd(a1, 4) % d) : rd(a1, 4), 4); break; } // UMOD32
        case 0x0A: wr(dst, Number((BigInt(rd(a1, 4)) * BigInt(rd(a2, 4))) & 0xFFFFFFFFn), 4); break; // SMUL32（低 32 位相同）
        case 0x0B: { const s2 = _s32(rd(a2, 4)); wr(dst, Math.trunc(div(_s32(rd(a1, 4)), s2)) >>> 0, 4); break; } // SDIV32
        case 0x0C: { const s2 = _s32(rd(a2, 4)); wr(dst, (s2 ? (_s32(rd(a1, 4)) % s2) : _s32(rd(a1, 4))) >>> 0, 4); break; } // SMOD32
        // ── 浮点（IEEE-754 单精度）──
        case 0x10: wf(dst, rf(a1) + rf(a2)); break;                                       // FADD
        case 0x11: wf(dst, rf(a1) - rf(a2)); break;                                       // FSUB
        case 0x12: wf(dst, rf(a1) * rf(a2)); break;                                       // FMUL
        case 0x13: wf(dst, rf(a1) / rf(a2)); break;                                       // FDIV
        case 0x14: { const x = rf(a1), y = rf(a2); wr(dst, x < y ? 0 : (x > y ? 2 : 1), 1); break; } // FCMP → 0/1/2
        case 0x15: wf(dst, _s16(rd(a1, 2))); break;                                       // I16TOF
        case 0x16: wr(dst, Math.trunc(rf(a1)) & 0xFFFF, 2); break;                        // FTOI16
        case 0x17: wf(dst, _s32(rd(a1, 4))); break;                                       // I32TOF
        case 0x18: wr(dst, Math.trunc(rf(a1)) >>> 0, 4); break;                           // FTOI32
        // ── 32 位比较 → 0/1/2 ──
        case 0x1A: { const x = rd(a1, 4), y = rd(a2, 4); wr(dst, x < y ? 0 : (x > y ? 2 : 1), 1); break; } // UCMP32
        case 0x1B: { const x = _s32(rd(a1, 4)), y = _s32(rd(a2, 4)); wr(dst, x < y ? 0 : (x > y ? 2 : 1), 1); break; } // SCMP32
        default: break;
    }
}
