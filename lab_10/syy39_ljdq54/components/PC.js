import { BaseComponent } from './BaseComponent.js';
import { Terminal, openTabbedDialog, closeActiveNetDialog, sleep } from '../lib/NetConsole.js';
import { DEMO } from '../lib/DemoTiming.js';
import {
    macOf, runPing, formatPingLines, isValidIp, isValidMask, maskPrefix,
    tracert, arpTable, dhcpRequest, dhcpRelease,
} from '../tools/NetworkSim.js';
import { resolveDomain, dnsCache, flushDns, httpGet, ftpConnect, ftpGet } from '../tools/NetServices.js';

/**
 * PC — 个人计算机仿真组件（简单组网）
 *
 * 交互：
 *   - 双击 → 多页面配置对话框：① TCP/IP 设置  ② 命令行
 *   - 命令行支持：ipconfig / ipconfig /all / ping [-n 次数] <IP> / cls / help
 *
 * 端口：<id>_wire_lan（一个以太网口，用于与交换机/另一台 PC 连线）
 */
export class PC extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'pc';
        this.cache = 'fixed';
        this.label = 'PC 主机';

        this.width = 240;
        this.height = 240;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            hostname: this.hostname,
            ip: this.ip,
            mask: this.mask,
            gateway: this.gateway,
            dns: this.dns,
            dhcp: this.dhcp,
        };

        this.addPort(this._portX, this._portY, 'lan', 'wire');
    }

    // ─────────────────────────────────────────────────────────
    //  初始化
    // ─────────────────────────────────────────────────────────

    _recalcGeometry() {
        this._portX = 135;
        this._portY = 58;
    }

    _initParameters(config) {
        this.hostname = config.hostname || config.id || 'PC';
        // 出厂状态：未配置任何 IP / 掩码 / 网关 / DNS
        this.ip = config.ip || '';
        this.mask = config.mask || '';
        this.gateway = config.gateway || '';
        this.dns = config.dns || '';
        this.dhcp = !!config.dhcp;
        this.mac = config.mac || macOf(this);

        this._linkOn = false;
        this._busy = false;
        this._demoActive = false;
        this._terminal = null;
        this._dialog = null;
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        const C = {
            bezel: '#2b3a45',
            bezelEdge: '#16222c',
            screen: '#071a24',
            screenEdge: '#16a085',
            tower: '#37474f',
            towerEdge: '#1b252b',
            slot: '#151d22',
            socket: '#101820',
            text: '#ecf0f1',
            dim: '#9fb3c8',
        };

        // 显示器外框
        g.add(new Konva.Rect({
            x: -110, y: -108, width: 210, height: 150,
            fill: C.bezel, stroke: C.bezelEdge, strokeWidth: 2, cornerRadius: 8,
        }));
        // 屏幕（外框）
        g.add(new Konva.Rect({
            x: -99, y: -97, width: 188, height: 126,
            fill: C.screen, stroke: C.screenEdge, strokeWidth: 2, cornerRadius: 4,
        }));
        // 简单桌面：壁纸
        g.add(new Konva.Rect({
            x: -95, y: -93, width: 180, height: 118,
            fill: '#1e3a5f', cornerRadius: 3,
        }));
        // 桌面图标：我的电脑 / 网络 / 回收站
        [
            { x: -90, label: '电脑' },
            { x: -58, label: '网络' },
            { x: -26, label: '回收站' },
        ].forEach((ic) => {
            g.add(new Konva.Rect({
                x: ic.x, y: -84, width: 22, height: 17,
                fill: '#cfe3f5', stroke: '#7aa8d4', strokeWidth: 1, cornerRadius: 2,
            }));
            g.add(new Konva.Text({
                x: ic.x - 8, y: -65, width: 38, align: 'center',
                text: ic.label, fontFamily: 'Microsoft YaHei', fontSize: 8, fill: '#eaf3fb',
            }));
        });
        // 任务栏（开始按钮 + 网络图标 + 时钟）
        g.add(new Konva.Rect({ x: -95, y: 16, width: 180, height: 9, fill: '#0e1a28' }));
        g.add(new Konva.Rect({ x: -93, y: 17.5, width: 24, height: 6, fill: '#2f6fb0', cornerRadius: 2 }));
        g.add(new Konva.Text({ x: -91, y: 17.5, text: '开始', fontFamily: 'Microsoft YaHei', fontSize: 6, fill: '#ffffff' }));
        g.add(new Konva.Line({ points: [40, 20.5, 47, 20.5], stroke: '#7ee7c7', strokeWidth: 1.2 }));
        g.add(new Konva.Circle({ x: 39, y: 20.5, radius: 1.8, fill: '#7ee7c7' }));
        g.add(new Konva.Circle({ x: 48, y: 20.5, radius: 1.8, fill: '#7ee7c7' }));
        g.add(new Konva.Text({
            x: 62, y: 17.5, width: 30, align: 'right', text: '10:24',
            fontFamily: 'Consolas, monospace', fontSize: 7, fill: '#cfe3f5',
        }));
        // 底座
        g.add(new Konva.Rect({ x: -16, y: 42, width: 32, height: 12, fill: '#24323b' }));
        g.add(new Konva.Rect({ x: -52, y: 54, width: 104, height: 8, fill: '#24323b', cornerRadius: 3 }));

        // 主机箱
        g.add(new Konva.Rect({
            x: 106, y: -108, width: 58, height: 170,
            fill: C.tower, stroke: C.towerEdge, strokeWidth: 2, cornerRadius: 6,
        }));
        // 光驱/硬盘位
        g.add(new Konva.Rect({ x: 114, y: -96, width: 42, height: 6, fill: C.slot, cornerRadius: 2 }));
        g.add(new Konva.Rect({ x: 114, y: -84, width: 42, height: 6, fill: C.slot, cornerRadius: 2 }));
        // 电源键
        g.add(new Konva.Circle({ x: 152, y: -72, radius: 4, fill: '#22c55e', stroke: '#0f5132', strokeWidth: 1 }));
        // 散热格栅
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Rect({ x: 114, y: -58 + i * 8, width: 42, height: 4, fill: '#2c3a42', cornerRadius: 2 }));
        }
        // RJ45 网口插座
        g.add(new Konva.Rect({
            x: 124, y: 44, width: 22, height: 14,
            fill: C.socket, stroke: '#7f8c8d', strokeWidth: 1, cornerRadius: 2,
        }));

        // 网口标注
        g.add(new Konva.Text({
            x: 104, y: 62, text: '网口', fontFamily: 'Microsoft YaHei',
            fontSize: 10, fill: C.dim,
        }));

        // 部件热区（供自动演示箭头精确指向）
        this.addClickablePart('screen', -99, -97, 188, 126);
        this.addClickablePart('lan', this._portX - 16, this._portY - 12, 32, 24);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        // 显示器上方主机名铭牌（只显示名字，不显示网络参数）
        this._hostText = new Konva.Text({
            x: -110, y: -130, width: 210,
            text: '', fontFamily: 'Microsoft YaHei',
            fontSize: 13, fontStyle: 'bold', fill: '#ecf0f1',
        });
        d.add(this._hostText);

        this._linkLed = new Konva.Circle({
            x: this._portX - 15, y: this._portY - 12, radius: 3.5,
            fill: '#555555', stroke: '#222', strokeWidth: 1,
        });
        d.add(this._linkLed);

        this._updateDynamic();
    }

    _bindInteraction() {
        // 双击打开多页面配置对话框
        this.group.on('dblclick dbltap', (e) => {
            e.cancelBubble = true;
            this.showConfigDialog('ip');
        });
    }

    _updateDynamic() {
        if (this._hostText) this._hostText.text(this.hostname);
    }

    // ─────────────────────────────────────────────────────────
    //  仿真循环
    // ─────────────────────────────────────────────────────────

    tick() {
        const link = this._hasLink();
        if (link !== this._linkOn) {
            this._linkOn = link;
            this._linkLed.fill(link ? '#22c55e' : '#555555');
            // 启用 DHCP 且链路刚通、尚无地址 → 自动申请
            if (link && this.dhcp && !isValidIp(this.ip)) {
                const r = dhcpRequest(this.sys, this);
                if (r.ok) this.sys.showFloatingTip(`PC ${this.hostname} 通过 DHCP 获取到地址 ${r.ip}`);
            }
            this.sys.requestRedraw();
        }
    }

    _hasLink() {
        const pid = `${this.id}_wire_lan`;
        return (this.sys.conns || []).some(c => c.type === 'wire' && (c.from === pid || c.to === pid));
    }

    // ─────────────────────────────────────────────────────────
    //  参数接口（供平台右键「参数设置」与流程演示）
    // ─────────────────────────────────────────────────────────

    getConfigFields() {
        return [
            { label: '主机名', key: 'hostname', type: 'text' },
            { label: 'IP 地址', key: 'ip', type: 'text' },
            { label: '子网掩码', key: 'mask', type: 'text' },
            { label: '默认网关', key: 'gateway', type: 'text' },
            { label: 'DNS 服务器', key: 'dns', type: 'text' },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.hostname !== undefined) this.hostname = cfg.hostname;
        if (cfg.ip !== undefined) this.ip = cfg.ip;
        if (cfg.mask !== undefined) this.mask = cfg.mask;
        if (cfg.gateway !== undefined) this.gateway = cfg.gateway;
        if (cfg.dns !== undefined) this.dns = cfg.dns;
        if (cfg.dhcp !== undefined) this.dhcp = !!cfg.dhcp;
        this.config = {
            ...this.config,
            hostname: this.hostname, ip: this.ip, mask: this.mask,
            gateway: this.gateway, dns: this.dns, dhcp: this.dhcp,
        };
        this._updateDynamic();
        this.sys.requestRedraw();
    }

    // 简单 getter/setter
    getIp() { return this.ip; }
    setIp(ip) { this.onConfigUpdate({ ip }); }

    // ─────────────────────────────────────────────────────────
    //  多页面配置对话框
    // ─────────────────────────────────────────────────────────

    showConfigDialog(page = 'ip') {
        const tabs = [
            { id: 'ip', label: 'TCP/IP 设置', render: (el, api) => this._renderIpTab(el, api) },
            { id: 'browser', label: '浏览器', render: (el, api) => this._renderBrowserTab(el, api) },
            { id: 'ftp', label: 'FTP 客户端', render: (el, api) => this._renderFtpTab(el, api) },
            { id: 'cli', label: '命令行', render: (el, api) => this._renderCliTab(el, api) },
        ];
        this._dialog = openTabbedDialog({
            title: `PC 配置 — ${this.hostname}（${this.id}）`,
            tabs,
            width: 720,
            height: 500,
            container: this.sys.container,
        });
        const idx = Math.max(0, tabs.findIndex(t => t.id === page));
        setTimeout(() => this._dialog && this._dialog.switchTab(idx), 0);
    }

    // ─────────────────────────────────────────────────────────
    //  浏览器 / FTP 客户端
    // ─────────────────────────────────────────────────────────

    _renderBrowserTab(el) {
        el.innerHTML = '';
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
        const inputStyle = 'flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;';
        bar.innerHTML = `<input id="diag_browser_url" style="${inputStyle}" value="http://www.example.com/" placeholder="输入 http://域名 或 http://IP 后回车/点击访问">`;
        const go = document.createElement('button');
        go.textContent = '访问';
        go.id = 'browser_go_btn';
        go.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        bar.appendChild(go);
        el.appendChild(bar);

        const view = document.createElement('div');
        view.id = 'browser_view';
        view.style.cssText = 'border:1px solid #d0d7de;border-radius:6px;min-height:280px;padding:14px;background:#fafbfc;font-family:\'Microsoft YaHei\',sans-serif;font-size:13px;color:#24292f;';
        view.innerHTML = '<div style="color:#999;">在地址栏输入网址后点击「访问」。</div>';
        el.appendChild(view);

        const doGo = () => { this._browserGo(view); };
        go.onclick = doGo;
        const urlInput = el.querySelector('#diag_browser_url');
        urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doGo(); } });
    }

    _browserGo(view) {
        const url = (document.getElementById('diag_browser_url') || {}).value || '';
        if (!isValidIp(this.ip)) { view.innerHTML = '<div style="color:#d1242f;">本机未配置 IP 地址，无法访问网络。</div>'; return; }
        const r = httpGet(this.sys, this, url);
        if (!r.ok) {
            const msg = {
                bad_url: '地址格式不正确，请输入如 http://www.example.com/',
                no_dns: '未配置 DNS 服务器，无法解析域名。',
                nxdomain: '找不到域名对应的服务器（DNS 解析失败）。',
                no_server: '无法连接到服务器（网络不可达或服务未开启）。',
                refused: '服务器拒绝了连接（该地址未提供 HTTP 服务）。',
                timeout: '请求超时，服务器无响应。',
            }[r.reason] || '无法访问该网站。';
            view.innerHTML = `<div style="color:#d1242f;">${msg}</div>`;
            return;
        }
        if (r.status === 404) {
            view.innerHTML = `<div style="color:#d1242f;">404 Not Found —— ${r.body}</div>`;
            return;
        }
        view.innerHTML = `<h3 style="margin:0 0 10px;color:#0a3069;border-bottom:1px solid #d8dee4;padding-bottom:6px;">${r.title || ''}</h3>
            <div style="white-space:pre-wrap;line-height:1.7;">${r.body || ''}</div>
            <div style="margin-top:16px;color:#8b949e;font-size:11px;">— 来自服务器 ${r.server ? r.server.hostname : ''}（${r.ip}）</div>`;
    }

    _renderFtpTab(el) {
        el.innerHTML = '';
        const rowStyle = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;';
        const inputStyle = 'padding:8px;border:1px solid #ccc;border-radius:4px;';
        const form = document.createElement('div');
        form.style.cssText = rowStyle;
        form.innerHTML =
            `<div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">服务器</label>
                <input id="diag_ftp_host" style="${inputStyle}" placeholder="IP 或域名" value="203.0.113.10"></div>
             <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">用户名</label>
                <input id="diag_ftp_user" style="${inputStyle}" value="ftpuser"></div>
             <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">密码</label>
                <input id="diag_ftp_pass" type="password" style="${inputStyle}" value="ftp123"></div>`;
        const login = document.createElement('button');
        login.textContent = '连接';
        login.id = 'ftp_login_btn';
        login.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        form.appendChild(login);
        el.appendChild(form);

        const view = document.createElement('div');
        view.id = 'ftp_view';
        view.style.cssText = 'border:1px solid #d0d7de;border-radius:6px;min-height:240px;padding:12px;background:#0d1117;color:#c9d1d9;font-family:Consolas,monospace;font-size:13px;';
        view.innerHTML = '<div style="color:#8b949e;">输入服务器地址与账号后点击「连接」。</div>';
        el.appendChild(view);

        this._ftpFiles = [];
        login.onclick = () => this._ftpLogin(view);
    }

    _ftpLogin(view) {
        const host = (document.getElementById('diag_ftp_host') || {}).value || '';
        const user = (document.getElementById('diag_ftp_user') || {}).value || 'anonymous';
        const pass = (document.getElementById('diag_ftp_pass') || {}).value || '';
        if (!isValidIp(this.ip)) { view.innerHTML = '<div style="color:#f85149;">本机未配置 IP 地址，无法访问网络。</div>'; return; }
        const r = ftpConnect(this.sys, this, host, user, pass);
        if (!r.ok) {
            const msg = {
                no_dns: '未配置 DNS 服务器，无法解析域名。',
                nxdomain: '域名解析失败。',
                refused: '无法连接（网络不可达或未开启 FTP 服务）。',
                denied: '登录失败：用户名或密码错误。',
                timeout: '连接超时。',
            }[r.reason] || '连接失败。';
            view.innerHTML = `<div style="color:#f85149;">${msg}</div>`;
            return;
        }
        this._ftpFiles = r.files || [];
        this._ftpHost = host; this._ftpUser = user; this._ftpPass = pass;
        this._renderFtpFiles(view);
    }

    _renderFtpFiles(view) {
        const fileRows = this._ftpFiles.map(f =>
            `<div style="display:flex;gap:12px;align-items:center;padding:3px 0;">
                <span style="flex:1;">${f.name}</span><span style="color:#8b949e;">${f.size} B</span>
                <button data-file="${f.name}" class="ftp-dl" style="padding:2px 10px;border:none;background:#238636;color:#fff;border-radius:4px;cursor:pointer;">下载</button>
            </div>`).join('') || '<div style="color:#8b949e;">（服务器上没有文件）</div>';
        view.innerHTML = `<div style="color:#3fb950;">已连接到 ${this._ftpHost}（${this._ftpUser}）</div>
            <div style="margin:8px 0;color:#58a6ff;">目录列表：</div>${fileRows}
            <pre id="ftp_log" style="margin-top:10px;color:#c9d1d9;white-space:pre-wrap;"></pre>`;
        view.querySelectorAll('.ftp-dl').forEach(btn => {
            btn.onclick = () => { this._ftpDownload(view, btn.dataset.file); };
        });
    }

    /** 下载文件（带“下载中…”过程效果），供手动点击与自动演示共用 */
    async _ftpDownload(view, fileName) {
        const log = document.getElementById('ftp_log');
        if (log) {
            log.textContent = `正在下载 ${fileName} …`;
            for (let i = 0; i < 3; i++) { await sleep(480); log.textContent = `正在下载 ${fileName} ${'.'.repeat(i + 1)}`; }
            await sleep(480);
        }
        const r = ftpGet(this.sys, this, this._ftpHost, fileName, this._ftpUser, this._ftpPass);
        if (!log) return r;
        if (r.ok) {
            log.textContent = `下载完成：${r.file.name}（${r.file.size} 字节）\n` +
                '────────────────────────────────\n' + (r.file.content || '');
        } else {
            log.textContent = `下载失败：${r.reason === 'not_found' ? '文件不存在' : '连接失败'}`;
        }
        return r;
    }

    /** 自动演示：打开浏览器 → 逐字输入网址 → “连接/加载”过程 → 渲染网页 → 停留展示 */
    async demoBrowser(url = 'http://www.example.com/', opts = {}) {
        const { holdMs = 7000 } = opts;
        this.showConfigDialog('browser');
        await sleep(700);
        const input = document.getElementById('diag_browser_url');
        const view = document.getElementById('browser_view');
        if (input) {
            input.value = '';
            for (let i = 1; i <= url.length; i++) { input.value = url.slice(0, i); await sleep(55); }
        }
        await sleep(500);
        if (view) view.innerHTML = '<div style="color:#57606a;">正在连接服务器…</div>';
        await sleep(1100);
        if (view) view.innerHTML = '<div style="color:#57606a;">正在加载页面…</div>';
        await sleep(900);
        this._browserGo(view);
        await sleep(holdMs);          // 停留展示网页内容
        closeActiveNetDialog();
    }

    /** 自动演示：打开 FTP 客户端 → 连接 → 停留展示目录 → 下载（过程动画）→ 停留展示文件内容 */
    async demoFtp(opts = {}) {
        const { host = '203.0.113.10', user = 'ftpuser', pass = 'ftp123', file = 'readme.txt', holdMs = 7000 } = opts;
        this.showConfigDialog('ftp');
        await sleep(700);
        const setv = (i, v) => { const e = document.getElementById(i); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
        setv('diag_ftp_host', host); setv('diag_ftp_user', user); setv('diag_ftp_pass', pass);
        const view = document.getElementById('ftp_view');
        if (view) view.innerHTML = `<div style="color:#8b949e;">正在连接 ${host} …</div>`;
        await sleep(1100);
        this._ftpLogin(view);
        await sleep(3200);            // 停留展示目录列表
        if (file) await this._ftpDownload(view, file);
        await sleep(holdMs);          // 停留展示下载完成的文件内容
        closeActiveNetDialog();
    }

    openConfigDialog(page = 'ip') { this.showConfigDialog(page); }

    _renderIpTab(el, api) {
        el.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'max-width:420px;';

        const row = (label, inputHtml) => `
            <div style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;color:#666;margin-bottom:5px;">${label}</label>
                ${inputHtml}
            </div>`;
        const inputStyle = 'width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:4px;';

        wrap.innerHTML =
            row('IP 地址', `<input type="text" id="diag_ip" value="${this.ip}" placeholder="如 192.168.1.2（出厂未配置）" style="${inputStyle}">`) +
            row('子网掩码', `<input type="text" id="diag_mask" value="${this.mask}" placeholder="如 255.255.255.0（出厂未配置）" style="${inputStyle}">`) +
            row('默认网关', `<input type="text" id="diag_gateway" value="${this.gateway}" placeholder="跨网段时填写，如 192.168.1.1" style="${inputStyle}">`) +
            row('DNS 服务器', `<input type="text" id="diag_dns" value="${this.dns}" placeholder="如 192.168.1.1 或 114.114.114.114" style="${inputStyle}">`) +
            `<div style="margin-bottom:16px;display:flex;align-items:center;gap:8px;">
                <input type="checkbox" id="diag_dhcp" ${this.dhcp ? 'checked' : ''} style="width:16px;height:16px;">
                <label for="diag_dhcp" style="font-size:13px;color:#333;cursor:pointer;">启用 DHCP（自动获取 IP）</label>
            </div>`;

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
        const cancel = document.createElement('button');
        cancel.textContent = '取消';
        cancel.style.cssText = 'padding:8px 16px;border:none;background:#eee;border-radius:4px;cursor:pointer;';
        cancel.onclick = () => closeActiveNetDialog();
        const save = document.createElement('button');
        save.textContent = '保存';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => this._saveFromDialog();
        btnRow.appendChild(cancel);
        btnRow.appendChild(save);

        el.appendChild(wrap);
        el.appendChild(btnRow);
    }

    _saveFromDialog() {
        const ip = (document.getElementById('diag_ip') || {}).value || '';
        const mask = (document.getElementById('diag_mask') || {}).value || '';
        const gateway = (document.getElementById('diag_gateway') || {}).value || '';
        const dns = (document.getElementById('diag_dns') || {}).value || '';
        const dhcp = !!(document.getElementById('diag_dhcp') || {}).checked;

        if (!dhcp) {
            if (!isValidIp(ip)) { alert('IP 地址格式不正确，请检查（如 192.168.1.10）'); return; }
            if (!isValidMask(mask)) { alert('子网掩码格式不正确，请检查（如 255.255.255.0）'); return; }
        }
        if (gateway && !isValidIp(gateway)) { alert('默认网关格式不正确，请检查'); return; }
        if (dns && !isValidIp(dns)) { alert('DNS 服务器格式不正确，请检查'); return; }

        this.onConfigUpdate({ ip, mask, gateway, dns, dhcp });
        closeActiveNetDialog();
        if (dhcp && this._hasLink()) {
            const r = dhcpRequest(this.sys, this);
            if (r.ok) this.sys.showFloatingTip(`PC ${this.hostname} 通过 DHCP 获取到地址 ${r.ip}`);
        }
    }

    _renderCliTab(el) {
        el.innerHTML = '';
        const tip = document.createElement('div');
        tip.style.cssText = 'font-size:12px;color:#666;margin-bottom:8px;';
        const ipText = isValidIp(this.ip) ? `${this.ip}/${maskPrefix(this.mask)}` : '（未配置 IP）';
        tip.textContent = `提示：可用命令 ipconfig、ipconfig /all、ping <IP>、tracert <IP>、arp -a、cls、help。当前地址 ${ipText}`;
        el.appendChild(tip);

        this._terminal = new Terminal({
            prompt: 'C:\\Users\\' + this.hostname + '>',
            height: 340,
            welcome: 'Microsoft Windows [版本 10.0.19045.3803]\n(c) Microsoft Corporation。保留所有权利。\n',
            onCommand: (cmd, term) => this._handleCommand(cmd, term),
        });
        el.appendChild(this._terminal.element);
    }

    // ─────────────────────────────────────────────────────────
    //  命令行解析
    // ─────────────────────────────────────────────────────────

    _handleCommand(cmd, term) {
        const raw = String(cmd || '').trim();
        if (!raw) return undefined;
        const parts = raw.split(/\s+/);
        const name = parts[0].toLowerCase();

        if (name === 'ipconfig') return this._cmdIpconfig(parts, term);
        if (name === 'ping') return this._cmdPing(parts, term);
        if (name === 'tracert' || name === 'traceroute') return this._cmdTracert(parts, term);
        if (name === 'nslookup') return this._cmdNslookup(parts, term);
        if (name === 'arp') { this._cmdArp(term); return undefined; }
        if (name === 'cls' || name === 'clear') { term.clear(); return undefined; }
        if (name === 'help' || name === '?') {
            term.print('可用命令：', 'term-info');
            term.print('  ipconfig            显示当前 IP 配置', 'term-dim');
            term.print('  ipconfig /all       显示完整 IP 配置（含 MAC、DHCP）', 'term-dim');
            term.print('  ipconfig /renew     向 DHCP 服务器续租地址', 'term-dim');
            term.print('  ipconfig /release   释放 DHCP 地址租约', 'term-dim');
            term.print('  ipconfig /displaydns 显示 DNS 解析缓存', 'term-dim');
            term.print('  ipconfig /flushdns  清空 DNS 解析缓存', 'term-dim');
            term.print('  nslookup <域名> [DNS]  查询域名对应的 IP 地址', 'term-dim');
            term.print('  ping <IP|域名>      测试与目标主机的连通性', 'term-dim');
            term.print('  ping -n <N> <目标>  指定发送 N 个数据包', 'term-dim');
            term.print('  tracert <IP|域名>   逐跳跟踪到目标的路由', 'term-dim');
            term.print('  arp -a              显示 ARP 缓存表', 'term-dim');
            term.print('  cls                 清屏', 'term-dim');
            return undefined;
        }
        if (name === 'exit' || name === 'quit') { closeActiveNetDialog(); return undefined; }

        term.print(`'${parts[0]}' 不是内部或外部命令，也不是可运行的程序或批处理文件。`, 'term-err');
        return undefined;
    }

    _cmdIpconfig(parts, term) {
        const release = parts.some(p => p.toLowerCase() === '/release');
        const renew = parts.some(p => p.toLowerCase() === '/renew');
        const displaydns = parts.some(p => p.toLowerCase() === '/displaydns');
        const flushdnsCmd = parts.some(p => p.toLowerCase() === '/flushdns');
        if (flushdnsCmd) {
            flushDns(this);
            term.print('已成功刷新 DNS 解析缓存。', 'term-dim');
            return undefined;
        }
        if (displaydns) {
            const rows = dnsCache(this);
            term.print('');
            term.print('Windows IP 配置', 'term-info');
            term.print('');
            term.print('    已配置的 DNS 服务器 . . . . . . . : ' + (this.dns || '（未配置）'));
            term.print('');
            if (!rows.length) term.print('   （DNS 缓存为空）', 'term-dim');
            rows.forEach(r => {
                term.print(`   记录名称 . . . . . . : ${r.host}`);
                term.print(`   记录类型 . . . . . . : 1`);
                term.print(`   记录数据 . . . . . . : ${r.ip}`);
                term.print('');
            });
            return undefined;
        }
        if (release) {
            dhcpRelease(this.sys, this);
            term.print('已释放 IP 地址租约。', 'term-dim');
            return undefined;
        }
        if (renew) {
            const r = dhcpRequest(this.sys, this);
            if (r.ok) {
                term.print('');
                term.print('以太网适配器 本地连接:', 'term-dim');
                term.print(`   IPv4 地址 . . . . . . . . . . . . : ${r.ip}`);
                term.print(`   子网掩码  . . . . . . . . . . . . : ${r.mask}`);
                term.print(`   默认网关. . . . . . . . . . . . . : ${r.gateway}`);
                term.print(`   DHCP 服务器 . . . . . . . . . . . : ${r.server}`);
                term.print('');
            } else {
                term.print(`未获取到 DHCP 地址（${r.reason === 'no_server' ? '未找到 DHCP 服务器' : '地址池已耗尽'}）。`, 'term-err');
            }
            return undefined;
        }
        const all = parts.some(p => p.toLowerCase() === '/all');
        term.print('');
        term.print('Windows IP 配置', 'term-info');
        term.print('');
        term.print('以太网适配器 本地连接:', 'term-dim');
        term.print('');
        if (!isValidIp(this.ip)) {
            term.print('   媒体状态  . . . . . . . . . . . . : 媒体已断开或未配置');
            term.print('   IPv4 地址 . . . . . . . . . . . . : （未配置）');
            if (all) {
                term.print(`   主机名  . . . . . . . . . . . . . : ${this.hostname}`);
                term.print(`   物理地址. . . . . . . . . . . . . : ${this.mac}`);
                term.print(`   DHCP 已启用 . . . . . . . . . . . : ${this.dhcp ? '是' : '否'}`);
            }
            term.print('');
            return undefined;
        }
        if (all) {
            term.print(`   主机名  . . . . . . . . . . . . . : ${this.hostname}`);
            term.print(`   主 DNS 后缀 . . . . . . . . . . . : `);
            term.print(`   节点类型. . . . . . . . . . . . . : 混合`);
            term.print(`   IP 路由已启用 . . . . . . . . . . : 否`);
            term.print(`   物理地址. . . . . . . . . . . . . : ${this.mac}`);
            term.print(`   DHCP 已启用 . . . . . . . . . . . : ${this.dhcp ? '是' : '否'}`);
            term.print(`   自动配置已启用. . . . . . . . . . : ${this.dhcp ? '是' : '否'}`);
            term.print(`   IPv4 地址 . . . . . . . . . . . . : ${this.ip}(首选)`);
            term.print(`   子网掩码  . . . . . . . . . . . . : ${this.mask}`);
            term.print(`   默认网关. . . . . . . . . . . . . : ${this.gateway || ''}`);
            term.print(`   DNS 服务器  . . . . . . . . . . . : ${this.dns || ''}`);
        } else {
            term.print(`   IPv4 地址 . . . . . . . . . . . . : ${this.ip}`);
            term.print(`   子网掩码  . . . . . . . . . . . . : ${this.mask}`);
            term.print(`   默认网关. . . . . . . . . . . . . : ${this.gateway || ''}`);
        }
        term.print('');
        return undefined;
    }

    async _cmdPing(parts, term) {
        let count = 4;
        let target = null;
        const args = parts.slice(1);
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            const low = a.toLowerCase();
            if (low === '-n' && args[i + 1] !== undefined) {
                count = Math.max(1, Math.min(20, parseInt(args[i + 1], 10) || 4));
                i++;
            } else if (/^-n\d+$/.test(low)) {
                count = Math.max(1, Math.min(20, parseInt(low.slice(2), 10) || 4));
            } else if (!a.startsWith('-')) {
                target = a;
            }
        }
        if (!target) {
            term.print('用法: ping [-n 次数] <目标IP|域名>', 'term-warn');
            return;
        }

        // 域名 → 先做 DNS 解析
        let ipTarget = target;
        if (!isValidIp(target)) {
            const dns = resolveDomain(this.sys, this, target, this.dns);
            if (!dns.ok) {
                const why = dns.reason === 'nxdomain' ? '找不到主机' : (dns.reason === 'timeout' ? 'DNS 服务器无响应' : '未配置有效的 DNS 服务器');
                term.print(`Ping 请求找不到主机 ${target}。${why}。`, 'term-err');
                return;
            }
            ipTarget = dns.ip;
            term.print(`正在 Ping ${target} [${ipTarget}] 具有 32 字节的数据:`, 'term-dim');
        }

        const result = runPing(this.sys, this, ipTarget, count);
        if (result.reason === 'bad_ip') {
            term.print(`Ping 请求找不到主机 ${target}。请检查该名称，然后重试。`, 'term-err');
            return;
        }
        if (result.reason === 'no_ip') {
            term.print('本机未配置有效的 IPv4 地址，无法发送 Ping 请求。', 'term-err');
            return;
        }

        const lines = formatPingLines(result, target, count);
        for (const l of lines) {
            let cls = 'term-dim';
            if (l.includes('回复')) cls = 'term-ok';
            else if (l.includes('超时') || l.includes('无法访问') || l.includes('传输失败') || l.includes('过期') || l.includes('找不到主机')) cls = 'term-err';
            term.print(l, cls);
            if (l.includes('回复') || l.includes('超时') || l.includes('无法访问') || l.includes('传输失败') || l.includes('过期')) await sleep(this._demoActive ? DEMO.LINE_DELAY : DEMO.LINE_DELAY_MANUAL);
        }
    }

    async _cmdTracert(parts, term) {
        const target = parts.slice(1).find(p => !p.startsWith('-'));
        if (!target) { term.print('用法: tracert <目标IP>', 'term-warn'); return; }
        term.print('');
        term.print(`通过最多 8 个跃点跟踪到 ${target} 的路由`, 'term-dim');
        term.print('');
        const hops = tracert(this.sys, this, target, 8);
        for (const h of hops) {
            term.print(`  ${String(h.ttl).padStart(2)}    <1ms    ${h.ip || '*'}    ${h.label || ''}`, h.ok ? '' : 'term-err');
            await sleep(this._demoActive ? DEMO.LINE_DELAY : DEMO.LINE_DELAY_MANUAL);
        }
        term.print('');
        term.print('跟踪完成。', 'term-dim');
        term.print('');
    }

    _cmdNslookup(parts, term) {
        const target = parts.slice(1).find(p => !p.startsWith('-'));
        if (!target) { term.print('用法: nslookup <域名> [DNS 服务器]', 'term-warn'); return undefined; }
        const dnsArg = parts.slice(2).find(p => isValidIp(p)) || '';
        const useDns = dnsArg || this.dns || '（未配置）';
        term.print('');
        term.print(`服务器:  ${useDns}`, 'term-dim');
        term.print('Address:  ' + (dnsArg || this.dns || '未知'), 'term-dim');
        term.print('');
        if (isValidIp(target)) {
            term.print(`名称:     ${target}`, 'term-dim');
            term.print(`Address:  ${target}`, 'term-info');
            term.print('');
            return undefined;
        }
        const r = resolveDomain(this.sys, this, target, dnsArg || this.dns);
        if (!r.ok) {
            const msg = {
                nxdomain: `*** ${this.dns || 'DNS'} 无法找到 ${target}: Non-existent domain`,
                no_dns: '*** 未配置 DNS 服务器，无法解析域名。',
                no_server: '*** 指定的 DNS 服务器不可达或未提供 DNS 服务。',
                timeout: '*** DNS 查询请求超时。',
            }[r.reason] || '*** 解析失败。';
            term.print(msg, 'term-err');
            term.print('');
            return undefined;
        }
        term.print(`名称:     ${target}`, 'term-dim');
        term.print(`Address:  ${r.ip}`, 'term-ok');
        if (r.server) term.print(`（由 ${r.server.hostname} 解析）`, 'term-dim');
        term.print('');
        return undefined;
    }

    _cmdArp(term) {
        term.print('');
        term.print('接口: 本地连接 --- 0x5', 'term-dim');
        term.print('  Internet 地址        物理地址              类型', 'term-info');
        const rows = arpTable(this);
        if (!rows.length) term.print('  （ARP 缓存为空）', 'term-dim');
        rows.forEach(r => term.print(`  ${r.ip.padEnd(20)} ${r.mac.padEnd(20)} 动态`));
        term.print('');
    }

    // ─────────────────────────────────────────────────────────
    //  自动演示：打开命令行并逐字执行
    // ─────────────────────────────────────────────────────────

    /**
     * 自动演示用：打开命令行页面 → 逐字键入命令 → 等待输出 → 停留后关闭。
     * @param {string} cmd
     * @param {{holdMs?:number, keepOpen?:boolean}} [opts]
     */
    async demoCommand(cmd, opts = {}) {
        const { holdMs = DEMO.CMD_HOLD, keepOpen = false } = opts;
        this.showConfigDialog('cli');
        await sleep(350);
        const term = this._terminal;
        if (!term) return;
        this._demoActive = true;
        try {
            await term.typeCommand(cmd);
            if (holdMs) await sleep(holdMs);
        } finally {
            this._demoActive = false;
        }
        if (!keepOpen) closeActiveNetDialog();
    }

    /** 自动演示：一次打开终端，连续逐字执行多条命令 */
    async demoScript(cmds, opts = {}) {
        const { holdMs = DEMO.SCRIPT_CMD_HOLD, endHoldMs = DEMO.SCRIPT_END_HOLD } = opts;
        this.showConfigDialog('cli');
        await sleep(350);
        const term = this._terminal;
        if (!term) return;
        this._demoActive = true;
        try {
            for (const c of cmds) {
                await term.typeCommand(c);
                if (holdMs) await sleep(holdMs);
            }
            await sleep(endHoldMs);
        } finally {
            this._demoActive = false;
        }
        closeActiveNetDialog();
    }
}
