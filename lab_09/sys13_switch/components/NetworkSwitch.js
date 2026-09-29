import { BaseComponent } from './BaseComponent.js';
import { Terminal, openTabbedDialog, closeActiveNetDialog, sleep } from '../lib/NetConsole.js';
import { DEMO } from '../lib/DemoTiming.js';
import {
    collectPCs, connectedPCIds, peerOfSwitchPort, deviceIdOfPort,
    runPing, formatPingLines, macOf, macOfInterface, maskPrefix,
    isValidIp, isValidMask,
} from '../tools/NetworkSim.js';

/** 前缀长度 → 点分掩码 */
function prefixToMask(p) {
    const n = parseInt(p, 10);
    if (!(n >= 0 && n <= 32)) return null;
    const m = n === 0 ? 0 : ((0xffffffff << (32 - n)) >>> 0);
    return [(m >>> 24) & 0xff, (m >>> 16) & 0xff, (m >>> 8) & 0xff, m & 0xff].join('.');
}

/**
 * NetworkSwitch — 简单组网仿真用的二层交换机（华为 VRP 风格 CLI）
 *
 * 交互：
 *   - 双击 → 命令行界面（display / system-view / ping / save / ...）
 *   - 右键 → 「生成到选中 PC 的网线」「断开所有网线」
 *
 * 端口：<id>_wire_eth1 .. <id>_wire_ethN（N = portCount，默认 8）
 * 所有端口属于同一广播域（二层转发）。
 */
export class NetworkSwitch extends BaseComponent {
    constructor(config, sys) {
        super(config, sys);

        this.type = 'net_switch';
        this.cache = 'fixed';
        this.label = '网络交换机';

        this.portCount = Math.max(2, Math.min(24, config.portCount || 8));
        this.width = 540;
        this.height = 180;

        this._initGroups();
        this._recalcGeometry();
        this._initParameters(config);
        this._init();

        this.config = {
            hostname: this.hostname,
            ip: this.ip,
            mask: this.mask,
            vlans: [...this.vlans],
            portVlan: { ...this.portVlan },
        };

        for (let i = 1; i <= this.portCount; i++) {
            this.addPort(this._portX(i), this._portY, 'eth' + i, 'wire');
        }
    }

    // ─────────────────────────────────────────────────────────
    //  初始化
    // ─────────────────────────────────────────────────────────

    _recalcGeometry() {
        this._portY = -70;
        this._portX = (i) => -210 + (i - 1) * 60;
    }

    _initParameters(config) {
        this.hostname = config.hostname || 'SW1';
        // 出厂状态：未配置管理地址（Vlanif1）
        this.ip = config.ip || '';
        this.mask = config.mask || '';

        // ── VLAN：默认全部端口属于 VLAN 1 ──
        this.vlans = new Set([1]);
        (Array.isArray(config.vlans) ? config.vlans : []).forEach(v => {
            const n = parseInt(v, 10);
            if (n >= 1 && n <= 4094) this.vlans.add(n);
        });
        this.portVlan = {};
        const cfgPV = config.portVlan || {};
        for (let i = 1; i <= this.portCount; i++) {
            const o = 'eth' + i;
            const v = parseInt(cfgPV[o], 10);
            this.portVlan[o] = (v >= 1 && v <= 4094) ? v : 1;
        }

        this._view = 'user';       // user | system | iface
        this._curPort = null;      // iface 视图：当前端口 origId
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
            body: '#455a64',
            bodyEdge: '#263238',
            bezel: '#37474f',
            socket: '#101820',
            socketEdge: '#78909c',
            text: '#eceff1',
            dim: '#b0bec5',
            dim2: '#90a4ae',
        };

        // 机箱
        g.add(new Konva.Rect({
            x: -260, y: -70, width: 520, height: 150,
            fill: C.body, stroke: C.bodyEdge, strokeWidth: 2, cornerRadius: 10,
        }));
        // 上沿端口区
        g.add(new Konva.Rect({
            x: -260, y: -70, width: 520, height: 30,
            fill: C.bezel, cornerRadius: [10, 10, 0, 0],
        }));

