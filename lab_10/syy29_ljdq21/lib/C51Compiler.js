/**
 * C51Compiler.js — 教学用 8051 C 子集编译器（浏览器内运行）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  支持：
 *   · 预处理：#include（忽略）、#define 数值宏、注释
 *   · sbit LED = P1^0;  sfr NAME = 0x90;   内置 reg51 SFR/位符号
 *   · 类型：void / bit / char / unsigned char / int / unsigned int /
 *           long / unsigned long / float / 指针 T* / 结构体 struct / 数组 T[N]
 *   · 语句：声明、赋值与复合赋值、if/else、while、for、do-while、
 *           break / continue / return、复合语句、函数调用
 *   · 运算：+ - * / %  & | ^ ~ << >>  比较  && || !  ++ --  ?:  括号、类型转换、sizeof
 *   · 指针：& 取地址、* 解引用、p[i] 下标、指针加减（数据 RAM 内）
 *   · 结构体：. 与 -> 成员访问、结构体赋值（逐字节拷贝）
 *   · 函数：非递归；参数/局部变量编译期分配到固定 RAM 地址（便于监视）
 *   · 中断：void name() interrupt N  → 自动生成向量 LJMP 与 ACC/PSW/B/DPTR 保护
 *   · 内建：_nop_()
 *
 *  运算实现：8/16/32 位 + - & | ^ 与 8 位常数移位为原生 8051 指令；
 *            16/32 位 * / %、浮点四则/比较/转换、32 位比较 由仿真数学协处理器
 *            （MCS51Solver 的 0xA5 MATH 指令）完成。
 *
 *  不支持（编译报错）：递归、标准库函数、函数指针、16 位及以上移位、
 *                      结构体按值传参/返回、联合体、位域
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SFR = {
    P0: 0x80, SP: 0x81, DPL: 0x82, DPH: 0x83, PCON: 0x87,
    TCON: 0x88, TMOD: 0x89, TL0: 0x8A, TL1: 0x8B, TH0: 0x8C, TH1: 0x8D,
    P1: 0x90, SCON: 0x98, SBUF: 0x99, P2: 0xA0, IE: 0xA8, P3: 0xB0, IP: 0xB8,
    PSW: 0xD0, ACC: 0xE0, B: 0xF0,
};
const SFR_BIT = {
    IT0: 0x88, IE0: 0x89, IT1: 0x8A, IE1: 0x8B, TR0: 0x8C, TF0: 0x8D, TR1: 0x8E, TF1: 0x8F,
    RI: 0x98, TI: 0x99, RB8: 0x9A, TB8: 0x9B, REN: 0x9C, SM2: 0x9D, SM1: 0x9E, SM0: 0x9F,
    EX0: 0xA8, ET0: 0xA9, EX1: 0xAA, ET1: 0xAB, ES: 0xAC, EA: 0xAF,
    PX0: 0xB8, PT0: 0xB9, PX1: 0xBA, PT1: 0xBB, PS: 0xBC,
    RXD: 0xB0, TXD: 0xB1, INT0: 0xB2, INT1: 0xB3, T0: 0xB4, T1: 0xB5, WR: 0xB6, RD: 0xB7,
    P: 0xD0, OV: 0xD2, RS0: 0xD3, RS1: 0xD4, F0: 0xD5, AC: 0xD6, CY: 0xD7,
};
for (let p = 0; p < 4; p++) for (let b = 0; b < 8; b++) SFR_BIT[`P${p}.${b}`] = (0x80 + p * 0x10) + b;

const TYPE_KEYWORDS = new Set(['void', 'char', 'int', 'unsigned', 'signed', 'bit', 'sbit', 'sfr', 'short', 'long', 'float', 'double', 'const', 'static', 'volatile', 'data', 'idata', 'xdata', 'code', 'struct', 'union', 'enum', 'typedef', 'extern']);

// 临时单元（0x30–0x3F）；用户变量从 0x40 起
const T0 = 0x30, T1 = 0x34, T2 = 0x38, T3 = 0x3C;   // 各 4 字节
const ZERO4 = T2;
const VAR_BASE = 0x40, MEM_LIMIT = 0x100;

const FT = { k: 'float', size: 4, float: 1 };
const TT = {
    void: { k: 'void', size: 0 },
    bit: { k: 'bit', size: 1, signed: 0 },
    char: { k: 'char', size: 1, signed: 1 },
    uchar: { k: 'uchar', size: 1, signed: 0 },
    int: { k: 'int', size: 2, signed: 1 },
    uint: { k: 'uint', size: 2, signed: 0 },
    long: { k: 'long', size: 4, signed: 1 },
    ulong: { k: 'ulong', size: 4, signed: 0 },
};
const tPtr = (e) => ({ k: 'ptr', size: 1, elem: e });
const tArr = (e, n) => ({ k: 'array', size: sizeOf(e) * n, elem: e, len: n });
const tStruct = (def) => ({ k: 'struct', size: def.size, def });
function sizeOf(t) { return t ? t.size : 0; }
function isFloat(t) { return !!t && t.k === 'float'; }
function isPtr(t) { return !!t && t.k === 'ptr'; }
function isAgg(t) { return !!t && (t.k === 'struct' || t.k === 'array'); }
function intInfo(t) {
    if (!t) return null;
    if (t.k === 'float' || t.k === 'struct' || t.k === 'array' || t.k === 'void') return null;
    if (t.k === 'ptr') return { size: 1, signed: 0 };
    if (t.k === 'bit') return { size: 1, signed: 0 };
    return { size: t.size, signed: t.signed ? 1 : 0 };
}
function intType(size, signed) {
    if (size <= 1) return signed ? TT.char : TT.uchar;
    if (size === 2) return signed ? TT.int : TT.uint;
    return signed ? TT.long : TT.ulong;
}
function scalarSize(t) { return Math.min(4, Math.max(1, sizeOf(t))); }
function floatBytes(f) { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, f, true); return [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)]; }
function hex(v) { return '0x' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }

// ═══════════════════════════════════════════════════════════
// 预处理 & 词法
// ═══════════════════════════════════════════════════════════
function stripComments(src) {
    let out = '', i = 0, inStr = false;
    while (i < src.length) {
        const c = src[i], c2 = src[i + 1];
        if (inStr) { out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (c === "'") inStr = false; i++; continue; }
        if (c === "'") { inStr = true; out += c; i++; continue; }
        if (c === '/' && c2 === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
        if (c === '/' && c2 === '*') { out += '  '; i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; } out += '  '; i += 2; continue; }
        out += c; i++;
    }
    return out;
}
function preprocess(src) {
    let text = stripComments(String(src || ''));
    const defines = new Map();
    text = text.split(/\r?\n/).map(line => {
        const t = line.trim();
        if (t.startsWith('#')) {
            const m = t.match(/^#\s*define\s+([A-Za-z_]\w*)\s+(.+)$/);
            if (m) defines.set(m[1], m[2].trim());
            return '';
        }
        return line;
    }).join('\n');
    for (const [k, v] of defines) {
        if (/^\d+$/.test(v) || /^0x[0-9a-fA-F]+$/.test(v) || /^'\\?.'$/.test(v) || /^\d+\.\d*f?$/.test(v)) {
            text = text.replace(new RegExp('\\b' + k + '\\b', 'g'), v);
        }
    }
    return text;
}
function tokenize(text) {
    const toks = [];
    let i = 0, line = 1, col = 1;
    const push = (t, v) => toks.push({ t, v, line, col });
    while (i < text.length) {
        const c = text[i];
        if (c === '\n') { line++; col = 1; i++; continue; }
        if (c === ' ' || c === '\t' || c === '\r') { col++; i++; continue; }
        if (/[A-Za-z_]/.test(c)) { let s = ''; while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) { s += text[i++]; col++; } push('id', s); continue; }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] || ''))) {
            let s = '';
            while (i < text.length && /[0-9a-fA-FxX.]/.test(text[i])) { s += text[i++]; col++; }
            if (/[fFlLuU]/.test(text[i] || '')) { s += text[i++]; col++; }
            push('num', s); continue;
        }
        if (c === "'") { let s = "'"; i++; col++; while (i < text.length && text[i] !== "'") { s += text[i++]; col++; } s += "'"; i++; col++; push('num', s); continue; }
        const two = text.substr(i, 2);
        const O2 = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '->'];
        const O1 = '+-*/%&|^~!<>=(){}[];,:?.#';
        if (O2.includes(two)) { push('punc', two); i += 2; col += 2; continue; }
        if (O1.includes(c)) { push('punc', c); i++; col++; continue; }
        throw new CompileError(line, `无法识别的字符 '${c}'`);
    }
    toks.push({ t: 'eof', v: '', line, col });
    return toks;
}
class CompileError extends Error {
    constructor(line, msg, col = 1) { super(msg); this.line = line; this.col = col; this.isCompile = true; }
}
function parseNumberLiteral(s) {
    if (s.startsWith("'")) {
        const inner = s.slice(1, -1);
        if (inner.startsWith('\\')) { const m = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, "'": 39 }; return m[inner[1]] !== undefined ? m[inner[1]] : 0; }
        return inner.charCodeAt(0) & 0xFF;
    }
    const v = s.replace(/[fFlLuU]+$/, '');
    if (/^0x/i.test(v)) return parseInt(v.slice(2), 16) >>> 0;
    return parseFloat(v);
}
function isFloatLiteral(s) { return /\./.test(s) || /[fF]$/.test(s); }

