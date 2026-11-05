import { discoverPlcs, macOf } from '../tools/NetworkSim.js';

/**
 * Step7UI — STEP 7-Micro/WIN SMART 上位机编程界面（覆盖层）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  P2：查找设备（直连 / 经交换机）→ 选中并连接/断开 → 设备与扩展模块信息。
 *  P3：梯形图编辑（触点/线圈/定时器/计数器 + 并联支路）→ 编译为 S7-200 STL →
 *      下载到 PLC 真实运行；上传 = 从 PLC 读回程序（优先读回梯形图模型，
 *      否则反编译 STL，含并联支路，可继续编辑）。
 *  P4：在线监控（完整过程映像）+ 梯形图按实时状态着色；监控时禁止编辑。
 *
 *  梯形图模型（series + parallel）：
 *    network = { comment, elements:[Node] }   // elements 为串联链
 *    Node ∈ {contact} | {parallel, branches:[[Node]]} | {coil|timer|counter}（输出，末尾）
 *    并联支路：{ type:'parallel', branches:[ [触点…], [触点…] ] }
 */

// ═══════════════════════════════════════════════════════════════════
// 梯形图 → STL（支持并联支路：用 LD 分块 + OLD/ALD 组合）
// ═══════════════════════════════════════════════════════════════════
export function ladderToStl(networks) {
    const out = [];
    (networks || []).forEach(net => {
        if (net.comment) out.push('// ' + net.comment);
        if (net.raw && net.raw.length) {
            // 高级指令网络：先还原其前导 EN 条件（触点串），再输出指令行
            if (net.en && net.en.length) {
                const enStl = compileChain(net.en, true);
                (enStl.length ? enStl : []).forEach(l => out.push(l));
            }
            if (Array.isArray(net.ins) && net.ins.length) {
                // 优先按结构化条目生成（支持编辑）；条目含注释行与指令
                net.ins.forEach(it => {
                    if (it && it.comment !== undefined) { out.push(String(it.comment)); return; }
                    if (!it || !it.mnem) return;
                    const ops = insOpsToString(insSpec(it.mnem), it.ops);
                    out.push(`${String(it.mnem).padEnd(6)}${ops ? ' ' + ops : ''}`);
                });
            } else {
                net.raw.forEach(l => out.push(l));
            }
            out.push('');
            return;
        }
        const els = net.elements || [];
        const output = els.find(e => e.type === 'coil' || e.type === 'timer' || e.type === 'counter');
        const series = els.filter(e => e !== output);
        if (!series.length && !output) { out.push('NOP'); out.push(''); return; }

        let lines = compileChain(series, true);
        if (!lines.length) lines = ['LD     SM0.0'];
        lines.forEach(l => out.push(l));
        if (output) {
            if (output.type === 'coil') out.push(`=      ${output.op}`);
            else if (output.type === 'timer') out.push(`${String(output.fn || 'TON').padEnd(6)} ${output.op}, ${output.pt}`);
            else if (output.type === 'counter') out.push(`${String(output.fn || 'CTU').padEnd(6)} ${output.op}, ${output.pv}`);
        }
        out.push('');
    });
    out.push('END');
    return out.join('\n');
}

/** 编译一条串联链为 STL；parallel 节点用 LD 分块 + OLD，必要时 ALD 与前段相与 */
function compileChain(nodes, startNewBlock) {
    const lines = [];
    (nodes || []).forEach((node, i) => {
        const first = (i === 0);
        if (node.type === 'contact') {
            const m = first ? (node.nc ? 'LDN' : 'LD') : (node.nc ? 'AN' : 'A');
            lines.push(`${m.padEnd(6)} ${node.op}`);
        } else if (node.type === 'parallel') {
            const brs = (node.branches || []);
            if (!brs.length) return;
            brs.forEach((br, bi) => {
                const sub = compileChain(br, true);
                (sub.length ? sub : ['LD     SM0.0']).forEach(l => lines.push(l));
                if (bi > 0) lines.push('OLD');
            });
            if (!first) lines.push('ALD');   // 与前段串联部分相与
        }
    });
    return lines;
}

// ═══════════════════════════════════════════════════════════════════
// STL → 梯形图（栈式解析为布尔表达式树，再转 series/parallel 模型）
// ═══════════════════════════════════════════════════════════════════
export function stlToLadder(stl) {
    const networks = [];
    let pendingComment = '';
    let stack = [];
    let cur = null;
    let output = null;
    let linesBuf = [];       // 当前网络所有原始行（用于无法解析时保留为只读）
    let unsupported = false;
    let advBuf = [];         // 高级指令缓冲：将合并为独立的只读网络

    const leaf = (op, nc) => ({ t: 'leaf', op, nc });
    const flush = () => {
        if (unsupported) {
            if (linesBuf.length) networks.push({ comment: pendingComment || '', raw: linesBuf.slice(), elements: [] });
        } else if (cur || output) {
            const els = toSeriesList(cur);
            if (output) els.push(output);
            if (els.length) networks.push({ comment: pendingComment || '', elements: els });
        }
        stack = []; cur = null; output = null; linesBuf = []; unsupported = false; pendingComment = '';
    };
    // 高级指令块独立成只读网络：把其"前导布尔条件"作为 EN 使能条件并入同一只读网络
    // takeComment=false 时不消耗 pendingComment（用于注释行触发收尾，使注释归属其后代码）
    const closeAdv = (takeComment) => {
        if (!advBuf.length) return;
        // 前导布尔条件（如 LD SM0.1）→ 作为 EN 条件附加到高级指令块，而非独立梯形图网络
        let en = null;
        if (cur && !output) {
            const els = toSeriesList(cur);
            if (els.length) en = els;
        } else if (output) {
            // 出现输出指令：前面的逻辑确属独立网络，先正常输出
            flush();
        }
        // 结构化条目（按原顺序，含注释行）→ 供编辑；raw 为其 STL 文本表示
        const ins = [];
        advBuf.forEach(it => {
            if (typeof it === 'string') { ins.push({ comment: it }); return; }
            ins.push({ mnem: it.mnem, ops: it.ops.slice(), raw: it.raw });
        });
        if (takeComment && pendingComment) { ins.unshift({ comment: '// ' + pendingComment }); pendingComment = ''; }
        const raw = ins.map(it => it.comment !== undefined ? it.comment : it.raw);
        networks.push({ comment: '', raw, ins, elements: [], advanced: true, en });
        advBuf = [];
        stack = []; cur = null; output = null; linesBuf = []; unsupported = false;
    };
    const flushAdv = () => closeAdv(true);

    for (let rawLine of String(stl || '').split(/\r?\n/)) {
        const commentPart = (rawLine.match(/\/\/(.*)$/) || [])[1];
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (commentPart !== undefined && !line) {
            // 注释行：若正处于高级指令块中，先收尾该块（不消耗注释），使注释归属其后的代码
            if (advBuf.length) closeAdv(false);
            pendingComment = commentPart.trim();
            continue;
        }
        if (!line) continue;

        const parts = line.split(/\s+/);
        let mnem = parts[0].toUpperCase();
        const args = parts.slice(1).join(' ').split(',').map(s => s.trim()).filter(Boolean);

        if (mnem === 'END') { flushAdv(); flush(); break; }
        if (mnem === 'NOP') continue;

        // ── 高级指令（数据/算术/比较/移位/转换/跳转等）：独立只读网络 ──
        // ==I 是 =I 的别名（求解器两者等价）；解析统一归一为 =I
        const canon = (mnem === '==I') ? '=I' : mnem;
        if (ADV_MNEM.has(canon)) {
            advBuf.push({ mnem: canon, ops: args, raw: (canon === mnem) ? line : (`${canon}${line.slice(mnem.length)}`) });
            continue;
        }
        // 若此前在累积高级指令，遇到布尔指令前先冲刷为独立网络
        if (advBuf.length) flushAdv();

        linesBuf.push(line);
        if (mnem === 'LD' || mnem === 'LDN') { stack.push(cur); cur = leaf(args[0] || 'I0.0', mnem === 'LDN'); }
        else if (mnem === 'A' || mnem === 'AN') { cur = cur ? { t: 'and', c: [cur, leaf(args[0] || 'I0.0', mnem === 'AN')] } : leaf(args[0] || 'I0.0', mnem === 'AN'); }
        else if (mnem === 'O' || mnem === 'ON') { cur = cur ? { t: 'or', c: [cur, leaf(args[0] || 'I0.0', mnem === 'ON')] } : leaf(args[0] || 'I0.0', mnem === 'ON'); }
        else if (mnem === 'ALD') { const prev = stack.pop(); cur = prev ? { t: 'and', c: [prev, cur] } : cur; }
        else if (mnem === 'OLD') { const prev = stack.pop(); cur = prev ? { t: 'or', c: [prev, cur] } : cur; }
        else if (mnem === '=') { output = { type: 'coil', op: args[0] || 'Q0.0' }; flush(); }
        else if (mnem === 'TON' || mnem === 'TOF' || mnem === 'TONR') { output = { type: 'timer', fn: mnem, op: args[0] || 'T37', pt: args[1] || '100' }; flush(); }
        else if (mnem === 'CTU' || mnem === 'CTD' || mnem === 'CTUD') { output = { type: 'counter', fn: mnem, op: args[0] || 'C0', pv: args[1] || '5' }; flush(); }
        // 其余 S/R/SI/RI/EU/ED/JMP/LBL 等一并归入高级指令只读块
        else { advBuf.push(line); }
    }
    flushAdv();
    flush();
    return networks;
}

/**
 * 高级指令规格表（统一维护：助记符 / 显示名 / 分类 / 操作数定义）。
 * 仅收录 S7200Solver 已实现、可真正运行的指令；供渲染、编辑对话框、编译校验共用。
 *
 *   cat   : move(传送·绿) | comp(比较·蓝) | pulse(边沿·灰) | math(算术逻辑·黄)
 *   en    : 是否需要显示 EN 使能端
 *   ops   : 操作数输入项 [{ label, ph(占位/示例), kind('bit'|'word'|'num'|'any') }]
 *   fmt   : 生成 STL 时操作数连接方式（默认 'comma' → "MNEM a, b"）
 */
