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
        if (net.raw && net.raw.length) { net.raw.forEach(l => out.push(l)); out.push(''); return; }
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

    for (let rawLine of String(stl || '').split(/\r?\n/)) {
        const commentPart = (rawLine.match(/\/\/(.*)$/) || [])[1];
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (commentPart !== undefined && !line) { pendingComment = commentPart.trim(); continue; }
        if (!line) continue;

        const parts = line.split(/\s+/);
        const mnem = parts[0].toUpperCase();
        const args = parts.slice(1).join(' ').split(',').map(s => s.trim()).filter(Boolean);

        if (mnem === 'END') { flush(); break; }
        if (mnem === 'NOP') continue;

        linesBuf.push(line);
        if (mnem === 'LD' || mnem === 'LDN') { stack.push(cur); cur = leaf(args[0] || 'I0.0', mnem === 'LDN'); }
        else if (mnem === 'A' || mnem === 'AN') { cur = cur ? { t: 'and', c: [cur, leaf(args[0] || 'I0.0', mnem === 'AN')] } : leaf(args[0] || 'I0.0', mnem === 'AN'); }
        else if (mnem === 'O' || mnem === 'ON') { cur = cur ? { t: 'or', c: [cur, leaf(args[0] || 'I0.0', mnem === 'ON')] } : leaf(args[0] || 'I0.0', mnem === 'ON'); }
        else if (mnem === 'ALD') { const prev = stack.pop(); cur = prev ? { t: 'and', c: [prev, cur] } : cur; }
        else if (mnem === 'OLD') { const prev = stack.pop(); cur = prev ? { t: 'or', c: [prev, cur] } : cur; }
        else if (mnem === '=') { output = { type: 'coil', op: args[0] || 'Q0.0' }; flush(); }
        else if (mnem === 'TON' || mnem === 'TOF' || mnem === 'TONR') { output = { type: 'timer', fn: mnem, op: args[0] || 'T37', pt: args[1] || '100' }; flush(); }
        else if (mnem === 'CTU' || mnem === 'CTD' || mnem === 'CTUD') { output = { type: 'counter', fn: mnem, op: args[0] || 'C0', pv: args[1] || '5' }; flush(); }
        else { unsupported = true; }
    }
    flush();
    return networks;
}

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
            const lines = net.raw.map(l => `<div style="font-family:Consolas,monospace;font-size:12px;color:#8a2b2b;">${l}</div>`).join('');
            return `<div class="s7-net">
                <div class="s7-net-h">Network ${idx + 1} <span style="color:#9aa2aa;">（高级指令，只读）</span>
                    ${locked ? '' : `<span style="margin-left:auto;"><button class="s7-mini" data-act="del-net" data-net="${idx}">删除</button></span>`}</div>
                <div class="s7-net-b"><div class="s7-chip raw">${lines}</div></div></div>`;
        }
        const tools = locked ? '' : `<span style="margin-left:auto;">
                <button class="s7-mini" data-act="add-contact" data-net="${idx}">＋触点</button>
                <button class="s7-mini" data-act="add-parallel" data-net="${idx}">＋并联</button>
                <button class="s7-mini" data-act="add-coil" data-net="${idx}">＋线圈</button>
                <button class="s7-mini" data-act="add-timer" data-net="${idx}">＋定时器</button>
                <button class="s7-mini" data-act="add-counter" data-net="${idx}">＋计数器</button>
                <button class="s7-mini" data-act="del-net" data-net="${idx}">删除网络</button></span>`;
        const body = this._renderSeries(net, idx, net.elements || [], '', locked)
            + (locked ? '' : `<button class="s7-add" data-act="add-contact" data-net="${idx}" title="在输出前加触点">＋</button>`);
        return `<div class="s7-net">
            <div class="s7-net-h">Network ${idx + 1}${tools}</div>
            <div class="s7-net-b">${body}</div></div>`;
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
        let arr = net.elements, key = parseInt(parts[0], 10);
        for (let i = 1; i < parts.length; i++) {
            const node = arr[key];
            const p = parts[i];
            if (p[0] === 'b') { arr = node.branches; key = parseInt(p.slice(1), 10); }
            else if (p[0] === 'c') { arr = node; key = parseInt(p.slice(1), 10); }
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
        if (chk) chk.onclick = () => { this._flashStatus('编译通过：' + this._ladder.networks.length + ' 个网络'); };

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

        if (act === 'add-contact' || act === 'add-coil' || act === 'add-timer' || act === 'add-counter' || act === 'add-parallel') {
            const at = this._indexBeforeOutput(net);
            let el = null;
            if (act === 'add-contact') el = { type: 'contact', op: 'I0.0', nc: false };
            else if (act === 'add-coil') el = { type: 'coil', op: 'Q0.0' };
            else if (act === 'add-timer') el = { type: 'timer', fn: 'TON', op: 'T37', pt: 100 };
            else if (act === 'add-counter') el = { type: 'counter', fn: 'CTU', op: 'C0', pv: 5 };
            else if (act === 'add-parallel') el = { type: 'parallel', branches: [
                [{ type: 'contact', op: 'I0.0', nc: false }],
                [{ type: 'contact', op: 'I0.0', nc: false }],
            ] };
            net.elements.splice(at, 0, el);
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
        bg.querySelector('#m-cancel').onclick = () => this._closeElModal();
        bg.querySelector('#m-del').onclick = () => { this._removeByPath(net, path); this._closeElModal(); this._renderMain(); };
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

    // ── 在线监控 ───────────────────────────────────────────────
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
                <tr><td>CPU</td><td>SR40</td><td>DI/DO 本体</td></tr>`;
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