// ═══════════════════════════════════════════════════════════
// 语法分析
// ═══════════════════════════════════════════════════════════
class Parser {
    constructor(toks) { this.toks = toks; this.p = 0; this.structs = new Map(); }
    peek(k = 0) { return this.toks[this.p + k] || this.toks[this.toks.length - 1]; }
    next() { return this.toks[this.p++]; }
    at(v) { const t = this.peek(); return t.t === 'punc' && t.v === v; }
    atId(v) { const t = this.peek(); return t.t === 'id' && t.v === v; }
    eat(v) { if (this.at(v)) { this.next(); return true; } return false; }
    expect(v) { if (!this.eat(v)) throw new CompileError(this.peek().line, `期望 '${v}'，实际为 '${this.peek().v}'`); }
    expectId() { const t = this.peek(); if (t.t !== 'id') throw new CompileError(t.line, `期望标识符，实际为 '${t.v}'`); this.next(); return t.v; }

    _primType() {
        const parts = [];
        while (this.peek().t === 'id' && TYPE_KEYWORDS.has(this.peek().v)) {
            const w = this.peek().v.toLowerCase();
            if (w === 'struct') break;
            parts.push(w); this.next();
        }
        if (!parts.length) return null;
        for (const p of parts) if (p === 'union' || p === 'enum' || p === 'typedef' || p === 'extern') throw new CompileError(this.peek().line, `不支持 '${p}'`);
        const has = s => parts.includes(s);
        if (has('bit')) return TT.bit;
        if (has('void')) return TT.void;
        if (has('float') || has('double')) return FT;
        if (has('char')) return has('unsigned') ? TT.uchar : TT.char;
        if (has('long')) return has('unsigned') ? TT.ulong : TT.long;
        if (has('int')) return has('unsigned') ? TT.uint : TT.int;
        return has('unsigned') ? TT.uint : TT.int;
    }
    parseTypeName() {
        if (this.atId('struct')) {
            this.next();
            const name = this.expectId();
            let def = this.structs.get(name);
            if (this.at('{')) def = this.parseStructDef(name);
            else if (!def) throw new CompileError(this.peek().line, `未定义的结构体 'struct ${name}'`);
            let t = tStruct(def);
            while (this.at('*')) { this.next(); t = tPtr(t); }
            return t;
        }
        const base = this._primType();
        if (!base) return null;
        let t = base;
        while (this.at('*')) { this.next(); t = tPtr(t); }
        return t;
    }
    parseStructDef(name) {
        this.expect('{');
        const members = [];
        let off = 0;
        while (!this.at('}')) {
            const t = this.parseTypeName();
            if (!t) throw new CompileError(this.peek().line, '结构体成员类型无效');
            const mn = this.expectId();
            let mt = t;
            if (this.at('[')) { this.next(); const n = this.parseConstInt(); this.expect(']'); mt = tArr(mt, n); }
            members.push({ name: mn, type: mt, offset: off });
            off += sizeOf(mt);
            this.expect(';');
        }
        this.expect('}');
        const def = { name, members, size: off, align: 1 };
        this.structs.set(name, def);
        return def;
    }
    parseConstInt() {
        const t = this.peek();
        if (t.t !== 'num') throw new CompileError(t.line, '需要常量');
        this.next();
        return parseNumberLiteral(t.v) | 0;
    }

    parseProgram() {
        const globals = [], funcs = [], sbites = [], sfrs = [], structs = [];
        while (this.peek().t !== 'eof') {
            if (this.atId('sbit')) {
                this.next(); const name = this.expectId(); this.expect('=');
                const port = this.expectId(); this.expect('^');
                const bitNo = this.peek().t === 'num' ? parseNumberLiteral(this.next().v) : null;
                let bitAddr;
                if (SFR[port] !== undefined && bitNo !== null) bitAddr = SFR[port] + (bitNo & 7);
                else if (SFR_BIT[port] !== undefined) bitAddr = SFR_BIT[port];
                else throw new CompileError(this.peek().line, 'sbit 仅支持端口位（如 P1^0）或已知位名');
                this.expect(';'); sbites.push({ name, bit: bitAddr }); continue;
            }
            if (this.atId('sfr')) {
                this.next(); const name = this.expectId(); this.expect('='); const addr = parseNumberLiteral(this.next().v);
                this.expect(';'); sfrs.push({ name, addr }); continue;
            }
            const line = this.peek().line;
            const t = this.parseTypeName();
            if (!t) throw new CompileError(line, `此处应为类型说明符，实际为 '${this.peek().v}'`);
            if (this.at(';')) { this.next(); if (t.k === 'struct') structs.push(t.def); continue; }
            if (t.k === 'void') { const name = this.expectId(); funcs.push(this.parseFunctionRest(t, name, line)); continue; }
            const name = this.expectId();
            if (this.at('(')) { funcs.push(this.parseFunctionRest(t, name, line)); continue; }
            let vn = name, vt = t;
            while (true) {
                let dt = vt, init = null;
                if (this.at('[')) { this.next(); const n = this.parseConstInt(); this.expect(']'); dt = tArr(dt, n); }
                if (this.eat('=')) init = this.parseAssign();
                globals.push({ type: dt, name: vn, init, line });
                if (!this.eat(',')) break;
                vn = this.expectId();
            }
            this.expect(';');
        }
        return { globals, funcs, sbites, sfrs, structs };
    }

