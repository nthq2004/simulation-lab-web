import { BaseComponent } from './BaseComponent.js';
import { Terminal, openTabbedDialog, closeActiveNetDialog, sleep } from '../lib/NetConsole.js';
import { DEMO } from '../lib/DemoTiming.js';
import {
    peerOfPort, deviceIdOfPort, runPing, formatPingLines, tracert, routingTable,
    isValidIp, isValidMask, maskPrefix, networkOf, macOfInterface, macOf,
    dhcpPoolStatus, arpTable, arpRecord, allInterfaces, inSameSubnet,
} from '../tools/NetworkSim.js';

/** 前缀长度 → 点分掩码 */
function prefixToMask(p) {
    const n = parseInt(p, 10);
    if (!(n >= 0 && n <= 32)) return null;
    const m = n === 0 ? 0 : ((0xffffffff << (32 - n)) >>> 0);
    return [(m >>> 24) & 0xff, (m >>> 16) & 0xff, (m >>> 8) & 0xff, m & 0xff].join('.');
}

/**
 * Router — 支持路由的三层设备（华为 VRP 风格）
 *
 * 接口：<id>_wire_g0 .. g<N-1>（名称 GigabitEthernet0/0/x，端口数可配 2~4）
 * 功能：接口 IP 配置（GUI + CLI）、静态路由、DHCP 服务器、ARP、ping/tracert、路由表
 * 交互：双击 → 多页面板（接口配置 / DHCP / 静态路由 / 命令行）
 *       右键 → 连接到选中的交换机/PC、断开所有连线
 */
