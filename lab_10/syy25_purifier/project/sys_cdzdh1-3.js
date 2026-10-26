// 复杂组网仿真工程（三层交换机 / 动态路由 / 服务器与 DNS）—— 出厂状态：所有设备未配置 IP
//
// 拓扑：
//   PC1(V10) PC2(V20)              PC3(V10) PC4(V20)
//        │        │                    │        │
//      [SW1]═══trunk(V10,20)══┐   ┌═══trunk(V10,20)═══[SW2]      ← 接入层二层交换机
//                            │   │
//                          [L3SW1]  三层交换机（VLAN 间路由 + 上联）
//                            │ 10.10.10.0/30
//                        [R1 出口路由器]  ← NAT（easy-ip）
//                            │ 100.64.0.0/30
//                        [R2 互联网路由器]
//                            │ 203.0.113.0/24
//                        [SRV1 统一服务器：HTTP / FTP / DNS]
//
// 地址规划：
//   VLAN10 192.168.10.0/24：PC1=.10、PC3=.11、L3SW Vlanif10=.1
//   VLAN20 192.168.20.0/24：PC2=.10、PC4=.11、L3SW Vlanif20=.1
//   上联 10.10.10.0/30：L3SW Vlanif100=.1、R1 GE0/0/0=.2
//   WAN 100.64.0.0/30：R1 GE0/0/1=.1、R2 GE0/0/0=.2
//   服务器网段 203.0.113.0/24：R2 GE0/0/1=.1、SRV1=.10
//
// 交互：
//   - 双击 PC       → TCP/IP 设置 / 浏览器 / FTP 客户端 / 命令行
//   - 双击 二层交换机 → VLAN 与端口（access/trunk）
//   - 双击 三层交换机 → VLAN/端口 / VLANIF / 静态路由 / DHCP / 动态路由 / 命令行
//   - 双击 路由器    → 接口 / DHCP / 静态路由 / 动态路由（RIP、OSPF）/ NAT / 命令行
//   - 双击 服务器    → 网络 / 服务（HTTP/FTP/DNS）/ 内容 / 命令行

import { PC } from '../components/PC.js';
import { NetworkSwitch } from '../components/NetworkSwitch.js';
import { L3Switch } from '../components/L3Switch.js';
import { Router } from '../components/Router.js';
import { NetServer } from '../components/NetServer.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { runPing, connectedPCIds, natSessions } from '../tools/NetworkSim.js';
import { resolveDomain, httpGet, ftpGet } from '../tools/NetServices.js';
import { closeActiveNetDialog } from '../lib/NetConsole.js';

const _sys = () => (typeof window !== 'undefined' && window.sys) ? window.sys : null;
const _comp = (id) => { const s = _sys(); return s ? s.comps[id] : null; };
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

function _flash(wf, el, msg, ms) {
    return (wf && typeof wf._flashDomElement === 'function' && el) ? wf._flashDomElement(el, msg, ms) : Promise.resolve();
}

// ─── 走界面配置参数的演示辅助 ─────────────────────────────────

const _setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
};

