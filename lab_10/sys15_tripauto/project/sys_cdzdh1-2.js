// 简单组网仿真工程（含三层路由）—— 出厂状态：所有设备未配置 IP
//
// 拓扑：
//     PC1  PC2            PC3  PC4
//      │    │              │    │
//    [SW1]                [SW2]
//      │                    │
//      └────── [R1] ────────┘
//
//   出厂状态：PC / 交换机 / 路由器均无 IP 配置，需在“操作流程”或手动配置。
//   参考地址规划（流程会逐步配置）：
//     LAN1 192.168.1.0/24：pc1=.2、pc2=.3、R1 GE0/0/0=.1（PC 网关 .1）
//     LAN2 192.168.2.0/24：pc3=.2、pc4=.3、R1 GE0/0/1=.1（PC 网关 .1）
//
// 交互：
//   - 双击 PC     → TCP/IP 设置 + 命令行（ipconfig / ping / tracert / arp）；屏幕为简单桌面
//   - 双击 交换机 → VLAN 配置（含 Vlanif1 管理地址）+ 命令行（vlan / interface Vlanif 1 / ip address）
//   - 双击 路由器 → 接口配置 / DHCP / 静态路由 / 命令行
//   - 右键 交换机 → 生成到选中 PC 的网线、断开所有网线
//   - 右键 路由器 → 连接到选中的交换机/PC、断开所有连线

import { PC } from '../components/PC.js';
import { NetworkSwitch } from '../components/NetworkSwitch.js';
import { Router } from '../components/Router.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

import { connectedPCIds, runPing } from '../tools/NetworkSim.js';
import { closeActiveNetDialog } from '../lib/NetConsole.js';

const _sys = () => (typeof window !== 'undefined' && window.sys) ? window.sys : null;
const _comp = (id) => { const s = _sys(); return s ? s.comps[id] : null; };
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

function _flash(wf, el, msg, ms) {
    return (wf && typeof wf._flashDomElement === 'function' && el) ? wf._flashDomElement(el, msg, ms) : Promise.resolve();
}

// ─── 走界面配置参数的演示辅助 ─────────────────────────────────

