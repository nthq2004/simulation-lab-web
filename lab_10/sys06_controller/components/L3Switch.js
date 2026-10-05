import { BaseComponent } from './BaseComponent.js';
import { Terminal, openTabbedDialog, closeActiveNetDialog, sleep } from '../lib/NetConsole.js';
import { DEMO } from '../lib/DemoTiming.js';
import {
    peerOfPort, peerOfSwitchPort, deviceIdOfPort, connectedPCIds,
    runPing, formatPingLines, tracert, routingTable, routingNeighbors,
    isValidIp, isValidMask, maskPrefix, networkOf, wildcardToMask, macOf, macOfInterface,
    dhcpPoolStatus, arpTable, allInterfaces, inSameSubnet,
    isValidRouteMask,
} from '../tools/NetworkSim.js';

/** 前缀长度 → 点分掩码 */
function prefixToMask(p) {
    const n = parseInt(p, 10);
    if (!(n >= 0 && n <= 32)) return null;
    const m = n === 0 ? 0 : ((0xffffffff << (32 - n)) >>> 0);
    return [(m >>> 24) & 0xff, (m >>> 16) & 0xff, (m >>> 8) & 0xff, m & 0xff].join('.');
}
/** 前缀长度 → 反掩码（通配符掩码），如 24 → 0.0.0.255 */
function prefixToWildcard(p) {
    const n = parseInt(p, 10);
    if (!(n >= 0 && n <= 32)) return null;
    const m = n === 0 ? 0 : ((0xffffffff << (32 - n)) >>> 0);
    const inv = (~m) >>> 0;
    return [(inv >>> 24) & 0xff, (inv >>> 16) & 0xff, (inv >>> 8) & 0xff, inv & 0xff].join('.');
}

/**
 * L3Switch — 三层交换机（VLAN 间路由 + 动态路由）
 *
 * 能力：VLAN / access/trunk 端口 / 多 VLANIF 虚接口 IP / 静态路由 / DHCP / RIP / OSPF
 * 交互：双击 → 多页面板（VLAN / VLANIF 接口 / 静态路由 / DHCP / 动态路由 / 命令行）
 *       右键 → 连接到选中设备、断开所有连线
 * 端口：<id>_wire_eth1 .. <id>_wire_ethN（N = portCount，默认 8）
 */