const ADV_SPEC = {
    // ── 传送 ──
    'MOV':    { name: 'MOV  传送',        cat: 'move', en: true,  ops: [{ label: 'IN 源', ph: 'VW0', kind: 'any' }, { label: 'OUT 目的', ph: 'MW0', kind: 'word' }] },
    'MOV_B':  { name: 'MOV_B  字节传送',  cat: 'move', en: true,  ops: [{ label: 'IN 源', ph: 'VB0', kind: 'any' }, { label: 'OUT 目的', ph: 'MB0', kind: 'word' }] },
    'MOV_W':  { name: 'MOV_W  字传送',    cat: 'move', en: true,  ops: [{ label: 'IN 源', ph: 'VW0', kind: 'any' }, { label: 'OUT 目的', ph: 'AQW0', kind: 'word' }] },
    'MOV_DW': { name: 'MOV_DW  双字传送', cat: 'move', en: true,  ops: [{ label: 'IN 源', ph: 'VD0', kind: 'any' }, { label: 'OUT 目的', ph: 'MD0', kind: 'word' }] },

    // ── 算术 / 逻辑运算 ──
    '+I':    { name: '+I  整数加',    cat: 'math', en: true, ops: [{ label: 'IN1', ph: '1', kind: 'any' }, { label: 'IN2/OUT', ph: 'VW0', kind: 'word' }] },
    '-I':    { name: '-I  整数减',    cat: 'math', en: true, ops: [{ label: 'IN1', ph: '1', kind: 'any' }, { label: 'IN2/OUT', ph: 'VW0', kind: 'word' }] },
    '*I':    { name: '*I  整数乘',    cat: 'math', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2/OUT', ph: 'MW10', kind: 'word' }] },
    '/I':    { name: '/I  整数除',    cat: 'math', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2/OUT', ph: 'MW10', kind: 'word' }] },
    'INC_W': { name: 'INC_W  字自增', cat: 'math', en: true, ops: [{ label: 'IN/OUT', ph: 'VW0', kind: 'word' }] },
    'DEC_W': { name: 'DEC_W  字自减', cat: 'math', en: true, ops: [{ label: 'IN/OUT', ph: 'VW0', kind: 'word' }] },
    'AND_W': { name: 'AND_W  字与',   cat: 'math', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2/OUT', ph: 'MW0', kind: 'word' }] },
    'OR_W':  { name: 'OR_W  字或',    cat: 'math', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2/OUT', ph: 'MW0', kind: 'word' }] },
    'XOR_W': { name: 'XOR_W  字异或', cat: 'math', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2/OUT', ph: 'MW0', kind: 'word' }] },

    // ── 移位 ──
    'SLW': { name: 'SLW  字左移', cat: 'math', en: true, ops: [{ label: 'IN', ph: 'VW0', kind: 'any' }, { label: 'N', ph: '1', kind: 'num' }, { label: 'OUT', ph: 'MW0', kind: 'word' }] },
    'SRW': { name: 'SRW  字右移', cat: 'math', en: true, ops: [{ label: 'IN', ph: 'VW0', kind: 'any' }, { label: 'N', ph: '1', kind: 'num' }, { label: 'OUT', ph: 'MW0', kind: 'word' }] },

    // ── 转换 ──
    'BTI': { name: 'BTI  字节转整数', cat: 'math', en: true, ops: [{ label: 'IN 字节', ph: 'VB0', kind: 'any' }, { label: 'OUT 字', ph: 'VW0', kind: 'word' }] },
    'ITB': { name: 'ITB  整数转字节', cat: 'math', en: true, ops: [{ label: 'IN 字', ph: 'VW0', kind: 'any' }, { label: 'OUT 字节', ph: 'VB0', kind: 'word' }] },

    // ── 比较（整数）──
    '=I':   { name: '==I  等于',     cat: 'comp', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2', ph: '100', kind: 'any' }] },
    '<>I':  { name: '<>I  不等于',   cat: 'comp', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2', ph: '0', kind: 'any' }] },
    '>I':   { name: '＞I  大于',     cat: 'comp', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2', ph: '0', kind: 'any' }] },
    '<I':   { name: '＜I  小于',     cat: 'comp', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2', ph: '100', kind: 'any' }] },
    '>=I':  { name: '＞=I  大于等于', cat: 'comp', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2', ph: '0', kind: 'any' }] },
    '<=I':  { name: '＜=I  小于等于', cat: 'comp', en: true, ops: [{ label: 'IN1', ph: 'VW0', kind: 'any' }, { label: 'IN2', ph: '100', kind: 'any' }] },

    // ── 置位 / 复位 / 立即 / 边沿 ──
    'S':  { name: 'S  置位',      cat: 'math',  en: true, ops: [{ label: '位', ph: 'Q0.0', kind: 'bit' }, { label: 'N（位数，可空）', ph: '1', kind: 'num' }] },
    'R':  { name: 'R  复位',      cat: 'math',  en: true, ops: [{ label: '位', ph: 'Q0.0', kind: 'bit' }, { label: 'N（位数，可空）', ph: '1', kind: 'num' }] },
    'SI': { name: 'SI  立即置位', cat: 'math',  en: true, ops: [{ label: '位', ph: 'Q0.0', kind: 'bit' }, { label: 'N（位数，可空）', ph: '1', kind: 'num' }] },
    'RI': { name: 'RI  立即复位', cat: 'math',  en: true, ops: [{ label: '位', ph: 'Q0.0', kind: 'bit' }, { label: 'N（位数，可空）', ph: '1', kind: 'num' }] },
    'EU': { name: 'EU  正跳变',   cat: 'pulse', en: false, ops: [] },
    'ED': { name: 'ED  负跳变',   cat: 'pulse', en: false, ops: [] },

    // ── 跳转 / 程序控制 ──
    'JMP':  { name: 'JMP  跳转', cat: 'pulse', en: true,  ops: [{ label: '标号', ph: 'LBL0', kind: 'any' }] },
    'LBL':  { name: 'LBL  标号', cat: 'pulse', en: false, ops: [{ label: '标号', ph: 'LBL0', kind: 'any' }] },
    'STOP': { name: 'STOP  停止', cat: 'pulse', en: true,  ops: [] },

    // ── 输出类（普通网络转换为高级网络时由线圈/定时器/计数器映射而来）──
    '=':   { name: '=  线圈输出',   cat: 'move', en: true, ops: [{ label: '位', ph: 'Q0.0', kind: 'bit' }] },
    'TON': { name: 'TON  接通延时', cat: 'math', en: true, ops: [{ label: '定时器', ph: 'T37', kind: 'any' }, { label: 'PT', ph: '100', kind: 'num' }] },
    'TOF': { name: 'TOF  断开延时', cat: 'math', en: true, ops: [{ label: '定时器', ph: 'T37', kind: 'any' }, { label: 'PT', ph: '100', kind: 'num' }] },
    'TONR':{ name: 'TONR  保持型延时', cat: 'math', en: true, ops: [{ label: '定时器', ph: 'T37', kind: 'any' }, { label: 'PT', ph: '100', kind: 'num' }] },
    'CTU': { name: 'CTU  加计数',   cat: 'math', en: true, ops: [{ label: '计数器', ph: 'C0', kind: 'any' }, { label: 'PV', ph: '5', kind: 'num' }] },
    'CTD': { name: 'CTD  减计数',   cat: 'math', en: true, ops: [{ label: '计数器', ph: 'C0', kind: 'any' }, { label: 'PV', ph: '5', kind: 'num' }] },
    'CTUD':{ name: 'CTUD  加减计数', cat: 'math', en: true, ops: [{ label: '计数器', ph: 'C0', kind: 'any' }, { label: 'PV', ph: '5', kind: 'num' }] },
};

/**
 * 高级指令助记符集合（供 stlToLadder 解析器识别）。
 * 注意：**不含**输出类指令（= / TON / TOF / TONR / CTU / CTD / CTUD）——
 * 这些由 stlToLadder 作为梯形图的输出元素处理；它们仅在普通网络被
 * "＋指令"转换为高级网络时才会出现在 net.ins 中（此时借助 ADV_SPEC 渲染/编辑）。
 */
const OUTPUT_MNEM = new Set(['=', 'TON', 'TOF', 'TONR', 'CTU', 'CTD', 'CTUD']);
const ADV_MNEM = new Set(Object.keys(ADV_SPEC).filter(m => !OUTPUT_MNEM.has(m)));

/** 极简 HTML 转义（防止操作数中的 < > & 破坏渲染） */
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 按指令规格把操作数拼成规范操作数字符串（如 "VW0, AQW0"） */
function insOpsToString(spec, ops) {
    const arr = (ops || []).map(s => String(s == null ? '' : s).trim()).filter(Boolean);
    return arr.join(', ');
}

/** 由助记符 + 操作数字符串定位 ADV_SPEC（未知指令返回 null） */
function insSpec(mnem) { return ADV_SPEC[String(mnem || '').toUpperCase()] || null; }



/** 布尔表达式 → 串联元素列表（and 展开、or 变并联节点） */
function toSeriesList(expr) {
    if (!expr) return [];
    if (expr.t === 'leaf') return [{ type: 'contact', op: expr.op, nc: expr.nc }];
    if (expr.t === 'and') {
        const out = [];
        expr.c.forEach(ch => out.push(...toSeriesList(ch)));
        return out;
    }
    if (expr.t === 'or') {
        return [{ type: 'parallel', branches: expr.c.map(ch => toSeriesList(ch)) }];
    }
    return [];
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// ═══════════════════════════════════════════════════════════════════
// 在线监控：按操作数读取过程映像
// ═══════════════════════════════════════════════════════════════════
function parseBitAddr(op) {
    const m = /^(I|Q|M|SM)(\d+)\.(\d+)$/i.exec(String(op || '').trim());
    if (!m) return null;
    return { area: m[1].toUpperCase(), idx: parseInt(m[2], 10) * 8 + parseInt(m[3], 10) };
}
function readBit(mon, op) {
    if (!mon) return false;
    const a = parseBitAddr(op);
    if (a) { const arr = mon[a.area]; return !!(arr && arr[a.idx]); }
    let m = /^T(\d+)$/i.exec(op || ''); if (m) { const t = mon.T[+m[1]]; return !!(t && t.bit); }
    m = /^C(\d+)$/i.exec(op || ''); if (m) { const c = mon.C[+m[1]]; return !!(c && c.bit); }
    return false;
}
function readTimer(mon, op) { const m = /^T(\d+)$/i.exec(op || ''); if (!m || !mon) return { cur: 0, bit: false }; return mon.T[+m[1]] || { cur: 0, bit: false }; }
function readCounter(mon, op) { const m = /^C(\d+)$/i.exec(op || ''); if (!m || !mon) return { cur: 0, bit: false }; return mon.C[+m[1]] || { cur: 0, bit: false }; }
function vwOf(mon, n) {
    if (!mon || !mon.V) return 0;
    const u = ((mon.V[n] || 0) | ((mon.V[n + 1] || 0) << 8)) & 0xFFFF;
    return u >= 0x8000 ? u - 0x10000 : u;
}

// ═══════════════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════════════
export class Step7UI {
    constructor(sys, pc) {
        this.sys = sys;
        this.pc = pc;
        this.devices = [];
        this.connectedId = null;
        this._root = null;
        this._ladder = { networks: [] };
        this._programLoaded = false;   // 连接后不主动读取程序，点「上传」才读取
        this._view = 'devices';
        this._monitoring = false;
    }

    open() {
        if (!this._root) this._build();
        this._root.style.display = 'flex';
        this._scanDevices();
        this._renderAll();
    }
    /** 仅由标题栏「✕」或 destroy() 调用；点击其它区域/Esc 均不关闭 */
    close() {
        if (this._root) this._root.style.display = 'none';
        this._closeElModal();
        this._stopMonitor();
        this._monitoring = false;
    }
    destroy() {
        this.close();
        if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
        this._root = null;
    }

    // ── 骨架 ───────────────────────────────────────────────────
    _build() {
        // STEP7 独立浮窗：不遮罩、不拦截其它操作（pointer-events:none 透传），
        // 仅窗口本身可交互；始终置顶（z-index 高于所有其它弹窗/面板）。
        const root = document.createElement('div');
        root.id = 'step7-overlay';
        root.style.cssText = `position:fixed;inset:0;background:transparent;pointer-events:none;
            display:flex;align-items:center;justify-content:center;z-index:30000;
            font-family:'Microsoft YaHei',Arial,sans-serif;`;

        const win = document.createElement('div');
        // 初始位置：在水平居中基础上再向右偏移 100px（margin-left 200px → 居中位移 +100px）
        win.style.cssText = `width:787px;max-width:96vw;height:740px;max-height:92vh;pointer-events:auto;margin-left:200px;
            background:#f0f1f2;border:1px solid #6b7280;border-radius:5px;display:flex;flex-direction:column;
            box-shadow:0 12px 44px rgba(0,0,0,0.5);overflow:hidden;color:#1f2937;`;

        const titlebar = document.createElement('div');
        titlebar.style.cssText = `height:32px;flex:0 0 32px;background:linear-gradient(#2f6fb0,#20527f);
            color:#fff;display:flex;align-items:center;padding:0 10px;font-size:13px;font-weight:bold;`;
        titlebar.innerHTML = `<span>SIMATIC Manager — STEP 7-Micro/WIN SMART</span>
            <span style="margin-left:auto;cursor:pointer;font-weight:bold;padding:0 8px;" id="s7-close">✕</span>`;

        const toolbar = document.createElement('div');
        toolbar.style.cssText = `height:40px;flex:0 0 40px;background:#e4e7ea;border-bottom:1px solid #c3c9cf;
            display:flex;align-items:center;gap:6px;padding:0 10px;flex-wrap:nowrap;overflow:hidden;`;
        toolbar.innerHTML = `
            <button class="s7-btn" id="s7-scan">🔍 查找设备</button>
            <button class="s7-btn" id="s7-connect" disabled>🔗 连接</button>
            <button class="s7-btn" id="s7-disconnect" disabled>✖ 断开</button>
            <span class="s7-sep"></span>
            <button class="s7-btn" id="s7-upload" disabled>⬆ 上传</button>
            <button class="s7-btn" id="s7-download" disabled>⬇ 下载</button>
            <button class="s7-btn" id="s7-editor">✎ 程序编辑器</button>
            <button class="s7-btn" id="s7-modules">📋 模块信息</button>
            <button class="s7-btn" id="s7-monitor" disabled>👁 监控</button>
            <span id="s7-hint" style="margin-left:auto;font-size:12px;color:#4b5563;"></span>`;

        const body = document.createElement('div');
        body.style.cssText = `flex:1 1 auto;display:flex;min-height:0;`;
        const left = document.createElement('div');
        left.id = 's7-tree';
        left.style.cssText = `width:220px;flex:0 0 220px;background:#fafbfc;border-right:1px solid #c3c9cf;overflow:auto;padding:8px;font-size:13px;`;
        const main = document.createElement('div');
        main.id = 's7-main';
        main.style.cssText = `flex:1 1 auto;overflow:auto;padding:14px;background:#fff;`;
        body.appendChild(left); body.appendChild(main);

        const status = document.createElement('div');
        status.id = 's7-status';
        status.style.cssText = `height:26px;flex:0 0 26px;background:#e4e7ea;border-top:1px solid #c3c9cf;
            display:flex;align-items:center;padding:0 12px;font-size:12px;color:#374151;`;

        win.appendChild(titlebar); win.appendChild(toolbar); win.appendChild(body); win.appendChild(status);
        root.appendChild(win);
        document.body.appendChild(root);

        const style = document.createElement('style');
        style.textContent = `
            .s7-btn{padding:6px 10px;border:1px solid #b9c0c7;border-radius:3px;background:#f7f8f9;cursor:pointer;font-size:12px;color:#1f2937;white-space:nowrap;}
            .s7-btn:hover:not([disabled]){background:#e9edf1;} .s7-btn[disabled]{opacity:.5;cursor:not-allowed;}
            .s7-sep{width:1px;height:22px;background:#b9c0c7;margin:0 2px;}
            .s7-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #d7dce1;border-radius:4px;margin-bottom:8px;}
            .s7-row:hover{background:#f2f6fa;} .s7-tag{font-size:11px;padding:1px 7px;border-radius:8px;color:#fff;}
            .s7-dir{background:#1f9d55;} .s7-sw{background:#8a5a00;}
            table.s7-tbl{border-collapse:collapse;width:100%;font-size:13px;}
            table.s7-tbl th,table.s7-tbl td{border:1px solid #d7dce1;padding:6px 9px;text-align:left;}
            table.s7-tbl th{background:#eef1f4;color:#374151;}
            .s7-net{border:1px solid #d7dce1;border-radius:4px;margin-bottom:10px;background:#fcfdfe;}
            .s7-net-h{display:flex;align-items:center;gap:8px;padding:5px 9px;background:#eef1f4;border-bottom:1px solid #d7dce1;font-size:12px;color:#374151;flex-wrap:wrap;}
            .s7-net-b{display:flex;align-items:flex-start;flex-wrap:wrap;gap:4px;padding:12px 10px;overflow-x:auto;}
            /* 无并联的元件（触点/线圈等）与并联块"第一行"顶边对齐
               （并联块 padding-top=4px，故独立元件补同等上边距；支路内元件不再另加上边距） */
            .s7-net-b > .s7-chip,.s7-net-b > .s7-add{margin-top:4px;}
            .s7-chip{display:inline-flex;flex-direction:column;align-items:center;min-width:52px;padding:3px 6px;border:1px solid #9fb0c0;border-radius:3px;background:#fff;cursor:pointer;}
            .s7-chip:hover{border-color:#2f6fb0;background:#eaf3fb;}
            .s7-chip.locked{cursor:default;}
            .s7-chip .sym{font-family:Consolas,monospace;font-size:14px;color:#1f3b57;line-height:1.1;}
            .s7-chip .op{font-size:11px;color:#20527f;font-weight:bold;}
            .s7-chip.block{border-color:#b29a3a;background:#fffdf3;}
            .s7-chip.raw{border-color:#c98a8a;background:#fdf4f4;color:#8a2b2b;cursor:default;}
            /* 高级指令"指令框"（Micro/WIN 风格）：EN 使能端 + 指令名 + 操作数 */
            .s7-insbox{position:relative;display:inline-flex;align-items:stretch;border:1.5px solid #b8860b;border-radius:3px;background:#fffdf3;overflow:hidden;min-height:44px;cursor:pointer;}
            .s7-insbox:hover{box-shadow:0 0 0 2px rgba(47,111,176,.35);}
            .s7-insbox.locked{cursor:default;}
            .s7-insbox.locked:hover{box-shadow:none;}
            .s7-insbox .s7-en{display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:3px 5px;border-right:1.5px solid #b8860b;background:#fff6dd;}
            .s7-insbox .s7-en .s7-en-lbl{font-size:10px;color:#8a6d00;font-weight:bold;line-height:1;}
            .s7-insbox .s7-en .s7-en-pin{font-size:11px;color:#8a6d00;line-height:1;}
            .s7-insbox .s7-ins-body{display:flex;flex-direction:column;justify-content:center;padding:4px 9px;}
            .s7-insbox .s7-ins-name{font-size:12px;font-weight:bold;color:#7a5b00;line-height:1.2;}
            .s7-insbox .s7-ins-ops{font-family:Consolas,monospace;font-size:11.5px;color:#1f3b57;line-height:1.35;white-space:nowrap;}
            .s7-insbox .s7-ins-ops b{color:#20527f;}
            .s7-insbox .s7-ins-del{position:absolute;top:1px;right:1px;width:15px;height:15px;line-height:13px;padding:0;font-size:10px;
                border:none;border-radius:2px;background:transparent;color:#b02b2b;cursor:pointer;opacity:.55;}
            .s7-insbox .s7-ins-del:hover{opacity:1;background:#f6dfe0;}
            .s7-insbox.pulse{border-color:#7a7a7a;background:#f6f6f6;}
            .s7-insbox.pulse .s7-en{border-right-color:#7a7a7a;background:#ececec;}
            .s7-insbox.pulse .s7-ins-name{color:#444;} .s7-insbox.pulse .s7-en .s7-en-lbl{color:#555;}
            .s7-insbox.comp{border-color:#2f7fb0;background:#f4fbff;}
            .s7-insbox.comp .s7-en{border-right-color:#2f7fb0;background:#e6f4fc;}
            .s7-insbox.comp .s7-ins-name{color:#1a5276;} .s7-insbox.comp .s7-en .s7-en-lbl{color:#1a5276;}
            .s7-insbox.move{border-color:#1f9d55;background:#f4fdf7;}
            .s7-insbox.move .s7-en{border-right-color:#1f9d55;background:#e6f7ec;}
            .s7-insbox.move .s7-ins-name{color:#0a6b3a;} .s7-insbox.move .s7-en .s7-en-lbl{color:#0a6b3a;}
            .s7-rawline{font-family:Consolas,monospace;font-size:12px;color:#8a2b2b;padding:1px 0;}
            .s7-chip.on{border-color:#1f9d55;background:#dff5e6;box-shadow:inset 0 0 0 1px #1f9d55;}
            .s7-chip.on .sym{color:#0a6b3a;} .s7-chip.on .op{color:#0a6b3a;}
            .s7-par{display:inline-flex;align-items:center;gap:6px;padding:4px 6px;border:1px dashed #8aa8c0;border-radius:4px;background:#f6faff;}
            .s7-par-inner{display:inline-flex;flex-direction:column;gap:4px;}
            .s7-branch{display:inline-flex;align-items:flex-start;gap:4px;}
            /* 支路内的增/删按钮与触点垂直居中对齐 */
            .s7-branch > .s7-mini,.s7-branch > .s7-add{align-self:center;}
            .s7-or{font-weight:bold;color:#2f6fb0;}
            .s7-add{color:#1f9d55;font-size:16px;line-height:1;border:1px dashed #9fb0c0;border-radius:3px;height:26px;min-width:24px;background:#fff;cursor:pointer;padding:0 4px;}
            .s7-mini{font-size:11px;padding:1px 6px;border:1px solid #b9c0c7;border-radius:3px;background:#f7f8f9;cursor:pointer;color:#4b5563;}
            .s7-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:30010;display:flex;align-items:center;justify-content:center;}
            .s7-modal{background:#fff;border-radius:5px;padding:16px;width:330px;box-shadow:0 8px 30px rgba(0,0,0,.4);font-size:13px;}
            .s7-modal label{display:block;font-size:12px;color:#4b5563;margin:8px 0 3px;}
            .s7-modal input,.s7-modal select{width:100%;box-sizing:border-box;padding:6px;border:1px solid #c3c9cf;border-radius:3px;}
            .s7-mon{margin-top:12px;border:1px solid #d7dce1;border-radius:4px;}
            .s7-mon-h{padding:6px 9px;background:#eef1f4;font-size:12px;font-weight:bold;color:#374151;border-bottom:1px solid #d7dce1;}
            .s7-mon-sec{padding:7px 9px;border-bottom:1px dashed #e2e7ec;}
            .s7-mon-sec b{display:block;font-size:11px;color:#6b7280;margin-bottom:4px;}
            .s7-mon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:3px;}
            .s7-bit{font-size:11px;font-family:Consolas,monospace;padding:2px 4px;border-radius:3px;background:#f3f5f7;color:#6b7280;text-align:center;}
            .s7-bit.on{background:#1f9d55;color:#fff;font-weight:bold;}
            .s7-word{font-size:11px;font-family:Consolas,monospace;padding:2px 4px;border-radius:3px;background:#f3f5f7;color:#1f3b57;text-align:center;}`;
        document.head.appendChild(style);

        this._root = root;
        this._win = win;
        this._makeDraggable(win, titlebar);
        this._bindEvents();
    }

    _makeDraggable(win, handle) {
        handle.style.cursor = 'move';
        let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
        handle.addEventListener('mousedown', (e) => {
            if (e.target && e.target.id === 's7-close') return;
            const r = win.getBoundingClientRect();
            win.style.position = 'fixed'; win.style.margin = '0';
            win.style.left = r.left + 'px'; win.style.top = r.top + 'px';
            dragging = true; startX = e.clientX; startY = e.clientY; origLeft = r.left; origTop = r.top;
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            let nl = origLeft + (e.clientX - startX), nt = origTop + (e.clientY - startY);
            nl = Math.max(-win.offsetWidth + 80, Math.min(window.innerWidth - 80, nl));
            nt = Math.max(0, Math.min(window.innerHeight - 40, nt));
            win.style.left = nl + 'px'; win.style.top = nt + 'px';
        });
        window.addEventListener('mouseup', () => { dragging = false; });
    }

    _bindEvents() {
        const q = (id) => this._root.querySelector('#' + id);
        q('s7-close').onclick = () => this.close();
        q('s7-scan').onclick = () => this._scanDevices(true);
        q('s7-connect').onclick = () => this._connectSelected();
        q('s7-disconnect').onclick = () => this._disconnect();
        q('s7-upload').onclick = () => this._upload();
        q('s7-download').onclick = () => this._download();
        q('s7-editor').onclick = () => { this._view = 'editor'; this._renderAll(); };
        q('s7-modules').onclick = () => { this._view = 'modules'; this._renderAll(); };
        q('s7-monitor').onclick = () => this._toggleMonitor();
        // 独立浮窗：不因点击遮罩/其它区域而关闭，仅标题栏 ✕ 关闭。
    }

    // ── 设备 ───────────────────────────────────────────────────
    _scanDevices(explicit) {
        this.devices = discoverPlcs(this.sys, this.pc);
        this._selectedId = this.devices.length ? this.devices[0].id : null;
        if (!this.connectedId) this._view = 'devices';
        if (explicit) this._renderAll();
    }
    _deviceById(id) { return this.devices.find(d => d.id === id) || null; }

    _connectSelected() {
        if (!this._selectedId) return;
        const dev = this._deviceById(this._selectedId);
        if (!dev) return;
        this.connectedId = dev.id;
        // 连接后不主动读取程序：清空编辑器，等待用户点「上传」
        this._ladder = { networks: [] };
        this._programLoaded = false;
        this._view = 'editor';
        this._renderAll();
        this._flashStatus('已连接。点击「上传」从 PLC 读取程序');
    }
    _disconnect() {
        this._stopMonitor();
        this.connectedId = null; this._view = 'devices'; this._monitoring = false;
        this._programLoaded = false;
        this._ladder = { networks: [] };
        this._renderAll();
    }
    _connectedDev() {
        if (!this.connectedId) return null;
        return this._deviceById(this.connectedId) || { id: this.connectedId, comp: this.sys.comps[this.connectedId] };
    }

    // ── 上传 / 下载 ────────────────────────────────────────────
    _loadLadderFromPlc(plc) {
        if (!plc) { this._ladder = { networks: [] }; this._programLoaded = false; return; }
        if (plc._ladderModel && Array.isArray(plc._ladderModel.networks)) {
            this._ladder = clone(plc._ladderModel);
        } else {
            const stl = (typeof plc.getProgram === 'function') ? plc.getProgram() : '';
            this._ladder = { networks: stlToLadder(stl) };   // 反编译（含并联，可编辑）
        }
        this._programLoaded = true;
    }

    _upload() {
        const conn = this._connectedDev();
        if (!conn || !conn.comp) return;
        this._loadLadderFromPlc(conn.comp);
        this._view = 'editor';
        this._renderAll();
        this._flashStatus('已从 PLC 上传程序（梯形图）');
    }

    _download() {
        const conn = this._connectedDev();
        if (!conn || !conn.comp) { this._flashStatus('未连接 PLC，无法下载'); return; }
        if (this._monitoring) { this._flashStatus('监控中不可下载，请先停止监控'); return; }
        const plc = conn.comp;
        const stl = ladderToStl(this._ladder.networks);
        try {
            plc._ladderModel = clone(this._ladder);
            if (typeof plc.setProgram === 'function') plc.setProgram(stl);
        } catch (e) { this._flashStatus('下载失败：' + e.message); return; }
        this._renderAll();
        this._flashStatus('程序已下载到 PLC 并运行');
    }

    // ── 渲染 ───────────────────────────────────────────────────
    _renderAll() { if (!this._root) return; this._renderTree(); this._renderMain(); this._renderStatus(); }

    _renderTree() {
        const el = this._root.querySelector('#s7-tree');
        const pcName = this.pc.hostname || this.pc.id;
        const conn = this._connectedDev();
        const comp = conn && conn.comp;
        let html = `<div style="font-weight:bold;color:#20527f;margin-bottom:6px;">项目树</div>`;
        html += `<div>📁 项目 — ${pcName}</div><div style="margin-left:14px;">👁 在线访问</div>`;
        if (!this.devices.length) html += `<div style="margin-left:28px;color:#9aa2aa;">（未发现设备）</div>`;
        for (const d of this.devices) {
            const on = d.id === this.connectedId;
            html += `<div style="margin-left:28px;color:${on ? '#1f9d55' : '#374151'};font-weight:${on ? 'bold' : 'normal'};">
                ${on ? '🟢' : '⚪'} ${d.label} <span style="color:#9aa2aa;">(${d.ip || '无IP'})</span></div>`;
            if (on && comp) {
                const info = (typeof comp.getExpansionInfo === 'function') ? comp.getExpansionInfo() : [];
                html += `<div style="margin-left:42px;">🧩 CPU ${comp.label || comp.id} [${comp.mode || ''}]</div>`;
                info.forEach(m => { html += `<div style="margin-left:56px;color:#0a5a5a;">槽 ${m.slot}：${m.model || m.id}</div>`; });
                if (!info.length) html += `<div style="margin-left:56px;color:#9aa2aa;">（无扩展模块）</div>`;
            }
        }
        const allPlcs = Object.values(this.sys.comps || {}).filter(c => c && c.type === 'plc_s7200');
        if (allPlcs.length) {
            html += `<div style="margin-top:10px;">📁 ${pcName} 的本地项目</div>`;
            allPlcs.forEach(p => { html += `<div style="margin-left:14px;color:#374151;">🧩 ${p.label || p.id}</div>`; });
        }
        el.innerHTML = html;
    }

    _renderMain() {
        const main = this._root.querySelector('#s7-main');
        if (this._view === 'editor') { main.innerHTML = this._editorHtml(); this._bindEditorEvents(); return; }
        if (this._view === 'modules') { main.innerHTML = this._modulesHtml(); return; }
        if (this._view === 'online' && this.connectedId) { main.innerHTML = this._onlineHtml(); return; }
        main.innerHTML = this._devicesHtml();
        this._bindDeviceEvents();
    }

    _devicesHtml() {
        let html = `<div style="font-size:16px;font-weight:bold;color:#20527f;margin-bottom:4px;">查找设备</div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">
            通过以太网网线搜索同一网段内的 PLC。直连时发现 1 台；经交换机时可发现多台，选中后点击「连接」。</div>`;
        if (!this.devices.length) {
            return html + `<div style="color:#b91c1c;padding:18px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;">
                未发现任何 PLC。请确认：① PC 网口已用网线连到 PLC 的以太网口（或经交换机）；② PLC 已配置 IP。</div>`;
        }
        html += `<div style="font-size:12px;color:#374151;margin-bottom:8px;">共发现 <b>${this.devices.length}</b> 台设备：</div>`;
        for (const d of this.devices) {
            const via = d.viaSwitch ? `<span class="s7-tag s7-sw">经交换机</span>` : `<span class="s7-tag s7-dir">直连</span>`;
            const sel = d.id === this._selectedId;
            html += `<div class="s7-row" style="${sel ? 'border-color:#2f6fb0;background:#eaf3fb;' : ''}">
                <input type="radio" name="s7-dev" ${sel ? 'checked' : ''} data-dev="${d.id}">
                <div style="flex:1;"><div style="font-weight:bold;">${d.label}</div>
                <div style="font-size:12px;color:#6b7280;">IP ${d.ip || '（未配置）'} / ${d.mask} · MAC ${d.mac}</div></div>${via}</div>`;
        }
        return html;
    }
    _bindDeviceEvents() {
        this._root.querySelectorAll('input[data-dev]').forEach(r => {
            r.onchange = () => { this._selectedId = r.dataset.dev; this._syncButtons(); this._renderMain(); this._renderTree(); };
        });
    }

    // ── 编辑器 ─────────────────────────────────────────────────
    _editorHtml() {
        const conn = this._connectedDev();
        const comp = conn && conn.comp;
        const locked = this._monitoring;
        const header = comp
            ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:7px 10px;background:#eaf3fb;border:1px solid #bcd7ee;border-radius:4px;font-size:13px;">
                  🟢 已连接 <b>${comp.label || comp.id}</b>（${comp.ip || '无IP'}） · 模式 ${comp.mode || ''}
                  <span style="margin-left:auto;color:#4b5563;">网络数：${this._ladder.networks.length}${locked ? ' · 🔒 监控中（只读）' : ''}</span></div>`
            : `<div style="padding:7px 10px;background:#fff7e6;border:1px solid #f0d9a8;border-radius:4px;font-size:13px;margin-bottom:10px;">未连接 PLC（可先「查找设备」→「连接」后再下载）</div>`;

        let nets = '';
        this._ladder.networks.forEach((net, i) => { nets += this._networkHtml(net, i, locked); });
        if (!this._ladder.networks.length) {
            nets = (comp && !this._programLoaded)
                ? `<div style="color:#b45309;padding:14px;background:#fff7e6;border:1px solid #f0d9a8;border-radius:4px;">尚未从 PLC 读取程序。点击工具栏「⬆ 上传」读取；或直接「＋ 新建网络」编写新程序。</div>`
                : `<div style="color:#6b7280;padding:14px;">暂无网络，点击下方「＋ 新建网络」添加。</div>`;
        }

        const bar = locked
            ? `<div style="font-size:12px;color:#b45309;background:#fff7e6;border:1px solid #f0d9a8;border-radius:4px;padding:6px 10px;margin-bottom:10px;">🔒 在线监控中，程序只读。停止监控后可编辑。</div>`
            : `<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">
                 <button class="s7-btn" id="s7-add-net">＋ 新建网络</button>
                 <button class="s7-btn" id="s7-build-check">编译检查</button>
                 <span style="margin-left:auto;font-size:12px;color:#1f9d55;">● 编辑中（可添加并联支路：网络内点「＋并联」）</span></div>`;

        // 连接后未主动读取程序的提示
        const notLoaded = (comp && !this._programLoaded)
            ? `<div style="font-size:12px;color:#b45309;background:#fff7e6;border:1px solid #f0d9a8;border-radius:4px;padding:6px 10px;margin-bottom:10px;">ℹ 已连接但尚未读取 PLC 程序：点击工具栏「⬆ 上传」读取。</div>`
            : '';

        const monPanel = this._monitoring ? `<div id="s7-mon-panel">${this._monitorPanelHtml(this._mon)}</div>` : '';
        return `${header}${notLoaded}${bar}<div id="s7-nets">${nets}</div>${monPanel}`;
    }

    _networkHtml(net, idx, locked) {
        if (net.raw && net.raw.length && (!net.elements || !net.elements.length)) {
            return this._advancedHtml(net, idx, locked);
        }
        const tools = locked ? '' : `<span style="margin-left:auto;">
                <button class="s7-mini" data-act="add-contact" data-net="${idx}">＋触点</button>
                <button class="s7-mini" data-act="add-parallel" data-net="${idx}">＋并联</button>
                <button class="s7-mini" data-act="add-coil" data-net="${idx}">＋线圈</button>
                <button class="s7-mini" data-act="add-timer" data-net="${idx}">＋定时器</button>
                <button class="s7-mini" data-act="add-counter" data-net="${idx}">＋计数器</button>
                <button class="s7-mini" data-act="add-ins" data-net="${idx}">＋指令</button>
                <button class="s7-mini" data-act="del-net" data-net="${idx}">删除网络</button></span>`;
        const body = this._renderSeries(net, idx, net.elements || [], '', locked)
            + (locked ? '' : `<button class="s7-add" data-act="add-contact" data-net="${idx}" title="在输出前加触点">＋</button>`);
        return `<div class="s7-net">
            <div class="s7-net-h">Network ${idx + 1}${tools}</div>
            <div class="s7-net-b">${body}</div></div>`;
    }

    /**
     * 渲染高级指令网络：把结构化指令条目渲染为 Micro/WIN 风格"指令框"。
     *  - 数据/算术/比较/转换/跳转等指令 → EN 使能端 + 指令名 + 操作数 方框（可点击编辑）；
     *  - 注释行不参与梯形图渲染（跳过）；
     *  - EN 使能条件（前导触点）可编辑、可增删、可加并联（至少保留 1 个触点）；
     *  - 工具栏提供「＋指令」；每个指令框右上角提供「✕」删除。
     *  监控态（locked）下全部只读。
     */
    _advancedHtml(net, idx, locked) {
        // EN 使能触点（前导布尔条件）—— 可编辑、可增删（至少保留 1 个）
        const en = Array.isArray(net.en) ? net.en : [];
        if (!en.length) en.push({ type: 'contact', op: 'SM0.0', nc: false });
        net.en = en;
        const enHtml = this._renderSeries(net, idx, en, 'en', locked);
        // 指令条目：优先 net.ins；兼容仅有 raw 的旧数据（注释条目跳过）
        let items = Array.isArray(net.ins) ? net.ins : null;
        if (!items) {
            items = (net.raw || []).map(l => {
                const t = String(l).trim();
                if (!t) return null;
                if (t.startsWith('//')) return null;
                const parts = t.split(/\s+/);
                const mnem = (parts[0] || '').toUpperCase();
                const ops = parts.slice(1).join(' ').split(',').map(s => s.trim()).filter(Boolean);
                return { mnem, ops, raw: t };
            }).filter(Boolean);
        }

        const boxes = items.map((it, i) => {
            if (it.comment !== undefined) return '';   // 注释不在梯形图中显示
            const mnem = String(it.mnem || '').toUpperCase();
            const spec = insSpec(mnem);
            const cls = spec ? spec.cat : 'math';
            const hasEN = spec ? spec.en : true;
            const label = spec ? spec.name : mnem;
            const operand = (it.ops || []).join(', ');
            const ops = operand ? `<div class="s7-ins-ops">${escapeHtml(operand)}</div>` : '';
            const enSel = hasEN
                ? `<div class="s7-en"><span class="s7-en-lbl">EN</span><span class="s7-en-pin">▸</span></div>`
                : '';
            const delBtn = locked ? ''
                : `<button class="s7-ins-del" data-act="del-ins" data-net="${idx}" data-ins="${i}" title="删除该指令">✕</button>`;
            const clickAttr = locked ? '' : `data-act="edit-ins" data-net="${idx}" data-ins="${i}"`;
            return `<div class="s7-insbox ${cls}${locked ? ' locked' : ''}" ${clickAttr}>
                ${enSel}
                <div class="s7-ins-body">
                    <div class="s7-ins-name">${escapeHtml(label)}</div>
                    ${ops}
                </div>${delBtn}</div>`;
        }).filter(Boolean).join('');

        // 与普通指令网络完全一致的工具栏（额外提供「＋指令」）
        const tools = locked ? '' : `<span style="margin-left:auto;">
                <button class="s7-mini" data-act="add-contact" data-net="${idx}">＋触点</button>
                <button class="s7-mini" data-act="add-parallel" data-net="${idx}">＋并联</button>
                <button class="s7-mini" data-act="add-coil" data-net="${idx}">＋线圈</button>
                <button class="s7-mini" data-act="add-timer" data-net="${idx}">＋定时器</button>
                <button class="s7-mini" data-act="add-counter" data-net="${idx}">＋计数器</button>
                <button class="s7-mini" data-act="add-ins" data-net="${idx}">＋指令</button>
                <button class="s7-mini" data-act="del-net" data-net="${idx}">删除网络</button></span>`;
        const title = locked ? '（高级指令，只读）' : '（高级指令）';
        return `<div class="s7-net">
            <div class="s7-net-h">Network ${idx + 1} <span style="color:#9aa2aa;">${title}</span>${tools}</div>
            <div class="s7-net-b">${enHtml}${boxes}</div></div>`;
    }

    /** 渲染一串串联元素（prefix 为空表示网络顶层） */
    _renderSeries(net, netIdx, nodes, prefix, locked) {
        let html = '';
        nodes.forEach((node, i) => {
            const path = prefix ? `${prefix}.c${i}` : `${i}`;
            if (node.type === 'parallel') html += this._parallelHtml(net, netIdx, node, path, locked);
            else html += this._elementHtml(node, netIdx, path, locked);
        });
        return html;
    }

    _parallelHtml(net, netIdx, node, path, locked) {
        let branches = '';
        node.branches.forEach((br, bi) => {
            let cells = this._renderSeries(net, netIdx, br, `${path}.b${bi}`, locked);
            if (!locked) cells += `<button class="s7-add" data-act="add-contact-branch" data-net="${netIdx}" data-path="${path}.b${bi}" title="该支路加触点">＋</button>`;
            const del = (!locked && node.branches.length > 1) ? `<button class="s7-mini" data-act="del-branch" data-net="${netIdx}" data-path="${path}.b${bi}" title="删除该支路">✕</button>` : '';
            branches += `<div class="s7-branch">${bi > 0 ? '<span class="s7-or">∥</span>' : '<span style="width:14px;"></span>'}${cells}${del}</div>`;
        });
        const addBr = locked ? '' : `<button class="s7-mini" data-act="add-branch" data-net="${netIdx}" data-path="${path}" title="增加并联支路">＋支路</button>`;
        return `<span class="s7-par"><span class="s7-par-inner">${branches}</span>${addBr}</span>`;
    }

    _elementHtml(e, netIdx, path, locked) {
        const lockCls = locked ? ' locked' : '';
        const d = `data-net="${netIdx}" data-path="${path}"`;
        if (e.type === 'contact') {
            const sym = e.nc ? '—|/|—' : '—| |—';
            return `<span class="s7-chip${lockCls}" data-act="edit-el" ${d} data-kind="contact" data-op="${e.op}" data-nc="${e.nc ? 1 : 0}"><span class="sym">${sym}</span><span class="op">${e.op}</span></span>`;
        }
        if (e.type === 'coil') {
            return `<span class="s7-chip${lockCls}" data-act="edit-el" ${d} data-kind="coil" data-op="${e.op}"><span class="sym">—( )—</span><span class="op">${e.op}</span></span>`;
        }
        if (e.type === 'timer') {
            return `<span class="s7-chip block${lockCls}" data-act="edit-el" ${d} data-kind="timer" data-op="${e.op}"><span class="sym">[${e.fn}]</span><span class="op">${e.op} · <span data-val>${e.pt}</span></span></span>`;
        }
        if (e.type === 'counter') {
            return `<span class="s7-chip block${lockCls}" data-act="edit-el" ${d} data-kind="counter" data-op="${e.op}"><span class="sym">[${e.fn}]</span><span class="op">${e.op} · <span data-val>${e.pv}</span></span></span>`;
        }
        return '';
    }

    // ── 路径解析 ───────────────────────────────────────────────
    _getParentArray(net, path) {
        const parts = String(path).split('.');
        // 首段索引：支持 "0" 或 "c0"（_renderSeries 的 prefix 会生成带 c 的前缀）
        const idxOf = (seg) => parseInt(String(seg).replace(/^[a-z]/i, ''), 10);
        // EN 条件路径：en.c0 / en.c1 …（net.en 独立于 net.elements）
        if (parts[0] === 'en') {
            if (!Array.isArray(net.en)) net.en = [];
            let arr = net.en, key = idxOf(parts[1]);
            for (let i = 2; i < parts.length; i++) {
                const node = arr[key];
                const p = parts[i];
                if (p[0] === 'b') { arr = node.branches; key = idxOf(p); }
                else if (p[0] === 'c') { arr = node; key = idxOf(p); }
            }
            return { arr, key };
        }
        let arr = net.elements, key = idxOf(parts[0]);
        for (let i = 1; i < parts.length; i++) {
            const node = arr[key];
            const p = parts[i];
            if (p[0] === 'b') { arr = node.branches; key = idxOf(p); }
            else if (p[0] === 'c') { arr = node; key = idxOf(p); }
        }
        return { arr, key };
    }
    _resolvePath(net, path) { const { arr, key } = this._getParentArray(net, path); return arr[key]; }
    _removeByPath(net, path) { const { arr, key } = this._getParentArray(net, path); if (arr && key >= 0) arr.splice(key, 1); }

    _indexBeforeOutput(net) {
        const els = net.elements;
        const oi = els.findIndex(e => e.type === 'coil' || e.type === 'timer' || e.type === 'counter');
        return oi < 0 ? els.length : oi;
    }

    // ── 编辑事件 ───────────────────────────────────────────────
    _bindEditorEvents() {
        const q = (id) => this._root.querySelector('#' + id);
        const addNet = q('s7-add-net');
        if (addNet) addNet.onclick = () => { this._ladder.networks.push({ comment: '', elements: [] }); this._renderMain(); };
        const chk = q('s7-build-check');
        if (chk) chk.onclick = () => this._compileCheck();

        // 监控中不可编辑
        if (this._monitoring) {
            this._root.querySelectorAll('[data-act="edit-el"]').forEach(ch => {
                ch.onclick = () => this._flashStatus('监控中程序只读，请先「停止监控」');
            });
            return;
        }

        this._root.querySelectorAll('button[data-act]').forEach(btn => {
            const act = btn.dataset.act;
            btn.onclick = (ev) => {
                ev.stopPropagation();
                this._handleAct(act, btn);
            };
        });
        this._root.querySelectorAll('[data-act="edit-el"]').forEach(chip => {
            chip.onclick = () => this._openElModal(parseInt(chip.dataset.net, 10), chip.dataset.path);
        });
        this._root.querySelectorAll('[data-act="edit-ins"]').forEach(box => {
            box.onclick = (ev) => {
                ev.stopPropagation();
                this._openInsModal(parseInt(box.dataset.net, 10), parseInt(box.dataset.ins, 10));
            };
        });
    }

    _handleAct(act, btn) {
        const path = btn.dataset.path;

        // ── 支路级操作（data-net + data-path）──
        if (act === 'add-branch' || act === 'add-contact-branch' || act === 'del-branch') {
            const bi = parseInt(btn.dataset.net, 10);
            const net = (bi >= 0) ? this._ladder.networks[bi] : null;
            if (!net) return;
            if (act === 'add-branch') {
                const node = this._resolvePath(net, path);
                if (node && node.type === 'parallel') { node.branches.push([{ type: 'contact', op: 'I0.0', nc: false }]); this._renderMain(); }
            } else if (act === 'add-contact-branch') {
                const { arr, key } = this._getParentArray(net, path);
                const branch = arr[key];
                if (Array.isArray(branch)) { branch.push({ type: 'contact', op: 'I0.0', nc: false }); this._renderMain(); }
            } else if (act === 'del-branch') {
                const { arr, key } = this._getParentArray(net, path);
                if (Array.isArray(arr) && arr.length > 1) { arr.splice(key, 1); this._renderMain(); }
            }
            return;
        }

        // ── 网络级操作（data-net）──
        const ni = btn.dataset.net !== undefined ? parseInt(btn.dataset.net, 10) : -1;
        const net = ni >= 0 ? this._ladder.networks[ni] : null;
        if (act === 'del-net') { this._ladder.networks.splice(ni, 1); this._renderMain(); return; }
        if (!net) return;

        const isAdv = !!(net.raw && net.raw.length);

        // ── ＋指令：高级网络追加一条；普通（含新建）网络先转换为高级网络 ──
        if (act === 'add-ins') {
            if (!isAdv) {
                // 普通网络 → 高级网络：把已有元件序列（触点/并联）迁移为 EN 使能条件，
                // 末尾的线圈/定时器/计数器转为对应输出指令（= / TON / CTU）
                const els = Array.isArray(net.elements) ? net.elements : [];
                const en = [];
                const ins = [];
                els.forEach(el => {
                    if (el.type === 'contact' || el.type === 'parallel') en.push(el);
                    else if (el.type === 'coil') ins.push({ mnem: '=', ops: [el.op], raw: `= ${el.op}` });
                    else if (el.type === 'timer') ins.push({ mnem: el.fn || 'TON', ops: [el.op, String(el.pt)], raw: `${el.fn || 'TON'} ${el.op}, ${el.pt}` });
                    else if (el.type === 'counter') ins.push({ mnem: el.fn || 'CTU', ops: [el.op, String(el.pv)], raw: `${el.fn || 'CTU'} ${el.op}, ${el.pv}` });
                });
                net.elements = [];
                net.en = en.length ? en : [{ type: 'contact', op: 'SM0.0', nc: false }];
                net.ins = ins;
                net.advanced = true;
            }
            if (!Array.isArray(net.ins)) net.ins = [];
            // 追加一条默认指令（刚转换/已高级网络均适用）
            net.ins.push({ mnem: 'MOV_W', ops: ['VW0', 'AQW0'], raw: 'MOV_W VW0, AQW0' });
            // 重建 raw（供 advanced 判定与下载回写；注释条目保留原文）
            net.raw = net.ins.map(it => it.comment !== undefined ? it.comment : it.raw);
            this._renderMain();
            return;
        }
        if (act === 'del-ins') {
            const ii = parseInt(btn.dataset.ins, 10);
            if (Array.isArray(net.ins) && ii >= 0) { net.ins.splice(ii, 1); this._renderMain(); }
            return;
        }

        // ── ＋触点 / ＋并联：高级网络改 EN 条件；普通网络插入元件序列 ──
        if (act === 'add-contact' || act === 'add-parallel') {
            if (isAdv) {
                if (!Array.isArray(net.en)) net.en = [];
                if (act === 'add-contact') net.en.push({ type: 'contact', op: 'I0.0', nc: false });
                else net.en.push({ type: 'parallel', branches: [
                    [{ type: 'contact', op: 'I0.0', nc: false }],
                    [{ type: 'contact', op: 'I0.0', nc: false }],
                ] });
            } else {
                const at = this._indexBeforeOutput(net);
                const el = (act === 'add-contact')
                    ? { type: 'contact', op: 'I0.0', nc: false }
                    : { type: 'parallel', branches: [
                        [{ type: 'contact', op: 'I0.0', nc: false }],
                        [{ type: 'contact', op: 'I0.0', nc: false }],
                    ] };
                net.elements.splice(at, 0, el);
            }
            this._renderMain();
            return;
        }

        // ── ＋线圈 / ＋定时器 / ＋计数器 ──
        if (act === 'add-coil' || act === 'add-timer' || act === 'add-counter') {
            if (isAdv) {
                // 高级网络 → 普通网络：删掉全部高级指令，把 EN 使能条件还原为触点序列，
                // 再按普通梯形图添加线圈 / 定时器 / 计数器（"+线圈"就得到真正的线圈）
                const en = (Array.isArray(net.en) && net.en.length) ? net.en.slice() : [{ type: 'contact', op: 'SM0.0', nc: false }];
                net.ins = [];
                net.raw = [];
                net.advanced = false;
                net.elements = en;
            }
            const at = this._indexBeforeOutput(net);
            const el = (act === 'add-coil') ? { type: 'coil', op: 'Q0.0' }
                : (act === 'add-timer') ? { type: 'timer', fn: 'TON', op: 'T37', pt: 100 }
                : { type: 'counter', fn: 'CTU', op: 'C0', pv: 5 };
            (net.elements || (net.elements = [])).splice(at, 0, el);
            this._renderMain();
            return;
        }
    }

    _openElModal(netIdx, path) {
        const net = (netIdx >= 0) ? this._ladder.networks[netIdx] : null;
        if (!net) return;
        let e = null;
        try { e = this._resolvePath(net, path); } catch (err) { /* ignore */ }
        if (!e) return;
        this._closeElModal();

        const bg = document.createElement('div');
        bg.className = 's7-modal-bg';
        let fields = '';
        if (e.type === 'contact') {
            fields = `<label>触点类型</label>
                <select id="m-nc"><option value="0"${!e.nc ? ' selected' : ''}>常开 ┤ ├</option><option value="1"${e.nc ? ' selected' : ''}>常闭 ┤/├</option></select>
                <label>操作数（I0.0 / Q0.0 / M0.0 / SM0.5 / T37 / C0）</label><input id="m-op" value="${e.op}">`;
        } else if (e.type === 'coil') {
            fields = `<label>操作数（Q0.0 / M0.0）</label><input id="m-op" value="${e.op}">`;
        } else if (e.type === 'timer') {
            fields = `<label>功能</label><select id="m-fn">${['TON', 'TOF', 'TONR'].map(f => `<option${e.fn === f ? ' selected' : ''}>${f}</option>`).join('')}</select>
                <label>定时器编号（T37…）</label><input id="m-op" value="${e.op}">
                <label>预置值 PT</label><input id="m-pt" value="${e.pt}">`;
        } else if (e.type === 'counter') {
            fields = `<label>功能</label><select id="m-fn">${['CTU', 'CTD'].map(f => `<option${e.fn === f ? ' selected' : ''}>${f}</option>`).join('')}</select>
                <label>计数器编号（C0…）</label><input id="m-op" value="${e.op}">
                <label>预置值 PV</label><input id="m-pv" value="${e.pv}">`;
        }
        bg.innerHTML = `<div class="s7-modal">
            <div style="font-weight:bold;color:#20527f;margin-bottom:6px;">编辑元件</div>${fields}
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
                <button class="s7-btn" id="m-del">删除</button>
                <button class="s7-btn" id="m-cancel">取消</button>
                <button class="s7-btn" id="m-ok" style="background:#2f6fb0;color:#fff;border-color:#2f6fb0;">确定</button>
            </div></div>`;
        document.body.appendChild(bg);
        this._elModal = bg;

        const val = (id) => { const el = bg.querySelector('#' + id); return el ? el.value : ''; };
        const isEnPath = String(path).split('.')[0] === 'en';
        bg.querySelector('#m-cancel').onclick = () => this._closeElModal();
        bg.querySelector('#m-del').onclick = () => {
            this._removeByPath(net, path);
            // EN 条件删空后自动补一个 SM0.0（保证网络有使能条件）
            if (isEnPath && Array.isArray(net.en) && !net.en.length) {
                net.en.push({ type: 'contact', op: 'SM0.0', nc: false });
            }
            this._closeElModal();
            this._renderMain();
        };
        bg.querySelector('#m-ok').onclick = () => {
            if (e.type === 'contact') { e.nc = val('m-nc') === '1'; e.op = val('m-op').trim() || e.op; }
            else if (e.type === 'coil') { e.op = val('m-op').trim() || e.op; }
            else if (e.type === 'timer') { e.fn = val('m-fn'); e.op = val('m-op').trim() || e.op; e.pt = val('m-pt').trim() || e.pt; }
            else if (e.type === 'counter') { e.fn = val('m-fn'); e.op = val('m-op').trim() || e.op; e.pv = val('m-pv').trim() || e.pv; }
            this._closeElModal(); this._renderMain();
        };
        bg.addEventListener('mousedown', (ev) => { if (ev.target === bg) this._closeElModal(); });
    }

    _closeElModal() {
        if (this._elModal && this._elModal.parentNode) this._elModal.parentNode.removeChild(this._elModal);
        this._elModal = null;
    }

    /**
     * 高级指令编辑对话框：下拉选择指令（仅列求解器支持的指令）+ 按指令规格动态生成操作数输入。
     * 确定后写回 net.ins[i]；删除则移除该条目。
     */
    _openInsModal(netIdx, insIdx) {
        const net = (netIdx >= 0) ? this._ladder.networks[netIdx] : null;
        if (!net || !Array.isArray(net.ins)) return;
        const it = net.ins[insIdx];
        if (!it || it.comment !== undefined) return;
        this._closeElModal();

        // 按分类分组的下拉选项
        const catName = { move: '传送', math: '算术 / 逻辑 / 移位 / 转换', comp: '比较', pulse: '边沿 / 跳转' };
        const groups = {};
        Object.keys(ADV_SPEC).forEach(m => {
            const c = ADV_SPEC[m].cat;
            (groups[c] = groups[c] || []).push(m);
        });
        const optHtml = Object.keys(groups).map(c =>
            `<optgroup label="${catName[c] || c}">${groups[c].map(m =>
                `<option value="${m}"${m === it.mnem ? ' selected' : ''}>${ADV_SPEC[m].name}</option>`).join('')}</optgroup>`
        ).join('');

        const bg = document.createElement('div');
        bg.className = 's7-modal-bg';
        bg.innerHTML = `<div class="s7-modal" style="width:360px;">
            <div style="font-weight:bold;color:#20527f;margin-bottom:6px;">编辑高级指令</div>
            <label>指令</label><select id="i-mnem">${optHtml}</select>
            <div id="i-ops"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
                <button class="s7-btn" id="i-del">删除</button>
                <button class="s7-btn" id="i-cancel">取消</button>
                <button class="s7-btn" id="i-ok" style="background:#2f6fb0;color:#fff;border-color:#2f6fb0;">确定</button>
            </div></div>`;
        document.body.appendChild(bg);
        this._elModal = bg;

        const opsBox = bg.querySelector('#i-ops');
        const mnemSel = bg.querySelector('#i-mnem');
        // 按当前指令规格渲染操作数输入框（保留 it.ops 已有值）
        const renderOps = (mnem, curOps) => {
            const spec = insSpec(mnem) || { ops: [] };
            opsBox.innerHTML = spec.ops.map((o, k) => {
                const v = (curOps && curOps[k] !== undefined) ? curOps[k] : '';
                return `<label>${o.label}</label>
                    <input id="i-op${k}" value="${escapeHtml(v)}" placeholder="${escapeHtml(o.ph || '')}">`;
            }).join('');
        };
        renderOps(it.mnem, it.ops);
        // 切换指令时重渲染操作数（尽量保留原值）
        mnemSel.onchange = () => {
            const keep = (it.ops || []).slice();
            renderOps(mnemSel.value, keep);
        };

        bg.querySelector('#i-cancel').onclick = () => this._closeElModal();
        bg.querySelector('#i-del').onclick = () => { net.ins.splice(insIdx, 1); this._closeElModal(); this._renderMain(); };
        bg.querySelector('#i-ok').onclick = () => {
            const mnem = mnemSel.value;
            const spec = insSpec(mnem) || { ops: [] };
            const ops = spec.ops.map((o, k) => {
                const el = bg.querySelector('#i-op' + k);
                return el ? el.value.trim() : '';
            });
            it.mnem = mnem;
            it.ops = ops;
            it.raw = `${mnem} ${insOpsToString(spec, ops)}`.trim();
            this._closeElModal();
            this._renderMain();
        };
        bg.addEventListener('mousedown', (ev) => { if (ev.target === bg) this._closeElModal(); });
    }

    /**
     * 编译检查：校验各网络的完整性。
     *  - 可编辑网络：需有输出（线圈/定时器/计数器）；
     *  - 高级指令网络：助记符须在 ADV_SPEC 内、操作数个数须匹配规格、操作数非空。
     * @returns {{ok:boolean, errors:string[]}}
     */
    _compileCheck() {
        const errors = [];
        (this._ladder.networks || []).forEach((net, i) => {
            const tag = `Network ${i + 1}`;
            if (net.raw && net.raw.length) {
                const items = Array.isArray(net.ins) ? net.ins : [];
                items.forEach(it => {
                    if (it.comment !== undefined) return;
                    const mnem = String(it.mnem || '').toUpperCase();
                    const spec = insSpec(mnem);
                    if (!spec) { errors.push(`${tag}：不支持的指令 ${mnem}`); return; }
                    const ops = (it.ops || []).filter(s => String(s).trim() !== '');
                    const need = spec.ops.filter(o => !/可空/.test(o.label)).length;
                    if (ops.length < need) errors.push(`${tag}：${mnem} 操作数不足（需 ${need} 个）`);
                    const extra = (it.ops || []).length - spec.ops.length;
                    if (extra > 0) errors.push(`${tag}：${mnem} 操作数过多（最多 ${spec.ops.length} 个）`);
                });
            } else {
                const els = net.elements || [];
                const hasOut = els.some(e => e.type === 'coil' || e.type === 'timer' || e.type === 'counter');
                const hasSeries = els.some(e => e.type === 'contact' || e.type === 'parallel');
                if (!hasSeries && !hasOut) errors.push(`${tag}：空网络`);
                else if (!hasOut) errors.push(`${tag}：缺少输出（线圈/定时器/计数器）`);
            }
        });

        if (errors.length) {
            this._flashStatus(`编译失败：${errors.length} 处问题 —— ` + errors.slice(0, 3).join('；') + (errors.length > 3 ? ' …' : ''));
        } else {
            this._flashStatus(`编译通过：${this._ladder.networks.length} 个网络，无错误`);
        }
        console.log('[Step7UI] 编译检查:\n' + (errors.length ? errors.join('\n') : '无错误'));
        return { ok: errors.length === 0, errors };
    }

    _startMonitor() { this._stopMonitor(); this._monTimer = setInterval(() => this._pollMonitor(), 150); this._pollMonitor(); }
    _stopMonitor() { if (this._monTimer) clearInterval(this._monTimer); this._monTimer = null; }

    _pollMonitor() {
        if (!this._monitoring || !this._root || this._root.style.display === 'none') return;
        const solver = this.sys.s7200Solver;
        const mon = solver && solver.getMonitor ? solver.getMonitor(this.connectedId) : null;
        if (!mon) return;
        this._mon = mon;

        this._root.querySelectorAll('#s7-nets .s7-chip[data-kind]').forEach(chip => {
            const kind = chip.dataset.kind, op = chip.dataset.op;
            let on = false;
            if (kind === 'contact') { const b = readBit(mon, op); on = (chip.dataset.nc === '1') ? !b : b; }
            else if (kind === 'coil') on = readBit(mon, op);
            else if (kind === 'timer') on = !!readTimer(mon, op).bit;
            else if (kind === 'counter') on = !!readCounter(mon, op).bit;
            chip.classList.toggle('on', on);
            const vs = chip.querySelector('[data-val]');
            if (vs) {
                if (kind === 'timer') { const t = readTimer(mon, op); vs.textContent = `${t.cur}/${t.bit ? '1' : '0'}`; }
                else if (kind === 'counter') { const c = readCounter(mon, op); vs.textContent = `${c.cur}/${c.bit ? '1' : '0'}`; }
            }
        });
        const panel = this._root.querySelector('#s7-mon-panel');
        if (panel) panel.innerHTML = this._monitorPanelHtml(mon);
        const scanEl = this._root.querySelector('#s7-scan-count');
        if (scanEl) scanEl.textContent = mon.scanCount;
    }

    _monitorPanelHtml(mon) {
        if (!mon) return '';
        const bitGrid = (arr, prefix, bytes) => {
            let h = '';
            for (let by = 0; by < bytes; by++) for (let b = 0; b < 8; b++) {
                const idx = by * 8 + b, on = !!(arr && arr[idx]);
                h += `<span class="s7-bit${on ? ' on' : ''}">${prefix}${by}.${b}</span>`;
            }
            return h;
        };
        // 数组按"地址数字"索引：AIW0/AIW2/…/AIW30
        const wordGrid = (arr, prefix, maxAddr) => {
            let h = '';
            for (let a = 0; a <= maxAddr; a += 2) h += `<span class="s7-word">${prefix}${a}: ${arr && arr[a] !== undefined ? arr[a] : 0}</span>`;
            return h;
        };
        const tcGrid = (list, prefix) => {
            let h = '';
            for (const n of list) {
                const it = (prefix === 'T' ? mon.T[n] : mon.C[n]) || { cur: 0, bit: false };
                h += `<span class="s7-bit${it.bit ? ' on' : ''}">${prefix}${n}:${it.cur}</span>`;
            }
            return h;
        };
        const vwGrid = (from, to) => { let h = ''; for (let n = from; n <= to; n += 2) h += `<span class="s7-word">VW${n}: ${vwOf(mon, n)}</span>`; return h; };
        const sec = (t, inner) => `<div class="s7-mon-sec"><b>${t}</b><div class="s7-mon-grid">${inner}</div></div>`;
        return `<div class="s7-mon">
            <div class="s7-mon-h">在线监控表　扫描：<span id="s7-scan-count">${mon.scanCount}</span>　模式：${mon.mode}</div>
            ${sec('数字量输入 I（含扩展 I3.x…）', bitGrid(mon.I, 'I', 8))}
            ${sec('数字量输出 Q（含扩展 Q2.x…）', bitGrid(mon.Q, 'Q', 8))}
            ${sec('位存储 M', bitGrid(mon.M, 'M', 2))}
            ${sec('特殊存储 SM', bitGrid(mon.SM, 'SM', 1))}
            ${sec('模拟量输入 AIW0~AIW30', wordGrid(mon.AIW, 'AIW', 30))}
            ${sec('模拟量输出 AQW0~AQW30', wordGrid(mon.AQW, 'AQW', 30))}
            ${sec('定时器 T32~T47', tcGrid([32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47], 'T'))}
            ${sec('计数器 C0~C15', tcGrid([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], 'C'))}
            ${sec('变量存储 VW0~VW30', vwGrid(0, 30))}
        </div>`;
    }

    _toggleMonitor() {
        if (!this.connectedId) { this._flashStatus('未连接 PLC，无法监控'); return; }
        this._monitoring = !this._monitoring;
        this._view = 'editor';
        this._renderAll();
        if (this._monitoring) { this._startMonitor(); this._flashStatus('已进入在线监控（程序只读）'); }
        else { this._stopMonitor(); this._flashStatus('已退出在线监控'); }
    }

    // ── 在线信息 / 模块信息 ────────────────────────────────────
    _onlineHtml() {
        const conn = this._connectedDev(); const comp = conn && conn.comp;
        if (!comp) return `<div style="color:#b91c1c;">设备不存在。</div>`;
        const info = (typeof comp.getExpansionInfo === 'function') ? comp.getExpansionInfo() : [];
        let html = `<div style="font-size:16px;font-weight:bold;color:#1f9d55;margin-bottom:10px;">🟢 已连接：${comp.label || comp.id}</div>
            <table class="s7-tbl"><tr><th style="width:150px;">IP 地址</th><td>${comp.ip || ''}</td></tr>
            <tr><th>运行模式</th><td>${comp.mode || 'STOP'}</td></tr>
            <tr><th>扫描次数</th><td>${typeof comp.getScanCount === 'function' ? comp.getScanCount() : 0}</td></tr></table>`;
        html += `<div style="font-size:14px;font-weight:bold;color:#20527f;margin:14px 0 6px;">扩展模块</div>`;
        if (!info.length) html += `<div style="color:#6b7280;">未挂接扩展模块。</div>`;
        else {
            html += `<table class="s7-tbl"><tr><th>槽位</th><th>型号</th><th>通道地址</th></tr>`;
            info.forEach(m => html += `<tr><td>${m.slot}</td><td>${m.model || m.id}</td><td>${(m.channels || []).map(c => c.addr).join('、') || '—'}</td></tr>`);
            html += `</table>`;
        }
        return html;
    }

    _modulesHtml() {
        const allPlcs = Object.values(this.sys.comps || {}).filter(c => c && c.type === 'plc_s7200');
        let html = `<div style="font-size:16px;font-weight:bold;color:#20527f;margin-bottom:12px;">模块信息（机架/槽位）</div>`;
        if (!allPlcs.length) return html + `<div style="color:#6b7280;">系统中没有 PLC。</div>`;
        allPlcs.forEach(p => {
            const info = (typeof p.getExpansionInfo === 'function') ? p.getExpansionInfo() : [];
            const online = p.id === this.connectedId;
            html += `<div style="margin-bottom:14px;border:1px solid #d7dce1;border-radius:4px;overflow:hidden;">
                <div style="background:#eef1f4;padding:7px 10px;font-weight:bold;">${online ? '🟢' : '⚪'} ${p.hostname || p.label || p.id}（${p.ip || '无IP'}）</div>
                <table class="s7-tbl"><tr><th style="width:70px;">槽位</th><th>模块</th><th>通道地址</th></tr>
                <tr><td>CPU</td><td>${p.label || 'CPU'}</td><td>DI/DO 本体</td></tr>`;
            info.forEach(m => html += `<tr><td>${m.slot}</td><td>${m.model || m.id}</td><td>${(m.channels || []).map(c => c.addr).join('、') || '—'}</td></tr>`);
            if (!info.length) html += `<tr><td colspan="3" style="color:#9aa2aa;">（无扩展模块）</td></tr>`;
            html += `</table></div>`;
        });
        return html;
    }

    // ── 状态 / 按钮 ────────────────────────────────────────────
    _renderStatus() {
        const el = this._root.querySelector('#s7-status');
        const hint = this._root.querySelector('#s7-hint');
        const connected = !!this.connectedId;
        if (hint) hint.textContent = connected ? `已连接：${this._connectedDev()?.label || this.connectedId}` : `发现 ${this.devices.length} 台设备`;
        el.textContent = connected ? `在线 · ${this._connectedDev()?.ip || ''} · ${this._monitoring ? '监控中（只读）' : '就绪'}` : `离线 · 未连接任何 PLC`;
        this._syncButtons();
    }

    _syncButtons() {
        const q = (id) => this._root.querySelector('#' + id);
        q('s7-connect').disabled = !this._selectedId || this.connectedId === this._selectedId;
        q('s7-disconnect').disabled = !this.connectedId;
        const on = !!this.connectedId;
        q('s7-upload').disabled = !on;
        q('s7-download').disabled = !on || this._monitoring;
        const monBtn = q('s7-monitor');
        monBtn.disabled = !on;
        monBtn.textContent = this._monitoring ? '⏹ 停止监控' : '👁 监控';
    }

    _flashStatus(msg) {
        const el = this._root.querySelector('#s7-status');
        if (!el) return;
        const old = el.textContent; el.textContent = msg;
        setTimeout(() => { if (el.textContent === msg) el.textContent = old; }, 2400);
    }
}

export default Step7UI;