    parseFunctionRest(retType, name, line) {
        this.expect('(');
        const params = [];
        if (!this.at(')')) {
            if (this.atId('void') && this.peek(1).v === ')') this.next();
            else while (true) {
                const pt = this.parseTypeName();
                if (!pt || pt.k === 'void') throw new CompileError(this.peek().line, '函数参数类型无效');
                const pn = this.expectId();
                let ptype = pt;
                if (this.at('[')) { this.next(); if (this.peek().t === 'num') this.parseConstInt(); this.expect(']'); ptype = tPtr(pt); }
                params.push({ type: ptype, name: pn });
                if (!this.eat(',')) break;
            }
        }
        this.expect(')');
        let isInterrupt = false, vector = 0;
        if (this.atId('interrupt')) { this.next(); isInterrupt = true; vector = parseNumberLiteral(this.next().v) | 0; }
        if (this.atId('using')) this.next();
        const body = this.parseCompound();
        return { kind: 'func', retType, name, params, isInterrupt, vector, body, line };
    }
    parseCompound() {
        const line = this.peek().line;
        this.expect('{');
        const stmts = [];
        while (!this.at('}')) { if (this.peek().t === 'eof') throw new CompileError(this.peek().line, "缺少 '}'"); stmts.push(this.parseStmt()); }
        this.expect('}');
        return { kind: 'block', stmts, line };
    }
    isDeclStart() {
        const t = this.peek();
        if (t.t !== 'id') return false;
        const kw = t.v.toLowerCase();
        if (kw === 'struct') return true;
        return ['char', 'int', 'unsigned', 'signed', 'bit', 'short', 'long', 'float', 'double', 'const', 'static', 'volatile', 'data', 'idata', 'xdata', 'code'].includes(kw);
    }
    parseDeclStatement(line) {
        const type = this.parseTypeName();
        const decls = [];
        let n = this.expectId();
        while (true) {
            let dt = type, init = null;
            if (this.at('[')) { this.next(); const sz = this.parseConstInt(); this.expect(']'); dt = tArr(dt, sz); }
            if (this.eat('=')) init = this.parseAssign();
            decls.push({ name: n, type: dt, init });
            if (!this.eat(',')) break;
            n = this.expectId();
        }
        this.expect(';');
        return { kind: 'decl', decls, line };
    }
    parseStmt() {
        const line = this.peek().line;
        if (this.at('{')) return this.parseCompound();
        if (this.at(';')) { this.next(); return { kind: 'empty', line }; }
        if (this.atId('if')) { this.next(); this.expect('('); const cond = this.parseExpr(); this.expect(')'); const then = this.parseStmt(); let els = null; if (this.atId('else')) { this.next(); els = this.parseStmt(); } return { kind: 'if', cond, then, else: els, line }; }
        if (this.atId('while')) { this.next(); this.expect('('); const cond = this.parseExpr(); this.expect(')'); const body = this.parseStmt(); return { kind: 'while', cond, body, line }; }
        if (this.atId('for')) {
            this.next(); this.expect('(');
            let init = null;
            if (!this.at(';')) init = this.isDeclStart() ? this.parseDeclStatement(line) : { kind: 'expr', expr: this.parseExpr(), line };
            this.expect(';');
            let cond = null; if (!this.at(';')) cond = this.parseExpr();
            this.expect(';');
            let step = null; if (!this.at(')')) step = this.parseExpr();
            this.expect(')');
            const body = this.parseStmt();
            return { kind: 'for', init, cond, step, body, line };
        }
        if (this.atId('do')) { this.next(); const body = this.parseStmt(); this.next(); this.expect('('); const cond = this.parseExpr(); this.expect(')'); this.expect(';'); return { kind: 'dowhile', body, cond, line }; }
        if (this.atId('break')) { this.next(); this.expect(';'); return { kind: 'break', line }; }
        if (this.atId('continue')) { this.next(); this.expect(';'); return { kind: 'continue', line }; }
        if (this.atId('return')) { this.next(); let val = null; if (!this.at(';')) val = this.parseExpr(); this.expect(';'); return { kind: 'return', val, line }; }
        if (this.isDeclStart()) return this.parseDeclStatement(line);
        const e = this.parseExpr();
        this.expect(';');
        return { kind: 'expr', expr: e, line };
    }
    parseExpr() { return this.parseAssign(); }
    parseAssign() {
        const left = this.parseCond();
        const t = this.peek();
        if (t.t === 'punc' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^='].includes(t.v)) {
            this.next();
            const right = this.parseAssign();
            return { kind: 'assign', op: t.v, target: left, value: right, line: t.line };
        }
        return left;
    }
    parseCond() {
        const c = this.parseLogOr();
        if (this.at('?')) { const line = this.next().line; const a = this.parseExpr(); this.expect(':'); const b = this.parseCond(); return { kind: 'cond', c, a, b, line }; }
        return c;
    }
    parseLogOr() { return this.binL(() => this.parseLogAnd(), ['||']); }
    parseLogAnd() { return this.binL(() => this.parseBitOr(), ['&&']); }
    parseBitOr() { return this.binL(() => this.parseBitXor(), ['|']); }
    parseBitXor() { return this.binL(() => this.parseBitAnd(), ['^']); }
    parseBitAnd() { return this.binL(() => this.parseEquality(), ['&']); }
    parseEquality() { return this.binL(() => this.parseRelational(), ['==', '!=']); }
    parseRelational() { return this.binL(() => this.parseShift(), ['<', '>', '<=', '>=']); }
    parseShift() { return this.binL(() => this.parseAdditive(), ['<<', '>>']); }
    parseAdditive() { return this.binL(() => this.parseMul(), ['+', '-']); }
    parseMul() { return this.binL(() => this.parseUnary(), ['*', '/', '%']); }
    binL(nextFn, ops) {
        let left = nextFn();
        while (this.peek().t === 'punc' && ops.includes(this.peek().v)) {
            const op = this.next().v;
            const right = nextFn();
            left = { kind: 'binary', op, left, right, line: this.peek().line };
        }
        return left;
    }
    parseUnary() {
        const t = this.peek();
        if (t.t === 'punc' && ['-', '+', '~', '!', '++', '--', '&', '*'].includes(t.v)) {
            this.next();
            const operand = this.parseUnary();
            return { kind: 'unary', op: t.v, operand, line: t.line };
        }
        if (t.t === 'id' && t.v === 'sizeof') {
            this.next();
            if (this.at('(')) {
                const save = this.p;
                this.next();
                const ty = this.parseTypeName();
                if (ty && this.at(')')) { this.next(); return { kind: 'num', value: sizeOf(ty), line: t.line }; }
                this.p = save;
            }
            const e = this.parseUnary();
            return { kind: 'num', value: 0, line: t.line, _sizeofExpr: e };
        }
        return this.parsePostfix();
    }
    parsePostfix() {
        let e = this.parsePrimary();
        while (true) {
            if (this.at('(')) {
                this.next(); const args = [];
                if (!this.at(')')) while (true) { args.push(this.parseAssign()); if (!this.eat(',')) break; }
                this.expect(')');
                e = { kind: 'call', callee: e, args, line: e.line };
            } else if (this.at('[')) {
                this.next(); const idx = this.parseExpr(); this.expect(']');
                e = { kind: 'index', base: e, index: idx, line: e.line };
            } else if (this.at('.')) {
                this.next(); const member = this.expectId();
                e = { kind: 'member', base: e, member, arrow: false, line: e.line };
            } else if (this.at('->')) {
                this.next(); const member = this.expectId();
                e = { kind: 'member', base: e, member, arrow: true, line: e.line };
            } else if (this.at('++') || this.at('--')) {
                const op = this.next().v;
                e = { kind: 'postfix', op, operand: e, line: e.line };
            } else break;
        }
        return e;
    }
    parsePrimary() {
        const t = this.peek();
        if (t.t === 'num') { this.next(); return { kind: 'num', value: parseNumberLiteral(t.v), isFloat: isFloatLiteral(t.v), raw: t.v, line: t.line }; }
        if (t.t === 'id') { this.next(); return { kind: 'id', name: t.v, line: t.line }; }
        if (t.t === 'punc' && t.v === '(') {
            const save = this.p;
            this.next();
            const ty = this.parseTypeName();
            if (ty && this.at(')')) { this.next(); const operand = this.parseUnary(); return { kind: 'cast', type: ty, operand, line: t.line }; }
            this.p = save;
            this.next();
            const e = this.parseExpr();
            this.expect(')');
            return e;
        }
        throw new CompileError(t.line, `表达式语法错误：'${t.v}'`);
    }
}

// ═══════════════════════════════════════════════════════════
// 代码生成
// ═══════════════════════════════════════════════════════════
class Emitter {
    constructor() {
        this.rom = new Uint8Array(0x10000).fill(0xFF);
        this.org = 0; this.listing = [];
        this.lineMap = new Map(); this.lineAddrs = new Map();
        this.curLine = 0; this.labels = new Map(); this.fixups = [];
    }
    setLine(l) { this.curLine = l; }
    emit(bytes, asm) {
        const addr = this.org;
        for (let i = 0; i < bytes.length; i++) this.rom[this.org++] = bytes[i] & 0xFF;
        this.listing.push({ addr, bytes: bytes.slice(), text: asm, line: this.curLine });
        this.lineMap.set(addr, this.curLine);
        if (!this.lineAddrs.has(this.curLine)) this.lineAddrs.set(this.curLine, [addr]);
        return addr;
    }
    label(name) { this.labels.set(name, this.org); }
    ljmp(name) { const at = this.emit([0x02, 0, 0], `LJMP ${name}`); this.fixups.push({ at: at + 1, label: name }); }
    lcall(name) { const at = this.emit([0x12, 0, 0], `LCALL ${name}`); this.fixups.push({ at: at + 1, label: name }); }
    condJump(cond, label) {
        const INV = { JZ: 0x70, JNZ: 0x60, JC: 0x50, JNC: 0x40 };
        this.emit([INV[cond], 0x03], `${cond} → ${label}`);
        this.ljmp(label);
    }
    resolve() {
        for (const f of this.fixups) {
            const a = this.labels.get(f.label);
            if (a === undefined) throw new Error('未定义标签：' + f.label);
            this.rom[f.at] = (a >> 8) & 0xFF; this.rom[f.at + 1] = a & 0xFF;
        }
    }
}

class Gen {
    constructor(program, emit) {
        this.program = program; this.E = emit;
        this.errors = []; this.warnings = []; this.symbols = [];
        this.globals = new Map(); this.scopes = []; this.funcs = new Map();
        this.sbites = new Map(); this.sfrs = new Map(); this.structs = new Map();
        this.nextVar = VAR_BASE; this.nextBit = 0;
        this.loopStack = []; this.curFunc = null; this.epilogue = null;
        this._lblN = 0; this.initStmts = [];
    }
    err(line, msg) { this.errors.push({ line, col: 1, msg }); }
    warn(line, msg) { this.warnings.push({ line, col: 1, msg }); }
    lbl(p) { return `${p}_${this._lblN++}`; }

