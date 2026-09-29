// NetworkSim.js — 简单组网仿真逻辑（纯逻辑，无 DOM）
//
// 设备模型（基于平台的 sys.conns，type === 'wire'）：
//   PC     ：一个以太网口（端口 id: <pcId>_wire_lan）
//   交换机 ：N 个以太网口，按 VLAN 划分广播域（端口 id: <swId>_wire_ethN）
//            管理 IP 位于 VLAN 1
//   路由器 ：N 个三层接口（端口 id: <rId>_wire_<gN>），每个接口独立属一个广播域
//
// 二层：VLAN 感知的连通分量。同一 (设备#VLAN) 桥节点内的端口互通；两交换机端口
//       直连需处于同一 VLAN 才通；PC/路由器接口接入所连交换机端口的 VLAN。
// 三层：直连网段 + 静态路由（含默认路由），最长前缀匹配；跨网段经网关逐跳转发。
//
// 说明：网络连线复用平台 'wire' 类型以复用 Renderer 绘制；电路求解器按已知 type
//       分组建模，pc / net_switch / router 无 stamp，其端口只会构成孤立节点，不影响求解。

export const LINK_TYPE = 'wire';
export const PC_TYPE = 'pc';
export const SWITCH_TYPE = 'net_switch';
export const ROUTER_TYPE = 'router';

/** 从端口 id 解析所属设备 id（兼容 _wire_ / _pipe_ 约定） */
export function deviceIdOfPort(portId) {
    if (!portId) return '';
    if (portId.includes('_wire_')) return portId.split('_wire_')[0];
    if (portId.includes('_pipe_')) return portId.split('_pipe_')[0];
    return String(portId).split('_')[0];
}

export function pcPortId(pcId) { return `${pcId}_wire_lan`; }
export function switchPortId(swId, n) { return `${swId}_wire_eth${n}`; }

