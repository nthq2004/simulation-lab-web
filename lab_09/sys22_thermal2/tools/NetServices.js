// NetServices.js — 应用层服务仿真逻辑（DNS / HTTP / FTP，纯逻辑，无 DOM）
//
// 服务器模型（component type === 'net_server'）：
//   hostname / ip / mask / gateway / dns
//   httpEnabled / ftpEnabled / dnsEnabled
//   pages       : { '/': { title, body }, '/index.html': {...} }    HTTP 页面
//   ftpFiles    : [{ name, size, content }]                          FTP 文件
//   ftpUsers    : [{ user, pass }]                                   FTP 账号
//   dnsRecords  : [{ host, ip }]                                     DNS A 记录
//
// 所有访问都先做三层可达性判定（同网段直连 / 跨网段经网关与动态路由），
// 再校验服务是否开启与账号是否正确，模拟真实“先通网、再通服务”。

import {
    getInterfaces, findInterfaceByIp, computeRoute, isL2Reachable, inSameSubnet,
    isValidIp, macOf, ipToInt, networkOf, maskPrefix, recordNatAlongPath,
} from './NetworkSim.js';

export const HTTP_PORT = 80;
export const FTP_PORT = 21;
export const DNS_PORT = 53;

/** 规范化域名（小写、去尾部点） */
export function normDomain(d) {
    return String(d || '').trim().toLowerCase().replace(/\.$/, '');
}

/** 判断是否是 IP 字面量 */
export function isIpLiteral(s) {
    return isValidIp(String(s || '').trim());
}

/** 取主机的 DNS 服务器地址（显式指定优先，其次客户端配置） */
export function dnsServerIpOf(client, explicit) {
    if (explicit && isValidIp(explicit)) return String(explicit).trim();
    if (client && isValidIp(client.dns)) return String(client.dns).trim();
    return null;
}

function dnsCacheOf(client) {
    if (!client) return null;
    if (!client._dnsCache) client._dnsCache = new Map();
    return client._dnsCache;
}
export function dnsCache(client) {
    const c = dnsCacheOf(client);
    return c ? [...c.entries()].map(([host, ip]) => ({ host, ip })) : [];
}
export function flushDns(client) { if (client) client._dnsCache = new Map(); }

/** 找到托管 DNS 且已启用的服务器 */
export function findDnsServer(sys, ip) {
    const iface = findInterfaceByIp(sys, ip);
    const comp = iface ? iface.comp : null;
    if (comp && comp.type === 'net_server' && comp.dnsEnabled && iface) return { comp, iface };
    return null;
}

/**
 * DNS 解析。
 * @returns {{ok:boolean, ip?:string, domain?:string, server?:object, reason?:string, cached?:boolean}}
 * reason: nxdomain | no_dns | timeout | no_server
 */
export function resolveDomain(sys, client, domain, explicitDns) {
    const host = normDomain(domain);
    if (!host) return { ok: false, reason: 'nxdomain' };
    if (isIpLiteral(host)) return { ok: true, ip: String(host).trim(), domain: domain, cached: true };

    const cache = dnsCacheOf(client);
    if (cache && cache.has(host)) return { ok: true, ip: cache.get(host), domain: domain, cached: true };

    const dnsIp = dnsServerIpOf(client, explicitDns);
    if (!dnsIp) return { ok: false, reason: 'no_dns' };

    const srv = findDnsServer(sys, dnsIp);
    if (!srv) return { ok: false, reason: 'no_server' };

    // 可达性：客户端到 DNS 服务器
    const clientIface = getInterfaces(sys, client)[0];
    if (!clientIface) return { ok: false, reason: 'nxdomain' };
    const route = computeRoute(sys, clientIface, srv.iface);
    if (!route.ok) return { ok: false, reason: route.reason === 'timeout' ? 'timeout' : 'no_dns' };

    const rec = (srv.comp.dnsRecords || []).find(r => normDomain(r.host) === host);
    if (!rec || !isValidIp(rec.ip)) return { ok: false, reason: 'nxdomain' };

    if (cache) cache.set(host, rec.ip);
    return { ok: true, ip: rec.ip, domain: domain, server: srv.comp };
}

/** 由 IP 找一个已开启 HTTP 的服务器 */
export function findHttpServerByIp(sys, ip) {
    const iface = findInterfaceByIp(sys, ip);
    const comp = iface ? iface.comp : null;
    if (comp && comp.type === 'net_server' && comp.httpEnabled && iface) return { comp, iface };
    return null;
}
export function findFtpServerByIp(sys, ip) {
    const iface = findInterfaceByIp(sys, ip);
    const comp = iface ? iface.comp : null;
    if (comp && comp.type === 'net_server' && comp.ftpEnabled && iface) return { comp, iface };
    return null;
}

