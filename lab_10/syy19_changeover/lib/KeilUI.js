/**
 * KeilUI.js — 8051 上位机（Keil µVision 风格）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  功能：C 语言编辑 → 编译（内置 C 子集编译器）→ 下载到仿真 8051 →
 *        开始/停止调试、单步 / 步过 / 运行 / 复位 / 断点、
 *        寄存器与 SFR 面板、变量监视 Watch、内部 RAM 视图、
 *        反汇编视图、串口监视、虚拟目标板（LED/按键）。
 *
 *  打开方式：画布上的“上位机”组件（components/MCS51PC.js）双击 / 右键菜单。
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { compileC } from './C51Compiler.js';

const DEFAULT_SOURCE = `#include <reg51.h>

/* 8051 开关板演示：LCD1602 + 4×4 矩阵键盘 四则运算计算器
   LCD：数据 P0.0~P0.7，RS=P2.0，E=P2.1
   键盘：行 P1.0~P1.3，列 P1.4~P1.7 */
sbit RS = P2^0;
sbit E  = P2^1;

long cur;
long acc;
long g_result;
unsigned char op;
unsigned char lastK;
unsigned char fresh;

void delay(unsigned int t) { while (t--); }

void lcdCmd(unsigned char c) { P0 = c; RS = 0; E = 1; delay(2); E = 0; delay(2); }
void lcdData(unsigned char c) { P0 = c; RS = 1; E = 1; delay(2); E = 0; delay(2); }
void lcdInit() { lcdCmd(0x38); lcdCmd(0x0C); lcdCmd(0x06); lcdCmd(0x01); delay(100); }
void lcdGoto(unsigned char a) { lcdCmd(0x80 | a); }

void putLong(long v) {
    unsigned char buf[10];
    unsigned char n;
    if (v < 0) { lcdData('-'); v = -v; }
    n = 0;
    if (v == 0) { lcdData('0'); return; }
    while (v > 0) { buf[n] = '0' + (unsigned char)(v % 10); n = n + 1; v = v / 10; }
    while (n > 0) { n = n - 1; lcdData(buf[n]); }
}

unsigned char scanKey() {
    unsigned char rm[4];
    unsigned char r;
    unsigned char v;
    rm[0] = 0x0E; rm[1] = 0x0D; rm[2] = 0x0B; rm[3] = 0x07;
    for (r = 0; r < 4; r = r + 1) {
        P1 = 0xF0 | rm[r];
        delay(2);
        v = P1 & 0xF0;
        if ((v & 0x10) == 0) return r * 4 + 1;
        if ((v & 0x20) == 0) return r * 4 + 2;
        if ((v & 0x40) == 0) return r * 4 + 3;
        if ((v & 0x80) == 0) return r * 4 + 4;
    }
    return 0;
}

unsigned char keyOf(unsigned char k) {
    if (k == 1) return '7'; if (k == 2) return '8'; if (k == 3) return '9'; if (k == 4) return '+';
    if (k == 5) return '4'; if (k == 6) return '5'; if (k == 7) return '6'; if (k == 8) return '-';
    if (k == 9) return '1'; if (k == 10) return '2'; if (k == 11) return '3'; if (k == 12) return '*';
    if (k == 13) return '0'; if (k == 14) return '/'; if (k == 15) return '='; if (k == 16) return 'C';
    return 0;
}

void showCur() {
    lcdGoto(0x40);
    lcdData(' '); lcdData(' '); lcdData(' '); lcdData(' ');
    lcdGoto(0x40);
    putLong(cur);
}

