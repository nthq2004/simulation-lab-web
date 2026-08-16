/**
 * networkPage.js — 网络诊断页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { mkBtn } from './utils.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';

export function buildNetworkPage(cc) {
    const pg = cc._pages[2];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 2, text: '■ CAN 网络诊断  (CANopen 250kbps)', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

    const legend = [
        'ID=CANId.encode(funcCode,nodeAddr)  bit[10:7]=功能码  bit[6:0]=节点地址',
        'AI上报 ID=0x081  AO状态 ID=0x082  DI上报 ID=0x083   DO状态 ID=0x084',
        'AI配置 ID=0x101  AO指令 ID=0x102  DI配置 ID=0x103   DO指令 ID=0x104',
        'AI回复 ID=0x181  AO回复 ID=0x182  DI回复 ID=0x183   DO回复 ID=0x184',
        '广播ID=0x780，   NMT ID=0x0 data[0]=命令码 0x01启动、0x02停止、0x81复位'
    ];
    legend.forEach((t, i) => {
        pg.add(new Konva.Text({ x: 12, y: 18 + i * 20, text: t, fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
    });

    const tableY = 120;
    pg.add(new Konva.Line({ points: [6, tableY - 4, pw - 6, tableY - 4], stroke: C.border, strokeWidth: 1 }));
    // 标题栏
    pg.add(new Konva.Text({ x: 8, y: tableY + 2, text: '节点', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
    pg.add(new Konva.Text({ x: 200, y: tableY + 2, text: 'NMT状态', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
    pg.add(new Konva.Text({ x: 320, y: tableY + 2, text: '最近心跳', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
    pg.add(new Konva.Line({ points: [6, tableY + 18, pw - 6, tableY + 14], stroke: C.border, strokeWidth: 1 }));

    const nodes = [
        { id: 1, label: 'AI Module  addr=1', color: C.blue },
        { id: 2, label: 'AO Module  addr=2', color: C.orange },
        { id: 3, label: 'DI Module  addr=3', color: C.green },
        { id: 4, label: 'DO Module  addr=4', color: C.purple },
    ];

    cc._netRowDisps = {};
    nodes.forEach((n, i) => {
        const ry = tableY + 24 + i * 28;
        pg.add(new Konva.Rect({ x: 6, y: ry - 2, width: pw - 12, height: 22, fill: C.bg, cornerRadius: 2 }));

        const dot = new Konva.Circle({ x: 20, y: ry + 7, radius: 5, fill: C.textDim, stroke: C.border, strokeWidth: 1 });
        pg.add(dot);
        pg.add(new Konva.Text({ x: 32, y: ry + 2, text: n.label, fontSize: 12, fontFamily: 'Courier New', fill: n.color }));
        // 状态主要在线、超时、离线
        const status = new Konva.Text({ x: 200, y: ry + 2, text: 'NO HEARTBEAT', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const age = new Konva.Text({ x: 320, y: ry + 2, text: '---', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(status, age);

        // 节点操作按钮：启动/停止/复位/测试
        const btnX = pw - 260;
        const btnW = 56;
        const gap = 4;
        const bx = btnX;
        const bStart = mkBtn(pg, '启动', bx, ry - 2, C.green, btnW);
        const bStop = mkBtn(pg, '停止', bx + (btnW + gap) * 1, ry - 2, C.yellow, btnW);
        const bReset = mkBtn(pg, '复位', bx + (btnW + gap) * 2, ry - 2, C.red, btnW);
        const bTest = mkBtn(pg, '测试', bx + (btnW + gap) * 3, ry - 2, C.blue, btnW);
        // 事件处理
        bStart.on('click tap', () => { try { cc._canSendNMT(0x01, n.id); cc._appendNetDiagLog && cc._appendNetDiagLog(`TX NMT START -> addr=${n.id}`); } catch (e) { console.warn(e); } });
        bStop.on('click tap', () => { try { cc._canSendNMT(0x02, n.id); cc._appendNetDiagLog && cc._appendNetDiagLog(`TX NMT STOP  -> addr=${n.id}`); } catch (e) { console.warn(e); } });
        bReset.on('click tap', () => { try { cc._canSendNMT(0x81, n.id); cc._appendNetDiagLog && cc._appendNetDiagLog(`TX NMT RESET -> addr=${n.id}`); } catch (e) { console.warn(e); } });
        // 测试命令：发送一个短的 config 请求（cmd=0xEE）期望节点回复包含其 ID/地址信息
        bTest.on('click tap', () => {
            try {
                const func = CAN_FUNC.AI_CONFIG; // 使用 config 功能码作为测试（节点应回复）
                const id = CANId.encode(func, n.id);
                cc._appendNetDiagLog && cc._appendNetDiagLog(`TX TEST cmd  -> id=0x${id.toString(16)} addr=${n.id}`);
                cc.sys.canBus.send({ id, extended: false, rtr: false, dlc: 8, data: [0xEE, n.id & 0xFF, 0, 0, 0, 0, 0, 0], sender: cc.id, timestamp: Date.now() });
            } catch (e) { console.warn(e); }
        });

        cc._netRowDisps[n.id] = { dot, status, age, bStart, bStop, bReset, bTest };
    });

    const debugY = tableY + 24 + nodes.length * 28;
    pg.add(new Konva.Line({ points: [6, debugY, pw - 6, debugY], stroke: C.border, strokeWidth: 1 }));

    // 日志显示区域（接收/发送简要记录）
    const logY = debugY + 26;
    pg.add(new Konva.Text({ x: 8, y: logY - 18, text: '■ 测试日志（保留 10 条）', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));
    pg.add(new Konva.Rect({ x: 8, y: logY + 2, width: pw - 10, height: 112, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 3 }));
    cc._netDiagLog = [];
    cc._netDiagText = new Konva.Text({ x: 14, y: logY + 4, width: pw - 28, text: '', fontSize: 11, fontFamily: 'Courier New', fill: C.textDim, align: 'left' });
    pg.add(cc._netDiagText);
    const clearLogBtn = mkBtn(pg, '清除日志', 200, logY - 22, C.textDim, 96);
    clearLogBtn.on('click tap', () => { if (cc._netDiagLog) cc._netDiagLog = []; if (cc._netDiagText) cc._netDiagText.text(''); });

    const statsY = debugY + 135;

    pg.add(new Konva.Text({ x: 8, y: statsY + 10, text: '■ 总线统计', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));
    cc._netStatsText = new Konva.Text({ x: 8, y: statsY + 24, text: 'TX:0  RX:0  ERR:0  LOAD:0.0%  BUS-OFF:否', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
    pg.add(cc._netStatsText);
    pg.add(new Konva.Line({ points: [6, statsY + 45, pw - 6, statsY + 45], stroke: C.border, strokeWidth: 1 }));
}

// ── 每 tick 刷新 ──────────────────────────────
export function renderNetworkPage(cc) {
    if (!cc._netRowDisps) return;
    const bus = cc.sys?.canBus;
    const now = Date.now();
    const TIMEOUT = 2000;
    const nodeIdMap = { 1: 'ai', 2: 'ao', 3: 'di', 4: 'do' };

    [1, 2, 3, 4].forEach(addr => {
        const row = cc._netRowDisps[addr]; if (!row) return;
        const lastSeen = cc._canNodeLastSeen[addr] || 0;
        const timeout = lastSeen > 0 && (now - lastSeen) > TIMEOUT;
        const neverSeen = lastSeen === 0;
        const busOnline = bus ? bus.isNodeOnline(nodeIdMap[addr]) : false;
        const frameAlive = !neverSeen && !timeout;
        const online = busOnline && frameAlive;

        let statusStr, statusColor;

        statusStr = neverSeen ? 'NO DATA' : timeout ? 'TIMEOUT' : busOnline ? 'ONLINE' : 'BUS OFFLINE';
        statusColor = online ? C.green : (neverSeen ? C.textDim : C.red);


        row.dot.fill(online ? C.green : (neverSeen ? C.textDim : C.red));
        row.status.text(statusStr);
        row.status.fill(statusColor);
        row.age.text(lastSeen > 0 ? `${((now - lastSeen) / 1000).toFixed(1)}s ago` : '---');
    });

    if (cc._netStatsText && bus) {
        const s = bus.getStats();
        const loadColor = s.busLoad > 80 ? C.red : (s.busLoad > 50 ? C.yellow : C.green);
        cc._netStatsText.text(
            `TX:${s.txFrames}  RX:${s.rxFrames}  ERR:${s.errorFrames}  ` +
            `LOAD:${s.busLoad.toFixed(1)}%  DROPPED:${s.dropped}  BUS-OFF:${s.busOff ? '是⚠' : '否'}`
        );
        cc._netStatsText.fill(s.busOff ? C.red : loadColor);
    }
}