    // ── 符号 ──
    alloc(name, type, line, scope) {
        if (type.k === 'bit') {
            if (this.nextBit >= 0x80) { this.err(line, '位变量过多'); return null; }
            const sym = { name, type, addr: this.nextBit++, scope, isBit: true };
            this.symbols.push({ name, type: 'bit', addr: sym.addr, size: 0, scope, isBit: true });
            this.declare(name, sym); return sym;
        }
        const sz = sizeOf(type);
        if (this.nextVar + sz > MEM_LIMIT) { this.err(line, `数据 RAM 不足（需要 ${sz} 字节）`); return null; }
        const sym = { name, type, addr: this.nextVar, scope };
        this.nextVar += sz;
        this.symbols.push({ name, type: typeName(type), addr: sym.addr, size: sz, scope });
        this.declare(name, sym); return sym;
    }
    declare(name, sym) { if (this.scopes.length) this.scopes[this.scopes.length - 1].set(name, sym); else this.globals.set(name, sym); }
    lookup(name) {
        for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i].get(name);
        if (this.globals.has(name)) return this.globals.get(name);
        if (this.sbites.has(name)) return { name, type: TT.bit, isBit: true, bitAddr: this.sbites.get(name), isSbit: true };
        if (this.sfrs.has(name)) return { name, type: TT.uchar, addr: this.sfrs.get(name), isSfr: true };
        if (SFR[name] !== undefined) return { name, type: TT.uchar, addr: SFR[name], isSfr: true };
        if (SFR_BIT[name] !== undefined) return { name, type: TT.bit, isBit: true, bitAddr: SFR_BIT[name], isSbit: true };
        return null;
    }

    // ── 低层 ──
    movA(addr) { this.E.emit([0xE5, addr & 0xFF], `MOV A,${hex(addr)}`); }
    movAdr(fromAddr, toAddr) { this.movA(fromAddr); this.E.emit([0xF5, toAddr & 0xFF], `MOV ${hex(toAddr)},A`); }
    movImm(addr, imm) { this.E.emit([0x74, imm & 0xFF], `MOV A,#${hex(imm)}`); this.E.emit([0xF5, addr & 0xFF], `MOV ${hex(addr)},A`); }
    clrA() { this.E.emit([0xE4], 'CLR A'); }
    loadBlock(dstSlot, addr, n) { for (let i = 0; i < n; i++) this.movAdr((addr + i) & 0xFF, (dstSlot + i) & 0xFF); }
    storeBlock(srcSlot, addr, n) { for (let i = 0; i < n; i++) this.movAdr((srcSlot + i) & 0xFF, (addr + i) & 0xFF); }
    copyT0toT1() { for (let i = 0; i < 4; i++) this.movAdr((T0 + i) & 0xFF, (T1 + i) & 0xFF); }
    copyT0toT2() { for (let i = 0; i < 4; i++) this.movAdr((T0 + i) & 0xFF, (T2 + i) & 0xFF); }
    copyT2toT0() { for (let i = 0; i < 4; i++) this.movAdr((T2 + i) & 0xFF, (T0 + i) & 0xFF); }
    /** 用 8051 硬件栈暂存若干字节（保证嵌套表达式安全） */
    pushBytes(addr, n) { for (let i = 0; i < n; i++) this.E.emit([0xC0, (addr + i) & 0xFF], `PUSH ${hex(addr + i)}`); }
    popBytes(addr, n) { for (let i = n - 1; i >= 0; i--) this.E.emit([0xD0, (addr + i) & 0xFF], `POP ${hex(addr + i)}`); }
    pushT0() { this.pushBytes(T0, 4); }
    popT1() { this.popBytes(T1, 4); }
    /** 间接读：地址在 addrSlot 的低字节 */
    loadIndirect(dstSlot, addrSlot, n) {
        this.movA(addrSlot);
        this.E.emit([0xF8], 'MOV R0,A');
        for (let i = 0; i < n; i++) {
            this.E.emit([0xE6], 'MOV A,@R0');
            this.E.emit([0xF5, (dstSlot + i) & 0xFF], `MOV d${i},A`);
            if (i < n - 1) this.E.emit([0x08], 'INC R0');
        }
    }
    storeIndirect(srcSlot, addrSlot, n) {
        this.movA(addrSlot);
        this.E.emit([0xF8], 'MOV R0,A');
        for (let i = 0; i < n; i++) {
            this.E.emit([0xE5, (srcSlot + i) & 0xFF], 'MOV A,s');
            this.E.emit([0xF6], 'MOV @R0,A');
            if (i < n - 1) this.E.emit([0x08], 'INC R0');
        }
    }
    math(func, a1, a2, dst, name) { this.E.emit([0xA5, func, a1 & 0xFF, a2 & 0xFF, dst & 0xFF], `MATH ${name}`); }
    zeroFrom(n) { for (let i = n; i < 4; i++) this.movImm(T0 + i, 0); }

    // ── 左值 ──
    lvalueOf(t) {
        if (t.kind === 'id') {
            const s = this.lookup(t.name);
            if (!s) { this.err(t.line, `未声明的标识符 '${t.name}'`); return { invalid: true }; }
            if (s.isBit || s.isSbit) return { bit: true, bitAddr: s.bitAddr, sym: s };
            if (s.isSfr) return { indirect: false, addr: s.addr, sym: s };   // SFR 必须直接寻址
            return { indirect: s.addr >= 0x80, addr: s.addr, sym: s };
        }
        return { indirect: true };
    }
    /** 地址求值 → T3（2 字节），返回指向类型 */
    genAddr(node) {
        switch (node.kind) {
            case 'id': {
                const s = this.lookup(node.name);
                if (!s) { this.err(node.line, `未声明的标识符 '${node.name}'`); return TT.char; }
                if (s.isBit || s.isSbit) { this.err(node.line, '不能对位取地址'); return TT.char; }
                this.movImm(T3, s.addr & 0xFF); this.movImm(T3 + 1, (s.addr >> 8) & 0xFF);
                return s.type;
            }
            case 'unary':
                if (node.op === '*') {
                    const t = this.genExpr(node.operand);
                    if (!isPtr(t)) { this.err(node.line, '解引用需要指针'); return TT.char; }
                    this.movAdr(T0, T3); this.movImm(T3 + 1, 0);
                    return t.elem;
                }
                break;
            case 'index': {
                const bt = this.typeOf(node.base);
                let et;
                if (isPtr(bt)) {
                    this.genExpr(node.base);                 // 指针基址 → 取指针值
                    this.movAdr(T0, T3); this.movImm(T3 + 1, 0);
                    et = bt.elem;
                } else {
                    const at = this.genAddr(node.base);       // 数组基址 → 取地址
                    et = isAgg(at) ? at.elem : TT.char;
                }
                const it = this.typeOf(node.index);
                this.genExpr(node.index);
                this.coerce(it, TT.uint);
                const sz = Math.max(1, sizeOf(et));
                if (sz !== 1) { this.copyT0toT1(); this.movImm(T0, sz); this.movImm(T0 + 1, 0); this.math(0x01, T1, T0, T0, 'UMUL16'); }
                this.addT0toT3();
                return et;
            }
            case 'member': {
                let bt;
                if (node.arrow) {
                    const pt = this.genExpr(node.base);
                    if (!isPtr(pt)) { this.err(node.line, '-> 左侧必须是指针'); return TT.char; }
                    this.movAdr(T0, T3); this.movImm(T3 + 1, 0);
                    bt = pt.elem;
                } else bt = this.genAddr(node.base);
                if (!bt || bt.k !== 'struct') { this.err(node.line, "'.' 左侧必须是结构体"); return TT.char; }
                const m = bt.def.members.find(x => x.name === node.member);
                if (!m) { this.err(node.line, `结构体 ${bt.def.name} 没有成员 '${node.member}'`); return TT.char; }
                this.addImmutT3(m.offset);
                return m.type;
            }
            case 'cond': break;
        }
        this.err(node.line, '无法取地址的表达式');
        this.movImm(T3, 0); this.movImm(T3 + 1, 0);
        return TT.char;
    }
    addImmutT3(k) {
        if (!k) return;
        this.movA(T3); this.E.emit([0x24, k & 0xFF], `ADD A,#${k}`); this.E.emit([0xF5, T3], 'MOV T3L,A');
        this.movA(T3 + 1); this.E.emit([0x34, 0x00], 'ADDC A,#0'); this.E.emit([0xF5, T3 + 1], 'MOV T3H,A');
    }
    addT0toT3() {
        this.movA(T3); this.E.emit([0x25, T0], 'ADD A,T0L'); this.E.emit([0xF5, T3], 'MOV T3L,A');
        this.movA(T3 + 1); this.E.emit([0x35, T0 + 1], 'ADDC A,T0H'); this.E.emit([0xF5, T3 + 1], 'MOV T3H,A');
    }
    loadViaT3(type) {
        if (type.k === 'bit') { this.err(0, '内部错误：位不可间接'); return; }
        const n = scalarSize(type);
        this.loadIndirect(T0, T3, n);
        this.zeroFrom(n);
    }
    storeViaT3(type) { this.storeIndirect(T0, T3, scalarSize(type)); }

    // ── 数值转换（就地 T0）──
    coerce(from, to) {
        if (!from || !to || from === to) return;
        if (to.k === 'bit') {
            if (isFloat(from)) this.math(0x16, T0, ZERO4, T0, 'FTOI16');
            this.movA(T0); this.E.emit([0x54, 0x01], 'ANL A,#1'); this.E.emit([0xF5, T0], 'MOV T0L,A');
            this.zeroFrom(1);
            return;
        }
        if (from.k === 'bit') { this.movA(T0); this.E.emit([0x54, 0x01], 'ANL A,#1'); this.E.emit([0xF5, T0], 'MOV T0L,A'); this.zeroFrom(1); from = TT.uchar; }
        if (isPtr(to)) { this.zeroFrom(1); return; }
        if (to.k === 'float') {
            const fs = from.k === 'ptr' ? 1 : scalarSize(from);
            this.zeroFrom(fs);
            if (fs <= 2) this.math(0x15, T0, ZERO4, T0, 'I16TOF'); else this.math(0x17, T0, ZERO4, T0, 'I32TOF');
            return;
        }
        if (isFloat(from)) {
            if (scalarSize(to) <= 2) this.math(0x16, T0, ZERO4, T0, 'FTOI16'); else this.math(0x18, T0, ZERO4, T0, 'FTOI32');
            this.zeroFrom(scalarSize(to));
            return;
        }
        const fs = from.k === 'ptr' ? 1 : scalarSize(from);
        const ts = scalarSize(to);
        if (ts <= fs) return;
        if (from.signed) {
            const Lz = this.lbl('extZ'), Le = this.lbl('extE');
            this.movA(T0 + fs - 1); this.E.emit([0x54, 0x80], 'ANL A,#80h');
            this.E.condJump('JZ', Lz);
            for (let i = fs; i < ts; i++) this.movImm(T0 + i, 0xFF);
            this.E.ljmp(Le); this.E.label(Lz);
            for (let i = fs; i < ts; i++) this.movImm(T0 + i, 0);
            this.E.label(Le);
        } else for (let i = fs; i < ts; i++) this.movImm(T0 + i, 0);
    }

    // ── 表达式 ──
    genExpr(node) {
        switch (node.kind) {
            case 'num': return this.genNum(node);
            case 'id': {
                const s = this.lookup(node.name);
                if (!s) { this.err(node.line, `未声明的标识符 '${node.name}'`); this.clrT0(); return TT.char; }
                if (s.isBit || s.isSbit) {
                    this.E.emit([0xA2, s.bitAddr], `MOV C,${s.name}`); this.clrA(); this.E.emit([0x33], 'RLC A'); this.E.emit([0xF5, T0], 'MOV T0L,A');
                    this.zeroFrom(1); return TT.bit;
                }
                if (isAgg(s.type)) { this.movImm(T3, s.addr & 0xFF); this.movAdr(T3, T0); this.zeroFrom(1); return s.type.k === 'array' ? tPtr(s.type.elem) : tPtr(s.type); }
                const n = scalarSize(s.type);
                this.loadBlock(T0, s.addr, n); this.zeroFrom(n);
                return s.type;
            }
            case 'assign': return this.genAssign(node);
            case 'binary': return this.genBinary(node);
            case 'unary': return this.genUnary(node);
            case 'postfix': return this.genIncDec(node.operand, node.op === '++' ? 1 : -1, false, node.line);
            case 'index': {
                const t = this.genAddr(node);
                if (isAgg(t)) { this.movAdr(T3, T0); this.zeroFrom(1); return t.k === 'array' ? tPtr(t.elem) : tPtr(t); }
                this.loadViaT3(t); return t;
            }
            case 'member': {
                const t = this.genAddr(node);
                if (isAgg(t)) { this.movAdr(T3, T0); this.zeroFrom(1); return t.k === 'array' ? tPtr(t.elem) : tPtr(t); }
                this.loadViaT3(t); return t;
            }
            case 'cast': { const ft = this.genExpr(node.operand); this.coerce(ft, node.type); return node.type; }
            case 'cond': return this.genCondExpr(node);
            case 'call': return this.genCall(node);
            default: this.err(node.line, '不支持的表达式'); this.clrT0(); return TT.char;
        }
    }
    clrT0() { for (let i = 0; i < 4; i++) this.movImm(T0 + i, 0); }
    genNum(node) {
        if (node.isFloat) { const b = floatBytes(parseFloat(String(node.raw).replace(/[fF]$/, ''))); for (let i = 0; i < 4; i++) this.movImm(T0 + i, b[i]); return FT; }
        const v = node.value >>> 0;
        for (let i = 0; i < 4; i++) this.movImm(T0 + i, (v >>> (8 * i)) & 0xFF);
        if (v > 0xFFFF) return v > 0x7FFFFFFF ? TT.ulong : TT.long;
        if (v > 0xFF) return v > 32767 ? TT.uint : TT.int;
        return v > 127 ? TT.uint : TT.char;
    }

    // ── 类型推断 ──
    typeOf(node) {
        switch (node.kind) {
            case 'num': return node.isFloat ? FT : this.numType(node.value);
            case 'id': { const s = this.lookup(node.name); return s ? s.type : TT.char; }
            case 'call': { const f = this.funcs.get(node.callee.name); return f ? f.retType : TT.char; }
            case 'cast': return node.type;
            case 'assign': { try { return this.typeOf(node.target); } catch (e) { return TT.char; } }
            case 'postfix': return this.typeOf(node.operand);
            case 'unary':
                if (node.op === '!') return TT.char;
                if (node.op === '&') return tPtr(this.typeOf(node.operand));
                if (node.op === '*') { const t = this.typeOf(node.operand); return isPtr(t) ? t.elem : TT.char; }
                return this.typeOf(node.operand);
            case 'index': { const bt = this.typeOf(node.base); return isPtr(bt) ? bt.elem : (isAgg(bt) ? bt.elem : TT.char); }
            case 'member': {
                let bt;
                if (node.arrow) { const pt = this.typeOf(node.base); bt = isPtr(pt) ? pt.elem : TT.char; }
                else bt = this.typeOf(node.base);
                if (bt && bt.k === 'struct') { const m = bt.def.members.find(x => x.name === node.member); if (m) return m.type; }
                return TT.char;
            }
            case 'cond': return this.arithType(this.typeOf(node.a), this.typeOf(node.b)) || TT.char;
            case 'binary': {
                const op = node.op;
                if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(op)) return TT.char;
                const lt = this.typeOf(node.left), rt = this.typeOf(node.right);
                if ((op === '+' || op === '-') && isPtr(lt)) return lt;
                if ((op === '+' || op === '-') && isPtr(rt) && !isPtr(lt)) return rt;
                return this.arithType(lt, rt) || TT.char;
            }
            default: return TT.char;
        }
    }
    numType(v) {
        v = v >>> 0;
        if (v > 0xFFFF) return v > 0x7FFFFFFF ? TT.ulong : TT.long;
        if (v > 0xFF) return v > 32767 ? TT.uint : TT.int;
        return v > 127 ? TT.uint : TT.char;
    }
    arithType(a, b) {
        if (!a || !b) return null;
        if (isFloat(a) || isFloat(b)) return FT;
        const ia = intInfo(a), ib = intInfo(b);
        if (!ia || !ib) return null;
        return intType(Math.max(ia.size, ib.size), ia.signed && ib.signed);
    }

    // ── 赋值 ──
    genAssign(node) {
        if (node.target.kind === 'id' && node.op !== '=') {
            const bop = node.op.slice(0, -1);
            return this.genAssign({ ...node, op: '=', value: { kind: 'binary', op: bop, left: node.target, right: node.value, line: node.line } });
        }
        const tType = this.typeOf(node.target);
        const lv = this.lvalueOf(node.target);
        if (lv.bit) {
            const vt = this.genExpr(node.value);
            if (node.op === '=' && node.value.kind === 'num' && !node.value.isFloat) { this.E.emit([(node.value.value & 1) ? 0xD2 : 0xC2, lv.bitAddr], `${(node.value.value & 1) ? 'SETB' : 'CLR'} bit`); return TT.bit; }
            if (vt.k === 'bit') { const src = this.lookup(node.value.name); if (src && src.isBit) this.E.emit([0xA2, src.bitAddr], 'MOV C,src'); else { this.movA(T0); this.E.emit([0x13], 'RRC A'); } }
            else { this.movA(T0); this.E.emit([0x54, 0x01], 'ANL A,#1'); this.E.emit([0x13], 'RRC A'); }
            this.E.emit([0x92, lv.bitAddr], 'MOV bit,C');
            return TT.bit;
        }
        if (tType.k === 'struct' || tType.k === 'array') {
            this.genAddr(node.value); this.pushBytes(T3, 2);
            this.genAddr(node.target); this.movAdr(T3, T1);
            this.popBytes(T3, 2); this.movAdr(T3, T2);
            const n = tType.size;
            for (let i = 0; i < n; i++) {
                this.movAdr(T2, T3); this.addImmutT3(i); this.loadIndirect(T0, T3, 1);
                this.movAdr(T1, T3); this.addImmutT3(i); this.storeIndirect(T0, T3, 1);
            }
            return tType;
        }
        const vType = this.typeOf(node.value);
        if (lv.indirect) { this.genAddr(node.target); this.pushBytes(T3, 2); }
        this.genExpr(node.value);
        this.coerce(vType, tType);
        if (lv.indirect) { this.popBytes(T3, 2); this.storeViaT3(tType); }
        else this.storeBlock(T0, lv.addr, scalarSize(tType));
        return tType;
    }

    // ── 条件测试 ──
    genTest(node, cond, label) {
        const t = this.genExpr(node);
        if (isFloat(t)) {
            for (let i = 0; i < 4; i++) this.movImm(ZERO4 + i, 0);
            this.math(0x14, T0, ZERO4, T2, 'FCMP');
            this.movA(T2); this.E.emit([0x64, 0x01], 'XRL A,#1');   // ==0 → A=0
            this.E.condJump(cond, label);
        } else {
            const n = scalarSize(t);
            this.movA(T0);
            for (let i = 1; i < n; i++) this.E.emit([0x45, T0 + i], 'ORL A,T0+i');
            this.E.condJump(cond, label);
        }
    }

    // ── 二元 ──
    genBinary(node) {
        const op = node.op;
        if (op === '&&') return this.genLogical(node, true);
        if (op === '||') return this.genLogical(node, false);
        const lt = this.typeOf(node.left), rt = this.typeOf(node.right);
        if ((op === '+' || op === '-')) {
            if (isPtr(lt) && isPtr(rt) && op === '-') return this.genPtrDiff(node, lt);
            if (isPtr(lt) || isPtr(rt)) {
                const pt = isPtr(lt) ? lt : rt;
                const es = Math.max(1, sizeOf(pt.elem));
                return this.genPtrArith2(node, pt, es, lt, rt);
            }
        }
        if (['==', '!=', '<', '>', '<=', '>='].includes(op)) return this.genCompare(node, lt, rt);
        if (op === '<<' || op === '>>') return this.genShift(node, lt);
        const R = this.arithType(lt, rt);
        if (!R) { this.err(node.line, `类型不支持运算 '${op}'`); this.clrT0(); return TT.char; }
        this.genExpr(node.left); this.coerce(lt, R); this.pushT0();
        this.genExpr(node.right); this.coerce(rt, R); this.popT1();
        if (isFloat(R)) {
            const FN = { '+': 0x10, '-': 0x11, '*': 0x12, '/': 0x13 }[op];
            if (FN === undefined) { this.err(node.line, `浮点不支持 '${op}'`); this.clrT0(); return FT; }
            this.math(FN, T1, T0, T0, { '+': 'FADD', '-': 'FSUB', '*': 'FMUL', '/': 'FDIV' }[op]);
            return FT;
        }
        const sz = scalarSize(R);
        if (['+', '-', '&', '|', '^'].includes(op)) {
            if (op === '-') this.E.emit([0xC3], 'CLR C');
            const OPC = { '+': 0x25, '-': 0x95, '&': 0x55, '|': 0x45, '^': 0x65 }[op];
            for (let i = 0; i < sz; i++) {
                this.movA(T1 + i);
                this.E.emit([OPC, T0 + i], `${op} A,T0+${i}`);
                this.E.emit([0xF5, T0 + i], `MOV T0+${i},A`);
            }
            this.zeroFrom(sz); return R;
        }
        if (op === '*' || op === '/' || op === '%') {
            const signed = R.signed ? 1 : 0;
            let fn;
            if (sz <= 2) fn = signed ? ({ '*': 0x04, '/': 0x05, '%': 0x06 }[op]) : ({ '*': 0x01, '/': 0x02, '%': 0x03 }[op]);
            else fn = signed ? ({ '*': 0x0A, '/': 0x0B, '%': 0x0C }[op]) : ({ '*': 0x07, '/': 0x08, '%': 0x09 }[op]);
            const NM = ({ '*': 'MUL', '/': 'DIV', '%': 'MOD' }[op]) + (signed ? 'S' : 'U') + (sz <= 2 ? '16' : '32');
            this.math(fn, T1, T0, T0, NM);
            this.zeroFrom(sz); return R;
        }
        this.err(node.line, `不支持的运算符 '${op}'`); this.clrT0(); return R;
    }
    genPtrDiff(node, ptrType) {
        const es = Math.max(1, sizeOf(ptrType.elem));
        this.genExpr(node.left); this.coerce(ptrType, TT.uint); this.pushT0();
        this.genExpr(node.right); this.coerce(ptrType, TT.uint); this.popT1();
        this.E.emit([0xC3], 'CLR C');
        this.movA(T1); this.E.emit([0x95, T0], 'SUBB A,T0L'); this.E.emit([0xF5, T0], 'MOV T0L,A');
        this.movA(T1 + 1); this.E.emit([0x95, T0 + 1], 'SUBB A,T0H'); this.E.emit([0xF5, T0 + 1], 'MOV T0H,A');
        if (es !== 1) { this.copyT0toT1(); this.movImm(T0, es); this.movImm(T0 + 1, 0); this.math(0x02, T1, T0, T0, 'UDIV16'); }
        this.zeroFrom(2); return TT.int;
    }
    genPtrArith2(node, ptrType, es, lt, rt) {
        const op = node.op;
        // 指针 → T1L；索引 → T0（16 位）
        if (isPtr(lt)) { this.genExpr(node.left); this.coerce(lt, TT.uint); this.pushT0(); const it = this.typeOf(node.right); this.genExpr(node.right); this.coerce(it, TT.int); this.popT1(); }
        else { this.genExpr(node.right); this.coerce(rt, TT.uint); this.pushT0(); const it = this.typeOf(node.left); this.genExpr(node.left); this.coerce(it, TT.int); this.popT1(); }
        if (es !== 1) { this.copyT0toT2(); this.movImm(T0, es); this.movImm(T0 + 1, 0); this.math(0x01, T2, T0, T0, 'UMUL16'); }
        this.movA(T1);
        if (op === '+') this.E.emit([0x25, T0], 'ADD A,T0L');
        else { this.E.emit([0xC3], 'CLR C'); this.E.emit([0x95, T0], 'SUBB A,T0L'); }
        this.E.emit([0xF5, T0], 'MOV T0L,A');
        this.zeroFrom(1);
        return ptrType;
    }

    genCompare(node, lt, rt) {
        if (isFloat(lt) || isFloat(rt)) {
            this.genExpr(node.left); this.coerce(lt, FT); this.pushT0();
            this.genExpr(node.right); this.coerce(rt, FT); this.popT1();
            this.math(0x14, T1, T0, T2, 'FCMP');
        } else {
            const w = (t) => isPtr(t) ? TT.ulong : (intInfo(t).signed ? TT.long : TT.ulong);
            this.genExpr(node.left); this.coerce(lt, w(lt)); this.pushT0();
            this.genExpr(node.right); this.coerce(rt, w(rt)); this.popT1();
            const signed = !isPtr(lt) && !isPtr(rt) && intInfo(lt).signed && intInfo(rt).signed;
            this.math(signed ? 0x1B : 0x1A, T1, T0, T2, signed ? 'SCMP32' : 'UCMP32');
        }
        this.cmpToBool(node.op, T2, T0);
        return TT.char;
    }
    cmpToBool(op, cmpSlot, dstSlot) {
        const Lt = this.lbl('ct'), Le = this.lbl('ce'), Lf = this.lbl('cf');
        const jEq = (k, label) => { this.movA(cmpSlot); this.E.emit([0xB4, k & 0xFF, 0x03], `CJNE A,#${k},+3`); this.E.ljmp(label); };
        switch (op) {
            case '<': jEq(0, Lt); break;
            case '==': jEq(1, Lt); break;
            case '>': jEq(2, Lt); break;
            case '!=': jEq(1, Lf); this.E.ljmp(Lt); this.E.label(Lf); break;
            case '<=': jEq(2, Lf); this.E.ljmp(Lt); this.E.label(Lf); break;
            case '>=': jEq(0, Lf); this.E.ljmp(Lt); this.E.label(Lf); break;
        }
        this.movImm(dstSlot, 0); this.E.ljmp(Le);
        this.E.label(Lt); this.movImm(dstSlot, 1);
        this.E.label(Le);
        for (let i = 1; i < 4; i++) this.movImm(dstSlot + i, 0);
    }
    genLogical(node, isAnd) {
        const Lend = this.lbl('lgE');
        if (isAnd) {
            const Lfalse = this.lbl('lgF');
            this.genTest(node.left, 'JZ', Lfalse);
            this.genTest(node.right, 'JZ', Lfalse);
            this.movImm(T0, 1); this.E.ljmp(Lend);
            this.E.label(Lfalse); this.movImm(T0, 0);
            this.E.label(Lend);
        } else {
            const Ltrue = this.lbl('lgT');
            this.genTest(node.left, 'JNZ', Ltrue);
            this.genTest(node.right, 'JNZ', Ltrue);
            this.movImm(T0, 0); this.E.ljmp(Lend);
            this.E.label(Ltrue); this.movImm(T0, 1);
            this.E.label(Lend);
        }
        return TT.char;
    }
    genShift(node, lt) {
        const rn = node.right;
        if (!rn || rn.kind !== 'num') { this.err(node.line, '移位次数必须是常量'); this.clrT0(); return TT.char; }
        if (scalarSize(lt) > 1) { this.err(node.line, '教学子集不支持 16 位及以上的移位'); this.clrT0(); return lt; }
        const n = rn.value & 7;
        this.genExpr(node.left);
        for (let i = 0; i < n; i++) this.E.emit([node.op === '<<' ? 0x23 : 0x03], node.op === '<<' ? 'RL A' : 'RR A');
        return TT.char;
    }
    genUnary(node) {
        const op = node.op;
        if (op === '++' || op === '--') return this.genIncDec(node.operand, op === '++' ? 1 : -1, true, node.line);
        if (op === '&') { const t = this.genAddr(node.operand); this.movAdr(T3, T0); this.zeroFrom(1); return tPtr(t); }
        if (op === '*') {
            const pt = this.typeOf(node.operand);
            if (!isPtr(pt)) { this.err(node.line, '解引用需要指针'); this.clrT0(); return TT.char; }
            this.genExpr(node.operand);                 // 指针值 → T0
            this.movAdr(T0, T3); this.movImm(T3 + 1, 0);
            const et = pt.elem;
            if (isAgg(et)) { this.movAdr(T3, T0); this.zeroFrom(1); return et.k === 'array' ? tPtr(et.elem) : tPtr(et); }
            this.loadViaT3(et); return et;
        }
        const t = this.genExpr(node.operand);
        switch (op) {
            case '+': return t;
            case '-':
                if (isFloat(t)) { for (let i = 0; i < 4; i++) this.movImm(ZERO4 + i, 0); this.math(0x11, ZERO4, T0, T0, 'FSUB'); return FT; }
                this.E.emit([0xC3], 'noop');
                this.movA(T0); this.E.emit([0xF4], 'CPL A'); this.E.emit([0x24, 0x01], 'ADD A,#1'); this.E.emit([0xF5, T0], 'MOV T0L,A');
                for (let i = 1; i < 4; i++) { this.movA(T0 + i); this.E.emit([0xF4], 'CPL A'); this.E.emit([0x34, 0x00], 'ADDC A,#0'); this.E.emit([0xF5, T0 + i], 'MOV T0+i,A'); }
                return t;
            case '~':
                for (let i = 0; i < 4; i++) { this.movA(T0 + i); this.E.emit([0xF4], 'CPL A'); this.E.emit([0xF5, T0 + i], 'MOV T0+i,A'); }
                return t;
            case '!': {
                const Lz = this.lbl('nz'), Le = this.lbl('ne');
                this.genTest(node.operand, 'JZ', Lz);
                this.movImm(T0, 0); this.E.ljmp(Le);
                this.E.label(Lz); this.movImm(T0, 1);
                this.E.label(Le);
                return TT.char;
            }
        }
        return t;
    }
    genIncDec(operand, delta, prefix, line) {
        const t = this.typeOf(operand);
        if (t.k === 'bit') { this.err(line, '位变量不支持 ++/--'); return t; }
        if (t.k === 'struct' || t.k === 'array') { this.err(line, '聚合类型不支持 ++/--'); return t; }
        const lv = this.lvalueOf(operand);
        const n = scalarSize(t);
        if (lv.indirect) this.genAddr(operand);
        if (lv.indirect) this.loadIndirect(T0, T3, n); else this.loadBlock(T0, lv.addr, n);
        this.zeroFrom(n);
        if (!prefix) this.copyT0toT2();
        if (delta > 0) this.addConstToT0(n, 1); else this.subConstFromT0(n, 1);
        if (lv.indirect) this.storeIndirect(T0, T3, n); else this.storeBlock(T0, lv.addr, n);
        if (!prefix) this.copyT2toT0();
        return t;
    }
    addConstToT0(n, k) {
        this.movA(T0); this.E.emit([0x24, k & 0xFF], `ADD A,#${k}`); this.E.emit([0xF5, T0], 'MOV T0L,A');
        for (let i = 1; i < n; i++) { this.movA(T0 + i); this.E.emit([0x34, 0x00], 'ADDC A,#0'); this.E.emit([0xF5, T0 + i], `MOV T0+${i},A`); }
        this.zeroFrom(n);
    }
    subConstFromT0(n, k) {
        this.E.emit([0xC3], 'CLR C');
        this.movA(T0); this.E.emit([0x94, k & 0xFF], `SUBB A,#${k}`); this.E.emit([0xF5, T0], 'MOV T0L,A');
        for (let i = 1; i < n; i++) { this.movA(T0 + i); this.E.emit([0x94, 0x00], 'SUBB A,#0'); this.E.emit([0xF5, T0 + i], `MOV T0+${i},A`); }
        this.zeroFrom(n);
    }
    genCondExpr(node) {
        const Lfalse = this.lbl('cdF'), Lend = this.lbl('cdE');
        const ta = this.typeOf(node.a), tb = this.typeOf(node.b);
        const R = this.arithType(ta, tb) || ta;
        this.genTest(node.c, 'JZ', Lfalse);
        this.genExpr(node.a); this.coerce(ta, R);
        this.E.ljmp(Lend);
        this.E.label(Lfalse);
        this.genExpr(node.b); this.coerce(tb, R);
        this.E.label(Lend);
        return R;
    }
    genCall(node) {
        if (node.callee.kind !== 'id') { this.err(node.line, '仅支持直接函数调用'); this.clrT0(); return TT.char; }
        const name = node.callee.name;
        if (name === '_nop_') { this.E.emit([0x00], 'NOP'); return TT.void; }
        const f = this.funcs.get(name);
        if (!f) { this.err(node.line, `未定义的函数 '${name}'`); this.clrT0(); return TT.char; }
        if (node.args.length !== f.params.length) this.err(node.line, `函数 '${name}' 参数个数不匹配`);
        for (let i = 0; i < f.params.length; i++) {
            const p = f.params[i], a = node.args[i];
            const sym = f._paramSyms[i];
            if (!sym) continue;
            if ((p.type.k === 'struct' || p.type.k === 'array') && !isPtr(p.type)) { this.err(node.line, '结构体/数组按值传参不支持'); continue; }
            const at = this.typeOf(a);
            this.genExpr(a);
            this.coerce(at, p.type);
            if (sym.addr >= 0x80) { this.movImm(T3, sym.addr); this.storeIndirect(T0, T3, scalarSize(p.type)); }
            else this.storeBlock(T0, sym.addr, scalarSize(p.type));
        }
        this.E.lcall('fn_' + name);
        return f.retType;
    }

    // ── 语句 ──
    genStmt(stmt) {
        this.E.setLine(stmt.line);
        switch (stmt.kind) {
            case 'empty': break;
            case 'block': { this.scopes.push(new Map()); for (const s of stmt.stmts) this.genStmt(s); this.scopes.pop(); break; }
            case 'decl': {
                for (const d of stmt.decls) {
                    const sym = this.alloc(d.name, d.type, stmt.line, this.curFunc ? this.curFunc.name : 'global');
                    if (sym && d.init) {
                        this.genExpr(d.init);
                        this.coerce(this.typeOf(d.init), d.type);
                        this.storeSym(sym, d.type);
                    }
                }
                break;
            }
            case 'expr': this.genExpr(stmt.expr); break;
            case 'if': {
                const Lelse = this.lbl('ifE'), Lend = this.lbl('ifX');
                this.genTest(stmt.cond, 'JZ', Lelse);
                this.genStmt(stmt.then);
                if (stmt.else) { this.E.ljmp(Lend); this.E.label(Lelse); this.genStmt(stmt.else); this.E.label(Lend); }
                else this.E.label(Lelse);
                break;
            }
            case 'while': {
                const Lcond = this.lbl('whC'), Lend = this.lbl('whE');
                this.E.label(Lcond); this.genTest(stmt.cond, 'JZ', Lend);
                this.loopStack.push({ brk: Lend, cont: Lcond });
                this.genStmt(stmt.body); this.loopStack.pop();
                this.E.ljmp(Lcond); this.E.label(Lend);
                break;
            }
            case 'for': {
                if (stmt.init) { if (stmt.init.kind === 'decl') this.genStmt(stmt.init); else this.genExpr(stmt.init.expr); }
                const Lcond = this.lbl('forC'), Lstep = this.lbl('forS'), Lend = this.lbl('forE');
                this.E.label(Lcond);
                if (stmt.cond) this.genTest(stmt.cond, 'JZ', Lend);
                this.loopStack.push({ brk: Lend, cont: Lstep });
                this.genStmt(stmt.body); this.loopStack.pop();
                this.E.label(Lstep);
                if (stmt.step) this.genExpr(stmt.step);
                this.E.ljmp(Lcond); this.E.label(Lend);
                break;
            }
            case 'dowhile': {
                const Lbody = this.lbl('doB'), Lcont = this.lbl('doC'), Lend = this.lbl('doE');
                this.E.label(Lbody);
                this.loopStack.push({ brk: Lend, cont: Lcont });
                this.genStmt(stmt.body); this.loopStack.pop();
                this.E.label(Lcont);
                this.genTest(stmt.cond, 'JNZ', Lbody);
                this.E.label(Lend);
                break;
            }
            case 'break': if (!this.loopStack.length) this.err(stmt.line, 'break 不在循环内'); else this.E.ljmp(this.loopStack[this.loopStack.length - 1].brk); break;
            case 'continue': if (!this.loopStack.length) this.err(stmt.line, 'continue 不在循环内'); else this.E.ljmp(this.loopStack[this.loopStack.length - 1].cont); break;
            case 'return': {
                if (stmt.val) { const vt = this.genExpr(stmt.val); if (this.curFunc && this.curFunc.retType.k !== 'void') this.coerce(vt, this.curFunc.retType); }
                this.E.ljmp(this.epilogue);
                break;
            }
            default: this.err(stmt.line, '不支持的语句');
        }
    }
    storeSym(sym, type) {
        if (sym.isBit) { this.movA(T0); this.E.emit([0x54, 0x01], 'ANL A,#1'); this.E.emit([0x13], 'RRC A'); this.E.emit([0x92, sym.bitAddr], `MOV bit,C`); return; }
        if (sym.addr >= 0x80) { this.movImm(T3, sym.addr); this.storeIndirect(T0, T3, scalarSize(type)); }
        else this.storeBlock(T0, sym.addr, scalarSize(type));
    }

    run() {
        for (const sb of this.program.sbites) this.sbites.set(sb.name, sb.bit);
        for (const sf of this.program.sfrs) this.sfrs.set(sf.name, sf.addr);
        for (const sd of this.program.structs) this.structs.set(sd.name, sd);
        for (const f of this.program.funcs) { if (this.funcs.has(f.name)) this.err(f.line, `函数重名 '${f.name}'`); this.funcs.set(f.name, f); }
        for (const g of this.program.globals) {
            const sym = this.alloc(g.name, g.type, g.line, 'global');
            if (sym && g.init) this.initStmts.push({ sym, init: g.init, type: g.type, line: g.line });
        }
        for (const f of this.program.funcs) f._paramSyms = f.params.map(p => this.alloc(p.name, p.type, f.line, f.name + ':param'));
        if (!this.funcs.has('main')) this.err(1, '缺少 main 函数');

        this.E.ljmp('__init');
        for (const f of this.program.funcs) {
            if (f.isInterrupt) {
                const vec = 0x0003 + f.vector * 8;
                if (vec < 0x0003 || vec > 0x0023) { this.err(f.line, `中断号超出范围（0..4）：${f.vector}`); continue; }
                this.E.org = vec; this.E.ljmp('fn_' + f.name);
            }
        }
        this.E.org = 0x0030;

        this.E.label('__init');
        this.curFunc = null;
        for (const gi of this.initStmts) {
            this.E.setLine(gi.line);
            this.genExpr(gi.init);
            this.coerce(this.typeOf(gi.init), gi.type);
            this.storeSym(gi.sym, gi.type);
        }
        this.E.ljmp('fn_main');

        for (const f of this.program.funcs) {
            this.E.label('fn_' + f.name);
            this.curFunc = f; this.epilogue = this.lbl('epi');
            this.scopes = [new Map()];
            f.params.forEach((p, i) => { if (f._paramSyms[i]) this.scopes[0].set(p.name, f._paramSyms[i]); });
            if (f.isInterrupt) {
                this.E.emit([0xC0, 0xE0], 'PUSH ACC'); this.E.emit([0xC0, 0xD0], 'PUSH PSW');
                this.E.emit([0xC0, 0xF0], 'PUSH B'); this.E.emit([0xC0, 0x83], 'PUSH DPH'); this.E.emit([0xC0, 0x82], 'PUSH DPL');
            }
            this.genStmt(f.body);
            this.E.label(this.epilogue);
            if (f.isInterrupt) {
                this.E.emit([0xD0, 0x82], 'POP DPL'); this.E.emit([0xD0, 0x83], 'POP DPH');
                this.E.emit([0xD0, 0xF0], 'POP B'); this.E.emit([0xD0, 0xD0], 'POP PSW');
                this.E.emit([0xD0, 0xE0], 'POP ACC'); this.E.emit([0x32], 'RETI');
            } else if (f.name === 'main') this.E.emit([0x80, 0xFE], 'SJMP $');
            else this.E.emit([0x22], 'RET');
            this.scopes.pop(); this.curFunc = null;
        }
        this.E.resolve();
        return { bytes: this.E.rom, listing: this.E.listing, lineMap: this.E.lineMap, lineAddrs: this.E.lineAddrs, symbols: this.symbols, errors: this.errors, warnings: this.warnings };
    }
}

