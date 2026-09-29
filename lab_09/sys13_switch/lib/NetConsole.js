// NetConsole.js — 组网仿真复用的 DOM 界面组件（无第三方依赖）
//   openTabbedDialog() : 居中多标签模态对话框（同一时刻仅保留一个网络对话框）
//   Terminal           : 终端控件（输出区 + 单行输入 + 命令历史 + 逐字输入演示）
import { DEMO } from './DemoTiming.js';

let _activeModal = null;
let _styleInjected = false;

function ensureStyle() {
    if (_styleInjected) return;
    const st = document.createElement('style');
    st.textContent = `
        .net-term .term-line { white-space: pre-wrap; word-break: break-all; }
        .net-term .term-cmd { color: #e6edf3; }
        .net-term .term-ok { color: #3fb950; }
        .net-term .term-err { color: #f85149; }
        .net-term .term-warn { color: #d29922; }
        .net-term .term-info { color: #58a6ff; }
        .net-term .term-dim { color: #8b949e; }
    `;
    document.head.appendChild(st);
    _styleInjected = true;
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function getActiveNetDialog() { return _activeModal; }

export function closeActiveNetDialog() {
    if (_activeModal && _activeModal.parentNode) _activeModal.parentNode.removeChild(_activeModal);
    _activeModal = null;
}

/**
 * 打开一个居中多标签对话框。
 * @param {object} opts
 * @param {string} opts.title  标题
 * @param {Array}  opts.tabs   [{ id, label, render(pageEl, api) }]
 * @param {number} [opts.width=640]
 * @param {number} [opts.height=460]
 * @param {HTMLElement} [opts.container=document.body] 挂载容器
 * @returns {{modal:HTMLElement, close:Function, switchTab:Function}}
 */
export function openTabbedDialog({ title = '配置', tabs = [], width = 640, height = 460, container = null } = {}) {
    ensureStyle();
    closeActiveNetDialog();

    const modal = document.createElement('div');
    modal.className = 'net-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;' +
        'align-items:center;justify-content:center;z-index:9999;' +
        "font-family:'Microsoft YaHei','PingFang SC',sans-serif;";

    const box = document.createElement('div');
    box.style.cssText = `background:#fff;border-radius:10px;width:${width}px;max-width:94vw;` +
        `height:${height}px;max-height:92vh;box-shadow:0 10px 30px rgba(0,0,0,.35);` +
        'display:flex;flex-direction:column;overflow:hidden;';

    // ── 标题栏 ──
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
        'padding:12px 16px;background:#1f2a33;color:#fff;';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-size:15px;font-weight:600;';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'border:none;background:transparent;color:#c9d1d9;font-size:16px;' +
        'cursor:pointer;padding:2px 8px;border-radius:4px;';
    closeBtn.onmouseenter = () => { closeBtn.style.background = 'rgba(255,255,255,.15)'; };
    closeBtn.onmouseleave = () => { closeBtn.style.background = 'transparent'; };
    header.appendChild(h);
    header.appendChild(closeBtn);

    // ── 标签栏 ──
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:4px;padding:0 12px;background:#26333d;';
    tabBar.className = 'net-tabbar';

    // ── 页面容器 ──
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-height:0;padding:14px 16px;overflow:auto;background:#fff;';

    const pages = [];
    const tabBtns = [];
    const api = {
        modal, switchTab: (i) => switchTab(i), close: () => close(),
    };

    const switchTab = (idx) => {
        pages.forEach((p, i) => { p.style.display = (i === idx) ? 'block' : 'none'; });
        tabBtns.forEach((b, i) => {
            const on = i === idx;
            b.style.background = on ? '#fff' : 'transparent';
            b.style.color = on ? '#1f2a33' : '#c9d1d9';
            b.style.fontWeight = on ? '600' : '400';
        });
    };

    tabs.forEach((tab, i) => {
        const btn = document.createElement('button');
        btn.textContent = tab.label;
        btn.style.cssText = 'border:none;background:transparent;color:#c9d1d9;padding:9px 16px;' +
            'cursor:pointer;font-size:13px;border-radius:6px 6px 0 0;';
        btn.onclick = () => switchTab(i);
        tabBtns.push(btn);
        tabBar.appendChild(btn);

        const page = document.createElement('div');
        page.style.cssText = 'display:none;';
        tab.render(page, api);
        pages.push(page);
        body.appendChild(page);
    });

    function close() {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        if (_activeModal === modal) _activeModal = null;
    }
    closeBtn.onclick = close;
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    box.appendChild(header);
    if (tabs.length > 1) box.appendChild(tabBar);
    box.appendChild(body);
    modal.appendChild(box);
    (container || document.body).appendChild(modal);
    _activeModal = modal;

    setTimeout(() => switchTab(0), 0);

    return { modal, close, switchTab };
}

/**
 * 终端控件。
 * @param {object} opts
 * @param {string} [opts.prompt='>']  提示符
 * @param {string} [opts.welcome]     首屏欢迎文字
 * @param {number} [opts.height=320]  可视高度(px)
 * @param {Function} [opts.onCommand] (cmd, term) => void|Promise  命令回调
 */
export class Terminal {
    constructor({ prompt = '>', welcome = '', height = 320, onCommand = null } = {}) {
        ensureStyle();
        this.onCommand = onCommand;
        this._prompt = prompt;
        this._history = [];
        this._histIdx = 0;

        this._root = document.createElement('div');
        this._root.className = 'net-term';
        this._root.style.cssText = `display:flex;flex-direction:column;height:${typeof height === 'number' ? height + 'px' : height};` +
            'background:#0d1117;border:1px solid #23303a;border-radius:8px;overflow:hidden;' +
            "font-family:Consolas,'Courier New',Monaco,monospace;font-size:13px;color:#c9d1d9;";

        this._out = document.createElement('div');
        this._out.style.cssText = 'flex:1;overflow:auto;padding:10px 12px;line-height:1.5;';

        const inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 12px;' +
            'border-top:1px solid #23303a;background:#0b0f14;';
        this._promptSpan = document.createElement('span');
        this._promptSpan.textContent = prompt;
        this._promptSpan.style.cssText = 'color:#3fb950;white-space:pre;';
        this._input = document.createElement('input');
        this._input.type = 'text';
        this._input.spellcheck = false;
        this._input.style.cssText = 'flex:1;background:transparent;border:none;outline:none;' +
            'color:#e6edf3;font-family:inherit;font-size:inherit;';
        inputRow.appendChild(this._promptSpan);
        inputRow.appendChild(this._input);

        this._input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._submit();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this._histIdx > 0) { this._histIdx--; this._input.value = this._history[this._histIdx] || ''; }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this._histIdx < this._history.length) {
                    this._histIdx++;
                    this._input.value = this._histIdx === this._history.length ? '' : (this._history[this._histIdx] || '');
                }
            }
        });
        this._input.addEventListener('mousedown', (e) => e.stopPropagation());

        this._root.appendChild(this._out);
        this._root.appendChild(inputRow);

        if (welcome) this.print(welcome, 'term-dim');
    }

    get element() { return this._root; }

    setPrompt(p) { this._prompt = p; this._promptSpan.textContent = p; }

    print(text = '', cls = '') {
        const parts = String(text).split('\n');
        for (const part of parts) {
            const line = document.createElement('div');
            line.className = 'term-line' + (cls ? ' ' + cls : '');
            line.textContent = part;
            this._out.appendChild(line);
        }
        this._out.scrollTop = this._out.scrollHeight;
    }

    clear() { this._out.innerHTML = ''; }

    focus() { try { this._input.focus(); } catch (e) { /* ignore */ } }

    /** 以“逐字键入”的方式执行一条命令（供自动演示），返回命令回调的完成 Promise */
    async typeCommand(cmd, perChar = DEMO.TYPE_PER_CHAR) {
        this.focus();
        for (let i = 1; i <= cmd.length; i++) {
            this._input.value = cmd.slice(0, i);
            await sleep(perChar);
        }
        await sleep(180);
        return await this._submit();
    }

    /** 直接执行一条命令（不回显键入过程），返回命令回调 */
    exec(cmd) { return this._run(cmd); }

    _submit() {
        const cmd = this._input.value;
        this._input.value = '';
        if (!cmd.trim()) return undefined;
        this._history.push(cmd);
        this._histIdx = this._history.length;
        this.print(this._prompt + cmd, 'term-cmd');
        return this._run(cmd);
    }

    _run(cmd) {
        if (!this.onCommand) return undefined;
        try {
            return this.onCommand(cmd, this);
        } catch (e) {
            this.print(String(e && e.message || e), 'term-err');
            return undefined;
        }
    }
}