export class L3Switch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'l3_switch';
        this.cache = 'fixed';
        this.label = '三层交换机';

        this.portCount = Math.max(2, Math.min(24, config.portCount || 8));
        this.width = 560;
        this.height = 190;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            hostname: this.hostname,
            interfaces: this.interfaces.map(f => ({ name: f.name, vlanId: f.vlanId, ip: f.ip, mask: f.mask, up: f.up })),
            routes: this.routes.map(r => ({ ...r })),
            dhcp: this.dhcpEnabled,
            rip: this.ripEnabled,
            ripNetworks: [...this.ripNetworks],
            ospf: this.ospfEnabled,
            ospfRouterId: this.ospfRouterId,
            ospfNetworks: this.ospfNetworks.map(n => ({ ...n })),
            vlans: [...this.vlans],
            portVlan: { ...this.portVlan },
            portType: { ...this.portType },
            portTrunkVlans: Object.fromEntries(Object.entries(this.portTrunkVlans).map(([k, v]) => [k, [...v]])),
        };

        for (let i = 1; i <= this.portCount; i++) {
            this.addPort(this._portX(i), this._portY, 'eth' + i, 'wire');
        }
    }

    _recalcGeometry() {
        this._portY = -74;
        this._portX = (i) => -220 + (i - 1) * 62;
    }

    _initParameters(config) {
        this.hostname = config.hostname || 'L3SW1';
        this.vlans = new Set([1]);
        (Array.isArray(config.vlans) ? config.vlans : []).forEach(v => {
            const n = parseInt(v, 10);
            if (n >= 1 && n <= 4094) this.vlans.add(n);
        });

        this.portVlan = {};
        this.portType = {};
        this.portTrunkVlans = {};
        const cfgPV = config.portVlan || {};
        const cfgPT = config.portType || {};
        const cfgPTV = config.portTrunkVlans || {};
        for (let i = 1; i <= this.portCount; i++) {
            const o = 'eth' + i;
            const v = parseInt(cfgPV[o], 10);
            this.portVlan[o] = (v >= 1 && v <= 4094) ? v : 1;
            this.portType[o] = cfgPT[o] === 'trunk' ? 'trunk' : 'access';
            const arr = Array.isArray(cfgPTV[o]) ? cfgPTV[o].map(x => parseInt(x, 10)).filter(x => x >= 1 && x <= 4094) : [];
            this.portTrunkVlans[o] = arr.length ? arr : [1];
        }

        // VLANIF 虚接口
        const cfgIf = Array.isArray(config.interfaces) ? config.interfaces : [];
        this.interfaces = [];
        const addIf = (name, vlanId, ip, mask, up) => {
            this.interfaces.push({
                name, vlanId: parseInt(vlanId, 10) || 1, origId: 'v' + vlanId,
                ip: ip || '', mask: mask || '', up: up !== false, desc: '', cost: 1,
            });
        };
        if (cfgIf.length) {
            cfgIf.forEach(f => addIf(f.name || `Vlanif${f.vlanId}`, f.vlanId, f.ip, f.mask, f.up));
        } else {
            addIf('Vlanif1', 1, '', '', true);
        }
        for (const f of this.interfaces) this.vlans.add(f.vlanId);

        this.routes = Array.isArray(config.routes) ? config.routes.map(r => ({ ...r })) : [];
        this.dhcpEnabled = !!config.dhcp;

        this.ripEnabled = !!config.rip;
        this.ripVersion = 2;
        this.ripNetworks = Array.isArray(config.ripNetworks) ? [...config.ripNetworks] : [];
        this.ospfEnabled = !!config.ospf;
        this.ospfRouterId = config.ospfRouterId || '';
        this.ospfNetworks = Array.isArray(config.ospfNetworks) ? config.ospfNetworks.map(n => ({ ...n })) : [];

        this._view = 'user';
        this._curPort = null;
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
            body: '#3f5765', bodyEdge: '#22303a', bezel: '#2f4550',
            socket: '#101820', socketEdge: '#90a4ae', dim: '#b0bec5',
        };
        g.add(new Konva.Rect({ x: -270, y: -74, width: 540, height: 158, fill: C.body, stroke: C.bodyEdge, strokeWidth: 2, cornerRadius: 10 }));
        g.add(new Konva.Rect({ x: -270, y: -74, width: 540, height: 30, fill: C.bezel, cornerRadius: [10, 10, 0, 0] }));

        for (let i = 1; i <= this.portCount; i++) {
            const px = this._portX(i);
            g.add(new Konva.Rect({ x: px - 11, y: -72, width: 22, height: 16, fill: C.socket, stroke: C.socketEdge, strokeWidth: 1, cornerRadius: 2 }));
            g.add(new Konva.Text({ x: px - 8, y: -92, width: 16, text: String(i), align: 'center', fontFamily: 'Consolas, monospace', fontSize: 12, fill: C.dim }));
        }
        g.add(new Konva.Text({ x: -256, y: 22, text: 'S5730 三层交换机  （L3 Core Switch）', fontFamily: 'Microsoft YaHei', fontSize: 13, fill: C.dim }));
        g.add(new Konva.Circle({ x: 252, y: 62, radius: 5, fill: '#22c55e', stroke: '#0f5132', strokeWidth: 1 }));
        g.add(new Konva.Text({ x: 228, y: 50, text: 'PWR', fontFamily: 'Consolas, monospace', fontSize: 10, fill: C.dim }));

        for (let i = 1; i <= this.portCount; i++) {
            this.addClickablePart('eth' + i, this._portX(i) - 14, this._portY - 12, 28, 24);
        }
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;
        this._hostText = new Konva.Text({ x: -256, y: -14, text: '', fontFamily: 'Microsoft YaHei', fontSize: 18, fontStyle: 'bold', fill: '#ffffff' });
        d.add(this._hostText);
        this._ifaceText = new Konva.Text({ x: -256, y: 44, width: 500, text: '', fontFamily: 'Consolas, monospace', fontSize: 12, fill: '#8fd6ff' });
        d.add(this._ifaceText);

        this._linkLeds = [];
        this._vlanTexts = [];
        for (let i = 1; i <= this.portCount; i++) {
            const led = new Konva.Circle({ x: this._portX(i), y: -50, radius: 3.5, fill: '#555555', stroke: '#222', strokeWidth: 1 });
            d.add(led); this._linkLeds.push(led);
            const vt = new Konva.Text({ x: this._portX(i) - 20, y: -36, width: 40, align: 'center', text: '', fontFamily: 'Consolas, monospace', fontSize: 10, fill: '#ffd479' });
            d.add(vt); this._vlanTexts.push(vt);
        }
        this._updateDynamic();
        this._updateVlanLabels();
    }

    _bindInteraction() {
        this.group.on('dblclick dbltap', (e) => { e.cancelBubble = true; this.showConfigDialog('vlan'); });
    }

    _updateDynamic() {
        if (this._hostText) this._hostText.text(this.hostname);
        if (this._ifaceText) {
            const parts = this.interfaces.map(f => {
                const ip = f.up === false ? 'shutdown' : (isValidIp(f.ip) ? `${f.ip}/${maskPrefix(f.mask)}` : '未配置');
                return `${f.name}=${ip}`;
            });
            this._ifaceText.text(parts.join('   '));
        }
    }

    _updateVlanLabels() {
        if (!this._vlanTexts) return;
        for (let i = 1; i <= this.portCount; i++) {
            const o = 'eth' + i;
            if (this.portType[o] === 'trunk') {
                this._vlanTexts[i - 1].text('TRK');
            } else {
                const v = this.getPortVlan(o);
                this._vlanTexts[i - 1].text(v !== 1 ? `V${v}` : '');
            }
        }
        this.sys.requestRedraw();
    }

    tick() {
        let changed = false;
        this.ports.forEach((p) => {
            if (!p.origId || !p.origId.startsWith('eth')) return;
            const i = parseInt(p.origId.slice(3), 10) - 1;
            if (i < 0 || i >= this._linkLeds.length) return;
            const on = !!peerOfSwitchPort(this.sys, p.id);
            if (on !== this._linkStates[i]) {
                this._linkStates[i] = on;
                this._linkLeds[i].fill(on ? '#22c55e' : '#555555');
                changed = true;
            }
        });
        if (changed) this.sys.requestRedraw();
    }

    // ─────────────────────────────────────────────────────────
    //  VLAN / 端口
    // ─────────────────────────────────────────────────────────

    getPortVlan(origId) { return this.portVlan[origId] || 1; }
    getPortType(origId) { return this.portType[origId] || 'access'; }
    getPortVlans(origId) {
        return this.getPortType(origId) === 'trunk'
            ? (this.portTrunkVlans[origId] || [1])
            : [this.getPortVlan(origId)];
    }
    _origOfPort(portId) {
        return String(portId).includes('_wire_') ? String(portId).split('_wire_')[1] : portId;
    }
    getPortVlanByPortId(portId) { return this.getPortVlan(this._origOfPort(portId)); }
    getPortVlansByPortId(portId) { return this.getPortVlans(this._origOfPort(portId)); }

    createVlan(v) {
        const n = parseInt(v, 10);
        if (n >= 1 && n <= 4094) this.vlans.add(n);
        return n;
    }
    deleteVlan(v) {
        const n = parseInt(v, 10);
        if (n === 1) return false;
        this.vlans.delete(n);
        for (const o in this.portVlan) if (this.portVlan[o] === n) this.portVlan[o] = 1;
        for (const o in this.portTrunkVlans) this.portTrunkVlans[o] = this.portTrunkVlans[o].filter(x => x !== n);
        this.interfaces = this.interfaces.filter(f => f.vlanId !== n || f.vlanId === 1);
        this.onConfigUpdate({});
        this._updateVlanLabels();
        return true;
    }
    setPortVlan(origId, vlan) {
        const n = parseInt(vlan, 10);
        if (!(n >= 1 && n <= 4094)) return false;
        this.vlans.add(n);
        this.portVlan[origId] = n;
        this.onConfigUpdate({});
        this._updateVlanLabels();
        return true;
    }
    setPortType(origId, type) {
        this.portType[origId] = (type === 'trunk') ? 'trunk' : 'access';
        this.onConfigUpdate({});
        this._updateVlanLabels();
    }
    setTrunkVlans(origId, vlans) {
        const arr = (vlans || []).map(x => parseInt(x, 10)).filter(x => x >= 1 && x <= 4094);
        this.portTrunkVlans[origId] = arr.length ? arr : [1];
        arr.forEach(v => this.vlans.add(v));
        this.onConfigUpdate({});
        this._updateVlanLabels();
    }

    /** 确保存在某 VLAN 的 VLANIF 虚接口 */
    ensureVlanif(vlanId) {
        const n = parseInt(vlanId, 10) || 1;
        let f = this.interfaces.find(x => x.vlanId === n);
        if (!f) {
            f = { name: `Vlanif${n}`, vlanId: n, origId: 'v' + n, ip: '', mask: '', up: true, desc: '', cost: 1 };
            this.interfaces.push(f);
            this.vlans.add(n);
            this.onConfigUpdate({});
        }
        return f;
    }
    getIfaceByName(name) {
        const n = String(name || '').toLowerCase();
        return this.interfaces.find(f => f.name.toLowerCase() === n || f.name.toLowerCase().endsWith(n)) || null;
    }
    getVlanifByVlan(v) {
        const n = parseInt(v, 10) || 1;
        return this.interfaces.find(f => f.vlanId === n) || null;
    }

    // ─────────────────────────────────────────────────────────
    //  参数接口
    // ─────────────────────────────────────────────────────────

    getConfigFields() {
        return [{ label: '设备名称', key: 'hostname', type: 'text' }];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.hostname !== undefined) this.hostname = cfg.hostname;
        if (cfg.dhcp !== undefined) this.dhcpEnabled = !!cfg.dhcp;
        if (cfg.rip !== undefined) this.ripEnabled = !!cfg.rip;
        if (Array.isArray(cfg.ripNetworks)) this.ripNetworks = [...cfg.ripNetworks];
        if (cfg.ospf !== undefined) this.ospfEnabled = !!cfg.ospf;
        if (cfg.ospfRouterId !== undefined) this.ospfRouterId = cfg.ospfRouterId;
        if (Array.isArray(cfg.ospfNetworks)) this.ospfNetworks = cfg.ospfNetworks.map(n => ({ ...n }));
        if (Array.isArray(cfg.routes)) this.routes = cfg.routes.map(r => ({ ...r }));
        if (Array.isArray(cfg.interfaces)) {
            cfg.interfaces.forEach((c, i) => {
                const f = this.interfaces[i]; if (!f) return;
                if (c.ip !== undefined) f.ip = c.ip;
                if (c.mask !== undefined) f.mask = c.mask;
                if (c.up !== undefined) f.up = !!c.up;
            });
        }
        this.config = {
            ...this.config,
            hostname: this.hostname,
            interfaces: this.interfaces.map(f => ({ name: f.name, vlanId: f.vlanId, ip: f.ip, mask: f.mask, up: f.up })),
            routes: this.routes.map(r => ({ ...r })),
            dhcp: this.dhcpEnabled,
            rip: this.ripEnabled, ripNetworks: [...this.ripNetworks],
            ospf: this.ospfEnabled, ospfRouterId: this.ospfRouterId,
            ospfNetworks: this.ospfNetworks.map(n => ({ ...n })),
            vlans: [...this.vlans], portVlan: { ...this.portVlan },
            portType: { ...this.portType },
            portTrunkVlans: Object.fromEntries(Object.entries(this.portTrunkVlans).map(([k, v]) => [k, [...v]])),
        };
        this._updateDynamic();
        this._syncPrompt();
        this._updateVlanLabels();
        this.sys.requestRedraw();
    }

    // ─────────────────────────────────────────────────────────
    //  连线
    // ─────────────────────────────────────────────────────────

    _usedPortIds() {
        const used = new Set();
        for (const c of (this.sys.conns || [])) if (c.type === 'wire') { used.add(c.from); used.add(c.to); }
        return used;
    }
    _freePortIds() {
        const used = this._usedPortIds();
        return this.ports.filter(p => p.origId && p.origId.startsWith('eth') && !used.has(p.id)).map(p => p.id);
    }
    _targetPort(comp) {
        if (!comp) return null;
        if (comp.type === 'pc' || comp.type === 'net_server') return `${comp.id}_wire_lan`;
        if (typeof comp._freePortIds === 'function') return comp._freePortIds()[0] || null;
        return null;
    }
    async connectDevices(deviceIds, animated = false) {
        const sys = this.sys;
        const free = this._freePortIds();
        const linked = new Set();
        for (const c of (sys.conns || [])) {
            if (c.type !== 'wire') continue;
            const a = deviceIdOfPort(c.from), b = deviceIdOfPort(c.to);
            if (a === this.id) linked.add(b); else if (b === this.id) linked.add(a);
        }
        const added = [];
        for (const id of (deviceIds || [])) {
            if (!id || linked.has(id)) continue;
            const comp = sys.comps[id];
            if (!comp || !['net_switch', 'l3_switch', 'pc', 'router', 'net_server'].includes(comp.type)) continue;
            if (!free.length) break;
            const to = this._targetPort(comp);
            if (!to) continue;
            const from = free.shift();
            const conn = { from, to, type: 'wire' };
            if (animated && typeof sys.addConnectionAnimated === 'function') await sys.addConnectionAnimated(conn);
            else sys.addConn(conn);
            linked.add(id); added.push(id);
        }
        sys.redrawAll();
        return added;
    }
    getContextMenuItems() {
        return [
            { label: '连接到选中的设备', onClick: () => this._connectSelected() },
            { label: '断开所有连线', onClick: () => this.disconnectAll() },
        ];
    }
    _connectSelected() {
        const sys = this.sys;
        const selected = [...(sys.selectedCompIds || [])].map(id => sys.comps[id])
            .filter(c => c && c.id !== this.id && ['net_switch', 'l3_switch', 'pc', 'router', 'net_server'].includes(c.type));
        if (!selected.length) { sys.showFloatingTip('请先选中要连接的设备'); return; }
        this.connectDevices(selected.map(c => c.id)).then(added => {
            sys.showFloatingTip(added.length ? `已连接 ${added.length} 台设备：${added.join('、')}` : '选中的设备均已连接，或端口已用尽');
        });
    }
    disconnectAll() {
        const sys = this.sys;
        const conns = (sys.conns || []).filter(c => c.type === 'wire' && (deviceIdOfPort(c.from) === this.id || deviceIdOfPort(c.to) === this.id));
        conns.forEach(c => sys.removeConn(c));
        sys.showFloatingTip(conns.length ? `已断开 ${conns.length} 条连线` : '本设备没有已连接的线缆');
    }

    // ─────────────────────────────────────────────────────────
    //  多页面板
    // ─────────────────────────────────────────────────────────

    showConfigDialog(tab = 'vlan') {
        const tabs = [
            { id: 'vlan', label: 'VLAN/端口', render: (el) => this._renderVlanTab(el) },
            { id: 'iface', label: 'VLANIF 接口', render: (el) => this._renderIfaceTab(el) },
            { id: 'route', label: '静态路由', render: (el) => this._renderRouteTab(el) },
            { id: 'dhcp', label: 'DHCP', render: (el) => this._renderDhcpTab(el) },
            { id: 'dyn', label: '动态路由', render: (el) => this._renderDynTab(el) },
            { id: 'cli', label: '命令行', render: (el) => this._renderCliTab(el) },
        ];
        this._dialog = openTabbedDialog({
            title: `三层交换机配置 — ${this.hostname}（${this.id}）`,
            tabs, width: 820, height: 560, container: this.sys.container,
        });
        const idx = Math.max(0, tabs.findIndex(t => t.id === tab));
        setTimeout(() => this._dialog && this._dialog.switchTab(idx), 0);
    }
    openConfigDialog(tab = 'vlan') { this.showConfigDialog(tab); }

    _renderVlanTab(el) {
        el.innerHTML = '';
        const inputStyle = 'padding:6px;border:1px solid #ccc;border-radius:4px;';
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:10px;';
        addRow.innerHTML = `<div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">新建 VLAN（1~4094）</label>
            <input id="diag_new_vlan" style="${inputStyle}" placeholder="10"></div>`;
        const addBtn = document.createElement('button');
        addBtn.textContent = '创建 VLAN';
        addBtn.style.cssText = 'padding:8px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        addBtn.onclick = () => {
            const n = parseInt((document.getElementById('diag_new_vlan') || {}).value, 10);
            if (!(n >= 1 && n <= 4094)) { alert('请输入 1~4094 的 VLAN ID'); return; }
            this.createVlan(n); this.onConfigUpdate({}); this._renderVlanTab(el);
        };
        addRow.appendChild(addBtn);
        el.appendChild(addRow);

        const info = document.createElement('div');
        info.style.cssText = 'font-size:12px;color:#666;margin-bottom:10px;';
        info.textContent = `已有 VLAN：${[...this.vlans].sort((a, b) => a - b).join('、')}。端口可设为 access（单 VLAN）或 trunk（多 VLAN）。`;
        el.appendChild(info);

        const table = document.createElement('div');
        const selects = {};
        for (let i = 1; i <= this.portCount; i++) {
            const origId = 'eth' + i;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 0;font-size:13px;';
            const peer = peerOfSwitchPort(this.sys, `${this.id}_wire_${origId}`);
            const label = document.createElement('span');
            label.style.cssText = 'width:170px;';
            label.textContent = `Ethernet0/0/${i}${peer ? '（' + peer + '）' : ''}`;
            const typeSel = document.createElement('select');
            typeSel.style.cssText = inputStyle + ';min-width:90px;';
            ['access', 'trunk'].forEach(t => {
                const o = document.createElement('option'); o.value = t; o.textContent = t;
                if (this.getPortType(origId) === t) o.selected = true;
                typeSel.appendChild(o);
            });
            const vlanInput = document.createElement('input');
            vlanInput.style.cssText = inputStyle + ';width:150px;';
            vlanInput.value = this.getPortType(origId) === 'trunk'
                ? this.getPortVlans(origId).join(',')
                : String(this.getPortVlan(origId));
            vlanInput.placeholder = 'access: 10  trunk: 10,20';
            typeSel.onchange = () => { this.setPortType(origId, typeSel.value); };
            selects[origId] = { typeSel, vlanInput };
            row.appendChild(label); row.appendChild(typeSel); row.appendChild(vlanInput);
            table.appendChild(row);
        }
        el.appendChild(table);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:12px;';
        const save = document.createElement('button');
        save.textContent = '保存';
        save.id = 'vlan_save_btn';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => {
            for (const origId in selects) {
                const { typeSel, vlanInput } = selects[origId];
                const vals = String(vlanInput.value).split(/[,\s]+/).map(x => parseInt(x, 10)).filter(x => x >= 1 && x <= 4094);
                if (!vals.length) { alert(`端口 ${origId} 请填写正确的 VLAN`); return; }
                this.portType[origId] = typeSel.value;
                if (typeSel.value === 'trunk') this.portTrunkVlans[origId] = vals;
                else this.portVlan[origId] = vals[0];
                vals.forEach(v => this.vlans.add(v));
            }
            this.onConfigUpdate({});
            this._updateVlanLabels();
            closeActiveNetDialog();
        };
        btnRow.appendChild(save);
        el.appendChild(btnRow);
    }

    _renderIfaceTab(el) {
        el.innerHTML = '';
        const inputStyle = 'width:100%;box-sizing:border-box;padding:6px;border:1px solid #ccc;border-radius:4px;';
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;';
        toolbar.innerHTML = `<div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">新建 VLANIF（VLAN 号）</label>
            <input id="diag_vlanif_vlan" style="padding:6px;border:1px solid #ccc;border-radius:4px;" placeholder="10"></div>`;
        const addBtn = document.createElement('button');
        addBtn.textContent = '创建 VLANIF';
        addBtn.style.cssText = 'padding:8px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        addBtn.onclick = () => {
            const n = parseInt((document.getElementById('diag_vlanif_vlan') || {}).value, 10);
            if (!(n >= 1 && n <= 4094)) { alert('请输入 1~4094 的 VLAN 号'); return; }
            this.ensureVlanif(n); this._renderIfaceTab(el);
        };
        toolbar.appendChild(addBtn);
        el.appendChild(toolbar);

        const wrap = document.createElement('div');
        this.interfaces.forEach((f, i) => {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin-bottom:12px;';
            card.innerHTML = `<div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">${f.name}（VLAN ${f.vlanId}）</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
                    <div style="flex:1;min-width:150px;"><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">IP 地址</label>
                        <input type="text" id="diag_ip_${f.origId}" value="${f.ip}" placeholder="如 192.168.10.1" style="${inputStyle}"></div>
                    <div style="flex:1;min-width:150px;"><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">子网掩码</label>
                        <input type="text" id="diag_mask_${f.origId}" value="${f.mask}" placeholder="如 255.255.255.0 或 24" style="${inputStyle}"></div>
                    <div style="min-width:70px;"><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">状态</label>
                        <label style="font-size:13px;"><input type="checkbox" id="diag_up_${f.origId}" ${f.up !== false ? 'checked' : ''}> 启用</label></div>
                </div>`;
            wrap.appendChild(card);
        });
        el.appendChild(wrap);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:6px;';
        const save = document.createElement('button');
        save.textContent = '保存';
        save.id = 'l3iface_save_btn';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => {
            for (const f of this.interfaces) {
                const ip = ((document.getElementById(`diag_ip_${f.origId}`) || {}).value || '').trim();
                let mask = ((document.getElementById(`diag_mask_${f.origId}`) || {}).value || '').trim();
                const up = !!(document.getElementById(`diag_up_${f.origId}`) || {}).checked;
                if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
                if (ip && !isValidIp(ip)) { alert(`${f.name} 的 IP 格式不正确`); return; }
                if (ip && !isValidMask(mask)) { alert(`${f.name} 的子网掩码格式不正确`); return; }
                f.ip = ip || ''; f.mask = ip ? mask : ''; f.up = up;
            }
            this.onConfigUpdate({});
            closeActiveNetDialog();
        };
        btnRow.appendChild(save);
        el.appendChild(btnRow);
    }

    _renderRouteTab(el) {
        el.innerHTML = '';
        const inputStyle = 'padding:6px;border:1px solid #ccc;border-radius:4px;';
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;';
        addRow.innerHTML =
            `<div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">目标网段</label><input id="diag_route_net" style="${inputStyle}" placeholder="0.0.0.0 或 192.168.30.0"></div>
             <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">掩码</label><input id="diag_route_mask" style="${inputStyle}" value="255.255.255.0"></div>
             <div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">下一跳</label><input id="diag_route_nh" style="${inputStyle}" placeholder="10.10.10.2"></div>`;
        const addBtn = document.createElement('button');
        addBtn.textContent = '添加路由';
        addBtn.style.cssText = 'padding:8px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        addBtn.onclick = () => {
            const net = (document.getElementById('diag_route_net') || {}).value;
            const mask = (document.getElementById('diag_route_mask') || {}).value;
            const nh = (document.getElementById('diag_route_nh') || {}).value;
            if (!isValidIp(net) || !isValidRouteMask(mask) || !isValidIp(nh)) { alert('请填写正确的目标网段 / 掩码 / 下一跳'); return; }
            this.routes.push({ net, mask, nextHop: nh });
            this.onConfigUpdate({}); this._renderRouteTab(el);
        };
        addRow.appendChild(addBtn);
        el.appendChild(addRow);

        const list = document.createElement('div');
        list.style.cssText = 'font-size:13px;';
        const direct = this.interfaces.filter(f => f.up !== false && isValidIp(f.ip) && isValidMask(f.mask));
        if (direct.length) {
            list.innerHTML += '<div style="color:#666;margin-bottom:6px;">直连网段（自动生成）：</div>';
            direct.forEach(f => { const n = networkOf(f.ip, f.mask); list.innerHTML += `<div style="padding:3px 0;">&nbsp;&nbsp;${n}/${maskPrefix(f.mask)}　直连 ${f.name}</div>`; });
        }
        list.innerHTML += '<div style="color:#666;margin:10px 0 6px;">静态路由：</div>';
        if (!this.routes.length) list.innerHTML += '<div style="color:#999;">&nbsp;&nbsp;（无）</div>';
        else this.routes.forEach((r, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:3px 0;';
            row.innerHTML = `<span>&nbsp;&nbsp;${r.net}/${maskPrefix(r.mask)} → ${r.nextHop}</span>`;
            const del = document.createElement('button');
            del.textContent = '删除';
            del.style.cssText = 'padding:2px 8px;border:none;background:#f3d2cf;color:#a13b2f;border-radius:4px;cursor:pointer;';
            del.onclick = () => { this.routes.splice(i, 1); this.onConfigUpdate({}); this._renderRouteTab(el); };
            row.appendChild(del); list.appendChild(row);
        });
        el.appendChild(list);
    }

    _renderDhcpTab(el) {
        el.innerHTML = '';
        const head = document.createElement('div');
        head.style.cssText = 'margin-bottom:12px;font-size:13px;';
        head.innerHTML = `<label style="cursor:pointer;"><input type="checkbox" id="diag_dhcp_enable" ${this.dhcpEnabled ? 'checked' : ''}> 启用 DHCP 服务（各 VLANIF 按直连网段自动生成地址池，起始主机号 .100）</label>`;
        el.appendChild(head);
        const btn = document.createElement('button');
        btn.textContent = '保存';
        btn.id = 'dhcp_save_btn';
        btn.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;margin-bottom:14px;';
        btn.onclick = () => { this.dhcpEnabled = !!(document.getElementById('diag_dhcp_enable') || {}).checked; this.onConfigUpdate({ dhcp: this.dhcpEnabled }); this._renderDhcpTab(el); };
        el.appendChild(btn);

        const rows = dhcpPoolStatus(this.sys, this);
        const table = document.createElement('div');
        table.style.cssText = 'font-size:13px;';
        if (!this.dhcpEnabled) table.innerHTML = '<div style="color:#999;">DHCP 服务未启用。</div>';
        else if (!rows.length) table.innerHTML = '<div style="color:#999;">VLANIF 尚未配置有效 IP，暂无地址池。</div>';
        else rows.forEach(r => {
            const div = document.createElement('div');
            div.style.cssText = 'border:1px solid #e3e6ea;border-radius:6px;padding:8px 10px;margin-bottom:8px;';
            const leaseLines = r.leases.length ? r.leases.map(l => `<div style="color:#555;">&nbsp;&nbsp;${l.mac} → ${l.ip}</div>`).join('') : '<div style="color:#999;">&nbsp;&nbsp;（暂无租约）</div>';
            div.innerHTML = `<div><b>${r.interface}</b>　网段 ${r.net}/${maskPrefix(r.mask)}　网关 ${r.gateway}　已分配 ${r.used}</div>${leaseLines}`;
            table.appendChild(div);
        });
        el.appendChild(table);
    }

    _renderDynTab(el) {
        el.innerHTML = '';
        const inputStyle = 'padding:6px;border:1px solid #ccc;border-radius:4px;';
        const ripBox = document.createElement('div');
        ripBox.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:13px;';
        ripBox.innerHTML = `<div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">RIP（距离向量，以跳数为度量）</div>
            <label style="display:block;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="diag_rip_enable" ${this.ripEnabled ? 'checked' : ''}> 启用 RIP</label>
            <div style="display:flex;gap:8px;align-items:flex-end;">
                <div style="flex:1;"><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">宣告网段（逗号分隔，留空=全部直连网段）</label>
                    <input id="diag_rip_nets" style="${inputStyle};width:100%;box-sizing:border-box;" value="${this.ripNetworks.join(',')}" placeholder="192.168.10.0,192.168.20.0"></div>
            </div>`;
        const ripSave = document.createElement('button');
        ripSave.textContent = '保存';
        ripSave.id = 'rip_save_btn';
        ripSave.style.cssText = 'margin-top:8px;padding:7px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        ripSave.onclick = () => {
            this.ripEnabled = !!(document.getElementById('diag_rip_enable') || {}).checked;
            this.ripNetworks = String((document.getElementById('diag_rip_nets') || {}).value || '').split(/[,\s]+/).filter(Boolean);
            this.onConfigUpdate({ rip: this.ripEnabled, ripNetworks: this.ripNetworks });
            this._renderDynTab(el);
        };
        ripBox.appendChild(ripSave);
        el.appendChild(ripBox);

        const ospfBox = document.createElement('div');
        ospfBox.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;font-size:13px;';
        const netLines = this.ospfNetworks.map(n => `<div style="color:#555;">&nbsp;&nbsp;network ${n.net} ${n.wildcard} area 0</div>`).join('') || '<div style="color:#999;">&nbsp;&nbsp;（无）</div>';
        ospfBox.innerHTML = `<div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">OSPF（链路状态，单区域 0）</div>
            <label style="display:block;margin-bottom:8px;cursor:pointer;"><input type="checkbox" id="diag_ospf_enable" ${this.ospfEnabled ? 'checked' : ''}> 启用 OSPF</label>
            <div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">Router ID</label>
                <input id="diag_ospf_rid" style="${inputStyle};width:220px;" value="${this.ospfRouterId}" placeholder="如 1.1.1.1"></div>
            <div>${netLines}</div>`;
        const ospfSave = document.createElement('button');
        ospfSave.textContent = '保存';
        ospfSave.id = 'ospf_save_btn';
        ospfSave.style.cssText = 'margin-top:8px;padding:7px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        ospfSave.onclick = () => {
            this.ospfEnabled = !!(document.getElementById('diag_ospf_enable') || {}).checked;
            this.ospfRouterId = ((document.getElementById('diag_ospf_rid') || {}).value || '').trim();
            this.onConfigUpdate({ ospf: this.ospfEnabled, ospfRouterId: this.ospfRouterId });
            this._renderDynTab(el);
        };
        ospfBox.appendChild(ospfSave);
        el.appendChild(ospfBox);
    }

    // ─────────────────────────────────────────────────────────
    //  命令行
    // ─────────────────────────────────────────────────────────

    _prompt() {
        if (this._view === 'iface' && this._curPort) return `[${this.hostname}-Ethernet0/0/${String(this._curPort).replace('eth', '')}]`;
        if (this._view === 'vlanif' && this._curIface) return `[${this.hostname}-${this._curIface.name}]`;
        if (this._view === 'rip') return `[${this.hostname}-rip-1]`;
        if (this._view === 'ospf') return `[${this.hostname}-ospf-1]`;
        if (this._view === 'ospf-area') return `[${this.hostname}-ospf-1-area-0.0.0.0]`;
        if (this._view === 'system') return `[${this.hostname}]`;
        return `<${this.hostname}>`;
    }
    _syncPrompt() { if (this._terminal) this._terminal.setPrompt(this._prompt()); }

    _renderCliTab(el) {
        el.innerHTML = '';
        const info = document.createElement('div');
        info.style.cssText = 'font-size:12px;color:#666;margin-bottom:8px;';
        info.textContent = '可用命令：sysname、system-view、vlan、interface Ethernet0/0/x / Vlanif x、port link-type access|trunk、port default vlan、'
            + 'port trunk allow-pass vlan、ip address、ip route-static、dhcp enable、rip、ospf 1 router-id、area 0、network、'
            + 'display ip routing-table [protocol rip|ospf]、display rip、display ospf peer、display vlan、ping、tracert、save。';
        el.appendChild(info);
        this._terminal = new Terminal({
            prompt: this._prompt(), height: 400,
            welcome: 'Info: 正在进入三层交换机命令行 ...\n',
            onCommand: (cmd, term) => this._handleCommand(cmd, term),
        });
        el.appendChild(this._terminal.element);
    }

    _handleCommand(cmd, term) {
        const raw = String(cmd || '').trim();
        if (!raw) return undefined;
        const parts = raw.split(/\s+/);
        const name = parts[0].toLowerCase();

        if (name === 'display' || name === 'show') return this._cmdDisplay(parts.slice(1), term);
        if (name === 'ping') return this._cmdPing(parts.slice(1), term);
        if (name === 'tracert' || name === 'traceroute') return this._cmdTracert(parts.slice(1), term);
        if (name === 'system-view' || name === 'configure') {
            this._view = 'system'; this._curPort = null; this._curIface = null; this._syncPrompt();
            term.print('Enter system view, return user view with Ctrl+Z.', 'term-dim'); return undefined;
        }
        if (name === 'return') { this._view = 'user'; this._curPort = null; this._curIface = null; this._syncPrompt(); return undefined; }
        if (name === 'quit') {
            if (this._view === 'iface' || this._view === 'vlanif') { this._view = 'system'; this._curPort = null; this._curIface = null; this._syncPrompt(); }
            else if (this._view === 'ospf-area') { this._view = 'ospf'; this._syncPrompt(); }
            else if (this._view === 'ospf' || this._view === 'rip') { this._view = 'system'; this._syncPrompt(); }
            else if (this._view === 'system') { this._view = 'user'; this._syncPrompt(); }
            else closeActiveNetDialog();
            return undefined;
        }
        if (name === 'interface') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const arg = parts.slice(1).join('').toLowerCase();
            if (/^vlanif\d*$/.test(arg)) {
                const n = parseInt(arg.replace('vlanif', '') || '1', 10);
                const f = this.ensureVlanif(n);
                this._curIface = f; this._curPort = null; this._view = 'vlanif'; this._syncPrompt();
                return undefined;
            }
            const m = String(parts[1] || '').match(/(\d+)$/);
            const origId = m ? `eth${m[1]}` : String(parts[1] || '').toLowerCase();
            if (!this.portVlan.hasOwnProperty(origId)) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
            this._view = 'iface'; this._curPort = origId; this._curIface = null; this._syncPrompt();
            return undefined;
        }
        if (name === 'vlan') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const n = parseInt(parts[1], 10);
            if (!(n >= 1 && n <= 4094)) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
            this.createVlan(n); this.onConfigUpdate({});
            term.print(`Info: VLAN ${n} 创建成功。`, 'term-ok'); return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'vlan') {
            const n = parseInt(parts[2], 10);
            if (n === 1) { term.print('Error: VLAN 1 不能删除。', 'term-err'); return undefined; }
            const ok = this.deleteVlan(n);
            term.print(ok ? `Info: VLAN ${n} 已删除。` : `Error: VLAN ${n} 不存在。`, ok ? 'term-ok' : 'term-err'); return undefined;
        }
        if (name === 'port') {
            const p1 = String(parts[1] || '').toLowerCase();
            if (p1 === 'link-type') {
                if (this._view !== 'iface' || !this._curPort) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
                const t = String(parts[2] || '').toLowerCase();
                if (t !== 'access' && t !== 'trunk') { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
                this.setPortType(this._curPort, t);
                term.print(`Info: 端口链路类型已设为 ${t}。`, 'term-ok'); return undefined;
            }
            if (p1 === 'default' && String(parts[2] || '').toLowerCase() === 'vlan') {
                if (this._view !== 'iface' || !this._curPort) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
                const n = parseInt(parts[3], 10);
                if (!(n >= 1 && n <= 4094)) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
                this.setPortVlan(this._curPort, n);
                term.print(`Info: 端口已加入 VLAN ${n}。`, 'term-ok'); return undefined;
            }
            if (p1 === 'trunk' && String(parts[2] || '').toLowerCase() === 'allow-pass') {
                if (this._view !== 'iface' || !this._curPort) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
                const vs = String(parts.slice(4).join(' ')).split(/[,\s]+/).map(x => parseInt(x, 10)).filter(x => x >= 1 && x <= 4094);
                if (String(parts[3] || '').toLowerCase() !== 'vlan' || !vs.length) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
                this.setTrunkVlans(this._curPort, vs);
                term.print(`Info: trunk 端口已允许 VLAN ${vs.join(' ')} 通过。`, 'term-ok'); return undefined;
            }
        }
        if (name === 'ip' && String(parts[1] || '').toLowerCase() === 'address') {
            if (this._view !== 'vlanif' || !this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const ip = parts[2]; let mask = parts[3];
            if (!ip || !mask) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
            if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
            if (!isValidIp(ip) || !isValidMask(mask)) { term.print('Error: 地址或掩码不合法。', 'term-err'); return undefined; }
            this._curIface.ip = ip; this._curIface.mask = mask; this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 地址已设置为 ${ip} ${mask}。`, 'term-ok'); return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'ip' && String(parts[2] || '').toLowerCase() === 'address') {
            if (!this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._curIface.ip = ''; this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 地址已删除。`, 'term-ok'); return undefined;
        }
        if (name === 'shutdown') {
            if (this._view !== 'vlanif' || !this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._curIface.up = false; this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 已关闭。`, 'term-warn'); return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'shutdown') {
            if (this._view !== 'vlanif' || !this._curIface) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._curIface.up = true; this.onConfigUpdate({});
            term.print(`Info: ${this._curIface.name} 已启用。`, 'term-ok'); return undefined;
        }
        if (name === 'sysname') {
            if (!parts[1]) { term.print('用法: sysname <设备名称>', 'term-warn'); return undefined; }
            this.onConfigUpdate({ hostname: parts[1] });
            term.print(`Info: 系统名称已修改为 ${parts[1]}。`, 'term-ok'); return undefined;
        }
        if (name === 'ip' && String(parts[1] || '').toLowerCase() === 'route-static') {
            const net = parts[2]; let mask = parts[3]; const nh = parts[4];
            if (!net || !mask || !nh) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
            if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
            if (!isValidIp(net) || !isValidRouteMask(mask) || !isValidIp(nh)) { term.print('Error: 参数不合法。', 'term-err'); return undefined; }
            this.routes.push({ net, mask, nextHop: nh }); this.onConfigUpdate({});
            term.print(`Info: 已添加静态路由 ${networkOf(net, mask)}/${maskPrefix(mask)} → ${nh}。`, 'term-ok'); return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'ip' && String(parts[2] || '').toLowerCase() === 'route-static') {
            const net = parts[3]; let mask = parts[4]; const nh = parts[5];
            if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
            const before = this.routes.length;
            this.routes = this.routes.filter(r => !(r.net === networkOf(net, mask) && r.nextHop === nh));
            this.onConfigUpdate({});
            term.print(before !== this.routes.length ? 'Info: 静态路由已删除。' : 'Error: 未找到匹配的静态路由。', before !== this.routes.length ? 'term-ok' : 'term-err');
            return undefined;
        }
        if (name === 'dhcp') {
            if (String(parts[1] || '').toLowerCase() === 'enable') { this.dhcpEnabled = true; this.onConfigUpdate({ dhcp: true }); term.print('Info: DHCP 服务已启用。', 'term-ok'); return undefined; }
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'dhcp') {
            this.dhcpEnabled = false; this.onConfigUpdate({ dhcp: false }); term.print('Info: DHCP 服务已关闭。', 'term-ok'); return undefined;
        }
        if (name === 'rip') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this.ripEnabled = true; this.onConfigUpdate({ rip: true });
            this._view = 'rip'; this._syncPrompt();
            term.print('Info: RIP 进程 1 已启用，进入 RIP 视图。', 'term-ok'); return undefined;
        }
        if (name === 'version') {
            if (this._view !== 'rip' && this._view !== 'system') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const v = String(parts[1] || '').trim();
            if (v !== '1' && v !== '2') { term.print('用法: version <1|2>', 'term-warn'); return undefined; }
            this.ripVersion = parseInt(v, 10);
            term.print(`Info: RIP 版本已设置为 ${v}。`, 'term-ok'); return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'rip') {
            this.ripEnabled = false; this.onConfigUpdate({ rip: false });
            if (this._view === 'rip') this._view = 'system';
            this._syncPrompt();
            term.print('Info: RIP 已关闭。', 'term-ok'); return undefined;
        }
        if (name === 'network') {
            // RIP 视图：network <网段>；OSPF 区域视图：network <网段> <反掩码>
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const net = parts[1];
            if (!isValidIp(net)) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
            const wcRaw = String(parts[2] || '').trim();
            const isOspf = this._view === 'ospf-area' || this._view === 'ospf' || /^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(wcRaw);
            if (isOspf) {
                const wildcard = /^\d+$/.test(wcRaw) ? prefixToWildcard(wcRaw) : wcRaw;
                if (!wildcard || !/^\d{1,3}(\.\d{1,3}){3}$/.test(wildcard)) { term.print('用法: network <网段> <反掩码>', 'term-warn'); return undefined; }
                this.ospfNetworks.push({ net, wildcard });
                this.ospfEnabled = true;
                this.onConfigUpdate({ ospf: true, ospfNetworks: this.ospfNetworks });
                term.print(`Info: OSPF 已宣告网段 ${net} ${wildcard} area 0。`, 'term-ok');
            } else {
                if (!this.ripNetworks.includes(net)) this.ripNetworks.push(net);
                this.ripEnabled = true;
                this.onConfigUpdate({ rip: true, ripNetworks: this.ripNetworks });
                term.print(`Info: RIP 已宣告网段 ${net}。`, 'term-ok');
            }
            return undefined;
        }
        if (name === 'ospf') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const rid = parts.find((p, i) => String(parts[i - 1] || '').toLowerCase() === 'router-id') || '';
            if (isValidIp(rid)) this.ospfRouterId = rid;
            this.ospfEnabled = true;
            this.onConfigUpdate({ ospf: true, ospfRouterId: this.ospfRouterId });
            this._view = 'ospf'; this._syncPrompt();
            term.print('Info: OSPF 进程 1 已启用，进入 OSPF 视图。', 'term-ok'); return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'ospf') {
            this.ospfEnabled = false; this.onConfigUpdate({ ospf: false });
            if (this._view === 'ospf' || this._view === 'ospf-area') this._view = 'system';
            this._syncPrompt();
            term.print('Info: OSPF 已关闭。', 'term-ok'); return undefined;
        }
        if (name === 'area') {
            if (this._view !== 'ospf' && this._view !== 'system') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this._view = 'ospf-area'; this._syncPrompt();
            term.print('Info: 已进入 OSPF 区域视图。', 'term-dim'); return undefined;
        }
        if (name === 'save') {
            term.print('The current configuration will be written to the device.', 'term-dim');
            term.print('Info: The current configuration is saved successfully.', 'term-ok'); return undefined;
        }
        if (name === 'cls' || name === 'clear') { term.clear(); return undefined; }
        if (name === 'help' || name === '?') {
            term.print('可用命令：', 'term-info');
            term.print('  system-view / vlan <id> / interface Ethernet0/0/1 / interface Vlanif 10', 'term-dim');
            term.print('  sysname <名称>                                                      修改设备名称', 'term-dim');
            term.print('  port link-type access|trunk / port default vlan <id> / port trunk allow-pass vlan <id...>', 'term-dim');
            term.print('  ip address <ip> <mask|前缀> / ip route-static <net> <mask> <下一跳>', 'term-dim');
            term.print('  dhcp enable / rip → version 2 → network <网段> / ospf 1 router-id <id> → area 0 → network <网段> <反掩码>', 'term-dim');
            term.print('  display ip routing-table [protocol rip|ospf] / display rip / display ospf peer / display vlan', 'term-dim');
            term.print('  ping <ip> / tracert <ip> / save / cls', 'term-dim');
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
            term.print('VRP (R) software, Version 5.170 (S5730 V200R019C10)');
            term.print('HUAWEI S5730 L3 Switch uptime is 0 day, 0 hour, 0 minute');
            term.print(`System Name : ${this.hostname}`);
            term.print('');
            return undefined;
        }
        if (sub === 'vlan') {
            term.print('');
            const ids = [...this.vlans].sort((a, b) => a - b);
            for (const v of ids) {
                const ports = [];
                for (let i = 1; i <= this.portCount; i++) {
                    const o = 'eth' + i;
                    if (this.getPortType(o) === 'trunk') { if (this.getPortVlans(o).includes(v)) ports.push(`Ethernet0/0/${i}(T)`); }
                    else if (this.getPortVlan(o) === v) ports.push(`Ethernet0/0/${i}`);
                }
                term.print(`VLAN ${v}`, 'term-info');
                term.print(`  Ports: ${ports.join(', ') || '（无）'}`);
            }
            term.print('');
            return undefined;
        }
        if (sub === 'port' && sub2 === 'vlan') {
            term.print('');
            term.print('Port                        Link Type   VLAN', 'term-info');
            for (let i = 1; i <= this.portCount; i++) {
                const o = 'eth' + i;
                const t = this.getPortType(o);
                const v = t === 'trunk' ? this.getPortVlans(o).join(',') : String(this.getPortVlan(o));
                term.print(`${('Ethernet0/0/' + i).padEnd(27)} ${t.padEnd(11)} ${v}`);
            }
            term.print('');
            return undefined;
        }
        if (sub === 'ip' && sub2 === 'interface') {
            term.print('');
            term.print('Interface                   IP Address/Mask       Physical   Protocol', 'term-info');
            for (const f of this.interfaces) {
                const addr = (f.up !== false && isValidIp(f.ip)) ? `${f.ip}/${maskPrefix(f.mask)}` : 'unassigned';
                term.print(`${f.name.padEnd(27)} ${addr.padEnd(21)} ${(f.up !== false ? 'up' : 'down').padEnd(10)} ${(f.up !== false ? 'up' : 'down')}`, f.up !== false && isValidIp(f.ip) ? 'term-ok' : 'term-dim');
            }
            term.print('');
            return undefined;
        }
        if (sub === 'ip' && sub2 === 'routing-table') {
            const proto = (args[2] && String(args[2]).toLowerCase() === 'protocol') ? String(args[3] || '').toLowerCase() : '';
            term.print('');
            term.print('Route Flags: R - relay, D - download to fib', 'term-dim');
            term.print('------------------------------------------------------------------------------');
            term.print('Routing Tables: Public');
            term.print('Destination/Mask    Proto   Pre  Cost      NextHop         Interface', 'term-info');
            for (const e of routingTable(this)) {
                if (proto && e.type !== proto) continue;
                const dest = `${e.net}/${e.prefix}`;
                if (e.type === 'direct') {
                    term.print(`${dest.padEnd(19)} Direct  ${String(e.ad).padEnd(4)} 0         ${(e.iface.ip || '').padEnd(15)} ${e.iface.name}`, 'term-ok');
                } else {
                    const protoName = e.type === 'static' ? 'Static' : (e.type === 'rip' ? 'RIP' : 'OSPF');
                    term.print(`${dest.padEnd(19)} ${protoName.padEnd(7)} ${String(e.ad).padEnd(4)} ${String(e.metric !== undefined ? e.metric : 0).padEnd(9)} ${e.nextHop.padEnd(15)} ${e.ifaceName || '(route)'}`, 'term-warn');
                }
            }
            term.print('');
            return undefined;
        }
        if (sub === 'rip') {
            term.print('');
            if (!this.ripEnabled) { term.print('Info: RIP 未启用。', 'term-dim'); term.print(''); return undefined; }
            term.print('RIP process 1', 'term-info');
            term.print(`  Version : 2    Networks: ${this.ripNetworks.length ? this.ripNetworks.join(', ') : '（全部直连网段）'}`);
            term.print('  Neighbors:', 'term-info');
            const nbs = routingNeighbors(this.sys, this);
            if (!nbs.length) term.print('    （无）', 'term-dim');
            nbs.forEach(n => term.print(`    ${n.ip.padEnd(16)} ${n.hostname}`));
            term.print('');
            return undefined;
        }
        if (sub === 'ospf') {
            const what = (args[1] || '').toLowerCase();
            term.print('');
            if (!this.ospfEnabled) { term.print('Info: OSPF 未启用。', 'term-dim'); term.print(''); return undefined; }
            if (what === 'peer') {
                term.print('OSPF Process 1 with Router ID ' + (this.ospfRouterId || '-'), 'term-info');
                term.print(' Neighbors', 'term-info');
                term.print(' Router ID       Address         State     Interface', 'term-info');
                const nbs = routingNeighbors(this.sys, this);
                if (!nbs.length) term.print('  （无邻居）', 'term-dim');
                nbs.forEach(n => term.print(` ${String(n.routerId).padEnd(15)} ${n.ip.padEnd(15)} Full      ${n.localIface}`));
            } else {
                term.print('OSPF Process 1 with Router ID ' + (this.ospfRouterId || '-'), 'term-info');
                term.print(` Area: 0    Networks: ${this.ospfNetworks.map(n => n.net).join(', ') || '（全部直连网段）'}`);
            }
            term.print('');
            return undefined;
        }
        if (sub === 'mac-address' || sub === 'mac-address-table') {
            term.print('');
            term.print('MAC Address Table', 'term-info');
            term.print('VLAN   MAC Address        Type       Port');
            let n = 0;
            for (let i = 1; i <= this.portCount; i++) {
                const pid = `${this.id}_wire_eth${i}`;
                const peer = peerOfSwitchPort(this.sys, pid);
                if (!peer) continue;
                const comp = this.sys.comps[peer];
                if (!comp) continue;
                let mac = null;
                if (comp.type === 'pc' || comp.type === 'net_server') mac = macOf(comp);
                else if (comp.type === 'router' || comp.type === 'l3_switch') {
                    const conn = (this.sys.conns || []).find(c => c.from === pid || c.to === pid);
                    const otherPort = conn ? (conn.from === pid ? conn.to : conn.from) : null;
                    const f = (comp.interfaces || []).find(x => x.portId === otherPort);
                    mac = macOfInterface(comp, f ? f.name : null);
                }
                if (!mac) continue;
                const vlan = this.getPortVlans('eth' + i)[0];
                term.print(`${String(vlan).padEnd(6)} ${mac.padEnd(18)} dynamic    Ethernet0/0/${i}`);
                n++;
            }
            if (!n) term.print('（当前没有学习到 MAC 地址）', 'term-dim');
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
        if (sub === 'current-configuration' || sub === 'current') {
            term.print('');
            term.print('#');
            term.print(`sysname ${this.hostname}`);
            term.print('#');
            [...this.vlans].sort((a, b) => a - b).forEach(v => term.print(`vlan ${v}`));
            term.print('#');
            if (this.dhcpEnabled) term.print('dhcp enable');
            if (this.ripEnabled) { term.print('rip 1'); term.print(' version 2'); this.ripNetworks.forEach(n => term.print(` network ${n}`)); term.print('#'); }
            if (this.ospfEnabled) { term.print(`ospf 1 router-id ${this.ospfRouterId || '-'}`); this.ospfNetworks.forEach(n => term.print(` area 0.0.0.0`)); term.print('#'); }
            for (const f of this.interfaces) {
                term.print(`interface ${f.name}`);
                if (f.up === false) term.print(' shutdown');
                if (isValidIp(f.ip)) term.print(` ip address ${f.ip} ${f.mask}`);
                term.print('#');
            }
            for (let i = 1; i <= this.portCount; i++) {
                const o = 'eth' + i;
                term.print(`interface Ethernet0/0/${i}`);
                term.print(` port link-type ${this.getPortType(o)}`);
                if (this.getPortType(o) === 'trunk') term.print(` port trunk allow-pass vlan ${this.getPortVlans(o).join(' ')}`);
                else term.print(` port default vlan ${this.getPortVlan(o)}`);
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
            term.print(`  ${String(h.ttl).padStart(2)}    <1ms    ${h.ip || '*'}    ${h.label || ''}`, h.ok ? '' : 'term-err');
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
        try { await term.typeCommand(cmd); if (holdMs) await sleep(holdMs); }
        finally { this._demoActive = false; }
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
            for (const c of cmds) { await term.typeCommand(c); if (holdMs) await sleep(holdMs); }
            await sleep(endHoldMs);
        } finally { this._demoActive = false; }
        closeActiveNetDialog();
    }
}