/** 解析 URL：http://host[:port]/path */
export function parseUrl(url) {
    let s = String(url || '').trim();
    s = s.replace(/^https?:\/\//i, '');
    let path = '/';
    const slash = s.indexOf('/');
    if (slash >= 0) { path = s.slice(slash) || '/'; s = s.slice(0, slash); }
    let port = HTTP_PORT;
    const colon = s.lastIndexOf(':');
    if (colon > 0 && /^\d+$/.test(s.slice(colon + 1))) {
        port = parseInt(s.slice(colon + 1), 10);
        s = s.slice(0, colon);
    }
    return { host: s, port, path: path || '/' };
}

/**
 * HTTP 请求。
 * @returns {{ok:boolean, status?:number, title?:string, body?:string, ip?:string, server?:object,
 *            url?:string, reason?:string}}
 * reason: bad_url | no_dns | nxdomain | no_server | refused | timeout
 */
export function httpGet(sys, client, url) {
    const u = parseUrl(url);
    if (!u.host) return { ok: false, reason: 'bad_url' };

    let ip = u.host;
    let resolved = { ok: true, ip };
    if (!isIpLiteral(u.host)) {
        resolved = resolveDomain(sys, client, u.host, client && client.dns);
        if (!resolved.ok) return { ok: false, reason: resolved.reason === 'nxdomain' ? 'nxdomain' : 'no_dns', url: url };
        ip = resolved.ip;
    }

    const srv = findHttpServerByIp(sys, ip);
    if (!srv) return { ok: false, reason: 'refused', ip, url: url };

    const clientIface = getInterfaces(sys, client)[0];
    const route = computeRoute(sys, clientIface, srv.iface);
    if (!route.ok) return { ok: false, reason: route.reason === 'timeout' ? 'timeout' : 'no_server', ip };

    recordNatAlongPath(sys, clientIface, srv.iface, route.routers || []);
    const page = lookupPage(srv.comp, u.path);
    return {
        ok: true, status: page ? 200 : 404,
        title: page ? page.title : '404 Not Found',
        body: page ? page.body : `请求的页面不存在：${u.path}`,
        ip, server: srv.comp, path: u.path,
        url: `http://${u.host}${u.path}`,
    };
}

function lookupPage(server, path) {
    const pages = server.pages || {};
    if (pages[path]) return pages[path];
    if (path === '/' && pages['/index.html']) return pages['/index.html'];
    if (path === '/index.html' && pages['/']) return pages['/'];
    return null;
}

/**
 * FTP 登录。
 * @returns {{ok:boolean, server?:object, files?:Array, reason?:string}}
 * reason: no_dns | nxdomain | refused | denied | timeout
 */
export function ftpConnect(sys, client, host, user = 'anonymous', pass = '') {
    let ip = String(host || '').trim();
    if (!isIpLiteral(ip)) {
        const r = resolveDomain(sys, client, ip, client && client.dns);
        if (!r.ok) return { ok: false, reason: r.reason === 'nxdomain' ? 'nxdomain' : 'no_dns' };
        ip = r.ip;
    }
    const srv = findFtpServerByIp(sys, ip);
    if (!srv) return { ok: false, reason: 'refused' };

    const users = srv.comp.ftpUsers || [];
    const okUser = users.some(u => u.user === user && (u.pass || '') === (pass || ''));
    if (!okUser && users.length) return { ok: false, reason: 'denied' };

    const clientIface = getInterfaces(sys, client)[0];
    const route = computeRoute(sys, clientIface, srv.iface);
    if (!route.ok) return { ok: false, reason: route.reason === 'timeout' ? 'timeout' : 'refused' };

    recordNatAlongPath(sys, clientIface, srv.iface, route.routers || []);
    return { ok: true, server: srv.comp, ip, files: (srv.comp.ftpFiles || []).map(f => ({ ...f })) };
}

/** FTP 下载文件 */
export function ftpGet(sys, client, host, fileName, user = 'anonymous', pass = '') {
    const conn = ftpConnect(sys, client, host, user, pass);
    if (!conn.ok) return conn;
    const file = (conn.files || []).find(f => f.name === fileName);
    if (!file) return { ok: false, reason: 'not_found', server: conn.server };
    return { ok: true, file, server: conn.server, ip: conn.ip };
}

/** 汇总服务器对外提供的服务列表 */
export function serverServices(server) {
    if (!server || server.type !== 'net_server') return [];
    const out = [];
    if (server.dnsEnabled) out.push('DNS');
    if (server.httpEnabled) out.push('HTTP');
    if (server.ftpEnabled) out.push('FTP');
    return out;
}
