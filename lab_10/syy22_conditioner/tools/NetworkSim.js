// NetworkSim.js — 组网仿真逻辑（纯逻辑，无 DOM）
//
// 设备模型（基于平台的 sys.conns，type === 'wire'）：
//   PC       ：一个以太网口（端口 id: <pcId>_wire_lan）
//   二层交换机：N 个以太网口（端口 id: <swId>_wire_ethN），按 VLAN 划分广播域；
//              端口可为 access（单 VLAN）或 trunk（多 VLAN）；管理 IP 位于 VLAN 1
//   三层交换机：以太网口 + VLANIF 虚接口；既做二层转发，又做 VLAN 间路由/上联路由
//   路由器   ：N 个三层接口（端口 id: <rId>_wire_<gN>），每个接口独立属一个广播域
//   服务器   ：一个以太网口（端口 id: <srvId>_wire_lan）
//
// 二层：VLAN 感知的连通分量。同一 (设备#VLAN) 桥节点内的端口互通；两台交换机之间
//       按端口 VLAN 集合的交集建桥；PC/路由器接口接入所连交换机端口的 VLAN。
// 三层：直连网段 + 静态路由 + RIP/OSPF 动态路由，最长前缀匹配（同前缀按管理距离优选）；
//       跨网段经网关逐跳转发。NAT（easy-ip/PAT）记录私网到公网的会话。
//
// 说明：网络连线复用平台 'wire' 类型以复用 Renderer 绘制；电路求解器按已知 type
//       分组建模，pc / net_switch / l3_switch / router / net_server 无 stamp，
//       其端口只会构成孤立节点，不影响求解。

export const LINK_TYPE = 'wire';
export const PC_TYPE = 'pc';
export const SWITCH_TYPE = 'net_switch';
export const L3SWITCH_TYPE = 'l3_switch';
export const ROUTER_TYPE = 'router';
export const SERVER_TYPE = 'net_server';
export const PLC_TYPE = 'plc_s7200';   // 西门子 S7-200 SMART（带以太网口）

/** 路由设备（三层设备）类型 */
function isRoutingDevice(c) { return !!c && (c.type === ROUTER_TYPE || c.type === L3SWITCH_TYPE); }
/** 交换类设备（带 VLAN 转发能力）类型 */
function isSwitchLike(c) { return !!c && (c.type === SWITCH_TYPE || c.type === L3SWITCH_TYPE); }
/** 终端主机类（PC / 服务器） */
function isHostLike(c) { return !!c && (c.type === PC_TYPE || c.type === SERVER_TYPE); }

/** 从端口 id 解析所属设备 id（兼容 _wire_ / _pipe_ 约定） */
export function deviceIdOfPort(portId) {
    if (!portId) return '';
    if (portId.includes('_wire_')) return portId.split('_wire_')[0];
    if (portId.includes('_pipe_')) return portId.split('_pipe_')[0];
    return String(portId).split('_')[0];
}

export function pcPortId(pcId) { return `${pcId}_wire_lan`; }
export function serverPortId(id) { return `${id}_wire_lan`; }
export function switchPortId(swId, n) { return `${swId}_wire_eth${n}`; }

export function collectPCs(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === PC_TYPE);
}
export function collectSwitches(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === SWITCH_TYPE);
}
export function collectL3Switches(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === L3SWITCH_TYPE);
}
export function collectRouters(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === ROUTER_TYPE);
}
export function collectServers(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === SERVER_TYPE);
}
/** PLC（带以太网口的主机） */
export function collectPLCs(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === PLC_TYPE);
}
/** 所有三层设备（路由器 + 三层交换机） */
export function collectRoutingDevices(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => isRoutingDevice(c));
}

// ─── IPv4 工具 ───────────────────────────────────────────────