void main() {
    unsigned char k, ch;
    lcdInit();
    lcdGoto(0x00);
    lcdData('8'); lcdData('0'); lcdData('5'); lcdData('1'); lcdData(' ');
    lcdData('C'); lcdData('a'); lcdData('l'); lcdData('c');
    cur = 0; acc = 0; op = 0; lastK = 0; g_result = 0; fresh = 1;
    while (1) {
        k = scanKey();
        if (k != 0 && k != lastK) {
            ch = keyOf(k);
            if (ch >= '0' && ch <= '9') { if (fresh) { cur = ch - '0'; fresh = 0; } else { cur = cur * 10 + (ch - '0'); } }
            else if (ch == 'C') { cur = 0; acc = 0; op = 0; fresh = 1; }
            else if (ch == '=') {
                if (op == 1) cur = acc + cur;
                else if (op == 2) cur = acc - cur;
                else if (op == 3) cur = acc * cur;
                else if (op == 4) { if (cur != 0) cur = acc / cur; }
                op = 0; acc = 0; fresh = 1; g_result = cur;
            } else {
                acc = cur; cur = 0; fresh = 1;
                if (ch == '+') op = 1; else if (ch == '-') op = 2; else if (ch == '*') op = 3; else op = 4;
            }
            showCur();
            delay(2000);
        }
        lastK = k;
    }
}
`;

export class KeilUI {
    constructor(sys, pc) {
        this.sys = sys;
        this.pc = pc;                 // 画布上的上位机组件
        this._root = null;
        this.targets = [];
        this.targetId = null;
        this.debugging = false;
        this._pollTimer = null;
        this._tab = 'src';
        this.srcText = DEFAULT_SOURCE;
        this.build = null;            // 编译结果
        this.watch = ['P1', 'i'];
        this._lastTI = 0;
        this.serialLog = [];
        this.buttons = { 'p3_2': 1, 'p3_3': 1, 'p3_4': 1, 'p3_5': 1 };
    }

    // ── 生命周期 ──────────────────────────────────────────────
    open() {
        if (!this._root) this._build();
        this._root.style.display = 'flex';
        this._scanTargets();
        this._loadSourceFromTarget();
        this._renderAll();
        this._setStatus('就绪');
    }
    close() {
        if (this._root) this._root.style.display = 'none';
        this._stopPoll();
        this.debugging = false;
    }
    destroy() {
        this.close();
        if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
        this._root = null;
    }

    _q(id) { return this._root.querySelector('#' + id); }
    _solver() { return this.sys.mcs51Solver; }

    // ── 骨架 ─────────────────────────────────────────────────
    _build() {
        const root = document.createElement('div');
        root.id = 'keil-overlay';
        root.style.cssText = `position:fixed;inset:0;background:transparent;pointer-events:none;
            display:flex;align-items:center;justify-content:center;z-index:30010;
            font-family:'Microsoft YaHei',Arial,sans-serif;`;

        const win = document.createElement('div');
        win.style.cssText = `width:1180px;max-width:97vw;height:740px;max-height:93vh;pointer-events:auto;
            background:#f4f5f6;border:1px solid #6b7280;border-radius:5px;display:flex;flex-direction:column;
            box-shadow:0 14px 46px rgba(0,0,0,0.5);overflow:hidden;color:#1f2937;`;

        const titlebar = document.createElement('div');
        titlebar.id = 'keil-title';
        titlebar.style.cssText = `height:32px;flex:0 0 32px;background:linear-gradient(#2f6fb0,#20527f);
            color:#fff;display:flex;align-items:center;padding:0 10px;font-size:13px;font-weight:bold;cursor:move;`;
        titlebar.innerHTML = `<span>Keil µVision — 8051 集成开发环境（仿真）</span>
            <span style="margin-left:auto;cursor:pointer;font-weight:bold;padding:0 8px;" id="keil-close">✕</span>`;

        const toolbar = document.createElement('div');
        toolbar.style.cssText = `flex:0 0 auto;background:#e4e7ea;border-bottom:1px solid #c3c9cf;
            display:flex;align-items:center;gap:5px;padding:6px 10px;flex-wrap:wrap;`;
        toolbar.innerHTML = `
            <button class="k-btn" id="k-build">🔨 编译</button>
            <button class="k-btn" id="k-download" disabled>⬇ 下载</button>
            <span class="k-sep"></span>
            <button class="k-btn" id="k-debug">▶ 开始调试</button>
            <button class="k-btn" id="k-stop" disabled>⏹ 停止调试</button>
            <span class="k-sep"></span>
            <button class="k-btn" id="k-run" disabled>⏵ 运行</button>
            <button class="k-btn" id="k-pause" disabled>⏸ 暂停</button>
            <button class="k-btn" id="k-step" disabled>⤓ 单步</button>
            <button class="k-btn" id="k-stepover" disabled>⇥ 步过</button>
            <button class="k-btn" id="k-reset" disabled>⟲ 复位</button>
            <span class="k-sep"></span>
            <button class="k-btn" id="k-bp">● 断点(当前行)</button>
            <button class="k-btn" id="k-clear">清理断点</button>
            <span id="k-hint" style="margin-left:auto;font-size:12px;color:#4b5563;"></span>`;

        const body = document.createElement('div');
        body.style.cssText = `flex:1 1 auto;display:flex;min-height:0;`;

        // 左：目标 + Watch
        const left = document.createElement('div');
        left.id = 'keil-left';
        left.style.cssText = `width:215px;flex:0 0 215px;background:#fafbfc;border-right:1px solid #c3c9cf;overflow:auto;padding:8px;font-size:12.5px;`;

        // 中：Tab
        const center = document.createElement('div');
        center.style.cssText = `flex:1 1 auto;display:flex;flex-direction:column;min-width:0;background:#fff;`;
        center.innerHTML = `
            <div id="keil-tabs" style="flex:0 0 auto;display:flex;gap:2px;background:#e9edf1;border-bottom:1px solid #c3c9cf;padding:4px 6px 0;">
                <div class="k-tab" data-tab="src">main.c</div>
                <div class="k-tab" data-tab="asm">反汇编</div>
                <div class="k-tab" data-tab="build">编译输出</div>
            </div>
            <div id="keil-main" style="flex:1 1 auto;overflow:auto;position:relative;"></div>`;

        // 右：寄存器 / 内存 / 目标板
        const right = document.createElement('div');
        right.id = 'keil-right';
        right.style.cssText = `width:340px;flex:0 0 340px;background:#fafbfc;border-left:1px solid #c3c9cf;overflow:auto;padding:8px;font-size:12px;`;

        body.appendChild(left); body.appendChild(center); body.appendChild(right);

        const status = document.createElement('div');
        status.id = 'keil-status';
        status.style.cssText = `height:26px;flex:0 0 26px;background:#e4e7ea;border-top:1px solid #c3c9cf;
            display:flex;align-items:center;padding:0 12px;font-size:12px;color:#374151;gap:16px;`;

        win.appendChild(titlebar); win.appendChild(toolbar); win.appendChild(body); win.appendChild(status);
        root.appendChild(win);
        document.body.appendChild(root);
        this._root = root;

        const style = document.createElement('style');
        style.textContent = `
            .k-btn{padding:6px 10px;border:1px solid #b9c0c7;border-radius:3px;background:#f7f8f9;cursor:pointer;font-size:12px;color:#1f2937;white-space:nowrap;}
            .k-btn:hover:not([disabled]){background:#e9edf1;} .k-btn[disabled]{opacity:.5;cursor:not-allowed;}
            .k-sep{width:1px;height:22px;background:#b9c0c7;margin:0 2px;}
            .k-tab{padding:5px 12px;font-size:12.5px;cursor:pointer;border:1px solid #c3c9cf;border-bottom:none;border-radius:4px 4px 0 0;background:#dfe4e9;color:#374151;}
            .k-tab.active{background:#fff;color:#20527f;font-weight:bold;}
            .k-code{font-family:Consolas,'Courier New',monospace;font-size:12.5px;line-height:1.5;white-space:pre;}
            .k-gutter{position:absolute;left:0;top:0;width:46px;text-align:right;color:#9aa4ae;user-select:none;
                font-family:Consolas,monospace;font-size:12.5px;line-height:1.5;padding-top:6px;background:#f1f3f5;border-right:1px solid #e3e6e9;}
            #k-editor{position:absolute;left:46px;top:0;right:0;bottom:0;border:none;outline:none;resize:none;padding:6px 8px;
                font-family:Consolas,'Courier New',monospace;font-size:12.5px;line-height:1.5;color:#111827;background:#fff;}
            #k-srcview{position:absolute;inset:0;overflow:auto;padding:0;}
            .k-line{display:flex;font-family:Consolas,monospace;font-size:12.5px;line-height:1.5;}
            .k-ln{width:46px;flex:0 0 46px;text-align:right;padding-right:8px;color:#9aa4ae;background:#f1f3f5;border-right:1px solid #e3e6e9;}
            .k-lt{flex:1 1 auto;white-space:pre;padding-left:8px;}
            .k-line.cur .k-lt{background:#cde6ff;} .k-line.cur .k-ln{background:#a9d3f7;color:#0b3d63;font-weight:bold;}
            .k-line.bp .k-ln{background:#f7b6b6;color:#7a1010;}
            .k-row{border:1px solid #d7dce1;border-radius:4px;padding:6px 8px;margin-bottom:6px;background:#fff;}
            .k-kv{display:flex;justify-content:space-between;gap:8px;font-family:Consolas,monospace;font-size:12px;padding:1px 0;}
            .k-kv b{color:#20527f;}
            table.k-tbl{border-collapse:collapse;width:100%;font-size:12px;}
            table.k-tbl th,table.k-tbl td{border:1px solid #e0e4e8;padding:2px 6px;text-align:left;font-family:Consolas,monospace;}
            table.k-tbl th{background:#eef1f4;color:#374151;font-family:inherit;}
            .k-bp{cursor:pointer;color:#c0392b;font-weight:bold;width:14px;display:inline-block;}
            .k-led{width:16px;height:16px;border-radius:50%;display:inline-block;border:1px solid #6b7280;margin:2px;vertical-align:middle;}
            .k-key{width:34px;height:26px;border:1px solid #8a97a4;border-radius:4px;background:#eef1f4;cursor:pointer;font-size:11px;margin:2px;}
            .k-key.down{background:#8fd18f;}
            .k-src-green{color:#1b7f3b;} .k-src-gray{color:#8a97a4;}
            .k-pre{margin:0;padding:6px 8px;font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap;line-height:1.5;}`;
        document.head.appendChild(style);

        this._makeDraggable(win, titlebar);
        this._bindEvents();
    }

    _makeDraggable(win, handle) {
        let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'keil-close') return;
            dragging = true; sx = e.clientX; sy = e.clientY;
            const r = win.getBoundingClientRect(); ox = r.left; oy = r.top;
            win.style.position = 'fixed';
            e.preventDefault();
        });
        const move = (e) => {
            if (!dragging) return;
            win.style.left = (ox + e.clientX - sx) + 'px';
            win.style.top = (oy + e.clientY - sy) + 'px';
            win.style.margin = '0';
        };
        const up = () => { dragging = false; };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }

    _bindEvents() {
        this._q('keil-close').onclick = () => this.close();
        this._q('k-build').onclick = () => this._compile();
        this._q('k-download').onclick = () => this._download();
        this._q('k-debug').onclick = () => this._startDebug();
        this._q('k-stop').onclick = () => this._stopDebug();
        this._q('k-run').onclick = () => this._run();
        this._q('k-pause').onclick = () => this._pause();
        this._q('k-step').onclick = () => this._step(1);
        this._q('k-stepover').onclick = () => this._stepOver();
        this._q('k-reset').onclick = () => this._reset();
        this._q('k-bp').onclick = () => this._toggleBreakpointAtCursor();
        this._q('k-clear').onclick = () => { const s = this._solver(); if (s && this.targetId) { s.clearBreakpoints(this.targetId); this._refresh(); this._setStatus('已清除所有断点'); } };
        this._root.querySelectorAll('.k-tab').forEach(t => t.onclick = () => { this._tab = t.dataset.tab; this._renderAll(); });
    }

    // ── 目标（画布上的 8051 组件）────────────────────────────
    _scanTargets() {
        this.targets = Object.values(this.sys.comps || {}).filter(c => c && c.type === 'd_mcs51');
        if (!this.targetId && this.targets.length) this.targetId = this.targets[0].id;
        if (this.targetId && !this.targets.some(t => t.id === this.targetId)) this.targetId = this.targets.length ? this.targets[0].id : null;
    }
    _target() { return this.targets.find(t => t.id === this.targetId) || null; }

    _loadSourceFromTarget() {
        const t = this._target();
        if (t && typeof t._cSource === 'string' && t._cSource.trim()) this.srcText = t._cSource;
    }

    // ── 编译 / 下载 ──────────────────────────────────────────
    _compile() {
        this._collectSource();
        const r = compileC(this.srcText);
        this.build = r;
        this._tab = 'build';
        this._renderAll();
        if (r.ok) {
            this._setStatus(`编译成功：${r.size} 字节，${r.listing.length} 条指令`);
            this._q('k-download').disabled = !this.targetId;
        } else {
            this._setStatus(`编译失败：${r.errors.length} 个错误`);
            this._q('k-download').disabled = true;
        }
    }

    _collectSource() {
        const ed = this._q('k-editor');
        if (ed) this.srcText = ed.value;
        const t = this._target();
        if (t) t._cSource = this.srcText;   // 存到组件

    }

    _download() {
        if (!this.build || !this.build.ok) { this._setStatus('请先成功编译'); return; }
        const s = this._solver();
        if (!s || !this.targetId) { this._setStatus('未选择目标 8051'); return; }
        this._collectSource();
        const res = s.downloadProgram(this.targetId, this.build.bytes, {
            lineMap: this.build.lineMap, lineAddrs: this.build.lineAddrs, symbols: this.build.symbols,
        }, { pause: false });
        if (res.ok) {
            this._setStatus(`已下载到 ${this.targetId}：${this.build.size} 字节，程序运行中`);
            this._q('k-debug').disabled = false;
            this._refresh();
            if (this.sys.requestRedraw) this.sys.requestRedraw();
        } else {
            this._setStatus('下载失败：' + res.error);
        }
    }

    // ── 调试控制 ─────────────────────────────────────────────
    _startDebug() {
        const s = this._solver();
        if (!s || !this.targetId) { this._setStatus('未选择目标 8051'); return; }
        s.resetMCU(this.targetId);      // 保留 ROM 与调试信息
        s.pause(this.targetId);
        this.debugging = true;
        this._startPoll();
        this._refresh();
        this._setStatus('已进入调试（暂停在复位向量），可单步/运行/步过');
    }
    _stopDebug() {
        const s = this._solver();
        if (s && this.targetId) s.resume(this.targetId);
        this.debugging = false;
        this._stopPoll();
        this._renderAll();
        this._setStatus('已退出调试，程序继续运行');
    }
    _run() { const s = this._solver(); if (s && this.targetId) { s.resume(this.targetId); this._setStatus('运行中…'); this._refresh(); } }
    _pause() { const s = this._solver(); if (s && this.targetId) { s.pause(this.targetId); this._setStatus('已暂停'); this._refresh(); } }
    _reset() {
        const s = this._solver();
        if (!s || !this.targetId) return;
        s.resetMCU(this.targetId);
        if (this.debugging) s.pause(this.targetId);
        this._refresh();
        this._setStatus('已复位');
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }
    _step(n) {
        const s = this._solver();
        if (!s || !this.targetId) return;
        if (!this.debugging) { this._startDebug(); }
        s.step(this.targetId, n);
        this._refresh();
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }
    _stepOver() {
        const s = this._solver();
        if (!s || !this.targetId) return;
        if (!this.debugging) this._startDebug();
        const st0 = s.getDebugState(this.targetId);
        const l0 = st0 ? st0.currentLine : null;
        for (let i = 0; i < 5000; i++) {
            s.step(this.targetId, 1);
            const st = s.getDebugState(this.targetId);
            if (!st) break;
            if (st.currentLine !== null && st.currentLine !== l0) break;
            // 若同行的指令已走完但行号丢失，则按地址变化兜底停止
        }
        this._refresh();
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }
    _toggleBreakpointAtCursor() {
        const s = this._solver();
        if (!s || !this.targetId) return;
        if (!this.build || !this.build.ok || !this.build.lineAddrs) { this._setStatus('请先编译'); return; }
        const line = this._cursorLine();
        if (!line) { this._setStatus('未定位到源码行'); return; }
        const addrs = this.build.lineAddrs.get(line);
        if (!addrs || !addrs.length) { this._setStatus(`第 ${line} 行无可执行指令`); return; }
        const on = s.toggleBreakpoint(this.targetId, addrs[0]);
        this._setStatus(`第 ${line} 行断点：${on ? '已设置' : '已清除'}（0x${addrs[0].toString(16)}）`);
        this._refresh();
    }
    _cursorLine() {
        const ed = this._q('k-editor');
        if (ed && document.activeElement === ed) {
            const upto = ed.value.substr(0, ed.selectionStart);
            return upto.split('\n').length;
        }
        if (this._editLine) return this._editLine;   // 记忆的编辑光标行
        const st = this._getState();
        return st ? st.currentLine : null;
    }

    _getState() {
        const s = this._solver();
        if (!s || !this.targetId) return null;
        return s.getDebugState(this.targetId);
    }

    // ── 轮询 ─────────────────────────────────────────────────
    _startPoll() { this._stopPoll(); this._pollTimer = setInterval(() => { this._refresh(); }, 150); }
    _stopPoll() { if (this._pollTimer) clearInterval(this._pollTimer); this._pollTimer = null; }

    // ── 渲染 ─────────────────────────────────────────────────
    _renderAll() {
        if (!this._root) return;
        this._renderLeft();
        this._renderTabs();
        this._renderMain();
        this._renderRight();
        this._renderStatusBar();
        this._syncButtons();
    }

    _setStatus(msg) {
        this._statusMsg = msg;
        const hint = this._q('k-hint');
        if (hint) hint.textContent = msg;
        const st = this._q('keil-status-msg');
        if (st) st.textContent = msg;
    }

    _renderLeft() {
        const el = this._q('keil-left');
        if (!el) return;
        const st = this._getState();
        let h = `<div style="font-weight:bold;color:#20527f;margin-bottom:6px;">工程 / 目标</div>`;
        h += `<div>📁 Target 1 — ${this.pc && this.pc.hostname ? this.pc.hostname : 'MCU 上位机'}</div>`;
        h += `<div style="margin-left:14px;">📄 main.c ${this.build ? (this.build.ok ? '✅' : '❌') : ''}</div>`;
        h += `<div style="margin-left:14px;">🎯 目标 8051：</div>`;
        if (!this.targets.length) h += `<div style="margin-left:28px;color:#9aa2aa;">（画布上没有 8051 组件）</div>`;
        for (const t of this.targets) {
            const on = t.id === this.targetId;
            h += `<div class="k-target" data-id="${t.id}" style="margin-left:28px;cursor:pointer;color:${on ? '#1f9d55' : '#374151'};font-weight:${on ? 'bold' : 'normal'};">${on ? '🟢' : '⚪'} ${t.label || t.id}</div>`;
        }
        h += `<div style="margin-top:12px;font-weight:bold;color:#20527f;margin-bottom:4px;">变量监视 (Watch)</div>`;
        h += `<div style="display:flex;gap:4px;"><input id="k-watch-in" placeholder="变量名/表达式" style="flex:1;min-width:0;padding:3px 5px;border:1px solid #c3c9cf;border-radius:3px;font-size:12px;"/><button class="k-btn" id="k-watch-add" style="padding:3px 8px;">+</button></div>`;
        h += `<div id="k-watch-list" style="margin-top:6px;">`;
        if (!this.watch.length) h += `<div style="color:#9aa2aa;">（暂无监视项）</div>`;
        for (const w of this.watch) {
            const v = st ? this._evalWatch(w, st) : '—';
            h += `<div class="k-kv"><span>${w}</span><b>${v}</b></div>`;
        }
        h += `</div>`;
        el.innerHTML = h;
        el.querySelectorAll('.k-target').forEach(d => d.onclick = () => { this.targetId = d.dataset.id; this.debugging = false; this._stopPoll(); this._renderAll(); this._setStatus('已选择目标：' + d.dataset.id); });
        const add = this._q('k-watch-add'), inp = this._q('k-watch-in');
        if (add) add.onclick = () => { const v = (inp.value || '').trim(); if (v && !this.watch.includes(v)) { this.watch.push(v); this._renderAll(); } };
        if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter' && add) add.onclick(); };
    }

    _evalWatch(expr, st) {
        // 支持：变量名 / SFR / 端口位（如 P1.0、P1） / 简单十进制
        try {
            const name = String(expr).trim();
            if (/^\d+$/.test(name)) return name;
            const s = this._solver();
            const syms = (st.symbols || []);
            const sym = syms.find(x => x.name === name);
            if (sym) {
                const t = sym.type || '';
                if (t === 'bit' || sym.isBit) { const byte = st.ram[0x20 + (sym.addr >> 3)]; const v = (byte >> (sym.addr & 7)) & 1; return v ? '1' : '0'; }
                if (t === 'float') { const dv = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) dv.setUint8(i, st.ram[sym.addr + i] || 0); return dv.getFloat32(0, true).toString(); }
                if (t.endsWith('*') || t.includes('struct') || t.includes('[')) return '&0x' + (sym.addr >>> 0).toString(16).toUpperCase();
                if (sym.size === 4 || t === 'long' || t === 'ulong') { let v = 0; for (let i = 0; i < 4; i++) v |= (st.ram[sym.addr + i] || 0) << (8 * i); return String(v >>> 0); }
                if (sym.size === 2) { const lo = st.ram[sym.addr] || 0, hi = st.ram[sym.addr + 1] || 0; return String(lo | (hi << 8)); }
                return String(st.ram[sym.addr] || 0);
            }
            const SFRADDR = { P0: 0x80, P1: 0x90, P2: 0xA0, P3: 0xB0, ACC: 0xE0, B: 0xF0, PSW: 0xD0, SP: 0x81, DPL: 0x82, DPH: 0x83, TMOD: 0x89, TCON: 0x88, TH0: 0x8C, TL0: 0x8A, TH1: 0x8D, TL1: 0x8B, IE: 0xA8, IP: 0xB8, SCON: 0x98, SBUF: 0x99 };
            if (SFRADDR[name] !== undefined) { const v = st.sfr[SFRADDR[name] - 0x80] || 0; return '0x' + v.toString(16).toUpperCase().padStart(2, '0'); }
            const m = name.match(/^P([0-3])\.(\d)$/);
            if (m) { const v = st.sfr[(0x80 + (+m[1]) * 0x10 - 0x80)] || 0; return ((v >> (+m[2])) & 1) ? '1' : '0'; }
            return '?';
        } catch (e) { return '?'; }
    }

    _renderTabs() {
        this._root.querySelectorAll('.k-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === this._tab));
    }

    _renderMain() {
        if (this._tab === 'src') return this._renderSource();
        if (this._tab === 'asm') return this._renderAsm();
        return this._renderBuild();
    }

    _renderSource() {
        const main = this._q('keil-main');
        if (!main) return;
        if (!this.debugging) {
            const lines = this.srcText.split('\n');
            let gutter = '';
            for (let i = 1; i <= lines.length; i++) gutter += i + '\n';
            main.innerHTML = `<div class="k-gutter" id="k-gutter">${gutter.replace(/\n/g, '<br/>')}</div>
                <textarea id="k-editor" spellcheck="false"></textarea>`;
            const ed = this._q('k-editor');
            ed.value = this.srcText;
            const remember = () => {
                const upto = ed.value.substr(0, ed.selectionStart);
                this._editLine = upto.split('\n').length;
            };
            ed.addEventListener('input', () => { this.srcText = ed.value; remember(); });
            ed.addEventListener('click', remember);
            ed.addEventListener('keyup', remember);
            ed.addEventListener('scroll', () => { const g = this._q('k-gutter'); if (g) g.scrollTop = ed.scrollTop; });
            remember();
            return;
        }
        // 调试：只读源码视图 + 当前行/断点高亮
        const st = this._getState();
        const cur = st ? st.currentLine : null;
        const bps = new Set();
        if (st && st.breakpoints && this.build && this.build.lineAddrs) {
            for (const [line, arr] of this.build.lineAddrs) if (arr.some(a => st.breakpoints.includes(a))) bps.add(line);
        }
        const lines = this.srcText.split('\n');
        let h = `<div id="k-srcview"><div class="k-code">`;
        lines.forEach((ln, i) => {
            const n = i + 1;
            const cls = (n === cur ? 'cur ' : '') + (bps.has(n) ? 'bp' : '');
            h += `<div class="k-line ${cls}"><span class="k-ln">${bps.has(n) ? '●' : ''}${n}</span><span class="k-lt">${escapeHtml(ln) || ' '}</span></div>`;
        });
        h += `</div></div>`;
        main.innerHTML = h;
    }

    _renderAsm() {
        const main = this._q('keil-main');
        if (!main) return;
        const s = this._solver();
        if (!s || !this.targetId) { main.innerHTML = `<div class="k-pre">未选择目标</div>`; return; }
        const st = this._getState();
        const pc = st ? st.pc : 0;
        const base = Math.max(0, pc - 8);
        const rows = s.disassemble(this.targetId, base, 40);
        const bps = st ? st.breakpoints : [];
        let h = `<table class="k-tbl"><tr><th>断点</th><th>地址</th><th>字节</th><th>指令</th><th>源行</th></tr>`;
        for (const r of rows) {
            const isCur = r.addr === pc;
            const isBp = bps.includes(r.addr);
            const line = (this.build && this.build.lineMap) ? this.build.lineMap.get(r.addr) : null;
            h += `<tr style="${isCur ? 'background:#cde6ff;' : ''}">
                <td><span class="k-bp" data-addr="${r.addr}">${isBp ? '●' : '○'}</span></td>
                <td>${r.addr.toString(16).toUpperCase().padStart(4, '0')}</td>
                <td>${r.bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</td>
                <td>${escapeHtml(r.text)}</td>
                <td>${line != null ? line : ''}</td></tr>`;
        }
        h += `</table>`;
        main.innerHTML = h;
        main.querySelectorAll('.k-bp').forEach(x => x.onclick = () => {
            const on = s.toggleBreakpoint(this.targetId, parseInt(x.dataset.addr, 10));
            this._setStatus(`断点 0x${parseInt(x.dataset.addr, 10).toString(16)}：${on ? '已设置' : '已清除'}`);
            this._renderAsm();
        });
    }

    _renderBuild() {
        const main = this._q('keil-main');
        if (!main) return;
        const r = this.build;
        if (!r) { main.innerHTML = `<pre class="k-pre">（尚未编译）点击工具栏「编译」。</pre>`; return; }
        let h = '';
        if (r.ok) h += `<div style="color:#1b7f3b;font-weight:bold;">Build succeeded.</div>`;
        else h += `<div style="color:#c0392b;font-weight:bold;">Build failed：${r.errors.length} error(s).</div>`;
        h += `<div>程序大小：${r.size} 字节，指令 ${r.listing.length} 条</div>`;
        h += `<div>符号表：${(r.symbols || []).map(s => `${s.name}(${s.type}${s.size === 2 ? ' 16位' : ''}@0x${s.addr.toString(16)})`).join('，') || '（无）'}</div>`;
        h += `<div style="margin:6px 0 2px;font-weight:bold;">编译信息</div><pre class="k-pre">`;
        const msgs = [];
        for (const e of r.errors) msgs.push(`main.c(${e.line}): error C${1000 + e.line}: ${e.msg}`);
        for (const w of r.warnings) msgs.push(`main.c(${w.line}): warning: ${w.msg}`);
        if (!msgs.length) msgs.push('0 Error(s), 0 Warning(s)');
        h += escapeHtml(msgs.join('\n')) + `</pre>`;
        h += `<div style="margin:6px 0 2px;font-weight:bold;">汇编清单</div><table class="k-tbl"><tr><th>地址</th><th>字节</th><th>指令</th><th>源行</th></tr>`;
        for (const l of (r.listing || []).slice(0, 400)) {
            h += `<tr><td>${l.addr.toString(16).toUpperCase().padStart(4, '0')}</td><td>${l.bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}</td><td>${escapeHtml(l.text)}</td><td>${l.line}</td></tr>`;
        }
        h += `</table>`;
        main.innerHTML = h;
    }

    _renderRight() {
        const el = this._q('keil-right');
        if (!el) return;
        const st = this._getState();
        const SFR_LIST = [
            [0x80, 'P0'], [0x81, 'SP'], [0x82, 'DPL'], [0x83, 'DPH'], [0x87, 'PCON'],
            [0x88, 'TCON'], [0x89, 'TMOD'], [0x8A, 'TL0'], [0x8B, 'TL1'], [0x8C, 'TH0'], [0x8D, 'TH1'],
            [0x90, 'P1'], [0x98, 'SCON'], [0x99, 'SBUF'], [0xA0, 'P2'], [0xA8, 'IE'], [0xB0, 'P3'], [0xB8, 'IP'],
            [0xD0, 'PSW'], [0xE0, 'ACC'], [0xF0, 'B'],
        ];
        const hx = v => (v || 0).toString(16).toUpperCase().padStart(2, '0');
        let h = '';
        h += `<div class="k-row"><div style="font-weight:bold;color:#20527f;margin-bottom:4px;">CPU 寄存器</div>`;
        if (st) {
            const bank = (st.psw >> 3) & 3;
            let rregs = '';
            for (let i = 0; i < 8; i++) rregs += `R${i}=${hx(st.ram[bank * 8 + i])} `;
            h += `<div class="k-kv"><span>PC</span><b>0x${st.pc.toString(16).toUpperCase().padStart(4, '0')}</b></div>`;
            h += `<div class="k-kv"><span>ACC / B</span><b>${hx(st.acc)} / ${hx(st.b)}</b></div>`;
            h += `<div class="k-kv"><span>PSW / SP</span><b>${hx(st.psw)} / ${hx(st.sp)}</b></div>`;
            h += `<div class="k-kv"><span>DPTR</span><b>0x${hx(st.dph)}${hx(st.dpl)}</b></div>`;
            h += `<div class="k-kv"><span>工作寄存器组</span><b>${bank}</b></div>`;
            h += `<div class="k-kv" style="display:block"><span>${rregs}</span></div>`;
            h += `<div class="k-kv"><span>状态</span><b>${st.paused ? (st.hit ? '断点' : '暂停') : '运行'}</b></div>`;
        } else h += `<div style="color:#9aa2aa;">未连接/未运行</div>`;
        h += `</div>`;

        h += `<div class="k-row"><div style="font-weight:bold;color:#20527f;margin-bottom:4px;">SFR / 端口</div><table class="k-tbl"><tr><th>地址</th><th>名称</th><th>值</th></tr>`;
        for (const [addr, name] of SFR_LIST) {
            const v = st ? (st.sfr[addr - 0x80] || 0) : 0;
            h += `<tr><td>0x${addr.toString(16).toUpperCase()}</td><td>${name}</td><td>0x${hx(v)}</td></tr>`;
        }
        h += `</table></div>`;

        // 虚拟目标板 / LCD
        const board = Object.values(this.sys.comps || {}).find(c => c && c.type === 'mcs51_board' && typeof c.getLcdText === 'function');
        if (board) {
            const lines = board.getLcdText();
            h += `<div class="k-row"><div style="font-weight:bold;color:#20527f;margin-bottom:4px;">开关板 LCD1602</div>`;
            h += `<div style="background:#0f3d1e;border:1px solid #0a2914;border-radius:4px;padding:6px 8px;font-family:Consolas,monospace;font-size:16px;line-height:1.4;color:#6ee7a8;">${escapeHtml(lines[0])}<br/>${escapeHtml(lines[1])}</div>`;
            h += `<div style="margin-top:4px;color:#607d8b;font-size:11px;">画布开关板上可直接点击 4×4 键盘输入</div></div>`;
        } else {
            h += `<div class="k-row"><div style="font-weight:bold;color:#20527f;margin-bottom:4px;">虚拟目标板</div>`;
            h += `<div style="margin-bottom:4px;">P1 LED：`;
            for (let b = 0; b < 8; b++) {
                const on = st ? ((st.sfr[0x10] >> b) & 1) : 0;
                h += `<span class="k-led" style="background:${on ? '#2ecc71' : '#d9dee3'}"></span>`;
            }
            h += `</div>`;
            h += `<div style="margin-bottom:6px;">P0 LED：`;
            for (let b = 0; b < 8; b++) {
                const on = st ? ((st.sfr[0x00] >> b) & 1) : 0;
                h += `<span class="k-led" style="background:${on ? '#f39c12' : '#d9dee3'}"></span>`;
            }
            h += `</div>`;
            h += `<div>P3 按键（按下=低）：`;
            for (const [key, label] of [['p3_2', 'INT0'], ['p3_3', 'INT1'], ['p3_4', 'T0'], ['p3_5', 'T1']]) {
                h += `<button class="k-key" data-key="${key}">${label}</button>`;
            }
            h += `</div></div>`;
        }

        // 串口
        h += `<div class="k-row"><div style="font-weight:bold;color:#20527f;margin-bottom:4px;">串口监视</div>`;
        h += `<div class="k-kv"><span>SBUF</span><b>${st ? '0x' + hx(st.sfr[0x19]) : '—'}</b></div>`;
        h += `<div class="k-kv"><span>SCON</span><b>${st ? '0x' + hx(st.sfr[0x18]) : '—'}</b></div>`;
        h += `<div class="k-kv"><span>TI / RI</span><b>${st ? (st.ti ? '1' : '0') + ' / ' + (st.ri ? '1' : '0') : '—'}</b></div>`;
        h += `<pre class="k-pre" style="max-height:80px;overflow:auto;background:#0f172a;color:#a7f3d0;border-radius:4px;">${escapeHtml(this.serialLog.join('')) || '（TxD 发送字节将显示在此）'}</pre>`;
        h += `</div>`;

        // 内存
        h += `<div class="k-row"><div style="font-weight:bold;color:#20527f;margin-bottom:4px;">内部 RAM / idata (0x00–0xFF)</div><pre class="k-pre" style="max-height:170px;overflow:auto;background:#f1f3f5;">`;
        if (st) {
            for (let row = 0; row < 16; row++) {
                const base = row * 16;
                const bytes = Array.from(st.ram.slice(base, base + 16));
                h += base.toString(16).toUpperCase().padStart(2, '0') + ': ' + bytes.map(hx).join(' ') + '\n';
            }
        } else h += '（无数据）';
        h += `</pre></div>`;

        el.innerHTML = h;
        // 按键事件
        el.querySelectorAll('.k-key').forEach(btn => {
            const key = btn.dataset.key;
            const [port, bit] = key.split('_');
            const press = () => { this.buttons[key] = 0; this._applyKey(port, +bit, 0); btn.classList.add('down'); };
            const release = () => { this.buttons[key] = 1; this._applyKey(port, +bit, 1); btn.classList.remove('down'); };
            btn.onmousedown = press; btn.onmouseup = release; btn.onmouseleave = release;
            if (this.buttons[key] === 0) btn.classList.add('down');
        });
    }

    _applyKey(port, bit, val) {
        const s = this._solver();
        if (s && this.targetId && typeof s.setInputPin === 'function') s.setInputPin(this.targetId, port, bit, val);
        if (this.sys.requestRedraw) this.sys.requestRedraw();
    }

    _renderStatusBar() {
        const el = this._q('keil-status');
        if (!el) return;
        const st = this._getState();
        el.innerHTML = `<span id="keil-status-msg" style="flex:1 1 auto;">${escapeHtml(this._statusMsg || '')}</span>
            <span>目标：${this.targetId || '（无）'}</span>
            <span>PC：${st ? '0x' + st.pc.toString(16).toUpperCase().padStart(4, '0') : '—'}</span>
            <span>源行：${st && st.currentLine != null ? st.currentLine : '—'}</span>
            <span>${this.debugging ? '调试中' : '编辑模式'}</span>`;
    }

    _syncButtons() {
        const hasTarget = !!this.targetId;
        const s = this._solver();
        const st = this._getState();
        const paused = !!(st && st.paused);
        const set = (id, dis) => { const b = this._q(id); if (b) b.disabled = dis; };
        set('k-download', !(this.build && this.build.ok) || !hasTarget);
        set('k-debug', !hasTarget);
        set('k-stop', !this.debugging);
        set('k-step', !this.debugging);
        set('k-stepover', !this.debugging);
        set('k-run', !this.debugging || !paused);
        set('k-pause', !this.debugging || paused);
        set('k-reset', !hasTarget);
    }

    /** 调用方在每帧后调用（若需要实时刷新显示）—— 目前用轮询即可，保留接口 */
    _refresh() {
        if (!this._root || this._root.style.display === 'none') return;
        this._scanTargets();
        // 串口：检测 TI 上升沿记录发送字节
        const st = this._getState();
        if (st) {
            const ti = st.ti;
            if (ti && !this._lastTI) {
                const b = st.sfr[0x19];
                this.serialLog.push(b >= 32 && b < 127 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`);
                if (this.serialLog.length > 200) this.serialLog.shift();
            }
            this._lastTI = ti;
        }
        this._renderLeftSafe();
        this._renderMain();
        this._renderRightSafe();
        this._renderStatusBar();
        this._syncButtons();
    }

    /** 刷新时若正在编辑 Watch 输入框，则不重建左栏（避免输入被打断） */
    _renderLeftSafe() {
        const ae = document.activeElement;
        if (ae && ae.id === 'k-watch-in') return;
        this._renderLeft();
    }

    /** 刷新时若正按住虚拟按键，则不重建右栏（避免按键状态丢失/闪烁） */
    _renderRightSafe() {
        const holding = Object.values(this.buttons).some(v => v === 0);
        if (holding) return;
        this._renderRight();
    }
}

function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default KeilUI;