/** 通过 PC 的 TCP/IP 界面配置 IP / 掩码 / 网关 / DNS */
async function _demoSetPcNet(wf, compId, { ip, mask, gateway = '', dns = '' } = {}, tip) {
    const comp = _comp(compId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('ip');
    await _sleep(700);
    const fields = [
        { id: 'diag_ip', value: ip, label: 'IP 地址' },
        { id: 'diag_mask', value: mask, label: '子网掩码' },
        { id: 'diag_gateway', value: gateway, label: '默认网关' },
        { id: 'diag_dns', value: dns, label: 'DNS 服务器' },
    ];
    for (const f of fields) {
        const el = document.getElementById(f.id);
        if (el) await _flash(wf, el, f.value ? `填写${f.label}：${f.value}` : `${f.label}：本次留空`, 2400);
        _setVal(f.id, f.value || '');
        await _sleep(350);
    }
    const save = document.getElementById('iface_save_btn') || [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存').pop();
    if (save) { await _flash(wf, save, '点击「保存」应用 TCP/IP 设置', 1500); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

/** 通过 PC 的 TCP/IP 界面切换 DHCP */
async function _demoSetPcDhcp(wf, compId, on, tip) {
    const comp = _comp(compId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('ip');
    await _sleep(700);
    const cb = document.getElementById('diag_dhcp');
    if (cb) { await _flash(wf, cb, tip || '勾选「启用 DHCP（自动获取 IP）」', 2000); cb.checked = !!on; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    const save = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存').pop();
    if (save) { await _flash(wf, save, '点击「保存」应用', 1400); save.click(); await _sleep(600); }
    closeActiveNetDialog();
}

/** 通过路由器的接口配置界面设置某接口地址 */
async function _demoSetRouterIface(wf, rId, origId, ip, mask, tip) {
    const comp = _comp(rId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('iface');
    await _sleep(700);
    for (const f of [{ id: 'diag_ip_' + origId, value: ip, label: 'IP 地址' }, { id: 'diag_mask_' + origId, value: mask, label: '子网掩码' }]) {
        const el = document.getElementById(f.id);
        if (el) await _flash(wf, el, `填写${f.label}：${f.value}`, 2400);
        _setVal(f.id, f.value);
        await _sleep(350);
    }
    const save = document.getElementById('iface_save_btn');
    if (save) { await _flash(wf, save, '点击「保存」应用接口配置', 1500); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

/** 通过服务器「网络」页配置 IP / 网关 / DNS */
async function _demoSetServerNet(wf, id, { ip, mask, gateway = '', dns = '' } = {}, tip) {
    const comp = _comp(id);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('net');
    await _sleep(700);
    for (const f of [{ id: 'diag_ip', value: ip, label: 'IP 地址' }, { id: 'diag_mask', value: mask, label: '子网掩码' }, { id: 'diag_gateway', value: gateway, label: '默认网关' }, { id: 'diag_dns', value: dns, label: 'DNS 服务器' }]) {
        const el = document.getElementById(f.id);
        if (el) await _flash(wf, el, f.value ? `填写${f.label}：${f.value}` : `${f.label}：留空`, 2200);
        _setVal(f.id, f.value || '');
        await _sleep(300);
    }
    const save = document.getElementById('srv_net_save_btn');
    if (save) { await _flash(wf, save, '点击「保存」应用服务器网络配置', 1500); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

/** 通过服务器「服务」页启用/关闭 HTTP / FTP / DNS */
async function _demoSetServerSvc(wf, id, { http = true, ftp = true, dns = true } = {}, tip) {
    const comp = _comp(id);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('svc');
    await _sleep(700);
    for (const [eid, val, name] of [['diag_srv_dns', dns, 'DNS'], ['diag_srv_http', http, 'HTTP'], ['diag_srv_ftp', ftp, 'FTP']]) {
        const el = document.getElementById(eid);
        if (el) { await _flash(wf, el, `${val ? '勾选' : '取消勾选'}「启用 ${name} 服务」`, 1600); el.checked = !!val; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    const save = document.getElementById('srv_svc_save_btn');
    if (save) { await _flash(wf, save, '点击「保存」应用服务设置', 1500); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

/** 通过路由器 NAT 页启用 NAT 并设置接口角色 */
async function _demoSetNat(wf, rId, { enable = true, inside = 'g0', outside = 'g1' } = {}, tip) {
    const comp = _comp(rId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('nat');
    await _sleep(700);
    const en = document.getElementById('diag_nat_enable');
    if (en) { await _flash(wf, en, tip || '勾选「启用 NAT（easy-ip）」', 1800); en.checked = !!enable; en.dispatchEvent(new Event('change', { bubbles: true })); }
    for (const [orig, role] of [[inside, 'inside'], [outside, 'outside']]) {
        const sel = document.getElementById('diag_natrole_' + orig);
        if (sel) { await _flash(wf, sel, `将接口设为 ${role}`, 1600); sel.value = role; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    const save = document.getElementById('nat_save_btn');
    if (save) { await _flash(wf, save, '点击「保存」应用 NAT 配置', 1500); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

/** 设备命令行逐条演示（命令之间留出较长观察间隔） */
function _runScript(comp, cmds) {
    if (!comp || typeof comp.demoScript !== 'function') return Promise.resolve();
    return comp.demoScript(cmds, { holdMs: 2800, endHoldMs: 3200 });
}

/** 逐根动画接线（≤8 根用动画） */
async function _wire(sys, pairs) {
    for (const [from, to] of (pairs || [])) {
        if (typeof sys.addConnectionAnimated === 'function') await sys.addConnectionAnimated({ from, to, type: 'wire' });
        else sys.addConn({ from, to, type: 'wire' });
    }
    sys.redrawAll();
}

// ─── 公共配置命令与连线 ───

const _L3_CMDS = [
    'system-view',
    'vlan 10', 'vlan 20', 'vlan 100',
    'interface Ethernet0/0/1', 'port link-type trunk', 'port trunk allow-pass vlan 10 20',
    'interface Ethernet0/0/2', 'port link-type trunk', 'port trunk allow-pass vlan 10 20',
    'interface Ethernet0/0/3', 'port link-type access', 'port default vlan 100',
    'interface Vlanif 10', 'ip address 192.168.10.1 255.255.255.0',
    'interface Vlanif 20', 'ip address 192.168.20.1 255.255.255.0',
    'interface Vlanif 100', 'ip address 10.10.10.1 255.255.255.252',
    'return', 'display ip interface brief',
];
const _SW_CMDS = [
    'system-view',
    'vlan 10', 'vlan 20',
    'interface Ethernet0/0/1', 'port link-type access', 'port default vlan 10',
    'interface Ethernet0/0/2', 'port link-type access', 'port default vlan 20',
    'interface Ethernet0/0/8', 'port link-type trunk', 'port trunk allow-pass vlan 10 20',
    'return', 'display vlan',
];
const _LAN_WIRES_1 = [['sw1_wire_eth1', 'pc1_wire_lan'], ['sw1_wire_eth2', 'pc2_wire_lan'], ['sw1_wire_eth8', 'l3sw1_wire_eth1']];
const _LAN_WIRES_2 = [['sw2_wire_eth1', 'pc3_wire_lan'], ['sw2_wire_eth2', 'pc4_wire_lan'], ['sw2_wire_eth8', 'l3sw1_wire_eth2']];
const _WAN_WIRES = [['l3sw1_wire_eth3', 'r1_wire_g0'], ['r1_wire_g1', 'r2_wire_g0'], ['r2_wire_g1', 'srv1_wire_lan']];

// ─── 公共步骤组（局域网接入 + 出口/服务器）─────────────────────

function _lanBaseSteps() {
    return [
        {
            mode: 'check',
            msg: '配置四台 PC 的 IP / 掩码 / 网关 / DNS（VLAN10：PC1=192.168.10.10、PC3=192.168.10.11；VLAN20：PC2=192.168.20.10、PC4=192.168.20.11；网关为各网段 .1，DNS=203.0.113.10）。',
            op: [
                { type: 'observe', target: 'pc1', part: 'screen', msg: '配置 PC1：192.168.10.10/24，网关 192.168.10.1', async act() { await _demoSetPcNet(this, 'pc1', { ip: '192.168.10.10', mask: '255.255.255.0', gateway: '192.168.10.1', dns: '203.0.113.10' }, '配置 PC1'); } },
                { type: 'observe', target: 'pc2', part: 'screen', msg: '配置 PC2：192.168.20.10/24，网关 192.168.20.1', async act() { await _demoSetPcNet(this, 'pc2', { ip: '192.168.20.10', mask: '255.255.255.0', gateway: '192.168.20.1', dns: '203.0.113.10' }, '配置 PC2'); } },
                { type: 'observe', target: 'pc3', part: 'screen', msg: '配置 PC3：192.168.10.11/24，网关 192.168.10.1', async act() { await _demoSetPcNet(this, 'pc3', { ip: '192.168.10.11', mask: '255.255.255.0', gateway: '192.168.10.1', dns: '203.0.113.10' }, '配置 PC3'); } },
                { type: 'observe', target: 'pc4', part: 'screen', msg: '配置 PC4：192.168.20.11/24，网关 192.168.20.1', async act() { await _demoSetPcNet(this, 'pc4', { ip: '192.168.20.11', mask: '255.255.255.0', gateway: '192.168.20.1', dns: '203.0.113.10' }, '配置 PC4'); } },
            ],
            check() { return ['pc1', 'pc2', 'pc3', 'pc4'].every(id => { const p = _comp(id); return !!p && !!p.ip; }); },
        },
        {
            mode: 'check',
            msg: '配置三层交换机 L3SW1：创建 VLAN10/20/100，端口 1/2 设为 trunk（允许 VLAN10、20），端口 3 划入 VLAN100，并配置 VLANIF10（192.168.10.1/24）、VLANIF20（192.168.20.1/24）、VLANIF100（10.10.10.1/30）。',
            op: [{ type: 'observe', target: 'l3sw1', msg: '打开 L3SW1 命令行，逐条配置 VLAN 与 VLANIF 地址', async act() { const l = _comp('l3sw1'); if (l) await _runScript(l, _L3_CMDS); } }],
            check() { const l = _comp('l3sw1'); if (!l) return false; const a = l.getVlanifByVlan(10), b = l.getVlanifByVlan(20); return !!a && !!b && a.ip === '192.168.10.1' && b.ip === '192.168.20.1'; },
        },
        {
            mode: 'check',
            msg: '配置接入交换机 SW1：PC1 口 access VLAN10、PC2 口 access VLAN20、上联口 trunk 允许 VLAN10/20。',
            op: [{ type: 'observe', target: 'sw1', msg: 'SW1 命令行配置端口 VLAN 与 trunk', async act() { const s = _comp('sw1'); if (s) await _runScript(s, _SW_CMDS); } }],
            check() { const s = _comp('sw1'); return !!s && s.getPortVlan('eth1') === 10 && s.getPortVlan('eth2') === 20 && s.getPortType('eth8') === 'trunk'; },
        },
        {
            mode: 'check',
            msg: '配置接入交换机 SW2：同样划分 VLAN 并配置 trunk 上联。',
            op: [{ type: 'observe', target: 'sw2', msg: 'SW2 命令行配置端口 VLAN 与 trunk', async act() { const s = _comp('sw2'); if (s) await _runScript(s, _SW_CMDS); } }],
            check() { const s = _comp('sw2'); return !!s && s.getPortVlan('eth1') === 10 && s.getPortVlan('eth2') === 20 && s.getPortType('eth8') === 'trunk'; },
        },
        {
            mode: 'check',
            msg: '布线：PC1→SW1-1、PC2→SW1-2、SW1-8→L3SW1-1；PC3→SW2-1、PC4→SW2-2、SW2-8→L3SW1-2。',
            op: [
                { type: 'observe', target: 'sw1', msg: 'SW1 接入 PC1、PC2 并 trunk 上联 L3SW1', async act() { const s = _sys(); if (s) await _wire(s, _LAN_WIRES_1); } },
                { type: 'observe', target: 'sw2', msg: 'SW2 接入 PC3、PC4 并 trunk 上联 L3SW1', async act() { const s = _sys(); if (s) await _wire(s, _LAN_WIRES_2); } },
            ],
            check() { const s = _sys(); return !!s && (s.conns || []).filter(c => c.type === 'wire').length >= 6; },
        },
    ];
}

function _wanBaseSteps() {
    return [
        {
            mode: 'check',
            msg: '配置出口路由器 R1：GE0/0/0=10.10.10.2/30（连三层交换机）、GE0/0/1=100.64.0.1/30（连互联网路由器）。',
            op: [
                { type: 'observe', target: 'r1', part: 'g0', msg: 'R1 接口 GE0/0/0 = 10.10.10.2/30', async act() { await _demoSetRouterIface(this, 'r1', 'g0', '10.10.10.2', '255.255.255.252', 'R1 GE0/0/0 = 10.10.10.2/30'); } },
                { type: 'observe', target: 'r1', part: 'g1', msg: 'R1 接口 GE0/0/1 = 100.64.0.1/30', async act() { await _demoSetRouterIface(this, 'r1', 'g1', '100.64.0.1', '255.255.255.252', 'R1 GE0/0/1 = 100.64.0.1/30'); } },
            ],
            check() { const r = _comp('r1'); return !!r && r.interfaces[0].ip === '10.10.10.2' && r.interfaces[1].ip === '100.64.0.1'; },
        },
        {
            mode: 'check',
            msg: '配置互联网路由器 R2：GE0/0/0=100.64.0.2/30（连出口路由器）、GE0/0/1=203.0.113.1/24（服务器网段网关）。',
            op: [
                { type: 'observe', target: 'r2', part: 'g0', msg: 'R2 接口 GE0/0/0 = 100.64.0.2/30', async act() { await _demoSetRouterIface(this, 'r2', 'g0', '100.64.0.2', '255.255.255.252', 'R2 GE0/0/0 = 100.64.0.2/30'); } },
                { type: 'observe', target: 'r2', part: 'g1', msg: 'R2 接口 GE0/0/1 = 203.0.113.1/24', async act() { await _demoSetRouterIface(this, 'r2', 'g1', '203.0.113.1', '255.255.255.0', 'R2 GE0/0/1 = 203.0.113.1/24'); } },
            ],
            check() { const r = _comp('r2'); return !!r && r.interfaces[0].ip === '100.64.0.2' && r.interfaces[1].ip === '203.0.113.1'; },
        },
        {
            mode: 'check',
            msg: '配置服务器 SRV1：IP 203.0.113.10/24、网关 203.0.113.1、DNS 203.0.113.10；并启用 DNS / HTTP / FTP 服务（DNS 记录 www.example.com → 203.0.113.10）。',
            op: [
                { type: 'observe', target: 'srv1', part: 'lan', msg: 'SRV1 网络设置（IP / 网关 / DNS）', async act() { await _demoSetServerNet(this, 'srv1', { ip: '203.0.113.10', mask: '255.255.255.0', gateway: '203.0.113.1', dns: '203.0.113.10' }, '配置服务器 IP / 网关 / DNS'); } },
                { type: 'observe', target: 'srv1', part: 'http', msg: 'SRV1 启用 DNS / HTTP / FTP 服务', async act() { await _demoSetServerSvc(this, 'srv1', { http: true, ftp: true, dns: true }, '勾选并保存 DNS / HTTP / FTP 服务'); } },
            ],
            check() { const s = _comp('srv1'); return !!s && s.ip === '203.0.113.10' && s.httpEnabled && s.ftpEnabled && s.dnsEnabled; },
        },
        {
            mode: 'check',
            msg: '布线：L3SW1-3→R1 GE0/0/0，R1 GE0/0/1→R2 GE0/0/0，R2 GE0/0/1→SRV1。',
            op: [{ type: 'observe', target: 'r1', msg: '连接 L3SW1 → R1 → R2 → SRV1', async act() { const s = _sys(); if (s) await _wire(s, _WAN_WIRES); } }],
            check() { const s = _sys(); return !!s && (s.conns || []).filter(c => c.type === 'wire').length >= 9; },
        },
    ];
}

// ─── 故障配置 ───
export const FAULT_CONFIGS = {};

// ─── 操作流程 ───
export const PROJECT_WORKFLOWS = {};

// ═════════════════════════════════════════════════════════════════════════
// 流程 1：三层交换机 VLAN 间路由
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['l3-vlan'] = {
    id: 'l3-vlan',
    name: '1. 三层交换机 VLAN 间路由',
    steps: [
        { mode: 'find', target: 'l3sw1', msg: '1. 三层交换机 L3SW1：既做二层交换，又通过 VLANIF 虚接口实现 VLAN 间路由，请点击它' },
        { mode: 'find', target: 'sw1', msg: '2. 接入层交换机 SW1：承载 VLAN10 与 VLAN20，并通过 trunk 上联三层交换机，请点击它' },
        { mode: 'find', target: 'sw2', msg: '3. 接入层交换机 SW2，请点击它' },
        ..._lanBaseSteps(),
        {
            mode: 'check',
            msg: '在 PC1 上 ping PC3（192.168.10.11）：同 VLAN、同网段，经交换机二层转发，应能通。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC3（同 VLAN，二层直通）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.10.11'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '192.168.10.11', 4).reachable; },
        },
        {
            mode: 'check',
            msg: '在 PC1 上 ping PC2（192.168.20.10）：不同 VLAN、不同网段，经三层交换机 VLANIF 路由转发，应能通（TTL=127）。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC2（跨 VLAN，三层转发）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.20.10'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); const r = runPing(s, pc, '192.168.20.10', 4); return r.reachable && r.hops === 1; },
        },
        {
            mode: 'check',
            msg: '在 L3SW1 上执行 display ip routing-table，查看两条直连路由（192.168.10.0/24、192.168.20.0/24）。',
            op: [{ type: 'observe', target: 'l3sw1', msg: 'L3SW1 执行 display ip routing-table', async act() { const l = _comp('l3sw1'); if (l) await l.demoCommand('display ip routing-table'); } }],
            check() { const l = _comp('l3sw1'); return !!l; },
        },
        {
            mode: 'check',
            msg: '故障演练：把 L3SW1 的 Vlanif20 关闭（shutdown），PC1 ping PC2 将失败；再 undo shutdown 恢复。',
            op: [
                { type: 'observe', target: 'l3sw1', msg: 'L3SW1：interface Vlanif 20 → shutdown', async act() { const l = _comp('l3sw1'); if (l) await _runScript(l, ['system-view', 'interface Vlanif 20', 'shutdown', 'quit', 'quit']); } },
                { type: 'observe', target: 'pc1', msg: 'PC1 ping PC2 失败（VLANIF20 已关闭）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.20.10'); } },
                { type: 'observe', target: 'l3sw1', msg: 'L3SW1：interface Vlanif 20 → undo shutdown 恢复', async act() { const l = _comp('l3sw1'); if (l) await _runScript(l, ['system-view', 'interface Vlanif 20', 'undo shutdown', 'quit', 'quit']); } },
                { type: 'observe', target: 'pc1', msg: 'PC1 ping PC2 恢复连通', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.20.10'); } },
            ],
            check() { const l = _comp('l3sw1'); const v = l && l.getVlanifByVlan(20); return !!v && v.up !== false; },
        },
        {
            mode: 'quiz',
            msg: '选择题：VLAN 间通信为什么需要三层交换机？',
            quizConfig: {
                question: '同一台交换机上，VLAN10 的主机要与 VLAN20 的主机通信，为什么需要三层设备？',
                options: [
                    'VLAN 隔离了二层广播域，必须经三层（VLANIF 虚接口）做路由转发',
                    '因为交换机端口不够用了',
                    '因为 VLAN 之间会自动互通，不需要三层设备',
                    '只要把两台主机的 IP 改成一样即可',
                ],
                answer: 0,
                analysis: 'VLAN 的作用是把一个物理交换机划分成多个二层广播域，VLAN 之间默认完全隔离。要让不同 VLAN 互通，必须在三层交换机上为每个 VLAN 配置 VLANIF 虚接口（相当于该 VLAN 的网关），由三层交换机在 VLAN 间做 IP 路由转发。',
            },
        },
        {
            mode: 'fill',
            msg: '填空题：VLAN10 主机 PC1 的默认网关是（   ），它由三层交换机的（   ）虚接口提供。',
            fields: [
                { label: 'PC1 默认网关', unit: '', answer: '192.168.10.1', placeholder: 'VLANIF10 地址' },
                { label: '虚接口名称', unit: '', answer: ['Vlanif10', 'VLANIF10', 'Vlanif 10', 'vlanif10'], placeholder: '接口类型+编号' },
            ],
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 2：RIP 动态路由
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['rip'] = {
    id: 'rip',
    name: '2. RIP 动态路由（含出口与服务器）',
    steps: [
        { mode: 'find', target: 'r1', msg: '1. 出口路由器 R1：连接内网三层交换机与互联网路由器，请点击它' },
        { mode: 'find', target: 'r2', msg: '2. 互联网路由器 R2：连接出口路由器与服务器，请点击它' },
        ..._lanBaseSteps(),
        ..._wanBaseSteps(),
        {
            mode: 'check',
            msg: '在三层交换机与两台路由器上启用 RIP，并宣告各自直连网段（L3SW：192.168.10.0/192.168.20.0/10.10.10.0；R1：10.10.10.0/100.64.0.0；R2：100.64.0.0/203.0.113.0）。',
            op: [
                { type: 'observe', target: 'l3sw1', msg: 'L3SW1：rip → version 2 → network 宣告内网网段', async act() { const l = _comp('l3sw1'); if (l) await _runScript(l, ['system-view', 'rip', 'version 2', 'network 192.168.10.0', 'network 192.168.20.0', 'network 10.10.10.0', 'quit', 'display ip routing-table']); } },
                { type: 'observe', target: 'r1', msg: 'R1：rip → version 2 → network 10.10.10.0 / 100.64.0.0', async act() { const r = _comp('r1'); if (r) await _runScript(r, ['system-view', 'rip', 'version 2', 'network 10.10.10.0', 'network 100.64.0.0']); } },
                { type: 'observe', target: 'r2', msg: 'R2：rip → version 2 → network 100.64.0.0 / 203.0.113.0', async act() { const r = _comp('r2'); if (r) await _runScript(r, ['system-view', 'rip', 'version 2', 'network 100.64.0.0', 'network 203.0.113.0', 'quit', 'display ip routing-table']); } },
            ],
            check() { const l = _comp('l3sw1'), r1 = _comp('r1'), r2 = _comp('r2'); return !!(l && l.ripEnabled && r1 && r1.ripEnabled && r2 && r2.ripEnabled); },
        },
        {
            mode: 'check',
            msg: '在 L3SW1 上查看仅由 RIP 学到的路由（display ip routing-table protocol rip）：应能学到 100.64.0.0/30 与 203.0.113.0/24。',
            op: [{ type: 'observe', target: 'l3sw1', msg: 'L3SW1 执行 display ip routing-table protocol rip', async act() { const l = _comp('l3sw1'); if (l) await l.demoCommand('display ip routing-table protocol rip'); } }],
            check() { const l = _comp('l3sw1'); return !!l; },
        },
        {
            mode: 'check',
            msg: '端到端测试：PC1 ping 服务器 203.0.113.10，数据经三层交换、两台路由器由 RIP 学到的路由转发，应能通。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping 服务器（跨整个网络，RIP 路由）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 203.0.113.10'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '203.0.113.10', 4).reachable; },
        },
        {
            mode: 'check',
            msg: '故障演练：在 R2 上关闭 RIP（undo rip），网络将失去通往服务器网段的路由，PC1 ping 失败；再启用 RIP 恢复。',
            op: [
                { type: 'observe', target: 'r2', msg: 'R2：undo rip 关闭 RIP', async act() { const r = _comp('r2'); if (r) await _runScript(r, ['system-view', 'undo rip']); } },
                { type: 'observe', target: 'pc1', msg: 'PC1 ping 服务器失败（路由丢失）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 203.0.113.10'); } },
                { type: 'observe', target: 'r2', msg: 'R2：重新启用 RIP 并宣告网段', async act() { const r = _comp('r2'); if (r) await _runScript(r, ['system-view', 'rip', 'version 2', 'network 100.64.0.0', 'network 203.0.113.0']); } },
                { type: 'observe', target: 'pc1', msg: 'PC1 ping 服务器恢复', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 203.0.113.10'); } },
            ],
            check() { const r = _comp('r2'); return !!r && r.ripEnabled; },
        },
        {
            mode: 'quiz',
            msg: '选择题：RIP 用什么作为路由度量？',
            quizConfig: {
                question: 'RIP 协议选择路由时使用的度量（metric）是什么？',
                options: [
                    '跳数（经过的路由器个数），最大 15 跳',
                    '链路带宽',
                    '延迟时间',
                    '接口的 IP 地址大小',
                ],
                answer: 0,
                analysis: 'RIP 是距离向量协议，以“跳数”为度量：直连网段为 0 跳，每经过一台路由器加 1，最大 15 跳，16 跳表示不可达。因此 RIP 倾向于选择跳数最少但未必带宽最优的路径。OSPF 则以链路开销（cost）为度量。',
            },
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 3：OSPF 动态路由
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['ospf'] = {
    id: 'ospf',
    name: '3. OSPF 动态路由',
    steps: [
        { mode: 'find', target: 'l3sw1', msg: '1. 三层交换机 L3SW1：作为内网核心，运行 OSPF 与出口路由器互通，请点击它' },
        { mode: 'find', target: 'r1', msg: '2. 出口路由器 R1，请点击它' },
        { mode: 'find', target: 'r2', msg: '3. 互联网路由器 R2，请点击它' },
        ..._lanBaseSteps(),
        ..._wanBaseSteps(),
        {
            mode: 'check',
            msg: '在三台三层设备上启用 OSPF（单区域 0），并宣告各自直连网段（network + 反掩码）。',
            op: [
                { type: 'observe', target: 'l3sw1', msg: 'L3SW1：ospf 1 router-id → area 0 → network 内网网段', async act() { const l = _comp('l3sw1'); if (l) await _runScript(l, ['system-view', 'ospf 1 router-id 1.1.1.1', 'area 0', 'network 192.168.10.0 0.0.0.255', 'network 192.168.20.0 0.0.0.255', 'network 10.10.10.0 0.0.0.3', 'quit', 'quit']); } },
                { type: 'observe', target: 'r1', msg: 'R1：ospf 1 router-id 2.2.2.2 → area 0 → network 网段', async act() { const r = _comp('r1'); if (r) await _runScript(r, ['system-view', 'ospf 1 router-id 2.2.2.2', 'area 0', 'network 10.10.10.0 0.0.0.3', 'network 100.64.0.0 0.0.0.3', 'quit', 'quit']); } },
                { type: 'observe', target: 'r2', msg: 'R2：ospf 1 router-id 3.3.3.3 → area 0 → network 网段', async act() { const r = _comp('r2'); if (r) await _runScript(r, ['system-view', 'ospf 1 router-id 3.3.3.3', 'area 0', 'network 100.64.0.0 0.0.0.3', 'network 203.0.113.0 0.0.0.255', 'quit', 'quit']); } },
            ],
            check() { const l = _comp('l3sw1'), r1 = _comp('r1'), r2 = _comp('r2'); return !!(l && l.ospfEnabled && r1 && r1.ospfEnabled && r2 && r2.ospfEnabled); },
        },
        {
            mode: 'check',
            msg: '在 R2 上查看 OSPF 邻居（display ospf peer），应看到与 R1 建立 Full 邻居关系。',
            op: [{ type: 'observe', target: 'r2', msg: 'R2 执行 display ospf peer', async act() { const r = _comp('r2'); if (r) await r.demoCommand('display ospf peer'); } }],
            check() { const r = _comp('r2'); return !!r; },
        },
        {
            mode: 'check',
            msg: '在 L3SW1 上查看 OSPF 学到的路由（display ip routing-table protocol ospf），应与 RIP 相同目标但管理距离/度量不同。',
            op: [{ type: 'observe', target: 'l3sw1', msg: 'L3SW1 执行 display ip routing-table protocol ospf', async act() { const l = _comp('l3sw1'); if (l) await l.demoCommand('display ip routing-table protocol ospf'); } }],
            check() { const l = _comp('l3sw1'); return !!l; },
        },
        {
            mode: 'check',
            msg: '端到端测试：PC1 ping 服务器 203.0.113.10，由 OSPF 计算的最短路径转发，应能通。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping 服务器（OSPF 路由）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 203.0.113.10'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '203.0.113.10', 4).reachable; },
        },
        {
            mode: 'check',
            msg: '对比测试：PC1 执行 tracert 203.0.113.10，查看逐跳经过的路由器。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 执行 tracert 查看 OSPF 路径', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('tracert 203.0.113.10'); } }],
            check() { const s = _sys(); return !!s && !!_comp('pc1'); },
        },
        {
            mode: 'quiz',
            msg: '选择题：RIP 与 OSPF 的主要区别？',
            quizConfig: {
                question: '关于 RIP 与 OSPF，下列说法正确的是？',
                options: [
                    'RIP 是距离向量、以跳数为度量；OSPF 是链路状态、以链路开销为度量',
                    'RIP 支持大型网络，最大跳数可达 255',
                    'OSPF 只能用于直连的两台路由器之间',
                    '两者度量方式完全相同',
                ],
                answer: 0,
                analysis: 'RIP 属于距离向量协议，邻居间直接交换整张路由表，以跳数为度量、最大 15 跳，适合小型网络。OSPF 属于链路状态协议，各路由器泛洪链路状态并各自用 SPF（Dijkstra）计算最短路径，以带宽决定的 cost 为度量，收敛快、适合中大型网络。',
            },
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 4：HTTP / FTP 服务器与 DNS（出口 NAT + 默认路由）
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['server-dns'] = {
    id: 'server-dns',
    name: '4. HTTP/FTP 服务器与 DNS（出口 NAT）',
    steps: [
        { mode: 'find', target: 'srv1', msg: '1. 统一服务器 SRV1：同时提供 HTTP 网站、FTP 文件与 DNS 域名解析服务，请点击它' },
        { mode: 'find', target: 'pc1', msg: '2. PC1 主机：作为客户端访问服务器，请点击它' },
        ..._lanBaseSteps(),
        ..._wanBaseSteps(),
        {
            mode: 'check',
            msg: '配置出口路由：关闭动态路由，L3SW1 加默认路由指向 R1（10.10.10.2），R1 加默认路由指向 R2（100.64.0.2）。',
            op: [
                { type: 'observe', target: 'l3sw1', msg: 'L3SW1：关闭动态路由并配置默认路由 0.0.0.0/0 → R1', async act() { const l = _comp('l3sw1'); if (l) await _runScript(l, ['system-view', 'undo rip', 'undo ospf', 'ip route-static 0.0.0.0 0.0.0.0 10.10.10.2', 'quit', 'display ip routing-table']); } },
                { type: 'observe', target: 'r1', msg: 'R1：关闭动态路由并配置默认路由 0.0.0.0/0 → R2', async act() { const r = _comp('r1'); if (r) await _runScript(r, ['system-view', 'undo rip', 'undo ospf', 'ip route-static 0.0.0.0 0.0.0.0 100.64.0.2', 'quit', 'display ip routing-table']); } },
            ],
            check() { const l = _comp('l3sw1'); const r = _comp('r1'); return !!(l && l.routes.some(x => x.net === '0.0.0.0' || x.net === '0.0.0.0') && r && r.routes.length); },
        },
        {
            mode: 'check',
            msg: '在出口路由器 R1 上启用 NAT（easy-ip）：GE0/0/0 设为 inside、GE0/0/1 设为 outside，私网地址复用出口地址访问互联网。',
            op: [{ type: 'observe', target: 'r1', part: 'console', msg: 'R1 打开 NAT 页：启用并设置 inside/outside 接口', async act() { await _demoSetNat(this, 'r1', { enable: true, inside: 'g0', outside: 'g1' }, '启用 NAT，GE0/0/0 inside / GE0/0/1 outside'); } }],
            check() { const r = _comp('r1'); return !!r && r.natEnabled; },
        },
        {
            mode: 'check',
            msg: '在 PC1 上执行 nslookup www.example.com，通过 DNS 服务器 203.0.113.10 解析出 203.0.113.10。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 执行 nslookup www.example.com', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('nslookup www.example.com'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); const r = resolveDomain(s, pc, 'www.example.com'); return !!(r && r.ok && r.ip === '203.0.113.10'); },
        },
        {
            mode: 'check',
            msg: '双击 PC1 →「浏览器」，输入 http://www.example.com/ 访问，先出现「正在连接 / 正在加载」，随后显示服务器返回的网页主页（停留观察）。',
            op: [{ type: 'observe', target: 'pc1', part: 'screen', msg: 'PC1 浏览器访问 http://www.example.com/（加载过程 + 网页显示）', async act() { const pc = _comp('pc1'); if (pc && pc.demoBrowser) await pc.demoBrowser('http://www.example.com/', { holdMs: 7500 }); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); const r = httpGet(s, pc, 'http://www.example.com/'); return !!(r && r.ok); },
        },
        {
            mode: 'check',
            msg: '双击 PC1 →「FTP 客户端」，连接 203.0.113.10（账号 ftpuser / ftp123），查看目录列表，再下载 readme.txt，观察“正在下载…”进度与下载完成的文件内容（停留观察）。',
            op: [{ type: 'observe', target: 'pc1', part: 'lan', msg: 'PC1 FTP 登录、列出文件并下载 readme.txt（下载过程 + 文件内容）', async act() { const pc = _comp('pc1'); if (pc && pc.demoFtp) await pc.demoFtp({ host: '203.0.113.10', user: 'ftpuser', pass: 'ftp123', file: 'readme.txt', holdMs: 7500 }); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); const r = ftpGet(s, pc, '203.0.113.10', 'readme.txt', 'ftpuser', 'ftp123'); return !!(r && r.ok); },
        },
        {
            mode: 'check',
            msg: '在出口路由器 R1 上执行 display nat session，查看私网地址到公网地址的转换会话（NAT/PAT）。',
            op: [{ type: 'observe', target: 'r1', msg: 'R1 执行 display nat session', async act() { const r = _comp('r1'); if (r) await r.demoCommand('display nat session'); } }],
            check() { const r = _comp('r1'); return !!r && natSessions(r).length > 0; },
        },
        {
            mode: 'quiz',
            msg: '选择题：DNS 的作用是什么？',
            quizConfig: {
                question: 'PC 用域名 www.example.com 访问网站，DNS 服务器的作用是？',
                options: [
                    '把域名解析成对应的 IP 地址',
                    '把 IP 地址转换成域名保存',
                    '为 PC 分配 IP 地址',
                    '把 HTTP 请求转发给服务器',
                ],
                answer: 0,
                analysis: '网络通信实际使用 IP 地址，而人更习惯记忆域名。DNS（域名系统）负责把域名解析为 IP 地址。PC 先向配置的 DNS 服务器查询域名对应的 IP，再用该 IP 建立连接；为 PC 自动分配 IP 的是 DHCP。',
            },
        },
        {
            mode: 'fill',
            msg: '填空题：PC1 的 DNS 服务器地址是（   ），出口路由器 NAT 使私网主机共享（   ）地址访问互联网。',
            fields: [
                { label: 'DNS 服务器', unit: '', answer: '203.0.113.10', placeholder: '服务器地址' },
                { label: 'NAT 复用地址', unit: '', answer: ['公网', '出口', '外网'], placeholder: '公网 / 出口 / 内网' },
            ],
        },
    ],
};

export const componentConfigs = [
    // PC（VLAN10：PC1、PC3；VLAN20：PC2、PC4）
    { Class: PC, id: 'pc1', x: 60, y: 160, hostname: 'PC1' },
    { Class: PC, id: 'pc2', x: 460, y: 160, hostname: 'PC2' },
    { Class: PC, id: 'pc3', x: 1100, y: 160, hostname: 'PC3' },
    { Class: PC, id: 'pc4', x: 1500, y: 160, hostname: 'PC4' },

    // 接入层二层交换机
    { Class: NetworkSwitch, id: 'sw1', x: 300, y: 390, hostname: 'SW1', portCount: 8 },
    { Class: NetworkSwitch, id: 'sw2', x: 1160, y: 390, hostname: 'SW2', portCount: 8 },

    // 三层核心交换机
    { Class: L3Switch, id: 'l3sw1', x: 330, y: 760, hostname: 'L3SW1', portCount: 8 },

    // 出口路由器 / 互联网路由器
    { Class: Router, id: 'r1', x: 1030, y: 660, hostname: '出口路由器', portCount: 2 },
    { Class: Router, id: 'r2', x: 1030, y: 900, hostname: '互联网路由器', portCount: 2 },

    // 统一服务器（HTTP / FTP / DNS）
    { Class: NetServer, id: 'srv1', x: 1500, y: 700, hostname: 'SRV1' },

    // 仪表（默认隐藏，经工具栏「选择仪表」调出）
    { Class: Multimeter, id: 'multimeter', x: 40, y: 740, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 40, y: 800, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 40, y: 860, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 40, y: 920, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 100, y: 740, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 100, y: 800, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 100, y: 860, visible: false },
];

export function initSlider(_sys) { }

export function applyAllPresets() { }

export async function applyStartSystem() { }

export function fiveStep() { }
