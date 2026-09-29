import { BaseComponent } from './BaseComponent.js';
import { Terminal, openTabbedDialog, closeActiveNetDialog, sleep } from '../lib/NetConsole.js';
import { DEMO } from '../lib/DemoTiming.js';
import {
    macOf, runPing, formatPingLines, isValidIp, isValidMask, maskPrefix,
    tracert, arpTable, dhcpRequest, dhcpRelease,
} from '../tools/NetworkSim.js';

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
            { id: 'cli', label: '命令行', render: (el, api) => this._renderCliTab(el, api) },
        ];
        this._dialog = openTabbedDialog({
            title: `PC 配置 — ${this.hostname}（${this.id}）`,
            tabs,
            width: 660,
            height: 470,
            container: this.sys.container,
        });
        const idx = page === 'cli' ? 1 : 0;
        setTimeout(() => this._dialog && this._dialog.switchTab(idx), 0);
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
        if (name === 'arp') { this._cmdArp(term); return undefined; }
        if (name === 'cls' || name === 'clear') { term.clear(); return undefined; }
        if (name === 'help' || name === '?') {
            term.print('可用命令：', 'term-info');
            term.print('  ipconfig            显示当前 IP 配置', 'term-dim');
            term.print('  ipconfig /all       显示完整 IP 配置（含 MAC、DHCP）', 'term-dim');
            term.print('  ipconfig /renew     向 DHCP 服务器续租地址', 'term-dim');
            term.print('  ipconfig /release   释放 DHCP 地址租约', 'term-dim');
            term.print('  ping <IP>           测试与目标主机的连通性', 'term-dim');
            term.print('  ping -n <N> <IP>    指定发送 N 个数据包', 'term-dim');
            term.print('  tracert <IP>        逐跳跟踪到目标的路由', 'term-dim');
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
            term.print('用法: ping [-n 次数] <目标IP>', 'term-warn');
            return;
        }

        const result = runPing(this.sys, this, target, count);
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