export function collectPCs(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === PC_TYPE);
}
export function collectSwitches(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === SWITCH_TYPE);
}
export function collectRouters(sys) {
    if (!sys || !sys.comps) return [];
    return Object.values(sys.comps).filter(c => c && c.type === ROUTER_TYPE);
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
/** 路由器接口 MAC（每接口独立） */
export function macOfInterface(comp, ifaceName) {
    if (!comp) return '00-1A-2B-00-00-00';
    return macFromSeed(`${comp.id}#${ifaceName || ''}`);
}

// ─── 接口模型 ────────────────────────────────────────────────

/**
 * 收集一个设备的三层接口（统一结构）：
 *  { key, comp, compId, kind, name, label, ip, mask, gateway, up, portId, ifaceName }
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
    if (comp.type === SWITCH_TYPE) {
        return [{
            key: `${comp.id}#v1`, comp, compId: comp.id, kind: 'switch',
            name: 'Vlanif1', label: comp.hostname || comp.id,
            ip: comp.ip, mask: comp.mask || '255.255.255.0', gateway: comp.gateway || '',
            up: true, portId: null, ifaceName: null,
        }];
    }
    if (comp.type === ROUTER_TYPE) {
        return (comp.interfaces || []).map(f => ({
            key: `${comp.id}#${f.name}`, comp, compId: comp.id, kind: 'router',
            name: f.name, label: comp.hostname || comp.id,
            ip: f.ip, mask: f.mask || '255.255.255.0', gateway: '',
            up: f.up !== false, portId: f.portId, ifaceName: f.name,
        }));
    }
    return [];
}

/** 全工程所有三层接口 */
export function allInterfaces(sys) {
    const out = [];
    for (const comp of [...collectPCs(sys), ...collectSwitches(sys), ...collectRouters(sys)]) {
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

/** 按 IP 查找主机设备（PC / 交换机 / 路由器） */
export function findHostByIp(sys, ip) {
    const f = findInterfaceByIp(sys, ip);
    return f ? f.comp : null;
}

// ─── 二层拓扑（VLAN 感知）─────────────────────────────────────

/**
 * 计算某个端口的所属 VLAN。
 * 交换机端口 → 端口 VLAN；其它设备 → null（接入所连交换机端口的 VLAN）。
 */
export function portVlan(sys, comp, portId) {
    if (!comp || comp.type !== SWITCH_TYPE) return null;
    if (typeof comp.getPortVlanByPortId === 'function') return comp.getPortVlanByPortId(portId);
    return 1;
}

/** 端口在二层图中对应的节点名 */
export function portToEndpoint(sys, portId) {
    const devId = deviceIdOfPort(portId);
    const comp = sys && sys.comps ? sys.comps[devId] : null;
    if (!comp) return null;
    if (comp.type === ROUTER_TYPE) {
        const f = (comp.interfaces || []).find(x => x.portId === portId);
        return f ? `${comp.id}#${f.name}` : null;
    }
    return comp.id;   // PC 整机；交换机整机（VLAN 由上层桥节点处理）
}

/**
 * 构建二层连通图（VLAN 感知）：
 *   节点：PC 端点 / 路由器接口端点 / 交换机 (设备#VLAN) 桥节点
 *   边  ：有线连接。两交换机端口直连需同 VLAN；交换机端口 ↔ 主机端点直接并入。
 */
export function buildTopology(sys) {
    const adj = new Map();
    const ensure = (id) => { if (!adj.has(id)) adj.set(id, new Set()); return adj.get(id); };
    const link = (a, b) => { if (!a || !b || a === b) return; ensure(a).add(b); ensure(b).add(a); };

    const comps = {};
    [...collectPCs(sys), ...collectSwitches(sys), ...collectRouters(sys)].forEach(c => { comps[c.id] = c; });

    const isNetConn = (conn) => conn && conn.type === LINK_TYPE && !conn.custom;

    for (const conn of (sys && sys.conns ? sys.conns : [])) {
        if (!isNetConn(conn)) continue;
        const aId = deviceIdOfPort(conn.from);
        const bId = deviceIdOfPort(conn.to);
        const A = comps[aId], B = comps[bId];
        if (!A || !B || aId === bId) continue;

        const aSw = A.type === SWITCH_TYPE, bSw = B.type === SWITCH_TYPE;
        const aV = aSw ? portVlan(sys, A, conn.from) : null;
        const bV = bSw ? portVlan(sys, B, conn.to) : null;
        const aNode = aSw ? `${A.id}#v${aV}` : portToEndpoint(sys, conn.from);
        const bNode = bSw ? `${B.id}#v${bV}` : portToEndpoint(sys, conn.to);

        if (aSw && bSw) {
            if (aV === bV) link(aNode, bNode);   // 不同 VLAN 的端口不相通
        } else {
            link(aNode, bNode);
        }
    }
    return { adj };
}

/** 两个二层端点是否连通（可经交换机、同一 VLAN） */
export function isL2Reachable(sys, epA, epB) {
    if (!epA || !epB) return false;
    if (epA === epB) return true;
    const { adj } = buildTopology(sys);
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

/** 交换机上已连接的 PC id 列表 */
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

// ─── 路由表 ─────────────────────────────────────────────────

/**
 * 路由器的路由表：直连网段 + 静态路由（含默认路由）。
 * 条目：{ net, mask, prefix, type:'direct'|'static', iface?, nextHop? }
 */
export function routingTable(router) {
    const table = [];
    if (!router || router.type !== ROUTER_TYPE) return table;
    for (const f of (router.interfaces || [])) {
        if (f.up === false) continue;
        if (!isValidIp(f.ip) || !isValidMask(f.mask)) continue;
        // 使用带二层节点 key 的接口对象，供 isL2Reachable 使用
        const iface = {
            key: `${router.id}#${f.name}`, comp: router, compId: router.id, kind: 'router',
            name: f.name, label: router.hostname || router.id,
            ip: f.ip, mask: f.mask, gateway: '', up: f.up !== false,
            portId: f.portId, ifaceName: f.name,
        };
        table.push({
            net: networkOf(f.ip, f.mask), mask: f.mask, prefix: maskPrefix(f.mask),
            type: 'direct', iface,
        });
    }
    for (const r of (router.routes || [])) {
        if (!isValidIp(r.net) || !isValidMask(r.mask) || !isValidIp(r.nextHop)) continue;
        table.push({
            net: networkOf(r.net, r.mask), mask: r.mask, prefix: maskPrefix(r.mask),
            type: 'static', nextHop: r.nextHop,
        });
    }
    return table;
}

/** 最长前缀匹配 */
export function longestPrefixMatch(table, dstIp) {
    const d = ipToInt(dstIp);
    if (d === null) return null;
    let best = null;
    for (const e of table) {
        const n = ipToInt(e.net), m = ipToInt(e.mask);
        if (n === null || m === null) continue;
        if (((d & m) >>> 0) === (n >>> 0)) {
            if (!best || e.prefix > best.prefix) best = e;
        }
    }
    return best;
}

// ─── 路由计算 ────────────────────────────────────────────────

/** 为某设备选取源接口（路由器按目标择优选接口） */
function pickSourceInterface(sys, comp, targetIp) {
    const ifs = getInterfaces(sys, comp).filter(f => f.up !== false && isValidIp(f.ip));
    if (!ifs.length) return getInterfaces(sys, comp)[0] || null;
    if (comp.type === ROUTER_TYPE) {
        const t = ipToInt(targetIp);
        // 优先同网段接口
        for (const f of ifs) {
            if (inSameSubnet(f.ip, f.mask, targetIp)) return f;
        }
    }
    return ifs[0];
}

/** 从某个路由器接口出发，向目标接口转发（返回经过的路由器与目标链） */
function walkFromRouter(sys, startIface, dstIface) {
    const routers = [];
    let cur = startIface;
    for (let i = 0; i < 24; i++) {
        const router = cur.comp;
        const match = longestPrefixMatch(routingTable(router), dstIface.ip);
        if (!match) return { ok: false, reason: 'no_route', routers };
        if (match.type === 'direct') {
            const outIface = match.iface;
            if (outIface.up === false) return { ok: false, reason: 'no_route', routers };
            routers.push(outIface);
            if (isL2Reachable(sys, outIface.key, dstIface.key)) {
                return { ok: true, reason: 'ok', routers };
            }
            return { ok: false, reason: 'timeout', routers };
        }
        // 静态路由
        const nextIface = findInterfaceByIp(sys, match.nextHop);
        if (!nextIface || nextIface.kind !== 'router') return { ok: false, reason: 'no_route', routers };
        if (!isL2Reachable(sys, cur.key, nextIface.key)) return { ok: false, reason: 'timeout', routers };
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

    // 路由器自身作为源：直接按路由表转发
    if (src.kind === 'router') {
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
    if (!gwIface || gwIface.kind !== 'router') return { ok: false, reason: 'no_gateway', routers: [] };
    if (!isL2Reachable(sys, src.key, gwIface.key)) return { ok: false, reason: 'timeout', routers: [] };

    const r = walkFromRouter(sys, gwIface, dst);
    return r;
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

// ─── ping ────────────────────────────────────────────────────

function makeReplies(count, base, ttl) {
    const arr = [];
    for (let i = 0; i < count; i++) arr.push({ seq: i + 1, time: base + (i % 3), ttl });
    return arr;
}
function replyTtl(src, hops) {
    const base = (src && (src.kind === 'router' || src.kind === 'switch')) ? 255 : 128;
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
    return iface.kind === 'router' ? macOfInterface(iface.comp, iface.name) : macOf(iface.comp);
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
    let hops;
    if (includeFirstHost(src, target)) {
        hops = [{ ip: src.ip, label: src.label, kind: src.kind }];
    } else {
        hops = [];
    }
    for (const r of (route.routers || [])) {
        hops.push({ ip: r.ip, label: `${r.label}（${r.name}）`, kind: r.kind });
    }
    if (dst && route.ok) {
        hops.push({ ip: dst.ip, label: `${dst.label}（目标）`, kind: dst.kind });
    }
    // 计算 TTL 前缀（不含源自身）
    const out = [];
    let ttl = 1;
    const startIdx = includeFirstHost(src, target) ? 1 : 0;
    for (let i = startIdx; i < hops.length; i++) {
        out.push({ ttl: ttl++, ip: hops[i].ip, label: hops[i].label, ok: true });
        if (ttl > maxHops) break;
    }
    if (!route.ok) {
        out.push({ ttl: ttl, ip: null, label: '请求超时（* * *）', ok: false });
    }
    return out;
}

function includeFirstHost(src, target) {
    // 源为 PC/交换机时不把自身计入路由跳；此处恒为 false，保留结构便于扩展
    return false;
}

// ─── DHCP ───────────────────────────────────────────────────

/** 路由器某接口的地址池（网段/掩码/网关/DNS/起始主机号） */
export function dhcpPoolOf(router, iface) {
    if (!router || !iface || !isValidIp(iface.ip) || !isValidMask(iface.mask)) return null;
    return {
        net: networkOf(iface.ip, iface.mask),
        mask: iface.mask,
        gateway: iface.ip,
        dns: iface.ip,
        start: 100,
        ifaceName: iface.name,
    };
}

function poolKey(router, ifaceName) { return `${router.id}#${ifaceName}`; }

function leasesOf(router, ifaceName) {
    if (!router._dhcpLeases) router._dhcpLeases = new Map();
    if (!router._dhcpLeases.has(ifaceName)) router._dhcpLeases.set(ifaceName, new Map());
    return router._dhcpLeases.get(ifaceName);
}

/**
 * PC 发起 DHCP 请求：找到同二层、启用了 DHCP 的路由器接口，分配一个地址并写回 PC。
 * @returns {{ok:boolean, ip?:string, gateway?:string, mask?:string, server?:string, reason?:string}}
 */
export function dhcpRequest(sys, pc) {
    if (!pc) return { ok: false, reason: 'no_client' };
    const pcIface = getInterfaces(sys, pc)[0];
    if (!pcIface) return { ok: false, reason: 'no_client' };
    const mac = macOf(pc);
    for (const router of collectRouters(sys)) {
        if (!router.dhcpEnabled) continue;
        for (const f of (router.interfaces || [])) {
            if (f.up === false || !isValidIp(f.ip) || !isValidMask(f.mask)) continue;
            const iface = getInterfaces(sys, router).find(x => x.ifaceName === f.name);
            if (!iface || !isL2Reachable(sys, pcIface.key, iface.key)) continue;
            const pool = dhcpPoolOf(router, f);
            const leases = leasesOf(router, f.name);
            // 已有租约：续租
            if (leases.has(mac)) {
                applyLease(pc, leases.get(mac), pool);
                return { ok: true, ip: leases.get(mac), gateway: pool.gateway, mask: pool.mask, server: f.ip };
            }
            const ip = allocateIp(sys, pool, leases);
            if (!ip) return { ok: false, reason: 'pool_exhausted' };
            leases.set(mac, ip);
            applyLease(pc, ip, pool);
            return { ok: true, ip, gateway: pool.gateway, mask: pool.mask, server: f.ip };
        }
    }
    return { ok: false, reason: 'no_server' };
}

function applyLease(pc, ip, pool) {
    pc.ip = ip;
    pc.mask = pool.mask;
    pc.gateway = pool.gateway;
    pc.dns = pool.dns || pool.gateway;
    pc.dhcp = true;
    if (typeof pc.onConfigUpdate === 'function') {
        pc.onConfigUpdate({ ip, mask: pool.mask, gateway: pool.gateway, dns: pc.dns, dhcp: true });
    }
    if (typeof pc.sys === 'object' && pc.sys && pc.sys.requestRedraw) pc.sys.requestRedraw();
}

function allocateIp(sys, pool, leases) {
    const usedIps = new Set([...leases.values()]);
    // 排除已配置的静态地址
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

/** 释放 PC 的 DHCP 租约 */
export function dhcpRelease(sys, pc) {
    if (!pc) return false;
    const mac = macOf(pc);
    let released = false;
    for (const router of collectRouters(sys)) {
        if (!router._dhcpLeases) continue;
        for (const [, leases] of router._dhcpLeases) {
            if (leases.has(mac)) { leases.delete(mac); released = true; }
        }
    }
    pc.ip = '';
    pc.gateway = '';
    if (typeof pc.onConfigUpdate === 'function') pc.onConfigUpdate({ ip: '', gateway: '' });
    return released;
}

/** 读取路由器地址池分配情况（供 display ip pool） */
export function dhcpPoolStatus(sys, router) {
    const rows = [];
    for (const f of (router.interfaces || [])) {
        const pool = dhcpPoolOf(router, f);
        if (!pool) continue;
        const leases = (router._dhcpLeases && router._dhcpLeases.get(f.name)) || new Map();
        rows.push({
            interface: f.name, net: pool.net, mask: pool.mask,
            gateway: pool.gateway, used: leases.size, total: 155,
            leases: [...leases.entries()].map(([mac, ip]) => ({ mac, ip })),
        });
    }
    return rows;
}