        // 端口插座与编号
        for (let i = 1; i <= this.portCount; i++) {
            const px = this._portX(i);
            g.add(new Konva.Rect({
                x: px - 11, y: -68, width: 22, height: 16,
                fill: C.socket, stroke: C.socketEdge, strokeWidth: 1, cornerRadius: 2,
            }));
            g.add(new Konva.Text({
                x: px - 8, y: -88, width: 16,
                text: String(i), align: 'center',
                fontFamily: 'Consolas, monospace', fontSize: 12, fill: C.dim,
            }));
        }

        // 品牌与型号
        g.add(new Konva.Text({
            x: -246, y: 22, text: 'S5700-8T 以太网交换机',
            fontFamily: 'Microsoft YaHei', fontSize: 13, fill: C.dim,
        }));
        // 电源指示灯
        g.add(new Konva.Circle({ x: 232, y: 60, radius: 5, fill: '#22c55e', stroke: '#0f5132', strokeWidth: 1 }));
        g.add(new Konva.Text({
            x: 208, y: 48, text: 'PWR', fontFamily: 'Consolas, monospace', fontSize: 10, fill: C.dim,
        }));
    }

    _createDynamicNodes() {
        const d = this._dynamicGroup;

        this._hostText = new Konva.Text({
            x: -246, y: -14, text: '', fontFamily: 'Microsoft YaHei',
            fontSize: 18, fontStyle: 'bold', fill: '#ffffff',
        });
        d.add(this._hostText);

        this._mgmtText = new Konva.Text({
            x: -246, y: 48, text: '', fontFamily: 'Consolas, monospace',
            fontSize: 12, fill: '#90a4ae',
        });
        d.add(this._mgmtText);

        this._linkLeds = [];
        this._vlanTexts = [];
        for (let i = 1; i <= this.portCount; i++) {
            const led = new Konva.Circle({
                x: this._portX(i), y: -46, radius: 3.5,
                fill: '#555555', stroke: '#222', strokeWidth: 1,
            });
            d.add(led);
            this._linkLeds.push(led);

            const vt = new Konva.Text({
                x: this._portX(i) - 20, y: -32, width: 40, align: 'center',
                text: '', fontFamily: 'Consolas, monospace', fontSize: 10, fill: '#ffd479',
            });
            d.add(vt);
            this._vlanTexts.push(vt);
        }

        this._updateDynamic();
        this._updateVlanLabels();
    }

    _bindInteraction() {
        this.group.on('dblclick dbltap', (e) => {
            e.cancelBubble = true;
            this.showConfigDialog();
        });
    }

    _updateDynamic() {
        if (this._hostText) this._hostText.text(this.hostname);
        if (this._mgmtText) {
            const mgmt = isValidIp(this.ip) ? `${this.ip}/${maskPrefix(this.mask)}` : '未配置';
            this._mgmtText.text(`管理地址 ${mgmt}    端口 ${this.portCount} 个`);
        }
    }

    // ─────────────────────────────────────────────────────────
    //  VLAN
    // ─────────────────────────────────────────────────────────

    getPortVlan(origId) { return this.portVlan[origId] || 1; }

    getPortVlanByPortId(portId) {
        const o = String(portId).includes('_wire_') ? String(portId).split('_wire_')[1] : portId;
        return this.getPortVlan(o);
    }

    createVlan(v) {
        const n = parseInt(v, 10);
        if (n >= 1 && n <= 4094) this.vlans.add(n);
        return n;
    }

    deleteVlan(v) {
        const n = parseInt(v, 10);
        if (n === 1) return false;                 // VLAN 1 不可删除
        this.vlans.delete(n);
        for (const o in this.portVlan) if (this.portVlan[o] === n) this.portVlan[o] = 1;
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

    _updateVlanLabels() {
        if (!this._vlanTexts) return;
        for (let i = 1; i <= this.portCount; i++) {
            const v = this.getPortVlan('eth' + i);
            this._vlanTexts[i - 1].text(v !== 1 ? `V${v}` : '');
        }
        this.sys.requestRedraw();
    }

    // ─────────────────────────────────────────────────────────
    //  仿真循环（链路指示灯）
    // ─────────────────────────────────────────────────────────

    tick() {
        let changed = false;
        this.ports.forEach((p, idx) => {
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
    //  参数接口
    // ─────────────────────────────────────────────────────────

    getConfigFields() {
        return [
            { label: '设备名称', key: 'hostname', type: 'text' },
            { label: '管理 IP', key: 'ip', type: 'text' },
            { label: '子网掩码', key: 'mask', type: 'text' },
        ];
    }

    onConfigUpdate(cfg = {}) {
        if (cfg.hostname !== undefined) this.hostname = cfg.hostname;
        if (cfg.ip !== undefined) this.ip = cfg.ip;
        if (cfg.mask !== undefined) this.mask = cfg.mask;
        if (Array.isArray(cfg.vlans)) {
            this.vlans = new Set(cfg.vlans.map(v => parseInt(v, 10)).filter(v => v >= 1 && v <= 4094));
            if (!this.vlans.has(1)) this.vlans.add(1);
        }
        if (cfg.portVlan && typeof cfg.portVlan === 'object') {
            for (const o in cfg.portVlan) {
                const n = parseInt(cfg.portVlan[o], 10);
                if (n >= 1 && n <= 4094) this.portVlan[o] = n;
            }
        }
        this.config = {
            ...this.config,
            hostname: this.hostname, ip: this.ip, mask: this.mask,
            vlans: [...this.vlans], portVlan: { ...this.portVlan },
        };
        this._updateDynamic();
        this._syncPrompt();
        this._updateVlanLabels();
        this.sys.requestRedraw();
    }

    // ─────────────────────────────────────────────────────────
    //  连线操作（右键菜单 / 流程演示）
    // ─────────────────────────────────────────────────────────

    _usedPortIds() {
        const used = new Set();
        for (const c of (this.sys.conns || [])) {
            if (c.type === 'wire') { used.add(c.from); used.add(c.to); }
        }
        return used;
    }

    _freePortIds() {
        const used = this._usedPortIds();
        return this.ports
            .filter(p => p.origId && p.origId.startsWith('eth') && !used.has(p.id))
            .map(p => p.id);
    }

    /** 收集本工程内所有 PC（自动发现） */
    collectPCs() { return collectPCs(this.sys); }

    /** 生成到指定 PC 的网线；animated=true 时逐根动画接线（供自动演示） */
    async connectPCs(pcIds, animated = false) {
        const sys = this.sys;
        const linked = new Set(connectedPCIds(sys, this));
        const free = this._freePortIds();
        const added = [];
        for (const id of (pcIds || [])) {
            if (!id || linked.has(id)) continue;
            const pc = sys.comps[id];
            if (!pc || pc.type !== 'pc') continue;
            if (!free.length) break;
            const port = free.shift();
            const conn = { from: port, to: `${id}_wire_lan`, type: 'wire' };
            if (animated && typeof sys.addConnectionAnimated === 'function') {
                await sys.addConnectionAnimated(conn);
            } else {
                sys.addConn(conn);
            }
            linked.add(id);
            added.push(id);
        }
        sys.redrawAll();
        return added;
    }

    /** 右键菜单：生成到「当前选中 PC」的网线（无选中则提示） */
    connectSelectedPCs() {
        const sys = this.sys;
        const selected = [...(sys.selectedCompIds || [])]
            .map(id => sys.comps[id])
            .filter(c => c && c.type === 'pc');
        if (selected.length === 0) {
            sys.showFloatingTip('请先选中要连接的 PC（按住 Ctrl 点选，或框选多台）');
            return;
        }
        this.connectPCs(selected.map(c => c.id)).then(added => {
            if (added.length) sys.showFloatingTip(`已生成 ${added.length} 条网线：${added.join('、')}`);
            else sys.showFloatingTip('选中的 PC 均已连接，或交换机端口已用尽');
        });
    }

    /** 右键菜单：断开本交换机所有网线 */
    disconnectAll() {
        const sys = this.sys;
        const conns = (sys.conns || []).filter(c =>
            c.type === 'wire' &&
            (deviceIdOfPort(c.from) === this.id || deviceIdOfPort(c.to) === this.id));
        conns.forEach(c => sys.removeConn(c));
        sys.showFloatingTip(conns.length ? `已断开 ${conns.length} 条网线` : '本交换机没有已连接的网线');
    }

    getContextMenuItems() {
        return [
            { label: '生成到选中 PC 的网线', onClick: () => this.connectSelectedPCs() },
            { label: '断开所有网线', onClick: () => this.disconnectAll() },
        ];
    }

    // ─────────────────────────────────────────────────────────
    //  CLI 对话框
    // ─────────────────────────────────────────────────────────

    showConfigDialog(tab = 'cli') {
        const tabs = [
            { id: 'vlan', label: 'VLAN 配置', render: (el) => this._renderVlanTab(el) },
            { id: 'cli', label: '命令行', render: (el) => this._renderCliTab(el) },
        ];
        this._dialog = openTabbedDialog({
            title: `交换机配置 — ${this.hostname}（${this.id}）`,
            tabs,
            width: 760,
            height: 520,
            container: this.sys.container,
        });
        const idx = Math.max(0, tabs.findIndex(t => t.id === tab));
        setTimeout(() => this._dialog && this._dialog.switchTab(idx), 0);
    }

    openConfigDialog(tab = 'cli') { this.showConfigDialog(tab); }

    _renderVlanTab(el) {
        el.innerHTML = '';
        const inputStyle = 'padding:6px;border:1px solid #ccc;border-radius:4px;';

        // 新建 VLAN
        const addRow = document.createElement('div');
        addRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;margin-bottom:12px;';
        addRow.innerHTML = `<div><label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">新建 VLAN（1~4094）</label>
            <input id="diag_new_vlan" style="${inputStyle}" placeholder="10"></div>`;
        const addBtn = document.createElement('button');
        addBtn.textContent = '创建 VLAN';
        addBtn.style.cssText = 'padding:8px 14px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        addBtn.onclick = () => {
            const v = (document.getElementById('diag_new_vlan') || {}).value;
            const n = parseInt(v, 10);
            if (!(n >= 1 && n <= 4094)) { alert('请输入 1~4094 的 VLAN ID'); return; }
            this.createVlan(n);
            this.onConfigUpdate({});
            this._renderVlanTab(el);
        };
        addRow.appendChild(addBtn);
        el.appendChild(addRow);

        const info = document.createElement('div');
        info.style.cssText = 'font-size:12px;color:#666;margin-bottom:10px;';
        info.textContent = `已有 VLAN：${[...this.vlans].sort((a, b) => a - b).join('、')}。每个端口为 access 口，仅属于一个 VLAN。`;
        el.appendChild(info);

        // 管理地址（Vlanif1）
        const mgmt = document.createElement('div');
        mgmt.style.cssText = 'border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin-bottom:12px;';
        mgmt.innerHTML = `
            <div style="font-weight:600;color:#1f2a33;margin-bottom:8px;">管理地址（Vlanif1，VLAN 1）</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <div style="flex:1;min-width:160px;">
                    <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">IP 地址</label>
                    <input type="text" id="diag_sw_ip" value="${this.ip}" placeholder="如 192.168.1.254（出厂未配置）" style="${inputStyle};width:100%;box-sizing:border-box;">
                </div>
                <div style="flex:1;min-width:160px;">
                    <label style="display:block;font-size:12px;color:#666;margin-bottom:4px;">子网掩码</label>
                    <input type="text" id="diag_sw_mask" value="${this.mask}" placeholder="如 255.255.255.0 或 24" style="${inputStyle};width:100%;box-sizing:border-box;">
                </div>
            </div>`;
        el.appendChild(mgmt);

        // 端口 VLAN 表
        const table = document.createElement('div');
        const selects = {};
        for (let i = 1; i <= this.portCount; i++) {
            const origId = 'eth' + i;
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:5px 0;font-size:13px;';
            const label = document.createElement('span');
            label.style.cssText = 'width:150px;';
            const peer = peerOfSwitchPort(this.sys, `${this.id}_wire_${origId}`);
            label.textContent = `Ethernet0/0/${i}${peer ? '（' + peer + '）' : ''}`;
            const sel = document.createElement('select');
            sel.style.cssText = inputStyle + ';min-width:120px;';
            [...this.vlans].sort((a, b) => a - b).forEach(v => {
                const opt = document.createElement('option');
                opt.value = v; opt.textContent = 'VLAN ' + v;
                if (v === this.getPortVlan(origId)) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.dataset.origId = origId;
            selects[origId] = sel;
            row.appendChild(label); row.appendChild(sel);
            table.appendChild(row);
        }
        el.appendChild(table);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:14px;';
        const save = document.createElement('button');
        save.textContent = '保存';
        save.id = 'vlan_save_btn';
        save.style.cssText = 'padding:8px 16px;border:none;background:#1395eb;color:#fff;border-radius:4px;cursor:pointer;';
        save.onclick = () => {
            const ip = (document.getElementById('diag_sw_ip') || {}).value || '';
            let mask = (document.getElementById('diag_sw_mask') || {}).value || '';
            if (ip && !isValidIp(ip)) { alert('管理 IP 地址格式不正确'); return; }
            if (ip) {
                if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
                if (!isValidMask(mask)) { alert('子网掩码格式不正确（如 255.255.255.0 或 24）'); return; }
            } else {
                mask = '';
            }
            for (const origId in selects) this.setPortVlan(origId, selects[origId].value);
            this.onConfigUpdate({ ip, mask });
            this.sys.redrawAll();
            closeActiveNetDialog();
        };
        btnRow.appendChild(save);
        el.appendChild(btnRow);
    }

    _prompt() {
        if (this._view === 'iface' && this._curPort) {
            const n = String(this._curPort).replace('eth', '');
            return `[${this.hostname}-Ethernet0/0/${n}]`;
        }
        if (this._view === 'vlanif') return `[${this.hostname}-Vlanif1]`;
        return this._view === 'system' ? `[${this.hostname}]` : `<${this.hostname}>`;
    }

    _syncPrompt() {
        if (this._terminal) this._terminal.setPrompt(this._prompt());
    }

    _renderCliTab(el) {
        el.innerHTML = '';
        const info = document.createElement('div');
        info.style.cssText = 'font-size:12px;color:#666;margin-bottom:8px;';
        const pcs = connectedPCIds(this.sys, this);
        info.textContent = `可用命令 display（version / interface brief / mac-address / vlan / ip interface brief）、`
            + `system-view、vlan <id>、interface Ethernet0/0/x、interface Vlanif 1 + ip address、ping、save、cls、help。`
            + `  已连接 PC：${pcs.length ? pcs.join('、') : '无'}`;
        el.appendChild(info);

        this._terminal = new Terminal({
            prompt: this._prompt(),
            height: 380,
            welcome: 'Info: 正在进入交换机命令行 ...\n',
            onCommand: (cmd, term) => this._handleCommand(cmd, term),
        });
        el.appendChild(this._terminal.element);
    }

    // ─────────────────────────────────────────────────────────
    //  命令解析（华为 VRP 风格）
    // ─────────────────────────────────────────────────────────

    _handleCommand(cmd, term) {
        const raw = String(cmd || '').trim();
        if (!raw) return undefined;
        const parts = raw.split(/\s+/);
        const name = parts[0].toLowerCase();

        if (name === 'display' || name === 'show') return this._cmdDisplay(parts.slice(1), term);
        if (name === 'ping') return this._cmdPing(parts.slice(1), term);

        if (name === 'system-view' || name === 'configure') {
            if (this._view !== 'user') { term.print('Info: 已处于配置视图。', 'term-warn'); return undefined; }
            this._view = 'system';
            this._syncPrompt();
            term.print('Enter system view, return user view with Ctrl+Z.', 'term-dim');
            return undefined;
        }
        if (name === 'return') {
            this._view = 'user'; this._curPort = null; this._syncPrompt(); return undefined;
        }
        if (name === 'quit') {
            if (this._view === 'iface' || this._view === 'vlanif') { this._view = 'system'; this._curPort = null; this._syncPrompt(); }
            else if (this._view === 'system') { this._view = 'user'; this._syncPrompt(); }
            else closeActiveNetDialog();
            return undefined;
        }
        if (name === 'interface') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            // VLAN 虚接口：interface Vlanif 1 / interface Vlanif1
            const arg = parts.slice(1).join('').toLowerCase();
            if (/^vlanif\d*$/.test(arg)) {
                const n = parseInt(arg.replace('vlanif', '') || '1', 10);
                if (n !== 1) { term.print('Error: 本交换机仅支持 Vlanif1（管理 VLAN 1）。', 'term-err'); return undefined; }
                this._view = 'vlanif'; this._curPort = null; this._syncPrompt();
                return undefined;
            }
            const m = String(parts[1] || '').match(/(\d+)$/);
            const origId = m ? `eth${m[1]}` : String(parts[1] || '').toLowerCase();
            if (!this.portVlan.hasOwnProperty(origId)) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
            this._view = 'iface'; this._curPort = origId; this._syncPrompt();
            return undefined;
        }
        if (name === 'vlan') {
            if (this._view === 'user') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const n = parseInt(parts[1], 10);
            if (!(n >= 1 && n <= 4094)) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
            this.createVlan(n); this.onConfigUpdate({});
            term.print(`Info: VLAN ${n} 创建成功。`, 'term-ok');
            return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'vlan') {
            const n = parseInt(parts[2], 10);
            if (n === 1) { term.print('Error: VLAN 1 不能删除。', 'term-err'); return undefined; }
            const ok = this.deleteVlan(n);
            term.print(ok ? `Info: VLAN ${n} 已删除。` : `Error: VLAN ${n} 不存在。`, ok ? 'term-ok' : 'term-err');
            return undefined;
        }
        if (name === 'port') {
            if (this._view !== 'iface' || !this._curPort) { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            if (String(parts[1] || '').toLowerCase() === 'default' && String(parts[2] || '').toLowerCase() === 'vlan') {
                const n = parseInt(parts[3], 10);
                if (!(n >= 1 && n <= 4094)) { term.print("Error: Wrong parameter found at '^' position.", 'term-err'); return undefined; }
                this.setPortVlan(this._curPort, n);
                term.print(`Info: 端口已加入 VLAN ${n}。`, 'term-ok');
                return undefined;
            }
            if (String(parts[1] || '').toLowerCase() === 'link-type') {
                term.print('Info: 端口链路类型为 access。', 'term-ok');
                return undefined;
            }
        }
        if (name === 'ip' && String(parts[1] || '').toLowerCase() === 'address') {
            if (this._view !== 'vlanif') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            const ip = parts[2];
            let mask = parts[3];
            if (!ip || !mask) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
            if (/^\d+$/.test(mask)) mask = prefixToMask(mask);
            if (!isValidIp(ip) || !isValidMask(mask)) { term.print('Error: 地址或掩码不合法。', 'term-err'); return undefined; }
            this.onConfigUpdate({ ip, mask });
            term.print(`Info: Vlanif1 管理地址已设置为 ${ip} ${mask}。`, 'term-ok');
            return undefined;
        }
        if (name === 'undo' && String(parts[1] || '').toLowerCase() === 'ip' && String(parts[2] || '').toLowerCase() === 'address') {
            if (this._view !== 'vlanif') { term.print("Error: Unrecognized command found at '^' position.", 'term-err'); return undefined; }
            this.onConfigUpdate({ ip: '', mask: '' });
            term.print('Info: Vlanif1 管理地址已删除。', 'term-ok');
            return undefined;
        }
        if (name === 'sysname') {
            if (this._view !== 'system') {
                term.print("Error: Unrecognized command found at '^' position.", 'term-err');
                return undefined;
            }
            const n = parts[1];
            if (!n) { term.print("Error: Incomplete command found at '^' position.", 'term-err'); return undefined; }
            this.onConfigUpdate({ hostname: n });
            term.print(`Info: 系统名称已修改为 ${n}。`, 'term-ok');
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
            term.print('  display version                       查看版本信息', 'term-dim');
            term.print('  display interface brief               查看端口状态', 'term-dim');
            term.print('  display mac-address                   查看 MAC 地址表', 'term-dim');
            term.print('  display ip interface brief            查看管理地址', 'term-dim');
            term.print('  display vlan / port vlan              查看 VLAN 与端口归属', 'term-dim');
            term.print('  display current-configuration         查看当前配置', 'term-dim');
            term.print('  system-view                           进入系统视图', 'term-dim');
            term.print('  vlan <id>                             创建 VLAN', 'term-dim');
            term.print('  interface Ethernet0/0/1               进入端口视图', 'term-dim');
            term.print('  port default vlan <id>                端口加入 VLAN', 'term-dim');
            term.print('  interface Vlanif 1                    进入管理虚接口视图', 'term-dim');
            term.print('  ip address <ip> <掩码|前缀>           配置管理地址（Vlanif1）', 'term-dim');
            term.print('  ping <IP>                            测试连通性', 'term-dim');
            term.print('  save                                 保存配置', 'term-dim');
            term.print('  quit / return                        退出视图', 'term-dim');
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
            term.print('VRP (R) software, Version 5.170 (S5700 V200R019C10)');
            term.print('Copyright (C) 2012-2026 Huawei Technologies Co., Ltd.');
            term.print(`HUAWEI S5700-8T Switch uptime is 0 day, 0 hour, 0 minute`);
            term.print(`System Name       : ${this.hostname}`);
            term.print(`Management IP     : ${this.ip}/${maskPrefix(this.mask)}`);
            term.print('');
            return undefined;
        }

        if (sub === 'interface' && (sub2 === 'brief' || sub2 === '')) {
            term.print('');
            term.print('Interface                   PHY     Protocol  VLAN   Description', 'term-info');
            for (let i = 1; i <= this.portCount; i++) {
                const pid = `${this.id}_wire_eth${i}`;
                const peer = peerOfSwitchPort(this.sys, pid);
                const up = peer ? 'up' : 'down';
                const proto = peer ? 'up' : 'down';
                const name = `Ethernet0/0/${i}`.padEnd(27);
                const vlan = String(this.getPortVlan('eth' + i)).padEnd(6);
                const desc = peer && this.sys.comps[peer] ? this.sys.comps[peer].hostname : '';
                term.print(`${name} ${up.padEnd(7)} ${proto.padEnd(9)} ${vlan} ${desc}`,
                    peer ? 'term-ok' : 'term-dim');
            }
            term.print('');
            return undefined;
        }

        if (sub === 'vlan') {
            term.print('');
            const ids = [...this.vlans].sort((a, b) => a - b);
            for (const v of ids) {
                const ports = [];
                for (let i = 1; i <= this.portCount; i++) if (this.getPortVlan('eth' + i) === v) ports.push(`Ethernet0/0/${i}`);
                term.print(`VLAN ${v}`, 'term-info');
                term.print(`  Ports: ${ports.join(', ') || '（无）'}`);
            }
            term.print('');
            term.print(`Total: ${ids.length} VLANs`, 'term-dim');
            term.print('');
            return undefined;
        }

        if (sub === 'port' && sub2 === 'vlan') {
            term.print('');
            term.print('Port                        Link Type   VLAN', 'term-info');
            for (let i = 1; i <= this.portCount; i++) {
                const origId = 'eth' + i;
                term.print(`${('Ethernet0/0/' + i).padEnd(27)} access      ${this.getPortVlan(origId)}`);
            }
            term.print('');
            return undefined;
        }

        if (sub === 'mac-address' || sub === 'mac-address-table') {
            term.print('');
            term.print('MAC Address Table', 'term-info');
            term.print('-----------------------------------------------------------------');
            term.print('VLAN   MAC Address        Type       Port');
            let n = 0;
            for (let i = 1; i <= this.portCount; i++) {
                const pid = `${this.id}_wire_eth${i}`;
                const peer = peerOfSwitchPort(this.sys, pid);
                if (!peer) continue;
                const comp = this.sys.comps[peer];
                if (!comp) continue;
                let mac = null;
                if (comp.type === 'pc') mac = macOf(comp);
                else if (comp.type === 'router') {
                    const conn = (this.sys.conns || []).find(c => c.from === pid || c.to === pid);
                    const otherPort = conn ? (conn.from === pid ? conn.to : conn.from) : null;
                    const f = (comp.interfaces || []).find(x => x.portId === otherPort);
                    mac = macOfInterface(comp, f ? f.name : null);
                }
                if (!mac) continue;
                const vlan = this.getPortVlan('eth' + i);
                term.print(`${String(vlan).padEnd(6)} ${mac.padEnd(18)} dynamic    Ethernet0/0/${i}`);
                n++;
            }
            if (!n) term.print('（当前没有学习到 MAC 地址）', 'term-dim');
            term.print('-----------------------------------------------------------------');
            term.print(`Total: ${n} entries`, 'term-dim');
            term.print('');
            return undefined;
        }

        if (sub === 'ip' && sub2 === 'interface') {
            term.print('');
            term.print('Interface                   IP Address/Mask       Physical   Protocol', 'term-info');
            const addr = isValidIp(this.ip) ? `${this.ip}/${maskPrefix(this.mask)}` : 'unassigned';
            term.print(`Vlanif1                     ${addr.padEnd(21)} up         up`,
                isValidIp(this.ip) ? 'term-ok' : 'term-dim');
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
            term.print('interface Vlanif1');
            if (isValidIp(this.ip)) term.print(` ip address ${this.ip} ${this.mask}`);
            term.print('#');
            for (let i = 1; i <= this.portCount; i++) {
                term.print(`interface Ethernet0/0/${i}`);
                term.print(' port link-type access');
                term.print(` port default vlan ${this.getPortVlan('eth' + i)}`);
                term.print('#');
            }
            term.print('return');
            term.print('');
            return undefined;
        }

        term.print("Error: Unrecognized command found at '^' position.", 'term-err');
        return undefined;
    }

    async _cmdPing(args, term) {
        const target = (args.find(a => !a.startsWith('-')) || '').trim();
        if (!target) { term.print('用法: ping <目标IP>', 'term-warn'); return; }
        const result = runPing(this.sys, this, target, 4);
        if (result.reason === 'bad_ip') {
            term.print(`Ping 请求找不到主机 ${target}。请检查该名称，然后重试。`, 'term-err');
            return;
        }
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