function typeName(t) {
    if (!t) return '?';
    if (t.k === 'ptr') return typeName(t.elem) + '*';
    if (t.k === 'array') return `${typeName(t.elem)}[${t.len}]`;
    if (t.k === 'struct') return 'struct ' + t.def.name;
    return t.k;
}

export function compileC(source) {
    const errors = [], warnings = [];
    let bytes = new Uint8Array(0), symbols = [], lineMap = new Map(), lineAddrs = new Map(), listing = [];
    try {
        const text = preprocess(source);
        const toks = tokenize(text);
        const parser = new Parser(toks);
        const program = parser.parseProgram();
        const emitter = new Emitter();
        const gen = new Gen(program, emitter);
        const res = gen.run();
        bytes = res.bytes; listing = res.listing; lineMap = res.lineMap; lineAddrs = res.lineAddrs; symbols = res.symbols;
        errors.push(...res.errors); warnings.push(...res.warnings);
    } catch (e) {
        if (e && e.isCompile) errors.push({ line: e.line, col: e.col || 1, msg: e.message });
        else errors.push({ line: 0, col: 1, msg: '内部错误：' + (e && e.message || e) });
    }
    let size = 0;
    for (let i = bytes.length - 1; i >= 0; i--) if (bytes[i] !== 0xFF) { size = i + 1; break; }
    return { ok: errors.length === 0, bytes, errors, warnings, symbols, lineMap, lineAddrs, listing, size };
}
export default compileC;