export function ipToInt(ip) {
    const s = String(ip || '').trim();
    const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    const o = m.slice(1).map(Number);
    if (o.some(n => n < 0 || n > 255)) return null;
    return (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0;
}
export function intToIp(n) {
    const x = (n >>> 0);
    return [(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff].join('.');
}
export function isValidIp(ip) { return ipToInt(ip) !== null; }

/** 校验子网掩码：必须为“连续 1 + 连续 0” */
export function isValidMask(mask) {
    const n = ipToInt(mask);
    if (n === null || n === 0) return false;
    const inv = (~n) >>> 0;
    return ((inv + 1) & inv) === 0;
}
/** 校验路由掩码：允许 0.0.0.0（默认路由），其余同子网掩码 */
export function isValidRouteMask(mask) {
    const n = ipToInt(mask);
    if (n === null) return false;
    if (n === 0) return true;
    const inv = (~n) >>> 0;
    return ((inv + 1) & inv) === 0;
}
export function inSameSubnet(ipA, maskA, ipB) {
    const a = ipToInt(ipA), b = ipToInt(ipB), m = ipToInt(maskA);
    if (a === null || b === null || m === null) return false;
    return ((a & m) >>> 0) === ((b & m) >>> 0);
}
/** 掩码前缀长度，如 255.255.255.0 → 24 */
export function maskPrefix(mask) {
    const n = ipToInt(mask);
    if (n === null) return 0;
    let c = 0;
    for (let i = 31; i >= 0; i--) { if ((n >>> i) & 1) c++; else break; }
    return c;
}
/** 网络地址：ip & mask */
export function networkOf(ip, mask) {
    const a = ipToInt(ip), m = ipToInt(mask);
    if (a === null || m === null) return null;
    return intToIp((a & m) >>> 0);
}
/** 通配符掩码（反掩码）：0.0.0.255 ↔ /24 */
export function wildcardToMask(wc) {
    const n = ipToInt(wc);
    if (n === null) return null;
    return intToIp((~n) >>> 0);
}
export function maskToWildcard(mask) {
    const n = ipToInt(mask);
    if (n === null) return null;
    return intToIp((~n) >>> 0);
}

// ─── MAC 地址 ────────────────────────────────────────────────

function fnv1a(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
function macFromSeed(seed) {
    const h = fnv1a(seed);
    const hex = n => n.toString(16).toUpperCase().padStart(2, '0');
    return `00-1A-2B-${hex((h >>> 16) & 0xff)}-${hex((h >>> 8) & 0xff)}-${hex(h & 0xff)}`;
}
/** 由设备 id 生成稳定的 MAC（00-1A-2B-xx-xx-xx） */
export function macOf(comp) {
    if (!comp) return '00-1A-2B-00-00-00';
    if (comp.mac) return comp.mac;
    const mac = macFromSeed(String(comp.id || 'dev'));
    comp.mac = mac;
    return mac;
}
/** 路由器/三层交换机接口 MAC（每接口独立） */
export function macOfInterface(comp, ifaceName) {
    if (!comp) return '00-1A-2B-00-00-00';
    return macFromSeed(`${comp.id}#${ifaceName || ''}`);
}

// ─── 接口模型 ────────────────────────────────────────────────

/**
 * 收集一个设备的三层接口（统一结构）：
 *  { key, comp, compId, kind, name, label, ip, mask, gateway, up, portId, ifaceName, vlanId, cost }
 * key 为二层图中的端点节点名。
 */
export function getInterfaces(sys, comp) {
    if (!comp) return [];
    if (comp.type === PC_TYPE) {
        return [{
            key: comp.id, comp, compId: comp.id, kind: 'pc',
            name: 'lan', label: comp.hostname || comp.id,
            ip: comp.ip, mask: comp.mask || '255.255.255.0', gateway: comp.gateway || '',
            up: true, portId: `${comp.id}_wire_lan`, ifaceName: null,
        }];
    }
    if (comp.type === SERVER_TYPE) {
        return [{
            key: comp.id, comp, compId: comp.id, kind: 'server',
            name: 'eth0', label: comp.hostname || comp.id,
            ip: comp.ip, mask: comp.mask || '255.255.255.0', gateway: comp.gateway || '',
            up: true, portId: `${comp.id}_wire_lan`, ifaceName: null,
        }];
    }
    if (comp.type === PLC_TYPE) {
        return [{
            key: comp.id, comp, compId: comp.id, kind: 'plc',
            name: 'pn', label: comp.hostname || comp.label || comp.id,
            ip: comp.ip, mask: comp.mask || '255.255.255.0', gateway: comp.gateway || '',
            up: true, portId: `${comp.id}_wire_lan`, ifaceName: null,
        }];
    }
    if (comp.type === SWITCH_TYPE) {
        return [{
            key: `${comp.id}#v1`, comp, compId: comp.id, kind: 'switch',
            name: 'Vlanif1', label: comp.hostname || comp.id,
            ip: comp.ip, mask: comp.mask || '255.255.255.0', gateway: comp.gateway || '',
            up: true, portId: null, ifaceName: null, vlanId: 1,
        }];
    }
    if (comp.type === L3SWITCH_TYPE) {
        return (comp.interfaces || []).filter(f => f.vlanId !== undefined || f.ip).map(f => ({
            key: `${comp.id}#${f.name}`, comp, compId: comp.id, kind: 'l3switch',
            name: f.name, label: comp.hostname || comp.id,
            ip: f.ip, mask: f.mask || '255.255.255.0', gateway: '',
            up: f.up !== false, portId: f.portId || null, ifaceName: f.name,
            vlanId: f.vlanId, cost: f.cost,
        }));
    }
    if (comp.type === ROUTER_TYPE) {
        return (comp.interfaces || []).map(f => ({
            key: `${comp.id}#${f.name}`, comp, compId: comp.id, kind: 'router',
            name: f.name, label: comp.hostname || comp.id,
            ip: f.ip, mask: f.mask || '255.255.255.0', gateway: '',
            up: f.up !== false, portId: f.portId, ifaceName: f.name, cost: f.cost,
        }));
    }
    return [];
}

/** 全工程所有三层接口 */
export function allInterfaces(sys) {
    const out = [];
    for (const comp of [...collectPCs(sys), ...collectServers(sys), ...collectPLCs(sys),
        ...collectSwitches(sys), ...collectL3Switches(sys), ...collectRouters(sys)]) {
        out.push(...getInterfaces(sys, comp));
    }
    return out;
}

/** 按 IP 查找接口 */
export function findInterfaceByIp(sys, ip) {
    const t = String(ip || '').trim();
    if (!t) return null;
    return allInterfaces(sys).find(f => String(f.ip || '').trim() === t) || null;
}

/** 按 IP 查找主机设备（PC / 服务器 / 交换机 / 三层设备） */
export function findHostByIp(sys, ip) {
    const f = findInterfaceByIp(sys, ip);
    return f ? f.comp : null;
}

// ─── 二层拓扑（VLAN 感知，支持 trunk）────────────────────────

/**
 * 端口所属 VLAN 集合。
 * 交换机/三层交换机端口 → access 单 VLAN 或 trunk 多 VLAN；其它设备 → [1]（由对端决定）。
 */
export function portVlansOf(sys, comp, portId) {
    if (!comp) return [1];
    if (typeof comp.getPortVlansByPortId === 'function') {
        const vs = comp.getPortVlansByPortId(portId);
        if (Array.isArray(vs) && vs.length) return vs;
    }
    if (isSwitchLike(comp)) {
        if (typeof comp.getPortVlanByPortId === 'function') {
            const v = comp.getPortVlanByPortId(portId);
            if (v) return [v];
        }
        return [1];
    }
    return [1];
}

/** 端口所属 VLAN（取集合中的第一个，兼容旧 API） */
export function portVlan(sys, comp, portId) {
    const vs = portVlansOf(sys, comp, portId);
    return vs.length ? vs[0] : 1;
}

/** 端口在二层图中对应的节点名（非交换类设备） */
export function portToEndpoint(sys, portId) {
    const devId = deviceIdOfPort(portId);
    const comp = sys && sys.comps ? sys.comps[devId] : null;
    if (!comp) return null;
    if (comp.type === ROUTER_TYPE || comp.type === L3SWITCH_TYPE) {
        // 三层设备按接口 portId 定位端点；三层交换机的物理口由 VLAN 桥处理，此处不适用
        const f = (comp.interfaces || []).find(x => x.portId === portId);
        return f ? `${comp.id}#${f.name}` : null;
    }
    return comp.id;   // PC / 服务器整机
}

/**
 * 构建二层连通图（VLAN 感知）：
 *   节点：PC/服务器端点 / 路由器接口端点 / 三层交换机 VLANIF 端点 /
 *         交换机(和三层交换机)的 (设备#VLAN) 桥节点
 *   边  ：有线连接。交换类设备之间按端口 VLAN 集合的交集建桥；
 *         交换类设备端口 ↔ 主机端点并入其 VLAN。
 *
 *   topology = { adj: Map<node, Set<node>> }
 */
export function buildTopology(sys) {
    const adj = new Map();
    const ensure = (id) => { if (!adj.has(id)) adj.set(id, new Set()); return adj.get(id); };
    const link = (a, b) => { if (!a || !b || a === b) return; ensure(a).add(b); ensure(b).add(a); };

    const comps = {};
    [...collectPCs(sys), ...collectServers(sys), ...collectPLCs(sys), ...collectSwitches(sys),
        ...collectL3Switches(sys), ...collectRouters(sys)].forEach(c => { comps[c.id] = c; });

    const isNetConn = (conn) => conn && conn.type === LINK_TYPE && !conn.custom;

    for (const conn of (sys && sys.conns ? sys.conns : [])) {
        if (!isNetConn(conn)) continue;
        const aId = deviceIdOfPort(conn.from);
        const bId = deviceIdOfPort(conn.to);
        const A = comps[aId], B = comps[bId];
        if (!A || !B || aId === bId) continue;

        const aSw = isSwitchLike(A), bSw = isSwitchLike(B);
        const aVs = aSw ? portVlansOf(sys, A, conn.from) : null;
        const bVs = bSw ? portVlansOf(sys, B, conn.to) : null;

        if (aSw && bSw) {
            const inter = aVs.filter(v => bVs.includes(v));
            for (const v of inter) link(`${A.id}#v${v}`, `${B.id}#v${v}`);
        } else if (aSw) {
            const nodeB = portToEndpoint(sys, conn.to);
            for (const v of aVs) link(`${A.id}#v${v}`, nodeB);
        } else if (bSw) {
            const nodeA = portToEndpoint(sys, conn.from);
            for (const v of bVs) link(`${B.id}#v${v}`, nodeA);
        } else {
            link(portToEndpoint(sys, conn.from), portToEndpoint(sys, conn.to));
        }
    }

    // 三层交换机的 VLANIF 端点并入对应 VLAN 桥节点（VLAN 间路由/上联的出口）
    for (const l3 of collectL3Switches(sys)) {
        for (const f of (l3.interfaces || [])) {
            if (f.vlanId === undefined || f.vlanId === null) continue;
            if (f.up === false) continue;
            link(`${l3.id}#${f.name}`, `${l3.id}#v${f.vlanId}`);
        }
    }
    return { adj };
}

function reachableIn(adj, epA, epB) {
    if (!epA || !epB) return false;
    if (epA === epB) return true;
    if (!adj.has(epA) || !adj.has(epB)) return false;
    const seen = new Set([epA]);
    const queue = [epA];
    while (queue.length) {
        const cur = queue.shift();
        for (const nb of adj.get(cur) || []) {
            if (nb === epB) return true;
            if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
        }
    }
    return false;
}

/** 两个二层端点是否连通（可经交换机、同一 VLAN）；可传入已构建的 topology 复用 */
export function isL2Reachable(sys, epA, epB, topo) {
    if (epA && epB && epA === epB) return true;
    const t = topo || buildTopology(sys);
    return reachableIn(t.adj, epA, epB);
}

/**
 * 从某主机（通常为 STEP7 上位机 PC）出发，发现**同一二层广播域**内的 PLC。
 *  - 直连：PC 网口与 PLC 网口同线 → 发现该 PLC
 *  - 经交换机：PC — 交换机 — 多台 PLC → 全部列出
 * @returns {Array<{id,label,ip,mask,mac,computerName,comp,viaSwitch}>}
 */
export function discoverPlcs(sys, fromComp, topo) {
    const t = topo || buildTopology(sys);
    const here = fromComp ? fromComp.id : null;
    // 直接对端是否为交换类设备（判断“经交换机”）
    let directViaSwitch = false;
    if (fromComp) {
        const peerId = peerOfPort(sys, `${fromComp.id}_wire_lan`);
        const peer = peerId ? sys.comps[peerId] : null;
        directViaSwitch = isSwitchLike(peer);
    }
    const out = [];
    for (const plc of collectPLCs(sys)) {
        const reachable = !here || isL2Reachable(sys, here, plc.id, t);
        if (!reachable) continue;
        out.push({
            id: plc.id,
            label: plc.hostname || plc.label || plc.id,
            ip: plc.ip || '',
            mask: plc.mask || '255.255.255.0',
            mac: macOf(plc),
            viaSwitch: directViaSwitch,
            comp: plc,
        });
    }
    return out;
}

/** 交换机/三层交换机上已连接的 PC id 列表 */
export function connectedPCIds(sys, sw) {
    const ids = new Set();
    for (const conn of (sys && sys.conns ? sys.conns : [])) {
        if (!conn || conn.type !== LINK_TYPE) continue;
        const a = deviceIdOfPort(conn.from), b = deviceIdOfPort(conn.to);
        const peer = a === sw.id ? b : (b === sw.id ? a : null);
        if (peer && sys.comps[peer] && sys.comps[peer].type === PC_TYPE) ids.add(peer);
    }
    return [...ids];
}

/** 端口当前连接的对端设备 id（无则 null） */
export function peerOfPort(sys, portId) {
    for (const conn of (sys && sys.conns ? sys.conns : [])) {
        if (!conn || conn.type !== LINK_TYPE) continue;
        if (conn.from === portId) return deviceIdOfPort(conn.to);
        if (conn.to === portId) return deviceIdOfPort(conn.from);
    }
    return null;
}
export function peerOfSwitchPort(sys, portId) { return peerOfPort(sys, portId); }

/** 某端口连接的对端设备（对象） */
export function peerCompOfPort(sys, portId) {
    const id = peerOfPort(sys, portId);
    return id ? (sys.comps[id] || null) : null;
}

// ─── 路由表 ─────────────────────────────────────────────────

/** 管理距离：直连 0 / OSPF 10 / 静态 60 / RIP 100 */
export const ADMIN_DISTANCE = { direct: 0, ospf: 10, static: 60, rip: 100 };

/**
 * 路由设备（路由器/三层交换机）的路由表：直连 + 静态 + RIP/OSPF 动态。
 * 条目：{ net, mask, prefix, type:'direct'|'static'|'rip'|'ospf', ad, iface?, nextHop?, metric? }
 */
export function routingTable(comp) {
    const table = [];
    if (!isRoutingDevice(comp)) return table;

    for (const f of (comp.interfaces || [])) {
        if (f.up === false) continue;
        if (!isValidIp(f.ip) || !isValidMask(f.mask)) continue;
        const iface = {
            key: `${comp.id}#${f.name}`, comp, compId: comp.id, kind: comp.type,
            name: f.name, label: comp.hostname || comp.id,
            ip: f.ip, mask: f.mask, gateway: '', up: f.up !== false,
            portId: f.portId || null, ifaceName: f.name, vlanId: f.vlanId, cost: f.cost,
        };
        table.push({
            net: networkOf(f.ip, f.mask), mask: f.mask, prefix: maskPrefix(f.mask),
            type: 'direct', ad: ADMIN_DISTANCE.direct, iface,
        });
    }
    for (const r of (comp.routes || [])) {
        if (!isValidIp(r.net) || !isValidRouteMask(r.mask) || !isValidIp(r.nextHop)) continue;
        table.push({
            net: networkOf(r.net, r.mask), mask: r.mask, prefix: maskPrefix(r.mask),
            type: 'static', ad: ADMIN_DISTANCE.static, nextHop: r.nextHop,
        });
    }

    // 动态路由（RIP / OSPF）
    const dyn = (comp.sys) ? dynamicRouteTables(comp.sys) : null;
    const d = dyn ? dyn[comp.id] : null;
    if (d) {
        for (const e of d.rip) table.push({ ...e });
        for (const e of d.ospf) table.push({ ...e });
    }
    return table;
}

/** 最长前缀匹配（同前缀按管理距离优选，数值小的优先） */
export function longestPrefixMatch(table, dstIp) {
    const d = ipToInt(dstIp);
    if (d === null) return null;
    let best = null;
    for (const e of table) {
        const n = ipToInt(e.net), m = ipToInt(e.mask);
        if (n === null || m === null) continue;
        if (((d & m) >>> 0) === (n >>> 0)) {
            if (!best) best = e;
            else if (e.prefix > best.prefix) best = e;
            else if (e.prefix === best.prefix && (e.ad || 0) < (best.ad || 0)) best = e;
        }
    }
    return best;
}

// ─── 动态路由：RIP / OSPF ────────────────────────────────────

function ifaceCost(iface) {
    return (iface && typeof iface.cost === 'number' && iface.cost > 0) ? iface.cost : 1;
}

/**
 * 构建路由设备间的“路由邻接图”。
 * 两台三层设备的接口若二层可达（同一广播域），即互为邻居。
 * @param {Function} pred 过滤参与动态路由的设备
 */
function buildAdjacency(sys, pred) {
    const devs = collectRoutingDevices(sys).filter(pred);
    const adj = new Map();
    devs.forEach(d => adj.set(d.id, []));
    if (devs.length < 2) return { devs, adj };
    const topo = buildTopology(sys);
    for (let i = 0; i < devs.length; i++) {
        for (let j = i + 1; j < devs.length; j++) {
            const A = devs[i], B = devs[j];
            const aIfs = getInterfaces(sys, A).filter(f => f.up !== false && isValidIp(f.ip));
            const bIfs = getInterfaces(sys, B).filter(f => f.up !== false && isValidIp(f.ip));
            for (const a of aIfs) {
                for (const b of bIfs) {
                    if (isL2Reachable(sys, a.key, b.key, topo)) {
                        adj.get(A.id).push({ nb: B, selfIf: a, peerIf: b, cost: ifaceCost(a) });
                        adj.get(B.id).push({ nb: A, selfIf: b, peerIf: a, cost: ifaceCost(b) });
                    }
                }
            }
        }
    }
    return { devs, adj };
}

/** 该设备是否宣告某直连网段（RIP：受 ripNetworks 限制；未配置则宣告全部） */
function ripAdvertises(d, iface) {
    if (!d.ripEnabled) return false;
    if (!Array.isArray(d.ripNetworks) || !d.ripNetworks.length) return true;
    const net = networkOf(iface.ip, iface.mask);
    return d.ripNetworks.some(n => String(n).trim() === net);
}

function directNetsOf(sys, d, filter) {
    return getInterfaces(sys, d)
        .filter(f => f.up !== false && isValidIp(f.ip) && isValidMask(f.mask))
        .filter(f => (filter ? filter(f) : true))
        .map(f => ({ net: networkOf(f.ip, f.mask), mask: f.mask, prefix: maskPrefix(f.mask), iface: f }));
}

/** 同一目标网段仅保留度量最优的一条（去重） */
function dedupeRoutes(list) {
    const best = new Map();
    for (const e of list) {
        const k = `${e.net}/${e.mask}`;
        const prev = best.get(k);
        if (!prev || e.metric < prev.metric) best.set(k, e);
    }
    return [...best.values()];
}

/**
 * RIP（距离向量）：以“跳数”为度量，逐跳扩散各设备的直连网段。
 * @returns {{[compId]: Array}} 每个设备学到的 RIP 路由条目
 */
export function computeRIP(sys) {
    const { devs, adj } = buildAdjacency(sys, d => !!d.ripEnabled);
    const out = {};
    devs.forEach(d => { out[d.id] = []; });
    for (const origin of devs) {
        for (const N of directNetsOf(sys, origin, f => ripAdvertises(origin, f))) {
            const visited = new Map();
            visited.set(origin.id, { metric: 0, nextHop: null, selfIf: N.iface });
            const queue = [origin.id];
            while (queue.length) {
                const curId = queue.shift();
                const info = visited.get(curId);
                if (info.metric >= 15) continue;
                for (const edge of (adj.get(curId) || [])) {
                    const nm = info.metric + 1;
                    const prev = visited.get(edge.nb.id);
                    if (!prev || prev.metric > nm) {
                        visited.set(edge.nb.id, { metric: nm, nextHop: edge.selfIf.ip, selfIf: edge.peerIf });
                        queue.push(edge.nb.id);
                    }
                }
            }
            for (const [id, info] of visited) {
                if (id === origin.id || !info.nextHop) continue;
                out[id].push({
                    net: N.net, mask: N.mask, prefix: N.prefix, type: 'rip',
                    ad: ADMIN_DISTANCE.rip, metric: info.metric, nextHop: info.nextHop,
                    ifaceName: info.selfIf ? info.selfIf.name : '',
                });
            }
        }
    }
    for (const id in out) out[id] = dedupeRoutes(out[id]);
    return out;
}

/** OSPF（单区域链路状态，Dijkstra）：以链路 cost 为度量。 */
export function computeOSPF(sys) {
    const { devs, adj } = buildAdjacency(sys, d => !!d.ospfEnabled);
    const out = {};
    devs.forEach(d => { out[d.id] = []; });
    for (const origin of devs) {
        for (const N of directNetsOf(sys, origin)) {
            const dist = new Map();
            const nh = new Map();
            devs.forEach(d => dist.set(d.id, Infinity));
            dist.set(origin.id, 0);
            const done = new Set();
            while (true) {
                let u = null, best = Infinity;
                for (const d of devs) {
                    if (!done.has(d.id) && dist.get(d.id) < best) { best = dist.get(d.id); u = d.id; }
                }
                if (u === null) break;
                done.add(u);
                for (const edge of (adj.get(u) || [])) {
                    const nd = dist.get(u) + edge.cost;
                    if (nd < dist.get(edge.nb.id)) {
                        dist.set(edge.nb.id, nd);
                        // nb 通往 origin 的下一跳 = 邻居 u 在该链路上的接口地址
                        nh.set(edge.nb.id, { hop: edge.selfIf.ip, selfIf: edge.peerIf });
                    }
                }
            }
            for (const d of devs) {
                if (d.id === origin.id) continue;
                const info = nh.get(d.id);
                if (!info || !isFinite(dist.get(d.id))) continue;
                out[d.id].push({
                    net: N.net, mask: N.mask, prefix: N.prefix, type: 'ospf',
                    ad: ADMIN_DISTANCE.ospf, metric: dist.get(d.id), nextHop: info.hop,
                    ifaceName: info.selfIf ? info.selfIf.name : '',
                });
            }
        }
    }
    for (const id in out) out[id] = dedupeRoutes(out[id]);
    return out;
}

/** 供 display ospf peer / display rip 使用：邻居列表 */
export function routingNeighbors(sys, dev) {
    const ospf = !!dev.ospfEnabled;
    const pred = ospf ? (d => !!d.ospfEnabled) : (d => !!d.ripEnabled);
    const { adj } = buildAdjacency(sys, pred);
    const seen = new Set();
    const rows = [];
    for (const edge of (adj.get(dev.id) || [])) {
        const key = `${edge.nb.id}#${edge.peerIf.ip}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
            neighborId: edge.nb.id, neighbor: edge.nb, hostname: edge.nb.hostname || edge.nb.id,
            routerId: edge.nb.ospfRouterId || edge.nb.id, ip: edge.peerIf.ip,
            localIface: edge.selfIf.name, cost: edge.cost,
        });
    }
    return rows;
}

/** 网络拓扑签名：用于动态路由结果缓存失效判定 */
function netSignature(sys) {
    const parts = [];
    for (const c of [...collectPCs(sys), ...collectServers(sys), ...collectSwitches(sys),
        ...collectL3Switches(sys), ...collectRouters(sys)]) {
        parts.push(c.id, c.ip || '', c.mask || '', c.ripEnabled ? 1 : 0, c.ospfEnabled ? 1 : 0);
        for (const f of (c.interfaces || [])) {
            parts.push(f.name, f.ip || '', f.mask || '', f.up === false ? 'D' : 'U', f.cost || 1);
        }
        for (const r of (c.routes || [])) parts.push(r.net, r.mask, r.nextHop);
        const pv = c.portVlan ? Object.keys(c.portVlan).map(k => `${k}:${c.portVlan[k]}`).join(',') : '';
        const pt = c.portType ? Object.keys(c.portType).map(k => `${k}:${c.portType[k]}`).join(',') : '';
        const ptv = c.portTrunkVlans ? Object.keys(c.portTrunkVlans).map(k => `${k}:${(c.portTrunkVlans[k] || []).join('-')}`).join(',') : '';
        parts.push(pv, pt, ptv);
    }
    for (const conn of (sys.conns || [])) {
        if (conn && conn.type === LINK_TYPE) parts.push(conn.from, conn.to);
    }
    return parts.join(';');
}

/** 动态路由表（RIP + OSPF），带签名缓存 */
export function dynamicRouteTables(sys) {
    if (!sys) return {};
    const sig = netSignature(sys);
    if (sys._netDyn && sys._netDynSig === sig) return sys._netDyn;
    const rip = computeRIP(sys);
    const ospf = computeOSPF(sys);
    const map = {};
    const ensure = id => (map[id] || (map[id] = { rip: [], ospf: [] }));
    for (const id in rip) ensure(id).rip = rip[id];
    for (const id in ospf) ensure(id).ospf = ospf[id];
    sys._netDyn = map;
    sys._netDynSig = sig;
    return map;
}

// ─── 路由计算 ────────────────────────────────────────────────

/** 为某设备选取源接口（路由设备按目标优选同网段接口） */
function pickSourceInterface(sys, comp, targetIp) {
    const ifs = getInterfaces(sys, comp).filter(f => f.up !== false && isValidIp(f.ip));
    if (!ifs.length) return getInterfaces(sys, comp)[0] || null;
    if (isRoutingDevice(comp)) {
        for (const f of ifs) {
            if (inSameSubnet(f.ip, f.mask, targetIp)) return f;
        }
    }
    return ifs[0];
}

/** 从某个三层接口出发，向目标接口转发（返回经过的三层设备接口链） */
function walkFromRouter(sys, startIface, dstIface) {
    const routers = [];
    let cur = startIface;
    for (let i = 0; i < 24; i++) {
        const dev = cur.comp;
        const match = longestPrefixMatch(routingTable(dev), dstIface.ip);
        if (!match) return { ok: false, reason: 'no_route', routers };
        if (match.type === 'direct') {
            const outIface = match.iface;
            if (outIface.up === false) return { ok: false, reason: 'no_route', routers };
            routers.push(outIface);
            if (isL2Reachable(sys, outIface.key, dstIface.key)) return { ok: true, reason: 'ok', routers };
            return { ok: false, reason: 'timeout', routers };
        }
        // 静态 / RIP / OSPF：按下一跳继续
        const nextIface = findInterfaceByIp(sys, match.nextHop);
        if (!nextIface || !isRoutingDevice(nextIface.comp)) return { ok: false, reason: 'no_route', routers };
        // 本设备通往下一跳的直连出接口（下一跳须与某直连网段同网段）
        const outLocal = getInterfaces(sys, dev).find(f =>
            f.up !== false && isValidIp(f.ip) && inSameSubnet(f.ip, f.mask, match.nextHop));
        if (!outLocal || !isL2Reachable(sys, outLocal.key, nextIface.key)) {
            return { ok: false, reason: 'timeout', routers };
        }
        routers.push(nextIface);
        cur = nextIface;
    }
    return { ok: false, reason: 'ttl_exceeded', routers };
}

/**
 * 计算一条路由。
 * @returns {{ok:boolean, reason:string, routers:Array, dst:object, src:object}}
 */
export function computeRoute(sys, src, dst) {
    if (!src || !dst) return { ok: false, reason: 'host_unreachable', routers: [] };
    if (String(src.ip) === String(dst.ip)) return { ok: true, reason: 'self', routers: [] };

    // 三层设备自身作为源：直接按路由表转发
    if (isRoutingDevice(src.comp)) {
        const r = walkFromRouter(sys, src, dst);
        return { ...r, routers: r.routers };
    }

    // 同网段：二层直连
    if (inSameSubnet(src.ip, src.mask, dst.ip)) {
        if (isL2Reachable(sys, src.key, dst.key)) return { ok: true, reason: 'ok', routers: [] };
        return { ok: false, reason: 'timeout', routers: [] };
    }

    // 跨网段：需要网关
    const gw = String(src.gateway || '').trim();
    if (!gw || !isValidIp(gw) || !inSameSubnet(src.ip, src.mask, gw)) {
        return { ok: false, reason: 'no_gateway', routers: [] };
    }
    const gwIface = findInterfaceByIp(sys, gw);
    if (!gwIface || !isRoutingDevice(gwIface.comp)) return { ok: false, reason: 'no_gateway', routers: [] };
    if (!isL2Reachable(sys, src.key, gwIface.key)) return { ok: false, reason: 'timeout', routers: [] };

    return walkFromRouter(sys, gwIface, dst);
}

// ─── ARP ────────────────────────────────────────────────────

function arpCache(comp) {
    if (!comp) return null;
    if (!comp._arp) comp._arp = new Map();
    return comp._arp;
}
/** 记录一条 ARP（IP → MAC） */
export function arpRecord(comp, ip, mac) {
    const c = arpCache(comp);
    if (!c || !ip) return;
    c.set(String(ip), mac);
}
/** 读取 ARP 表：[{ip, mac}] */
export function arpTable(comp) {
    const c = arpCache(comp);
    if (!c) return [];
    return [...c.entries()].map(([ip, mac]) => ({ ip, mac }));
}
export function clearArp(comp) { if (comp) comp._arp = new Map(); }

// ─── NAT（easy-ip / PAT，教学简化）────────────────────────────

/** 出口接口（natRole === 'outside'）的公网地址 */
export function natOutsideIp(dev) {
    const f = (dev && dev.interfaces || []).find(x => x.natRole === 'outside' && x.up !== false && isValidIp(x.ip));
    return f ? f.ip : null;
}
/** 内网接口（natRole === 'inside'） */
export function natInsideIfaces(dev) {
    return (dev && dev.interfaces || []).filter(x => x.natRole === 'inside' && x.up !== false && isValidIp(x.ip));
}
/** 建立/复用一条 NAT 会话（私网 IP → 公网 IP:端口） */
export function natRecord(dev, srcIp, dstIp) {
    if (!dev || !dev.natEnabled) return null;
    const pub = natOutsideIp(dev);
    if (!pub) return null;
    if (!dev._natSessions) dev._natSessions = new Map();
    if (dev._natSessions.has(srcIp)) return dev._natSessions.get(srcIp);
    const h = ipToInt(srcIp) || 0;
    const sess = {
        privateIp: srcIp,
        privatePort: 40000 + (h % 20000),
        publicIp: pub,
        publicPort: 1024 + (h % 60000),
        dstIp,
        protocol: 'ICMP',
        ts: Date.now(),
    };
    dev._natSessions.set(srcIp, sess);
    if (dev.sys && typeof dev.sys.requestRedraw === 'function') dev.sys.requestRedraw();
    return sess;
}
export function natSessions(dev) {
    if (!dev || !dev._natSessions) return [];
    return [...dev._natSessions.values()];
}
export function clearNatSessions(dev) { if (dev) dev._natSessions = new Map(); }
export function natEnabledDevices(sys) {
    return collectRoutingDevices(sys).filter(d => d.natEnabled);
}
/** ping/访问成功时，在路径（含 NAT 出口设备）上建立 NAT 会话 */
export function recordNatAlongPath(sys, src, dst, routers) {
    const seen = new Set();
    for (const node of (routers || [])) {
        const dev = node.comp;
        if (!dev || seen.has(dev.id)) continue;
        seen.add(dev.id);
        if (!dev.natEnabled) continue;
        if (!natInsideIfaces(dev).length || !natOutsideIp(dev)) continue;
        natRecord(dev, src.ip, dst.ip);
    }
}

// ─── ping ────────────────────────────────────────────────────

function makeReplies(count, base, ttl) {
    const arr = [];
    for (let i = 0; i < count; i++) arr.push({ seq: i + 1, time: base + (i % 3), ttl });
    return arr;
}
function replyTtl(src, hops) {
    const base = (src && (isRoutingDevice(src.comp) || src.kind === 'switch')) ? 255 : 128;
    return Math.max(1, base - (hops || 0));
}

/**
 * 执行一次 ping。
 * @returns {{reachable:boolean, reason:string, replies:Array, lossPct:number, targetComp:object|null, hops:number, path:Array}}
 * reason: ok | loopback | self | host_unreachable | timeout | no_gateway | no_route | ttl_exceeded | bad_ip | no_ip
 */
export function runPing(sys, fromComp, targetIp, count = 4) {
    const target = String(targetIp || '').trim();
    const out = { reachable: false, reason: 'host_unreachable', replies: [], lossPct: 100, targetComp: null, hops: 0, path: [] };

    if (!isValidIp(target)) { out.reason = 'bad_ip'; return out; }
    const src = pickSourceInterface(sys, fromComp, target);
    if (!src || !src.ip) { out.reason = 'no_ip'; return out; }

    if (target === '127.0.0.1') {
        out.reason = 'loopback'; out.reachable = true; out.lossPct = 0;
        out.replies = makeReplies(count, 0, 128); return out;
    }
    if (target === String(src.ip)) {
        out.reason = 'self'; out.reachable = true; out.lossPct = 0;
        out.replies = makeReplies(count, 0, 128); return out;
    }

    const dst = findInterfaceByIp(sys, target);
    out.targetComp = dst ? dst.comp : null;
    if (!dst) { out.reason = 'host_unreachable'; return out; }

    const route = computeRoute(sys, src, dst);
    out.hops = route.routers ? route.routers.length : 0;
    out.path = [src, ...(route.routers || []), dst].map(f => ({ label: f.label, name: f.name, ip: f.ip, kind: f.kind }));

    if (route.ok) {
        out.reachable = true; out.reason = 'ok'; out.lossPct = 0;
        out.replies = makeReplies(count, 1, replyTtl(src, out.hops));
        recordArp(sys, src, dst, route.routers || []);
        recordNatAlongPath(sys, src, dst, route.routers || []);
    } else {
        out.reason = route.reason || 'host_unreachable';
    }
    return out;
}

/** ping 成功时写入 ARP（更贴近实际：同网段记对端；跨网段记各自网关，末端记目标） */
function recordArp(sys, src, dst, routers) {
    if (!routers || !routers.length) {
        arpRecord(src.comp, dst.ip, macFor(dst));
        arpRecord(dst.comp, src.ip, macFor(src));
        return;
    }
    // 源端：ARP 自己的网关（入接口）
    if (src.gateway) {
        const gw = findInterfaceByIp(sys, src.gateway);
        if (gw) {
            arpRecord(src.comp, src.gateway, macOfInterface(gw.comp, gw.name));
            arpRecord(gw.comp, src.ip, macOf(src.comp));          // 网关学习源主机 MAC
        }
    }
    // 目的端：回程同样 ARP 自己的网关
    if (dst.gateway) {
        const gw2 = findInterfaceByIp(sys, dst.gateway);
        if (gw2) arpRecord(dst.comp, dst.gateway, macOfInterface(gw2.comp, gw2.name));
    }
    // 目的所在网段的路由器出接口：学习目标主机 MAC
    const lastRouter = routers[routers.length - 1];
    arpRecord(lastRouter.comp, dst.ip, macFor(dst));
}

function macFor(iface) {
    return (iface.kind === 'router' || iface.kind === 'l3switch')
        ? macOfInterface(iface.comp, iface.name)
        : macOf(iface.comp);
}

/** 生成系统风格的 ping 输出文本行 */
export function formatPingLines(result, targetIp, count = 4) {
    const lines = [];
    const t = String(targetIp || '').trim();
    if (result.reason === 'bad_ip') return [`Ping 请求找不到主机 ${t}。请检查该名称，然后重试。`];
    if (result.reason === 'no_ip') return ['本机未配置有效的 IPv4 地址，无法发送 Ping 请求。'];

    lines.push(`正在 Ping ${t} 具有 32 字节的数据:`);
    if (result.reachable) {
        for (const r of result.replies) lines.push(`来自 ${t} 的回复: 字节=32 时间=${r.time}ms TTL=${r.ttl}`);
    } else {
        const msg = failMessage(result.reason);
        for (let i = 0; i < count; i++) lines.push(msg);
    }
    const recv = result.reachable ? result.replies.length : 0;
    const loss = Math.round((count - recv) / count * 100);
    lines.push('');
    lines.push(`${t} 的 Ping 统计信息:`);
    lines.push(`    数据包: 已发送 = ${count}，已接收 = ${recv}，丢失 = ${count - recv} (${loss}% 丢失)，`);
    if (recv > 0) {
        const times = result.replies.map(r => r.time);
        const min = Math.min(...times), max = Math.max(...times);
        const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        lines.push('往返行程的估计时间(以毫秒为单位):');
        lines.push(`    最短 = ${min}ms，最长 = ${max}ms，平均 = ${avg}ms`);
    }
    return lines;
}

export function failMessage(reason) {
    switch (reason) {
        case 'timeout': return '请求超时。';
        case 'no_gateway': return '传输失败。常见故障。';
        case 'ttl_exceeded': return 'TTL 传输中过期。';
        case 'no_route':
        case 'host_unreachable':
        default: return '无法访问目标主机。';
    }
}

// ─── tracert ─────────────────────────────────────────────────

/**
 * 路由追踪：返回逐跳列表。
 * @returns {Array<{ttl:number, ip:string|null, label:string, ok:boolean}>}
 */
export function tracert(sys, fromComp, targetIp, maxHops = 8) {
    const target = String(targetIp || '').trim();
    const src = pickSourceInterface(sys, fromComp, target);
    if (!src || !src.ip) return [];
    const dst = findInterfaceByIp(sys, target);
    if (!isValidIp(target)) return [{ ttl: 1, ip: null, label: '目标地址无效', ok: false }];

    if (dst && String(src.ip) === String(dst.ip)) {
        return [{ ttl: 1, ip: src.ip, label: `${src.label}（本机）`, ok: true }];
    }

    const route = dst ? computeRoute(sys, src, dst) : { ok: false, reason: 'host_unreachable', routers: [] };
    const hops = [];
    for (const r of (route.routers || [])) {
        hops.push({ ip: r.ip, label: `${r.label}（${r.name}）`, kind: r.kind });
    }
    if (dst && route.ok) {
        hops.push({ ip: dst.ip, label: `${dst.label}（目标）`, kind: dst.kind });
    }
    const out = [];
    let ttl = 1;
    for (let i = 0; i < hops.length; i++) {
        out.push({ ttl: ttl++, ip: hops[i].ip, label: hops[i].label, ok: true });
        if (ttl > maxHops) break;
    }
    if (!route.ok) {
        out.push({ ttl: ttl, ip: null, label: '请求超时（* * *）', ok: false });
    }
    return out;
}

// ─── DHCP ───────────────────────────────────────────────────

/** 某三层接口的地址池（网段/掩码/网关/DNS/起始主机号） */
export function dhcpPoolOf(dev, iface) {
    if (!dev || !iface || !isValidIp(iface.ip) || !isValidMask(iface.mask)) return null;
    return {
        net: networkOf(iface.ip, iface.mask),
        mask: iface.mask,
        gateway: iface.ip,
        dns: iface.ip,
        start: 100,
        ifaceName: iface.name,
    };
}

function leasesOf(dev, ifaceName) {
    if (!dev._dhcpLeases) dev._dhcpLeases = new Map();
    if (!dev._dhcpLeases.has(ifaceName)) dev._dhcpLeases.set(ifaceName, new Map());
    return dev._dhcpLeases.get(ifaceName);
}

/**
 * 主机发起 DHCP 请求：找到同二层、启用了 DHCP 的三层接口，分配一个地址并写回主机。
 * @returns {{ok:boolean, ip?:string, gateway?:string, mask?:string, server?:string, reason?:string}}
 */
export function dhcpRequest(sys, host) {
    if (!host) return { ok: false, reason: 'no_client' };
    const hostIface = getInterfaces(sys, host)[0];
    if (!hostIface) return { ok: false, reason: 'no_client' };
    const mac = macOf(host);
    for (const dev of collectRoutingDevices(sys)) {
        if (!dev.dhcpEnabled) continue;
        for (const f of (dev.interfaces || [])) {
            if (f.up === false || !isValidIp(f.ip) || !isValidMask(f.mask)) continue;
            const iface = getInterfaces(sys, dev).find(x => x.ifaceName === f.name);
            if (!iface || !isL2Reachable(sys, hostIface.key, iface.key)) continue;
            const pool = dhcpPoolOf(dev, f);
            const leases = leasesOf(dev, f.name);
            if (leases.has(mac)) {
                applyLease(host, leases.get(mac), pool);
                return { ok: true, ip: leases.get(mac), gateway: pool.gateway, mask: pool.mask, server: f.ip };
            }
            const ip = allocateIp(sys, pool, leases);
            if (!ip) return { ok: false, reason: 'pool_exhausted' };
            leases.set(mac, ip);
            applyLease(host, ip, pool);
            return { ok: true, ip, gateway: pool.gateway, mask: pool.mask, server: f.ip };
        }
    }
    return { ok: false, reason: 'no_server' };
}

function applyLease(host, ip, pool) {
    host.ip = ip;
    host.mask = pool.mask;
    host.gateway = pool.gateway;
    host.dns = pool.dns || pool.gateway;
    host.dhcp = true;
    if (typeof host.onConfigUpdate === 'function') {
        host.onConfigUpdate({ ip, mask: pool.mask, gateway: pool.gateway, dns: host.dns, dhcp: true });
    }
    if (host.sys && host.sys.requestRedraw) host.sys.requestRedraw();
}

function allocateIp(sys, pool, leases) {
    const usedIps = new Set([...leases.values()]);
    for (const f of allInterfaces(sys)) {
        if (isValidIp(f.ip) && inSameSubnet(f.ip, pool.mask, pool.gateway)) usedIps.add(f.ip);
    }
    const netInt = ipToInt(pool.net);
    if (netInt === null) return null;
    for (let host = pool.start; host <= 254; host++) {
        const ip = intToIp((netInt + host) >>> 0);
        if (usedIps.has(ip)) continue;
        return ip;
    }
    return null;
}

/** 释放主机的 DHCP 租约 */
export function dhcpRelease(sys, host) {
    if (!host) return false;
    const mac = macOf(host);
    let released = false;
    for (const dev of collectRoutingDevices(sys)) {
        if (!dev._dhcpLeases) continue;
        for (const [, leases] of dev._dhcpLeases) {
            if (leases.has(mac)) { leases.delete(mac); released = true; }
        }
    }
    host.ip = '';
    host.gateway = '';
    if (typeof host.onConfigUpdate === 'function') host.onConfigUpdate({ ip: '', gateway: '' });
    return released;
}

/** 读取三层设备地址池分配情况（供 display ip pool） */
export function dhcpPoolStatus(sys, dev) {
    const rows = [];
    if (!dev || !dev.interfaces) return rows;
    for (const f of dev.interfaces) {
        const pool = dhcpPoolOf(dev, f);
        if (!pool) continue;
        const leases = (dev._dhcpLeases && dev._dhcpLeases.get(f.name)) || new Map();
        rows.push({
            interface: f.name, net: pool.net, mask: pool.mask,
            gateway: pool.gateway, used: leases.size, total: 155,
            leases: [...leases.entries()].map(([mac, ip]) => ({ mac, ip })),
        });
    }
    return rows;
}
