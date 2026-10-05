import { BaseComponent } from './BaseComponent.js';
import { Terminal, openTabbedDialog, closeActiveNetDialog, sleep } from '../lib/NetConsole.js';
import { DEMO } from '../lib/DemoTiming.js';
import {
    macOf, runPing, formatPingLines, isValidIp, isValidMask, maskPrefix, peerOfPort, deviceIdOfPort,
} from '../tools/NetworkSim.js';
import { serverServices } from '../tools/NetServices.js';

/**
 * NetServer — 统一服务器组件（HTTP / FTP / DNS，可分别启用）
 *
 * 交互：
 *   - 双击 → 多页面配置对话框：① 网络  ② 服务  ③ 内容  ④ 命令行
 *   - 右键 → 断开所有连线
 * 端口：<id>_wire_lan（一个以太网口）
 */
export class NetServer extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'net_server';
        this.cache = 'fixed';
        this.label = '服务器';

        this.width = 320;
        this.height = 190;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            hostname: this.hostname,
            ip: this.ip, mask: this.mask, gateway: this.gateway, dns: this.dns,
            httpEnabled: this.httpEnabled, ftpEnabled: this.ftpEnabled, dnsEnabled: this.dnsEnabled,
            pages: JSON.parse(JSON.stringify(this.pages)),
            ftpFiles: this.ftpFiles.map(f => ({ ...f })),
            ftpUsers: this.ftpUsers.map(u => ({ ...u })),
            dnsRecords: this.dnsRecords.map(r => ({ ...r })),
        };

        this.addPort(this._portX, this._portY, 'lan', 'wire');
    }

    // ─────────────────────────────────────────────────────────
    //  初始化
    // ─────────────────────────────────────────────────────────

    _recalcGeometry() {
        this._portX = 168;
        this._portY = 58;
    }

    _initParameters(config) {
        this.hostname = config.hostname || config.id || 'SRV';
        this.ip = config.ip || '';
        this.mask = config.mask || '';
        this.gateway = config.gateway || '';
        this.dns = config.dns || '';
        this.mac = config.mac || macOf(this);

        this.httpEnabled = config.httpEnabled !== false;
        this.ftpEnabled = !!config.ftpEnabled;
        this.dnsEnabled = !!config.dnsEnabled;

        const defPages = {
            '/': { title: `${this.hostname} 示例站点`, body: '欢迎访问本服务器！这是一个教学用 HTTP 服务器。' },
            '/index.html': { title: `${this.hostname} 示例站点`, body: '欢迎访问本服务器！这是一个教学用 HTTP 服务器。' },
        };
        this.pages = Object.assign(defPages, config.pages ? JSON.parse(JSON.stringify(config.pages)) : {});
        this.ftpFiles = Array.isArray(config.ftpFiles) && config.ftpFiles.length
            ? config.ftpFiles.map(f => ({ ...f }))
            : [
                { name: 'readme.txt', size: 1024, content: 'FTP 服务器说明文件。' },
                { name: 'data.csv', size: 2048, content: 'id,value\n1,100\n2,200\n' },
            ];
        this.ftpUsers = Array.isArray(config.ftpUsers) && config.ftpUsers.length
            ? config.ftpUsers.map(u => ({ ...u }))
            : [{ user: 'ftpuser', pass: 'ftp123' }, { user: 'anonymous', pass: '' }];
        this.dnsRecords = Array.isArray(config.dnsRecords) && config.dnsRecords.length
            ? config.dnsRecords.map(r => ({ ...r }))
            : [{ host: 'www.example.com', ip: config.ip || '203.0.113.10' }];

        this._linkOn = false;
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
            body: '#455a64', bodyEdge: '#1c262b', bezel: '#37474f',
            slot: '#1a252b', socket: '#101820', socketEdge: '#90a4ae',
            text: '#eceff1', dim: '#b0bec5',
        };

        g.add(new Konva.Rect({
            x: -160, y: -85, width: 320, height: 170,
            fill: C.body, stroke: C.bodyEdge, strokeWidth: 2, cornerRadius: 10,
        }));
        g.add(new Konva.Rect({
            x: -160, y: -85, width: 320, height: 28,
            fill: C.bezel, cornerRadius: [10, 10, 0, 0],
        }));
        // 硬盘位
        for (let i = 0; i < 4; i++) {
            g.add(new Konva.Rect({
                x: -146, y: -46 + i * 22, width: 150, height: 16, fill: C.slot, cornerRadius: 3,
            }));
            g.add(new Konva.Rect({ x: 10, y: -42 + i * 22, width: 6, height: 8, fill: '#2c3a42', cornerRadius: 2 }));
        }
        // 网口
        g.add(new Konva.Rect({
            x: 156, y: 50, width: 24, height: 16,
            fill: C.socket, stroke: C.socketEdge, strokeWidth: 1, cornerRadius: 2,
        }));
        g.add(new Konva.Text({
            x: 132, y: 68, text: '网口', fontFamily: 'Microsoft YaHei', fontSize: 10, fill: C.dim,
        }));
        // 类型标注
        g.add(new Konva.Text({
            x: -146, y: 40, text: 'Rack Server 1U', fontFamily: 'Consolas, monospace', fontSize: 11, fill: C.dim,
        }));
        // 电源灯
        g.add(new Konva.Circle({ x: 146, y: -71, radius: 4, fill: '#22c55e', stroke: '#0f5132', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: 120, y: -80, text: 'PWR', fontFamily: 'Consolas, monospace', fontSize: 9, fill: C.dim }));

        this.addClickablePart('lan', this._portX - 16, this._portY - 12, 32, 24);
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        this._hostText = new Konva.Text({
            x: -148, y: -76, text: '', fontFamily: 'Microsoft YaHei',
            fontSize: 16, fontStyle: 'bold', fill: '#ffffff',
        });
        d.add(this._hostText);

        this._ipText = new Konva.Text({
            x: -146, y: 60, width: 240, text: '', fontFamily: 'Consolas, monospace',
            fontSize: 12, fill: '#8fd6ff',
        });
        d.add(this._ipText);

        // 服务指示灯
        this._svcLeds = {};
        const defs = [['dns', 'DNS'], ['http', 'HTTP'], ['ftp', 'FTP']];
        defs.forEach(([key, name], i) => {
            const x = 30 + i * 44;
            const led = new Konva.Circle({ x, y: -55, radius: 4, fill: '#555555', stroke: '#222', strokeWidth: 1 });
            d.add(led);
            const t = new Konva.Text({ x: x - 18, y: -44, width: 36, align: 'center', text: name, fontFamily: 'Consolas, monospace', fontSize: 10, fill: '#cfd8dc' });
            d.add(t);
            this._svcLeds[key] = led;
        });

        this._linkLed = new Konva.Circle({
            x: this._portX - 18, y: this._portY - 14, radius: 3.5,
            fill: '#555555', stroke: '#222', strokeWidth: 1,
        });
        d.add(this._linkLed);

        this.addClickablePart('dns', 12, -67, 36, 46);
        this.addClickablePart('http', 56, -67, 36, 46);
        this.addClickablePart('ftp', 100, -67, 36, 46);

        this._updateDynamic();
    }

    _bindInteraction() {
        this.group.on('dblclick dbltap', (e) => {
            e.cancelBubble = true;
            this.showConfigDialog('net');
        });
    }

    _updateDynamic() {
        if (this._hostText) this._hostText.text(this.hostname);
        if (this._ipText) {
            const base = this.ip ? `${this.ip}/${maskPrefix(this.mask)}` : '未配置 IP';
            const svc = serverServices(this).join('/') || '无服务';
            this._ipText.text(`${base}   服务: ${svc}`);
        }
        if (this._svcLeds) {
            this._svcLeds.dns.fill(this.dnsEnabled ? '#22c55e' : '#555555');
            this._svcLeds.http.fill(this.httpEnabled ? '#22c55e' : '#555555');
            this._svcLeds.ftp.fill(this.ftpEnabled ? '#22c55e' : '#555555');
        }
    }

    // ─────────────────────────────────────────────────────────
    //  仿真循环
    // ─────────────────────────────────────────────────────────

    tick() {
        const link = !!peerOfPort(this.sys, `${this.id}_wire_lan`);
        if (link !== this._linkOn) {
            this._linkOn = link;
            this._linkLed.fill(link ? '#22c55e' : '#555555');
            this.sys.requestRedraw();
        }
    }

    // ─────────────────────────────────────────────────────────
    //  参数接口
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
        if (cfg.httpEnabled !== undefined) this.httpEnabled = !!cfg.httpEnabled;
        if (cfg.ftpEnabled !== undefined) this.ftpEnabled = !!cfg.ftpEnabled;
        if (cfg.dnsEnabled !== undefined) this.dnsEnabled = !!cfg.dnsEnabled;
        if (cfg.pages) this.pages = JSON.parse(JSON.stringify(cfg.pages));
        if (Array.isArray(cfg.ftpFiles) && cfg.ftpFiles.length) this.ftpFiles = cfg.ftpFiles.map(f => ({ ...f }));
        if (Array.isArray(cfg.ftpUsers) && cfg.ftpUsers.length) this.ftpUsers = cfg.ftpUsers.map(u => ({ ...u }));
        if (Array.isArray(cfg.dnsRecords)) this.dnsRecords = cfg.dnsRecords.map(r => ({ ...r }));
        this.config = {
            ...this.config,
            hostname: this.hostname, ip: this.ip, mask: this.mask,
            gateway: this.gateway, dns: this.dns,
            httpEnabled: this.httpEnabled, ftpEnabled: this.ftpEnabled, dnsEnabled: this.dnsEnabled,
            pages: JSON.parse(JSON.stringify(this.pages)),
            ftpFiles: this.ftpFiles.map(f => ({ ...f })),
            ftpUsers: this.ftpUsers.map(u => ({ ...u })),
            dnsRecords: this.dnsRecords.map(r => ({ ...r })),
        };
        this._updateDynamic();
        this._syncPrompt();
        this.sys.requestRedraw();
    }

    // ─────────────────────────────────────────────────────────
    //  连线操作
    // ─────────────────────────────────────────────────────────

    getContextMenuItems() {
        return [{ label: '断开所有连线', onClick: () => this.disconnectAll() }];
    }

    disconnectAll() {
        const sys = this.sys;
        const conns = (sys.conns || []).filter(c =>
            c.type === 'wire' && (deviceIdOfPort(c.from) === this.id || deviceIdOfPort(c.to) === this.id));
        conns.forEach(c => sys.removeConn(c));
        sys.showFloatingTip(conns.length ? `已断开 ${conns.length} 条连线` : '本服务器没有已连接的线缆');
    }

    // ─────────────────────────────────────────────────────────
    //  多页面板
    // ─────────────────────────────────────────────────────────

    showConfigDialog(tab = 'net') {
        const tabs = [
            { id: 'net', label: '网络', render: (el) => this._renderNetTab(el) },
            { id: 'svc', label: '服务', render: (el) => this._renderSvcTab(el) },
            { id: 'content', label: '内容', render: (el) => this._renderContentTab(el) },
            { id: 'cli', label: '命令行', render: (el) => this._renderCliTab(el) },
        ];
        this._dialog = openTabbedDialog({
            title: `服务器配置 — ${this.hostname}（${this.id}）`,
            tabs, width: 760, height: 540, container: this.sys.container,
        });
        const idx = Math.max(0, tabs.findIndex(t => t.id === tab));
        setTimeout(() => this._dialog && this._dialog.switchTab(idx), 0);
    }
    openConfigDialog(tab = 'net') { this.showConfigDialog(tab); }

    _renderNetTab(el) {
        el.innerHTML = '';
        const inputStyle = 'width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:4px;';
        const row = (label, id, val, ph) => `<div style="margin-bottom:12px;">
            <label style="display:block;font-size:12px;color:#666;margin-bottom:5px;">${label}</label>
            <input type="text" id="${id}" value="${val || ''}" placeholder="${ph || ''}" style="${inputStyle}"></div>`;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'max-width:440px;';
        wrap.innerHTML =
            row('主机名', 'diag_hostname', this.hostname) +
            row('IP 地址', 'diag_ip', this.ip, '如 203.0.113.10（出厂未配置）') +
            row('子网掩码', 'diag_mask', this.mask, '如 255.255.255.0') +
            row('默认网关', 'diag_gateway', this.gateway, '如 203.0.113.1') +
            row('DNS 服务器', 'diag_dns', this.dns, '如 203.0.113.10');
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:6px;';
        const save = document.createElement('button');
        save.textContent = '保存';
        save.id = 'srv_net_save_btn';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => this._saveNet();
        btnRow.appendChild(save);
        el.appendChild(wrap);
        el.appendChild(btnRow);
    }

    _saveNet() {
        const g = id => ((document.getElementById(id) || {}).value || '').trim();
        const ip = g('diag_ip'), mask = g('diag_mask'), gateway = g('diag_gateway'), dns = g('diag_dns');
        if (ip && !isValidIp(ip)) { alert('IP 地址格式不正确'); return; }
        if (ip && !isValidMask(mask)) { alert('子网掩码格式不正确'); return; }
        if (gateway && !isValidIp(gateway)) { alert('默认网关格式不正确'); return; }
        if (dns && !isValidIp(dns)) { alert('DNS 服务器格式不正确'); return; }
        this.onConfigUpdate({ hostname: g('diag_hostname') || this.hostname, ip, mask, gateway, dns });
        closeActiveNetDialog();
    }

    _renderSvcTab(el) {
        el.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'font-size:13px;margin-bottom:14px;';
        head.innerHTML =
            `<label style="display:block;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="diag_srv_dns" ${this.dnsEnabled ? 'checked' : ''}> 启用 DNS 服务（提供域名解析，端口 53）</label>
             <label style="display:block;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="diag_srv_http" ${this.httpEnabled ? 'checked' : ''}> 启用 HTTP 服务（Web 网站，端口 80）</label>
             <label style="display:block;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="diag_srv_ftp" ${this.ftpEnabled ? 'checked' : ''}> 启用 FTP 服务（文件传输，端口 21）</label>`;
        el.appendChild(head);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
        const save = document.createElement('button');
        save.textContent = '保存';
        save.id = 'srv_svc_save_btn';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => {
            const checked = id => !!(document.getElementById(id) || {}).checked;
            this.onConfigUpdate({
                dnsEnabled: checked('diag_srv_dns'),
                httpEnabled: checked('diag_srv_http'),
                ftpEnabled: checked('diag_srv_ftp'),
            });
            closeActiveNetDialog();
        };
        btnRow.appendChild(save);
        el.appendChild(btnRow);
    }

    _renderContentTab(el) {
        el.innerHTML = '';
        const inputStyle = 'padding:6px;border:1px solid #ccc;border-radius:4px;';

        // HTTP 主页
        const httpBox = document.createElement('div');
        httpBox.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin-bottom:12px;';
        httpBox.innerHTML =
            `<div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">HTTP 主页（路径 /）</div>
             <input id="diag_http_title" style="${inputStyle};width:100%;box-sizing:border-box;margin-bottom:8px;" value="${(this.pages['/'] && this.pages['/'].title) || ''}" placeholder="页面标题">
             <textarea id="diag_http_body" style="${inputStyle};width:100%;box-sizing:border-box;height:70px;" placeholder="页面正文">${(this.pages['/'] && this.pages['/'].body) || ''}</textarea>`;
        el.appendChild(httpBox);

        // FTP 文件与账号
        const ftpBox = document.createElement('div');
        ftpBox.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;';
        ftpBox.innerHTML = `<div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">FTP 文件与账号</div>
            <div>文件：${this.ftpFiles.map(f => `${f.name}(${f.size}B)`).join('、') || '（无）'}</div>
            <div style="margin-top:6px;">账号：${this.ftpUsers.map(u => u.user).join('、') || '（匿名）'}</div>`;
        el.appendChild(ftpBox);

        // DNS 记录
        const dnsBox = document.createElement('div');
        dnsBox.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;';
        const list = (this.dnsRecords || []).map(r => `<div style="color:#555;">&nbsp;&nbsp;${r.host} → ${r.ip}</div>`).join('') || '<div style="color:#999;">&nbsp;&nbsp;（无记录）</div>';
        dnsBox.innerHTML = `<div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">DNS A 记录</div>
            <div id="dns_record_list">${list}</div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:flex-end;">
                <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">域名</label>
                    <input id="diag_dnsrec_host" style="${inputStyle}" placeholder="www.example.com"></div>
                <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">IP 地址</label>
                    <input id="diag_dnsrec_ip" style="${inputStyle}" placeholder="203.0.113.10"></div>
            </div>`;
        el.appendChild(dnsBox);

        const addRecBtn = document.createElement('button');
        addRecBtn.textContent = '添加 DNS 记录';
        addRecBtn.id = 'dnsrec_add_btn';
        addRecBtn.style.cssText = 'padding:8px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;margin-right:10px;';
        addRecBtn.onclick = () => {
            const host = ((document.getElementById('diag_dnsrec_host') || {}).value || '').trim();
            const ip = ((document.getElementById('diag_dnsrec_ip') || {}).value || '').trim();
            if (!host || !isValidIp(ip)) { alert('请填写域名与正确的 IP 地址'); return; }
            this.dnsRecords.push({ host, ip });
            this.onConfigUpdate({ dnsRecords: this.dnsRecords });
            this._renderContentTab(el);
        };

        const save = document.createElement('button');
        save.textContent = '保存';
        save.id = 'srv_content_save_btn';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => {
            const title = ((document.getElementById('diag_http_title') || {}).value || '').trim();
            const body = ((document.getElementById('diag_http_body') || {}).value || '');
            const pages = { ...this.pages, '/': { title, body }, '/index.html': { title, body } };
            this.onConfigUpdate({ pages });
            closeActiveNetDialog();
        };

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:6px;';
        btnRow.appendChild(addRecBtn);
        btnRow.appendChild(save);
        el.appendChild(btnRow);
    }

    _renderCliTab(el) {
        el.innerHTML = '';
        const tip = document.createElement('div');
        tip.style.cssText = 'font-size:12px;color:#666;margin-bottom:8px;';
        tip.textContent = '可用命令：ipconfig、display services、display dns-records、display http、display ftp、ping <IP>、cls、help。';
        el.appendChild(tip);
        this._terminal = new Terminal({
            prompt: `${this.hostname}$ `,
            height: 380,
            welcome: 'Info: 正在进入服务器控制台 ...\n',
            onCommand: (cmd, term) => this._handleCommand(cmd, term),
        });
        el.appendChild(this._terminal.element);
    }

    _syncPrompt() { if (this._terminal) this._terminal.setPrompt(`${this.hostname}$ `); }

    _handleCommand(cmd, term) {
        const raw = String(cmd || '').trim();
        if (!raw) return undefined;
        const parts = raw.split(/\s+/);
        const name = parts[0].toLowerCase();

        if (name === 'ipconfig' || name === 'ifconfig') {
            term.print('');
            term.print(`eth0: ${this.ip ? this.ip + '/' + maskPrefix(this.mask) : 'unassigned'}`);
            term.print(`  网关 ${this.gateway || '-'}   DNS ${this.dns || '-'}   MAC ${this.mac}`);
            term.print('');
            return undefined;
        }
        if (name === 'display' || name === 'show') {
            const sub = (parts[1] || '').toLowerCase();
            if (sub === 'services') {
                term.print('');
                term.print('服务状态：', 'term-info');
                term.print(`  DNS  : ${this.dnsEnabled ? '已启用 (53)' : '未启用'}`);
                term.print(`  HTTP : ${this.httpEnabled ? '已启用 (80)' : '未启用'}`);
                term.print(`  FTP  : ${this.ftpEnabled ? '已启用 (21)' : '未启用'}`);
                term.print('');
                return undefined;
            }
            if (sub === 'dns-records' || sub === 'dns') {
                term.print('');
                term.print('DNS A 记录：', 'term-info');
                if (!this.dnsRecords.length) term.print('  （无）', 'term-dim');
                this.dnsRecords.forEach(r => term.print(`  ${r.host} → ${r.ip}`));
                term.print('');
                return undefined;
            }
            if (sub === 'http') {
                term.print('');
                term.print(`HTTP 页面：${Object.keys(this.pages).join(' ')}`, 'term-info');
                term.print('');
                return undefined;
            }
            if (sub === 'ftp') {
                term.print('');
                term.print('FTP 文件：', 'term-info');
                this.ftpFiles.forEach(f => term.print(`  ${f.name}  ${f.size} 字节`));
                term.print('');
                return undefined;
            }
        }
        if (name === 'ping') return this._cmdPing(parts.slice(1), term);
        if (name === 'cls' || name === 'clear') { term.clear(); return undefined; }
        if (name === 'exit' || name === 'quit') { closeActiveNetDialog(); return undefined; }
        if (name === 'help' || name === '?') {
            term.print('可用命令：ipconfig、display services、display dns-records、display http、display ftp、ping <IP>、cls', 'term-dim');
            return undefined;
        }
        term.print(`'${parts[0]}' 不是可识别的命令。`, 'term-err');
        return undefined;
    }

    async _cmdPing(args, term) {
        const target = args.find(a => !a.startsWith('-'));
        if (!target) { term.print('用法: ping <目标IP>', 'term-warn'); return; }
        const result = runPing(this.sys, this, target, 4);
        if (result.reason === 'bad_ip') { term.print(`Ping 请求找不到主机 ${target}。`, 'term-err'); return; }
        const lines = formatPingLines(result, target, 4);
        for (const l of lines) {
            let cls = 'term-dim';
            if (l.includes('回复')) cls = 'term-ok';
            else if (l.includes('超时') || l.includes('无法访问') || l.includes('传输失败') || l.includes('过期') || l.includes('找不到主机')) cls = 'term-err';
            term.print(l, cls);
            if (l.includes('回复') || l.includes('超时') || l.includes('无法访问') || l.includes('传输失败') || l.includes('过期')) await sleep(this._demoActive ? DEMO.LINE_DELAY : DEMO.LINE_DELAY_MANUAL);
        }
    }

    // ─────────────────────────────────────────────────────────
    //  自动演示
    // ─────────────────────────────────────────────────────────

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