/** 通过 PC 的 TCP/IP 界面一次性配置 IP / 掩码 / 网关 / DNS */
async function _demoSetPcNet(wf, compId, { ip, mask, gateway = '', dns = '' } = {}, tip) {
    const comp = _comp(compId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('ip');
    await _sleep(700);

    const setv = (id, v) => {
        const el = document.getElementById(id);
        if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    // 逐个参数演示：高亮该字段 → 填写 → 停顿，绝不一次性写入所有参数
    const fields = [
        { id: 'diag_ip', value: ip, label: 'IP 地址' },
        { id: 'diag_mask', value: mask, label: '子网掩码' },
        { id: 'diag_gateway', value: gateway, label: '默认网关' },
        { id: 'diag_dns', value: dns, label: 'DNS 服务器' },
    ];
    for (const f of fields) {
        const el = document.getElementById(f.id);
        const msg = f.value ? `填写${f.label}：${f.value}` : `${f.label}：本次留空`;
        if (el) await _flash(wf, el, msg, 2500);
        setv(f.id, f.value || '');
        await _sleep(450);
    }

    const save = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存').pop();
    if (save) { await _flash(wf, save, '点击「保存」应用 TCP/IP 设置', 1600); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

/** 通过 PC 的 TCP/IP 界面切换 DHCP 开关 */
async function _demoSetPcDhcp(wf, compId, on, tip) {
    const comp = _comp(compId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('ip');
    await _sleep(700);
    const cb = document.getElementById('diag_dhcp');
    if (cb) {
        await _flash(wf, cb, tip || '勾选「启用 DHCP（自动获取 IP）」', 2000);
        cb.checked = !!on;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
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

    const setv = (id, v) => {
        const el = document.getElementById(id);
        if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    // 逐个参数演示：先 IP，再掩码
    const fields = [
        { id: 'diag_ip_' + origId, value: ip, label: 'IP 地址' },
        { id: 'diag_mask_' + origId, value: mask, label: '子网掩码' },
    ];
    for (const f of fields) {
        const el = document.getElementById(f.id);
        const msg = f.value ? `填写${f.label}：${f.value}` : `${f.label}：本次留空`;
        if (el) await _flash(wf, el, msg, 2500);
        setv(f.id, f.value || '');
        await _sleep(450);
    }

    const save = document.getElementById('iface_save_btn');
    if (save) { await _flash(wf, save, '点击「保存」应用接口配置', 1600); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

/** 通过路由器的 DHCP 界面切换启用状态 */
async function _demoSetRouterDhcp(wf, rId, on, tip) {
    const comp = _comp(rId);
    if (!comp || typeof comp.showConfigDialog !== 'function') return;
    comp.showConfigDialog('dhcp');
    await _sleep(700);
    const cb = document.getElementById('diag_dhcp_enable');
    if (cb) {
        await _flash(wf, cb, tip || '启用 DHCP 服务', 2000);
        cb.checked = !!on;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const save = document.getElementById('dhcp_save_btn');
    if (save) { await _flash(wf, save, '点击「保存」应用', 1400); save.click(); await _sleep(500); }
    closeActiveNetDialog();
}

// ─── 故障配置 ───
export const FAULT_CONFIGS = {};

// ─── 操作流程 ───
export const PROJECT_WORKFLOWS = {};

export const componentConfigs = [
    // PC（出厂状态：未配置 IP / 掩码 / 网关）
    { Class: PC, id: 'pc1', x: 240, y: 210, hostname: 'PC1' },
    { Class: PC, id: 'pc2', x: 620, y: 210, hostname: 'PC2' },
    { Class: PC, id: 'pc3', x: 1140, y: 210, hostname: 'PC3' },
    { Class: PC, id: 'pc4', x: 1520, y: 210, hostname: 'PC4' },

    // 交换机（出厂状态：未配置管理地址）
    { Class: NetworkSwitch, id: 'sw1', x: 430, y: 600, hostname: 'SW1', portCount: 8 },
    { Class: NetworkSwitch, id: 'sw2', x: 1330, y: 600, hostname: 'SW2', portCount: 8 },

    // 路由器（出厂状态：两个接口均未配置地址）
    { Class: Router, id: 'r1', x: 880, y: 840, hostname: 'R1', portCount: 2 },

    // 仪表（默认隐藏，经工具栏「选择仪表」调出）
    { Class: Multimeter, id: 'multimeter', x: 40, y: 740, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 40, y: 800, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 40, y: 860, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 40, y: 920, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 100, y: 740, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 100, y: 800, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 100, y: 860, visible: false },
];

// ═════════════════════════════════════════════════════════════════════════
// 流程 1：交换式局域网（同网段连通）
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['lan-ping'] = {
    id: 'lan-ping',
    name: '1. 交换式局域网（同网段连通）',
    steps: [
        { mode: 'find', target: 'pc1', msg: '1. 组网用的第一台PC 主机，双击可打开「TCP/IP 设置」与「命令行」，请点击它' },
        { mode: 'find', target: 'pc2', msg: '2. 第二台 PC，请点击它' },
        { mode: 'find', target: 'sw1', msg: '3. 网络交换机：把接入的 PC 划分在同一广播域内转发数据帧，请点击它' },
        {
            mode: 'check',
            msg: '4. 双击 PC1，在「TCP/IP 设置」中配置 IP 192.168.1.2、掩码 255.255.255.0、网关 192.168.1.1、DNS 192.168.1.1。',
            op: [{ type: 'observe', target: 'pc1', msg: '配置 PC1：IP / 掩码 / 网关 / DNS', async act() { await _demoSetPcNet(this, 'pc1', { ip: '192.168.1.2', mask: '255.255.255.0', gateway: '192.168.1.1', dns: '192.168.1.1' }, '配置 PC1：IP、掩码、网关与 DNS'); } }],
            check() { const pc = _comp('pc1'); return !!pc && pc.ip === '192.168.1.2' && pc.gateway === '192.168.1.1' && pc.dns === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '5. 同样配置 PC2：IP 192.168.1.3、掩码 255.255.255.0、网关 192.168.1.1、DNS 192.168.1.1。',
            op: [{ type: 'observe', target: 'pc2', msg: '配置 PC2：IP / 掩码 / 网关 / DNS', async act() { await _demoSetPcNet(this, 'pc2', { ip: '192.168.1.3', mask: '255.255.255.0', gateway: '192.168.1.1', dns: '192.168.1.1' }, '配置 PC2：IP、掩码、网关与 DNS'); } }],
            check() { const pc = _comp('pc2'); return !!pc && pc.ip === '192.168.1.3' && pc.gateway === '192.168.1.1' && pc.dns === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '6. 将 PC1、PC2 连接到到交换机 SW1 。',
            op: [{
                type: 'observe', target: 'sw1',
                msg: '将 PC1、PC2 连接到到交换机 SW1',
                async act() { const sw = _comp('sw1'); if (sw) await sw.connectPCs(['pc1', 'pc2'], true); },
            }],
            check() { const s = _sys(); const sw = _comp('sw1'); return !!s && !!sw && connectedPCIds(s, sw).length >= 2; },
        },
        {
            mode: 'check',
            msg: '7. 在 PC1 命令行执行 ipconfig，查看本机地址。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 执行 ipconfig', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ipconfig'); } }],
            check() { const pc = _comp('pc1'); return !!pc && !!pc.ip; },
        },
        {
            mode: 'check',
            msg: '8. PC1 执行 ping 192.168.1.3：同网段且经交换机连通，应全部应答。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC2（同网段）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.1.3'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '192.168.1.3', 4).reachable; },
        },
        {
            mode: 'quiz',
            msg: '9. 选择题：同网段两台 PC 能 ping 通，主要条件是什么？',
            quizConfig: {
                question: 'PC1（192.168.1.2/24）能 ping 通 PC2（192.168.1.3/24），主要条件是？',
                options: [
                    '两者物理上经交换机连通，且 IP 位于同一网段',
                    '两者 IP 地址不同，所以一定能通',
                    '交换机为每台 PC 分配了不同的 IP',
                    '只要插上网线，任意 IP 都能互相 ping 通',
                ],
                answer: 0,
                analysis: '二层连通是前提：两台 PC 都接入同一交换机的同一 VLAN，数据帧可被转发。逻辑同网段是第二个条件：源主机用掩码判断目标在同一子网，直接 ARP 获取目标 MAC，无需网关。若不同网段，则需要路由器转发。',
            },
        },
        {
            mode: 'fill',
            msg: '10. 填空题：同网段通信依赖（   ）层交换，跨网段通信依赖（   ）层设备。',
            fields: [
                { label: '同网段依赖', unit: '', answer: ['二', '2', '数据链路'], placeholder: 'OSI 层号' },
                { label: '跨网段依赖', unit: '', answer: ['三', '3', '网络', '路由器'], placeholder: 'OSI 层号 / 设备' },
            ],
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 2：跨网段路由通信（双交换机 + 路由器）
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['inter-subnet'] = {
    id: 'inter-subnet',
    name: '2. 跨网段路由通信（双交换机 + 路由器）',
    steps: [
        { mode: 'find', target: 'r1', msg: '1. 路由器 R1（出厂未配置）：配置两个接口地址后，即可作为 LAN1 / LAN2 的网关，请点击它' },

        {
            mode: 'check',
            msg: '2. 配置 PC1：192.168.1.2/24，网关 192.168.1.1，DNS 192.168.1.1。',
            op: [{ type: 'observe', target: 'pc1', msg: '配置 PC1：IP / 网关 / DNS', async act() { await _demoSetPcNet(this, 'pc1', { ip: '192.168.1.2', mask: '255.255.255.0', gateway: '192.168.1.1', dns: '192.168.1.1' }, '配置 PC1：192.168.1.2/24，网关与 DNS .1'); } }],
            check() { const pc = _comp('pc1'); return !!pc && pc.ip === '192.168.1.2' && pc.gateway === '192.168.1.1' && pc.dns === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '3. 配置 PC2：192.168.1.3/24，网关 192.168.1.1，DNS 192.168.1.1。',
            op: [{ type: 'observe', target: 'pc2', msg: '配置 PC2：IP / 网关 / DNS', async act() { await _demoSetPcNet(this, 'pc2', { ip: '192.168.1.3', mask: '255.255.255.0', gateway: '192.168.1.1', dns: '192.168.1.1' }, '配置 PC2：192.168.1.3/24，网关与 DNS .1'); } }],
            check() { const pc = _comp('pc2'); return !!pc && pc.ip === '192.168.1.3' && pc.dns === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '4. 配置 PC3：192.168.2.2/24，网关 192.168.2.1，DNS 192.168.2.1。',
            op: [{ type: 'observe', target: 'pc3', msg: '配置 PC3：IP / 网关 / DNS', async act() { await _demoSetPcNet(this, 'pc3', { ip: '192.168.2.2', mask: '255.255.255.0', gateway: '192.168.2.1', dns: '192.168.2.1' }, '配置 PC3：192.168.2.2/24，网关与 DNS .1'); } }],
            check() { const pc = _comp('pc3'); return !!pc && pc.ip === '192.168.2.2' && pc.dns === '192.168.2.1'; },
        },
        {
            mode: 'check',
            msg: '5. 配置 PC4：192.168.2.3/24，网关 192.168.2.1，DNS 192.168.2.1。',
            op: [{ type: 'observe', target: 'pc4', msg: '配置 PC4：IP / 网关 / DNS', async act() { await _demoSetPcNet(this, 'pc4', { ip: '192.168.2.3', mask: '255.255.255.0', gateway: '192.168.2.1', dns: '192.168.2.1' }, '配置 PC4：192.168.2.3/24，网关与 DNS .1'); } }],
            check() { const pc = _comp('pc4'); return !!pc && pc.ip === '192.168.2.3' && pc.dns === '192.168.2.1'; },
        },
        {
            mode: 'check',
            msg: '6. 配置路由器 GE0/0/0：192.168.1.1/24（LAN1 网关）。',
            op: [{ type: 'observe', target: 'r1', msg: '双击 R1 →「接口配置」设置 GE0/0/0', async act() { await _demoSetRouterIface(this, 'r1', 'g0', '192.168.1.1', '255.255.255.0', 'GE0/0/0 = 192.168.1.1/24（LAN1 网关）'); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[0].ip === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '7. 配置路由器 GE0/0/1：192.168.2.1/24（LAN2 网关）。',
            op: [{ type: 'observe', target: 'r1', msg: '在「接口配置」设置 GE0/0/1', async act() { await _demoSetRouterIface(this, 'r1', 'g1', '192.168.2.1', '255.255.255.0', 'GE0/0/1 = 192.168.2.1/24（LAN2 网关）'); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[1].ip === '192.168.2.1'; },
        },
        {
            mode: 'check',
            msg: '8. 组网接线：PC1/PC2→SW1，PC3/PC4→SW2，SW1/SW2→R1。',
            op: [
                { type: 'observe', target: 'sw1', msg: 'SW1 接入 PC1、PC2', async act() { const sw = _comp('sw1'); if (sw) await sw.connectPCs(['pc1', 'pc2'], true); } },
                { type: 'observe', target: 'sw2', msg: 'SW2 接入 PC3、PC4', async act() { const sw = _comp('sw2'); if (sw) await sw.connectPCs(['pc3', 'pc4'], true); } },
                { type: 'observe', target: 'r1', msg: '右键 R1 →「连接到选中的交换机/PC」，GE0/0/0→SW1、GE0/0/1→SW2', async act() { const r = _comp('r1'); if (r) await r.connectDevices(['sw1', 'sw2'], true); } },
            ],
            check() {
                const s = _sys();
                return !!s && connectedPCIds(s, _comp('sw1')).length >= 2 && connectedPCIds(s, _comp('sw2')).length >= 2;
            },
        },
        {
            mode: 'check',
            msg: '9. 在 R1 执行 display ip routing-table，查看直连路由。',
            op: [{ type: 'observe', target: 'r1', msg: 'R1 执行 display ip routing-table', async act() { const r = _comp('r1'); if (r) await r.demoCommand('display ip routing-table'); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[0].ip === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '10. PC1 执行 ping 192.168.2.2：跨网段经 R1 转发，应能通（TTL=127）。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC3（跨网段，经路由器）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.2.2'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); const r = runPing(s, pc, '192.168.2.2', 4); return r.reachable && r.hops === 1; },
        },
        {
            mode: 'check',
            msg: '11. PC1 执行 tracert 192.168.2.2，查看数据包经过的路由器。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 执行 tracert，逐跳显示路径', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('tracert 192.168.2.2'); } }],
            check() { const s = _sys(); return !!s && !!_comp('pc1'); },
        },
        {
            mode: 'check',
            msg: '12. PC1 执行 arp -a，查看通过 ARP 学到的地址（网关）。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 执行 arp -a', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('arp -a'); } }],
            check() { const pc = _comp('pc1'); return !!pc; },
        },
        {
            mode: 'check',
            msg: '13. 制造故障：在 R1 关闭 GE0/0/1 接口，模拟链路中断。',
            op: [{ type: 'observe', target: 'r1', msg: 'R1：system-view → interface GE0/0/1 → shutdown', async act() { const r = _comp('r1'); if (r) await r.demoScript(['system-view', 'interface GigabitEthernet0/0/1', 'shutdown']); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[1].up === false; },
        },
        {
            mode: 'check',
            msg: '14. PC1 再次 ping PC3：接口已关闭，提示「无法访问目标主机」。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC3 失败', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.2.2'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && !runPing(s, pc, '192.168.2.2', 4).reachable; },
        },
        {
            mode: 'check',
            msg: '15. 恢复：在 R1 执行 undo shutdown，重新启用 GE0/0/1。',
            op: [{ type: 'observe', target: 'r1', msg: 'R1：interface GE0/0/1 → undo shutdown', async act() { const r = _comp('r1'); if (r) await r.demoScript(['system-view', 'interface GigabitEthernet0/0/1', 'undo shutdown']); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[1].up !== false; },
        },
        {
            mode: 'check',
            msg: '16. PC1 再 ping PC3：恢复连通。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC3 恢复', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.2.2'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '192.168.2.2', 4).reachable; },
        },
        {
            mode: 'quiz',
            msg: '17. 选择题：PC1 能 ping 通 PC3 的关键条件是什么？',
            quizConfig: {
                question: 'PC1（192.168.1.2/24）能 ping 通 PC3（192.168.2.2/24），关键条件是？',
                options: [
                    'PC 配置了正确的网关，且路由器接口分别属于两个网段并能转发',
                    '两台 PC 直接连在同一交换机上',
                    '两台 PC 的 IP 地址相同',
                    '交换机为跨网段流量做了 NAT',
                ],
                answer: 0,
                analysis: '跨网段通信：源 PC 发现目标不在本网段，把报文交给默认网关（路由器接口）；路由器在路由表中查到目标直连网段，从对应接口转发出去。因此需要：① PC 网关正确；② 路由器两个接口地址/掩码正确；③ 链路连通。',
            },
        },
        {
            mode: 'fill',
            msg: '18. 填空题：路由器接口 GE0/0/0 的地址是（   ），PC3 的默认网关是（   ）。',
            fields: [
                { label: 'GE0/0/0 地址', unit: '', answer: '192.168.1.1', placeholder: 'LAN1 网关' },
                { label: 'PC3 默认网关', unit: '', answer: '192.168.2.1', placeholder: 'LAN2 网关' },
            ],
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 3：静态路由配置与路由表
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['static-route'] = {
    id: 'static-route',
    name: '3. 静态路由配置与路由表',
    steps: [
        { mode: 'find', target: 'r1', msg: '1. 路由器 R1：通过路由表决定报文从哪个接口转发，请点击它' },
        {
            mode: 'check',
            msg: '2. 配置 R1 的 GE0/0/0 地址 192.168.1.1/24，形成直连路由。',
            op: [{ type: 'observe', target: 'r1', msg: '配置 GE0/0/0 = 192.168.1.1/24', async act() { await _demoSetRouterIface(this, 'r1', 'g0', '192.168.1.1', '255.255.255.0', 'GE0/0/0 = 192.168.1.1/24'); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[0].ip === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '3. 配置 R1 的 GE0/0/1 地址 192.168.2.1/24。',
            op: [{ type: 'observe', target: 'r1', msg: '配置 GE0/0/1 = 192.168.2.1/24', async act() { await _demoSetRouterIface(this, 'r1', 'g1', '192.168.2.1', '255.255.255.0', 'GE0/0/1 = 192.168.2.1/24'); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[1].ip === '192.168.2.1'; },
        },
        {
            mode: 'check',
            msg: '4. 查看当前路由表：只有两条直连路由。',
            op: [{ type: 'observe', target: 'r1', msg: 'R1 执行 display ip routing-table', async act() { const r = _comp('r1'); if (r) await r.demoCommand('display ip routing-table'); } }],
            check() { const r = _comp('r1'); return !!r; },
        },
        {
            mode: 'check',
            msg: '5. 添加一条静态路由：目标 192.168.9.0/24，下一跳 192.168.2.2。',
            op: [{
                type: 'observe', target: 'r1', msg: 'R1：ip route-static 192.168.9.0 255.255.255.0 192.168.2.2',
                async act() { const r = _comp('r1'); if (r) await r.demoScript(['system-view', 'ip route-static 192.168.9.0 255.255.255.0 192.168.2.2']); },
            }],
            check() { const r = _comp('r1'); return !!r && r.routes.some(x => x.net === '192.168.9.0' && x.nextHop === '192.168.2.2'); },
        },
        {
            mode: 'check',
            msg: '6. 再次查看路由表：新增一条 Static 路由。',
            op: [{ type: 'observe', target: 'r1', msg: 'R1 执行 display ip routing-table 查看静态路由', async act() { const r = _comp('r1'); if (r) await r.demoCommand('display ip routing-table'); } }],
            check() { const r = _comp('r1'); return !!r && r.routes.length >= 1; },
        },
        {
            mode: 'check',
            msg: '7. 删除该静态路由，恢复原状。',
            op: [{
                type: 'observe', target: 'r1', msg: 'R1 执行 undo ip route-static 删除静态路由',
                async act() { const r = _comp('r1'); if (r) { r.routes = []; r.onConfigUpdate({}); await r.demoCommand('display ip routing-table'); } },
            }],
            check() { const r = _comp('r1'); return !!r && r.routes.length === 0; },
        },
        {
            mode: 'quiz',
            msg: '8. 选择题：关于直连路由与静态路由，说法正确的是？',
            quizConfig: {
                question: '路由器配置接口 IP 后自动产生直连路由；静态路由需要管理员手工配置。下列说法正确的是？',
                options: [
                    '直连路由自动生成，静态路由需手工指定目标网段与下一跳',
                    '静态路由会自动生成，无需配置',
                    '直连路由必须手工添加',
                    '静态路由的下一跳可以是任意 IP，无需可达',
                ],
                answer: 0,
                analysis: '路由器为每个已配置且 UP 的接口自动生成一条直连路由（目标为该接口网段）。静态路由由管理员用 ip route-static 手工配置，格式为「目标网段 掩码 下一跳」；下一跳必须与某个直连网段可达，否则路由不生效。',
            },
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 4：VLAN 隔离 + 交换机管理地址配置
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['vlan-isolation'] = {
    id: 'vlan-isolation',
    name: '4. VLAN 隔离与交换机管理地址',
    steps: [
        { mode: 'find', target: 'sw1', msg: '1. 交换机 SW1（出厂未配置管理地址）：可通过 VLAN 划分广播域，请点击它' },
        {
            mode: 'check',
            msg: '2. 配置 PC1：192.168.1.2/24（同网段，无需网关）。',
            op: [{ type: 'observe', target: 'pc1', msg: '配置 PC1：192.168.1.2/24', async act() { await _demoSetPcNet(this, 'pc1', { ip: '192.168.1.2', mask: '255.255.255.0' }, '配置 PC1 的 IP 与掩码'); } }],
            check() { const pc = _comp('pc1'); return !!pc && pc.ip === '192.168.1.2'; },
        },
        {
            mode: 'check',
            msg: '3. 配置 PC2：192.168.1.3/24。',
            op: [{ type: 'observe', target: 'pc2', msg: '配置 PC2：192.168.1.3/24', async act() { await _demoSetPcNet(this, 'pc2', { ip: '192.168.1.3', mask: '255.255.255.0' }, '配置 PC2 的 IP 与掩码'); } }],
            check() { const pc = _comp('pc2'); return !!pc && pc.ip === '192.168.1.3'; },
        },
        {
            mode: 'check',
            msg: '4. 把 PC1、PC2 接入 SW1（默认都在 VLAN 1）。',
            op: [{ type: 'observe', target: 'sw1', msg: 'SW1 接入 PC1、PC2', async act() { const sw = _comp('sw1'); if (sw) await sw.connectPCs(['pc1', 'pc2'], true); } }],
            check() { const s = _sys(); const sw = _comp('sw1'); return !!s && !!sw && connectedPCIds(s, sw).length >= 2; },
        },
        {
            mode: 'check',
            msg: '5. PC1 ping PC2：同 VLAN、同网段，应能通。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC2（同 VLAN）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.1.3'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '192.168.1.3', 4).reachable; },
        },
        {
            mode: 'check',
            msg: '6. 配置交换机管理地址（VLAN 虚接口）：system-view → interface Vlanif 1 → ip address 192.168.1.254 24。',
            op: [{
                type: 'observe', target: 'sw1', msg: 'SW1 配置 Vlanif1 管理地址',
                async act() { const sw = _comp('sw1'); if (sw) await sw.demoScript(['system-view', 'interface Vlanif 1', 'ip address 192.168.1.254 24', 'quit', 'display ip interface brief']); },
            }],
            check() { const sw = _comp('sw1'); return !!sw && sw.ip === '192.168.1.254'; },
        },
        {
            mode: 'check',
            msg: '7. 四台设备已在同一 VLAN：PC1 ping 交换机管理地址 192.168.1.254，应能通。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping 交换机管理地址 192.168.1.254', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.1.254'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '192.168.1.254', 4).reachable; },
        },
        {
            mode: 'check',
            msg: '8. 在 SW1 上新建 VLAN 10，并把连接 PC2 的端口 Ethernet0/0/2 划入 VLAN 10。',
            op: [{
                type: 'observe', target: 'sw1', msg: 'SW1：vlan 10，interface Ethernet0/0/2，port default vlan 10',
                async act() { const sw = _comp('sw1'); if (sw) await sw.demoScript(['system-view', 'vlan 10', 'interface Ethernet0/0/2', 'port default vlan 10']); },
            }],
            check() { const sw = _comp('sw1'); return !!sw && sw.getPortVlan('eth2') === 10; },
        },
        {
            mode: 'check',
            msg: '9. PC1 再 ping PC2：IP 仍同网段，但已不在同一 VLAN（广播域），提示「请求超时」。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC2 失败（VLAN 隔离）', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.1.3'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); const r = runPing(s, pc, '192.168.1.3', 4); return !!s && !!pc && !r.reachable && r.reason === 'timeout'; },
        },
        {
            mode: 'check',
            msg: '10. 把端口改回 VLAN 1，恢复同一广播域。',
            op: [{
                type: 'observe', target: 'sw1', msg: 'SW1：interface Ethernet0/0/2，port default vlan 1',
                async act() { const sw = _comp('sw1'); if (sw) await sw.demoScript(['system-view', 'interface Ethernet0/0/2', 'port default vlan 1']); },
            }],
            check() { const sw = _comp('sw1'); return !!sw && sw.getPortVlan('eth2') === 1; },
        },
        {
            mode: 'check',
            msg: '11. PC1 再 ping PC2：VLAN 相同，恢复连通。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 ping PC2 恢复', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ping 192.168.1.3'); } }],
            check() { const s = _sys(); const pc = _comp('pc1'); return !!s && !!pc && runPing(s, pc, '192.168.1.3', 4).reachable; },
        },
        {
            mode: 'quiz',
            msg: '12. 选择题：交换机的管理地址配置在哪里？',
            quizConfig: {
                question: '二层交换机要配置管理 IP，通常配置在什么接口上？',
                options: [
                    '管理 VLAN 的 VLANIF 虚接口（如 interface Vlanif 1）',
                    '任意一个物理以太网口上',
                    'Console 控制台口上',
                    '不需要配置，交换机默认就有一个管理 IP',
                ],
                answer: 0,
                analysis: '二层交换机的端口是二层口，不能直接配 IP。要给交换机配管理地址，需先创建/使用管理 VLAN（默认 VLAN 1）的三层虚接口 VLANIF，再用 interface Vlanif 1 + ip address 配置。同 VLAN 内的主机即可通过该地址管理交换机。',
            },
        },
    ],
};

// ═════════════════════════════════════════════════════════════════════════
// 流程 5：DHCP 自动获取地址
// ═════════════════════════════════════════════════════════════════════════
PROJECT_WORKFLOWS['dhcp'] = {
    id: 'dhcp',
    name: '5. DHCP 自动获取地址',
    steps: [
        { mode: 'find', target: 'pc1', msg: '1. PC1（出厂未配置）：可设置为「自动获取 IP（DHCP）」，请点击它' },
        { mode: 'find', target: 'r1', msg: '2. 路由器 R1：配置接口地址后可作为 DHCP 服务器，请点击它' },
        {
            mode: 'check',
            msg: '3. 配置 R1 的 GE0/0/0 地址 192.168.1.1/24（DHCP 服务器的网关）。',
            op: [{ type: 'observe', target: 'r1', msg: '配置 GE0/0/0 = 192.168.1.1/24', async act() { await _demoSetRouterIface(this, 'r1', 'g0', '192.168.1.1', '255.255.255.0', 'GE0/0/0 = 192.168.1.1/24'); } }],
            check() { const r = _comp('r1'); return !!r && r.interfaces[0].ip === '192.168.1.1'; },
        },
        {
            mode: 'check',
            msg: '4. 接线：PC1 接入 SW1，SW1 上行连接 R1。',
            op: [
                { type: 'observe', target: 'sw1', msg: 'SW1 接入 PC1', async act() { const sw = _comp('sw1'); if (sw) await sw.connectPCs(['pc1'], true); } },
                { type: 'observe', target: 'r1', msg: 'R1 连接 SW1', async act() { const r = _comp('r1'); if (r) await r.connectDevices(['sw1'], true); } },
            ],
            check() { const s = _sys(); return !!s && (s.conns || []).length >= 2; },
        },
        {
            mode: 'check',
            msg: '5. 在 R1 的 DHCP 界面启用 DHCP 服务（地址池由 GE0/0/0 网段自动生成）。',
            op: [{ type: 'observe', target: 'r1', msg: '双击 R1 →「DHCP」页，勾选启用并保存', async act() { await _demoSetRouterDhcp(this, 'r1', true, '启用 DHCP 服务'); } }],
            check() { const r = _comp('r1'); return !!r && r.dhcpEnabled === true; },
        },
        {
            mode: 'check',
            msg: '6. 双击 PC1，在「TCP/IP 设置」中勾选「启用 DHCP」并保存，自动获取地址。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 启用 DHCP 并保存，自动获取地址', async act() { await _demoSetPcDhcp(this, 'pc1', true, '勾选「启用 DHCP（自动获取 IP）」并保存'); } }],
            check() { const pc = _comp('pc1'); return !!pc && pc.dhcp === true && /^192\.168\.1\./.test(pc.ip || ''); },
        },
        {
            mode: 'check',
            msg: '7. PC1 执行 ipconfig /all，查看自动获取的地址与 DHCP 状态。',
            op: [{ type: 'observe', target: 'pc1', msg: 'PC1 执行 ipconfig /all', async act() { const pc = _comp('pc1'); if (pc) await pc.demoCommand('ipconfig /all'); } }],
            check() { const pc = _comp('pc1'); return !!pc && !!pc.ip; },
        },
        {
            mode: 'check',
            msg: '8. 在 R1 执行 display ip pool，查看地址池分配情况。',
            op: [{ type: 'observe', target: 'r1', msg: 'R1 执行 display ip pool', async act() { const r = _comp('r1'); if (r) await r.demoCommand('display ip pool'); } }],
            check() { const r = _comp('r1'); return !!r && r.dhcpEnabled === true; },
        },
        {
            mode: 'fill',
            msg: '9. 填空题：DHCP 的作用是（   ）分配 IP 地址；交换机管理地址配置在（   ）虚接口上。',
            fields: [
                { label: 'DHCP 作用', unit: '', answer: ['自动', '动态'], placeholder: '自动 / 手动' },
                { label: '管理地址配置在', unit: '', answer: ['Vlanif', 'VLANIF', 'VLAN', 'vlanif'], placeholder: '接口类型' },
            ],
        },
    ],
};

export function initSlider(_sys) { }

export function applyAllPresets() { }

export async function applyStartSystem() { }

export function fiveStep() { }