export class Router extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'router';
        this.cache = 'fixed';
        this.label = '路由器';

        this.portCount = Math.max(2, Math.min(4, config.portCount || 2));
        this.width = 340;
        this.height = 160;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            hostname: this.hostname,
            interfaces: this.interfaces.map(f => ({ ip: f.ip, mask: f.mask, up: f.up, desc: f.desc })),
            routes: this.routes.map(r => ({ ...r })),
            dhcp: this.dhcpEnabled,
            portCount: this.portCount,
        };

        for (const f of this.interfaces) this.addPort(this._portX(f.origId), this._portY, f.origId, 'wire');
    }

    // ─────────────────────────────────────────────────────────
    //  初始化
    // ─────────────────────────────────────────────────────────

    _recalcGeometry() {
        this._portY = -62;
        const n = this.portCount;
        this._portX = (origId) => {
            const i = parseInt(String(origId).replace('g', ''), 10) || 0;
            return (i - (n - 1) / 2) * 90;
        };
    }

    _initParameters(config) {
        this.hostname = config.hostname || 'R1';
        this.dhcpEnabled = !!config.dhcp;

        const cfgIfaces = Array.isArray(config.interfaces) ? config.interfaces : [];
        this.interfaces = [];
        for (let i = 0; i < this.portCount; i++) {
            const c = cfgIfaces[i] || {};
            this.interfaces.push({
                name: `GigabitEthernet0/0/${i}`,
                origId: `g${i}`,
                portId: `${this.id}_wire_g${i}`,
                ip: c.ip || '',
                mask: c.mask || '',
                up: c.up !== false,
                desc: c.desc || '',
            });
        }
        this.routes = Array.isArray(config.routes) ? config.routes.map(r => ({ ...r })) : [];

        this._view = 'user';       // user | system | iface
        this._curIface = null;
        this._demoActive = false;
        this._terminal = null;
        this._dialog = null;
        this._linkStates = new Array(this.portCount).fill(false);
    }

    _init() {
        this._drawStaticParts();
        this._createDynamicNodes();
        this._bindInteraction();
    }

    _drawStaticParts() {
        const g = this._staticGroup;
        const C = {
            body: '#3a4550', bodyEdge: '#232c34', bezel: '#2b343d',
            socket: '#101820', socketEdge: '#78909c',
            text: '#eceff1', dim: '#b0bec5',
        };

        g.add(new Konva.Rect({
            x: -170, y: -62, width: 340, height: 132,
            fill: C.body, stroke: C.bodyEdge, strokeWidth: 2, cornerRadius: 10,
        }));
        g.add(new Konva.Rect({
            x: -170, y: -62, width: 340, height: 30,
            fill: C.bezel, cornerRadius: [10, 10, 0, 0],
        }));

        for (let i = 0; i < this.portCount; i++) {
            const origId = `g${i}`;
            const px = this._portX(origId);
            g.add(new Konva.Rect({
                x: px - 12, y: -60, width: 24, height: 17,
                fill: C.socket, stroke: C.socketEdge, strokeWidth: 1, cornerRadius: 2,
            }));
            g.add(new Konva.Text({
                x: px - 26, y: -83, width: 52,
                text: `GE0/0/${i}`, align: 'center',
                fontFamily: 'Consolas, monospace', fontSize: 10, fill: C.dim,
            }));
        }

        // 型号
        g.add(new Konva.Text({
            x: -156, y: 40, text: 'AR2200 企业路由器',
            fontFamily: 'Microsoft YaHei', fontSize: 12, fill: C.dim,
        }));
        // 电源灯
        g.add(new Konva.Circle({ x: 150, y: 56, radius: 5, fill: '#22c55e', stroke: '#0f5132', strokeWidth: 1 }));
        g.add(new Konva.Text({
            x: 126, y: 44, text: 'PWR', fontFamily: 'Consolas, monospace', fontSize: 10, fill: C.dim,
        }));
        // 控制台口
        g.add(new Konva.Rect({
            x: 116, y: -46, width: 18, height: 14, fill: C.socket, stroke: C.socketEdge, strokeWidth: 1, cornerRadius: 2,
        }));
        g.add(new Konva.Text({
            x: 108, y: -60, text: 'CON', fontFamily: 'Consolas, monospace', fontSize: 9, fill: C.dim,
        }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        this._hostText = new Konva.Text({
            x: -156, y: -16, text: '', fontFamily: 'Microsoft YaHei',
            fontSize: 18, fontStyle: 'bold', fill: '#ffffff',
        });
        d.add(this._hostText);

        this._ipTexts = [];
        this._linkLeds = [];
        for (let i = 0; i < this.portCount; i++) {
            const px = this._portX(`g${i}`);
            const led = new Konva.Circle({
                x: px, y: -36, radius: 3.5, fill: '#555555', stroke: '#222', strokeWidth: 1,
            });
            d.add(led);
            this._linkLeds.push(led);

            const t = new Konva.Text({
                x: px - 60, y: 0, width: 120, align: 'center',
                text: '', fontFamily: 'Consolas, monospace', fontSize: 11, fill: '#8fd6ff',
            });
            d.add(t);
            this._ipTexts.push(t);
        }
        this._updateDynamic();
    }

    _bindInteraction() {
        this.group.on('dblclick dbltap', (e) => {
            e.cancelBubble = true;
            this.showConfigDialog();
        });
    }

    _updateDynamic() {
        if (this._hostText) this._hostText.text(this.hostname);
        this.interfaces.forEach((f, i) => {
            if (!this._ipTexts[i]) return;
            const txt = (f.up === false) ? 'shutdown' : (isValidIp(f.ip) ? `${f.ip}/${maskPrefix(f.mask)}` : '未配置');
            this._ipTexts[i].text(txt);
        });
    }

    // ─────────────────────────────────────────────────────────
    //  仿真循环
    // ─────────────────────────────────────────────────────────

    tick() {
        let changed = false;
        this.interfaces.forEach((f, i) => {
            const on = f.up !== false && !!peerOfPort(this.sys, f.portId);
            if (on !== this._linkStates[i]) {
                this._linkStates[i] = on;
                this._linkLeds[i].fill(on ? '#22c55e' : '#555555');
                changed = true;
            }
        });
        if (changed) this.sys.requestRedraw();
    }

    // ─────────────────────────────────────────────────────────
    //  参数接口
    // ─────────────────────────────────────────────────────────

    getConfigFields() {
        return [
            { label: '设备名称', key: 'hostname', type: 'text' },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.hostname !== undefined) this.hostname = cfg.hostname;
        if (cfg.dhcp !== undefined) this.dhcpEnabled = !!cfg.dhcp;
        if (Array.isArray(cfg.interfaces)) {
            cfg.interfaces.forEach((c, i) => {
                const f = this.interfaces[i];
                if (!f) return;
                if (c.ip !== undefined) f.ip = c.ip;
                if (c.mask !== undefined) f.mask = c.mask;
                if (c.up !== undefined) f.up = !!c.up;
                if (c.desc !== undefined) f.desc = c.desc;
            });
        }
        if (Array.isArray(cfg.routes)) this.routes = cfg.routes.map(r => ({ ...r }));
        this.config = {
            ...this.config,
            hostname: this.hostname,
            interfaces: this.interfaces.map(f => ({ ip: f.ip, mask: f.mask, up: f.up, desc: f.desc })),
            routes: this.routes.map(r => ({ ...r })),
            dhcp: this.dhcpEnabled,
        };
        this._updateDynamic();
        this._syncPrompt();
        this.sys.requestRedraw();
    }

    getIfaceByName(name) {
        const n = String(name || '').toLowerCase();
        return this.interfaces.find(f => f.name.toLowerCase() === n || f.origId === n || f.name.toLowerCase().endsWith(n)) || null;
    }

    // ─────────────────────────────────────────────────────────
    //  连线操作
    // ─────────────────────────────────────────────────────────

    _usedPortIds() {
        const used = new Set();
        for (const c of (this.sys.conns || [])) if (c.type === 'wire') { used.add(c.from); used.add(c.to); }
        return used;
    }

    _freeIfacePorts() {
        const used = this._usedPortIds();
        return this.interfaces.filter(f => !used.has(f.portId)).map(f => f.portId);
    }

    /** 目标设备上的空闲端口 */
    _targetPort(sys, comp) {
        if (!comp) return null;
        if (comp.type === 'pc') return `${comp.id}_wire_lan`;
        if (typeof comp._freePortIds === 'function') return comp._freePortIds()[0] || null;
        return null;
    }

    /** 生成到指定设备的连线（交换机/PC）；animated=true 逐根动画 */
    async connectDevices(deviceIds, animated = false) {
        const sys = this.sys;
        const used = this._usedPortIds();
        const free = this.interfaces.filter(f => !used.has(f.portId)).map(f => f.portId);
        const added = [];
        for (const id of (deviceIds || [])) {
            const comp = sys.comps[id];
            if (!comp || (comp.type !== 'net_switch' && comp.type !== 'switch' && comp.type !== 'pc')) continue;
            if (this._connectedDeviceIds().includes(id)) continue;
            const to = this._targetPort(sys, comp);
            if (!to) continue;
            const from = free.shift();
            if (!from) break;
            const conn = { from, to, type: 'wire' };
            if (animated && typeof sys.addConnectionAnimated === 'function') await sys.addConnectionAnimated(conn);
            else sys.addConn(conn);
            added.push(id);
        }
        sys.redrawAll();
        return added;
    }

    _connectedDeviceIds() {
        const ids = [];
        for (const c of (this.sys.conns || [])) {
            if (c.type !== 'wire') continue;
            const a = deviceIdOfPort(c.from), b = deviceIdOfPort(c.to);
            if (a === this.id) ids.push(b);
            else if (b === this.id) ids.push(a);
        }
        return ids;
    }

    connectSelectedDevices() {
        const sys = this.sys;
        const selected = [...(sys.selectedCompIds || [])]
            .map(id => sys.comps[id])
            .filter(c => c && (c.type === 'net_switch' || c.type === 'switch' || c.type === 'pc'));
        if (!selected.length) {
            sys.showFloatingTip('请先选中要连接的交换机或 PC（按住 Ctrl 点选，或框选多台）');
            return;
        }
        this.connectDevices(selected.map(c => c.id)).then(added => {
            if (added.length) sys.showFloatingTip(`已连接 ${added.length} 台设备：${added.join('、')}`);
            else sys.showFloatingTip('选中的设备均已连接，或路由器接口已用尽');
        });
    }

    disconnectAll() {
        const sys = this.sys;
        const conns = (sys.conns || []).filter(c =>
            c.type === 'wire' && (deviceIdOfPort(c.from) === this.id || deviceIdOfPort(c.to) === this.id));
        conns.forEach(c => sys.removeConn(c));
        sys.showFloatingTip(conns.length ? `已断开 ${conns.length} 条连线` : '本路由器没有已连接的线缆');
    }

    getContextMenuItems() {
        return [
            { label: '连接到选中的交换机/PC', onClick: () => this.connectSelectedDevices() },
            { label: '断开所有连线', onClick: () => this.disconnectAll() },
        ];
    }

    // ─────────────────────────────────────────────────────────
    //  多页面板
    // ─────────────────────────────────────────────────────────

    showConfigDialog(tab = 'iface') {
        const tabs = [
            { id: 'iface', label: '接口配置', render: (el) => this._renderIfaceTab(el) },
            { id: 'dhcp', label: 'DHCP', render: (el) => this._renderDhcpTab(el) },
            { id: 'route', label: '静态路由', render: (el) => this._renderRouteTab(el) },
            { id: 'cli', label: '命令行', render: (el) => this._renderCliTab(el) },
        ];
        this._dialog = openTabbedDialog({
            title: `路由器配置 — ${this.hostname}（${this.id}）`,
            tabs, width: 760, height: 540, container: this.sys.container,
        });
        const idx = Math.max(0, tabs.findIndex(t => t.id === tab));
        setTimeout(() => this._dialog && this._dialog.switchTab(idx), 0);
    }
    openConfigDialog(tab = 'iface') { this.showConfigDialog(tab); }

    _renderIfaceTab(el) {
        el.innerHTML = '';
        const wrap = document.createElement('div');
        const inputStyle = 'width:100%;box-sizing:border-box;padding:6px;border:1px solid #ccc;border-radius:4px;';

        this.interfaces.forEach((f, i) => {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin-bottom:12px;';
            card.innerHTML =
                `<div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">${f.name}</div>
                 <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                    <div style="flex:1;min-width:150px;">
                        <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">IP 地址</label>
                        <input type="text" id="diag_ip_${f.origId}" value="${f.ip}" placeholder="如 192.168.1.1（出厂未配置）" style="${inputStyle}">
                    </div>
                    <div style="flex:1;min-width:150px;">
                        <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">子网掩码</label>
                        <input type="text" id="diag_mask_${f.origId}" value="${f.mask}" placeholder="如 255.255.255.0" style="${inputStyle}">
                    </div>
                    <div style="min-width:80px;">
                        <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">状态</label>
                        <label style="font-size:13px;"><input type="checkbox" id="diag_up_${f.origId}" ${f.up !== false ? 'checked' : ''}> 启用</label>
                    </div>
                 </div>`;
            wrap.appendChild(card);
        });

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:6px;';
        const cancel = document.createElement('button');
        cancel.textContent = '取消';
        cancel.style.cssText = 'padding:8px 16px;border:none;background:#eee;border-radius:4px;cursor:pointer;';
        cancel.onclick = () => closeActiveNetDialog();
        const save = document.createElement('button');
        save.textContent = '保存';
        save.id = 'iface_save_btn';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => this._saveIfaces();
        btnRow.appendChild(cancel); btnRow.appendChild(save);

        el.appendChild(wrap);
        el.appendChild(btnRow);
    }

    _saveIfaces() {
        for (const f of this.interfaces) {
            const ip = (document.getElementById(`diag_ip_${f.origId}`) || {}).value;
            const mask = (document.getElementById(`diag_mask_${f.origId}`) || {}).value;
            const up = !!(document.getElementById(`diag_up_${f.origId}`) || {}).checked;
            if (ip && !isValidIp(ip)) { alert(`接口 ${f.name} 的 IP 地址格式不正确`); return; }
            if (ip && !isValidMask(mask)) { alert(`接口 ${f.name} 的子网掩码格式不正确`); return; }
            f.ip = ip || '';
            f.mask = mask || '';
            f.up = up;
        }
        this.onConfigUpdate({});
        closeActiveNetDialog();
    }

    _renderDhcpTab(el) {
        el.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'margin-bottom:12px;font-size:13px;';
        head.innerHTML = `<label style="cursor:pointer;"><input type="checkbox" id="diag_dhcp_enable" ${this.dhcpEnabled ? 'checked' : ''}> 启用 DHCP 服务（各接口按直连网段自动生成地址池，起始主机号 .100）</label>`;
        el.appendChild(head);

        const btn = document.createElement('button');
        btn.textContent = '保存';
        btn.id = 'dhcp_save_btn';
        btn.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;margin-bottom:14px;';
        btn.onclick = () => {
            this.dhcpEnabled = !!(document.getElementById('diag_dhcp_enable') || {}).checked;
            this.onConfigUpdate({ dhcp: this.dhcpEnabled });
            this._renderDhcpTab(el);
        };
        el.appendChild(btn);

        const rows = dhcpPoolStatus(this.sys, this);
        const table = document.createElement('div');
        table.style.cssText = 'font-size:13px;';
        if (!this.dhcpEnabled) {
            table.innerHTML = '<div style="color:#999;">DHCP 服务未启用。</div>';
        } else if (!rows.length) {
            table.innerHTML = '<div style="color:#999;">接口尚未配置有效 IP，暂无地址池。</div>';
        } else {
            rows.forEach(r => {
                const div = document.createElement('div');
                div.style.cssText = 'border:1px solid #e3e6ea;border-radius:6px;padding:8px 10px;margin-bottom:8px;';
                const leaseLines = r.leases.length
                    ? r.leases.map(l => `<div style="color:#555;">&nbsp;&nbsp;${l.mac} → ${l.ip}</div>`).join('')
                    : '<div style="color:#999;">&nbsp;&nbsp;（暂无租约）</div>';
                div.innerHTML = `<div><b>${r.interface}</b>　网段 ${r.net}/${maskPrefix(r.mask)}　网关 ${r.gateway}　已分配 ${r.used}</div>${leaseLines}`;
                table.appendChild(div);
            });
        }
        el.appendChild(table);
    }

    _renderRouteTab(el) {
        el.innerHTML = '';
        const inputStyle = 'padding:6px;border:1px solid #ccc;border-radius:4px;';
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;';
        addRow.innerHTML =
            `<div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">目标网段</label><input id="diag_route_net" style="${inputStyle}" placeholder="192.168.3.0"></div>
             <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">掩码</label><input id="diag_route_mask" style="${inputStyle}" value="255.255.255.0"></div>
             <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">下一跳</label><input id="diag_route_nh" style="${inputStyle}" placeholder="192.168.2.2"></div>`;
        const addBtn = document.createElement('button');
        addBtn.textContent = '添加路由';
        addBtn.style.cssText = 'padding:8px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        addBtn.onclick = () => {
            const net = (document.getElementById('diag_route_net') || {}).value;
            const mask = (document.getElementById('diag_route_mask') || {}).value;
            const nh = (document.getElementById('diag_route_nh') || {}).value;
            if (!isValidIp(net) || !isValidMask(mask) || !isValidIp(nh)) { alert('请填写正确的目标网段 / 掩码 / 下一跳'); return; }
            this.routes.push({ net, mask, nextHop: nh });
            this.onConfigUpdate({});
            this._renderRouteTab(el);
        };
        addRow.appendChild(addBtn);
        el.appendChild(addRow);

        const list = document.createElement('div');
        list.style.cssText = 'font-size:13px;';
        const direct = this.interfaces.filter(f => f.up !== false && isValidIp(f.ip) && isValidMask(f.mask));
        if (direct.length) {
            list.innerHTML += '<div style="color:#666;margin-bottom:6px;">直连网段（自动生成）：</div>';
            direct.forEach(f => {
                const n = networkOf(f.ip, f.mask);
                list.innerHTML += `<div style="padding:4px 0;">&nbsp;&nbsp;${n}/${maskPrefix(f.mask)}　直连 ${f.name}</div>`;
            });
        }
        list.innerHTML += '<div style="color:#666;margin:10px 0 6px;">静态路由：</div>';
        if (!this.routes.length) {
            list.innerHTML += '<div style="color:#999;">&nbsp;&nbsp;（无）</div>';
        } else {
            this.routes.forEach((r, i) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 0;';
                row.innerHTML = `<span>&nbsp;&nbsp;${r.net}/${maskPrefix(r.mask)} → ${r.nextHop}</span>`;
                const del = document.createElement('button');
                del.textContent = '删除';
                del.style.cssText = 'padding:2px 8px;border:none;background:#f3d2cf;color:#a13b2f;border-radius:4px;cursor:pointer;';
                del.onclick = () => { this.routes.splice(i, 1); this.onConfigUpdate({}); this._renderRouteTab(el); };
                row.appendChild(del);
                list.appendChild(row);
            });
        }
        el.appendChild(list);
    }

    // ─────────────────────────────────────────────────────────
    //  命令行
    // ─────────────────────────────────────────────────────────

    _renderCliTab(el) {
        el.innerHTML = '';
        const ip = document.createElement('div');
        ip.style.cssText = 'font-size:12px;color:#666;margin-bottom:8px;';
        ip.textContent = '可用命令：system-view / interface GigabitEthernet0/0/0 / ip address / ip route-static / dhcp enable / '
            + 'display ip interface brief / display ip routing-table / display ip pool / display arp / ping / tracert / save / cls / help';
        el.appendChild(ip);

        this._terminal = new Terminal({
            prompt: this._prompt(), height: 400,
            welcome: 'Info: 正在进入路由器命令行 ...\n',
            onCommand: (cmd, term) => this._handleCommand(cmd, term),
        });
        el.appendChild(this._terminal.element);
    }

    _prompt() {
        if (this._view === 'iface' && this._curIface) return `[${this.hostname}-${this._curIface.name}]`;
        if (this._view === 'system') return `[${this.hostname}]`;
        return `<${this.hostname}>`;
    }
    _syncPrompt() { if (this._terminal) this._terminal.setPrompt(this._prompt()); }

    _handleCommand(cmd, term) {
        const raw = String(cmd || '').trim();
        if (!raw) return undefined;
        const parts = raw.split(/\s+/);
        const name = parts[0].toLowerCase();

        if (name === 'display' || name === 'show') return this._cmdDisplay(parts.slice(1), term);
        if (name === 'ping') return this._cmdPing(parts.slice(1), term);
        if (name === 'tracert' || name === 'traceroute') return this._cmdTracert(parts.slice(1), term);
        if (name === 'system-view' || name === 'configure') {
            this._view = 'system'; this._curIface = null; this._syncPrompt();
            term.print('Enter system view, return user view with Ctrl+Z.', 'term-dim');
            return undefined;
        }
        if (name === 'quit') {
            if (this._view === 'iface') { this._view = 'system'; this._curIface = null; this._syncPrompt(); }
            else if (this._view === 'system') { this._view = 'user'; this._syncPrompt(); }
            else closeActiveNetDialog();
            return undefined;
        }
        if (name === 'return') { this._view = 'user'; this._curIface = null; this._syncPrompt(); return undefined; }

        // interface 视图
        if (name === 'interface') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const f = this.getIfaceByName(parts[1]);
            if (!f) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
            this._curIface = f; this._view = 'iface'; this._syncPrompt();
            return undefined;
        }
        if (name === 'ip' && parts[1] && parts[1].toLowerCase() === 'address') {
            if (this._view !== 'iface' || !this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const ip = parts[2];
            let mask = parts[3];
            if (!ip || !mask) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
            if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
            if (!isValidIp(ip) || !isValidMask(mask)) { term.print('Error: 地址或掩码不合法。', 'term-err'); return undefined; }
            this._curIface.ip = ip; this._curIface.mask = mask;
            this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 地址已设置为 ${ip} ${mask}。`, 'term-ok');
            return undefined;
        }
        if (name === 'undo' && parts[1] && parts[1].toLowerCase() === 'ip' && parts[2] && parts[2].toLowerCase() === 'address') {
            if (!this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._curIface.ip = ''; this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 地址已删除。`, 'term-ok');
            return undefined;
        }
        if (name === 'description') {
            if (!this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._curIface.desc = parts.slice(1).join(' ');
            this.onConfigUpdate({});
            term.print('Info: 描述已设置。', 'term-ok');
            return undefined;
        }
        if (name === 'shutdown') {
            if (this._view !== 'iface' || !this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._curIface.up = false; this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 已关闭。`, 'term-warn');
            return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'shutdown') {
            if (this._view !== 'iface' || !this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._curIface.up = true; this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 已启用。`, 'term-ok');
            return undefined;
        }

        // 系统视图命令
        if (name === 'sysname') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            if (!parts[1]) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
            this.onConfigUpdate({ hostname: parts[1] });
            term.print(`Info: 系统名称已修改为 ${parts[1]}。`, 'term-ok');
            return undefined;
        }
        if (name === 'ip' && parts[1] && parts[1].toLowerCase() === 'route-static') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const net = parts[2]; let mask = parts[3]; const nh = parts[4];
            if (!net || !mask || !nh) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
            if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
            if (!isValidIp(net) || !isValidMask(mask) || !isValidIp(nh)) { term.print('Error: 参数不合法。', 'term-err'); return undefined; }
            this.routes.push({ net, mask, nextHop: nh });
            this.onConfigUpdate({});
            term.print(`Info: 已添加静态路由 ${networkOf(net, mask)}/${maskPrefix(mask)} → ${nh}。`, 'term-ok');
            return undefined;
        }
        if (name === 'undo' && parts[1] && parts[1].toLowerCase() === 'ip' && parts[2] && parts[2].toLowerCase() === 'route-static') {
            const net = parts[3]; let mask = parts[4]; const nh = parts[5];
            if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
            const before = this.routes.length;
            this.routes = this.routes.filter(r => !(r.net === networkOf(net, mask) && r.nextHop === nh));
            this.onConfigUpdate({});
            term.print(before !== this.routes.length ? 'Info: 静态路由已删除。' : 'Error: 未找到匹配的静态路由。', before !== this.routes.length ? 'term-ok' : 'term-err');
            return undefined;
        }
        if (name === 'dhcp') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this.dhcpEnabled = true; this.onConfigUpdate({ dhcp: true });
            term.print('Info: DHCP 服务已启用。', 'term-ok');
            return undefined;
        }
        if (name === 'undo' && parts[1] && parts[1].toLowerCase() === 'dhcp') {
            this.dhcpEnabled = false; this.onConfigUpdate({ dhcp: false });
            term.print('Info: DHCP 服务已关闭。', 'term-ok');
            return undefined;
        }

        if (name === 'save') {
            term.print('The current configuration will be written to the device.', 'term-dim');
            term.print('Info: The current configuration is saved successfully.', 'term-ok');
            return undefined;
        }
        if (name === 'cls' || name === 'clear') { term.clear(); return undefined; }
        if (name === 'help' || name === '?') {
            term.print('可用命令：', 'term-info');
            term.print('  system-view                            进入系统视图', 'term-dim');
            term.print('  interface GigabitEthernet0/0/0         进入接口视图', 'term-dim');
            term.print('  ip address <ip> <mask|前缀>            配置接口地址', 'term-dim');
            term.print('  ip route-static <net> <mask> <下一跳>  添加静态路由', 'term-dim');
            term.print('  dhcp enable                            启用 DHCP 服务', 'term-dim');
            term.print('  display ip interface brief             接口地址一览', 'term-dim');
            term.print('  display ip routing-table               查看路由表', 'term-dim');
            term.print('  display ip pool                        查看 DHCP 地址池', 'term-dim');
            term.print('  display arp                            查看 ARP 表', 'term-dim');
            term.print('  ping <ip>  /  tracert <ip>             连通性测试 / 路由追踪', 'term-dim');
            return undefined;
        }

        term.print("Error: Unrecognized command found at '^' position.", 'term-err');
        return undefined;
    }

    _cmdDisplay(args, term) {
        const sub = (args[0] || '').toLowerCase();
        const sub2 = (args[1] || '').toLowerCase();

        if (sub === 'version') {
            term.print('');
            term.print('Huawei Versatile Routing Platform Software', 'term-info');
            term.print('VRP (R) software, Version 5.170 (AR2200 V200R019C10)');
            term.print(`HUAWEI AR2200 Router uptime is 0 day, 0 hour, 0 minute`);
            term.print(`System Name : ${this.hostname}`);
            term.print('');
            return undefined;
        }
        if (sub === 'ip' && sub2 === 'interface') {
            term.print('');
            term.print('Interface                   IP Address/Mask      Physical   Protocol', 'term-info');
            for (const f of this.interfaces) {
                const configured = f.up !== false && isValidIp(f.ip) && isValidMask(f.mask);
                const addr = configured ? `${f.ip}/${maskPrefix(f.mask)}` : 'unassigned';
                const phy = (f.up !== false) ? 'up' : 'down';
                const peer = peerOfPort(this.sys, f.portId);
                term.print(`${f.name.padEnd(27)} ${addr.padEnd(20)} ${phy.padEnd(10)} ${phy}`,
                    peer ? 'term-ok' : 'term-dim');
            }
            term.print('');
            return undefined;
        }
        if (sub === 'ip' && sub2 === 'routing-table') {
            term.print('');
            term.print('Route Flags: R - relay, D - download to fib', 'term-dim');
            term.print('------------------------------------------------------------------------------');
            term.print('Routing Tables: Public');
            term.print('Destination/Mask    Proto   Pre  Cost      NextHop         Interface', 'term-info');
            for (const e of routingTable(this)) {
                const dest = `${e.net}/${e.prefix}`;
                if (e.type === 'direct') {
                    term.print(`${dest.padEnd(19)} Direct  0    0         ${e.iface.ip.padEnd(15)} ${e.iface.name}`, 'term-ok');
                } else {
                    term.print(`${dest.padEnd(19)} Static  60   0         ${e.nextHop.padEnd(15)} ${'(static)'}`, 'term-warn');
                }
            }
            term.print('');
            return undefined;
        }
        if (sub === 'ip' && sub2 === 'pool') {
            term.print('');
            const rows = dhcpPoolStatus(this.sys, this);
            if (!this.dhcpEnabled) { term.print('Info: DHCP 服务未启用，无地址池。', 'term-dim'); term.print(''); return undefined; }
            rows.forEach(r => {
                term.print(`Pool for ${r.interface}  (${r.net}/${maskPrefix(r.mask)})`, 'term-info');
                term.print(`  gateway ${r.gateway}   used ${r.used}`);
                r.leases.forEach(l => term.print(`    ${l.mac}  ${l.ip}`));
            });
            term.print('');
            return undefined;
        }
        if (sub === 'arp') {
            term.print('');
            term.print('IP Address       MAC Address', 'term-info');
            const rows = arpTable(this);
            if (!rows.length) term.print('（ARP 表为空）', 'term-dim');
            rows.forEach(r => term.print(`${r.ip.padEnd(16)} ${r.mac}`));
            term.print('');
            return undefined;
        }
        if (sub === 'interface') {
            const f = this.getIfaceByName(args[1]);
            if (!f) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
            const peer = peerOfPort(this.sys, f.portId);
            term.print('');
            term.print(`${f.name} current state : ${f.up !== false ? 'UP' : 'DOWN'}`, f.up !== false ? 'term-ok' : 'term-err');
            term.print(`  Internet Address is ${isValidIp(f.ip) ? f.ip + '/' + maskPrefix(f.mask) : 'unassigned'}`);
            term.print(`  Description : ${f.desc || '-'}`);
            term.print(`  Link peer   : ${peer || '-'}`);
            term.print('');
            return undefined;
        }
        if (sub === 'current-configuration' || sub === 'current') {
            term.print('');
            term.print('#');
            term.print(`sysname ${this.hostname}`);
            term.print('#');
            term.print('ip routing');
            if (this.dhcpEnabled) term.print('dhcp enable');
            for (const f of this.interfaces) {
                term.print(`interface ${f.name}`);
                if (f.up === false) term.print(' shutdown');
                if (isValidIp(f.ip)) term.print(` ip address ${f.ip} ${f.mask}`);
                term.print('#');
            }
            for (const r of this.routes) term.print(`ip route-static ${r.net} ${r.mask} ${r.nextHop}`);
            term.print('return');
            term.print('');
            return undefined;
        }
        term.print("Error: Unrecognized command found at '^' position.", 'term-err');
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

    async _cmdTracert(args, term) {
        const target = args.find(a => !a.startsWith('-'));
        if (!target) { term.print('用法: tracert <目标IP>', 'term-warn'); return; }
        term.print('');
        term.print(`通过最多 8 个跃点跟踪到 ${target} 的路由`, 'term-dim');
        term.print('');
        const hops = tracert(this.sys, this, target, 8);
        for (const h of hops) {
            const ip = h.ip || '*';
            term.print(`  ${String(h.ttl).padStart(2)}    <1ms    ${ip}    ${h.label || ''}`, h.ok ? '' : 'term-err');
            await sleep(this._demoActive ? DEMO.LINE_DELAY : DEMO.LINE_DELAY_MANUAL);
        }
        term.print('');
        term.print('跟踪完成。', 'term-dim');
        term.print('');
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
