/**
 * pageBuilders.js — 各页面一次性构建函数（_buildXxxPage）
 * 负责创建 Konva 图形元素并挂载到对应页面容器。
 * 每个函数仅在初始化时调用一次，运行时刷新由 pageRenderers.js 负责。
 */

import { W, H, BODY_H, C } from './constants.js';
import { mkBtn, mkToggle } from './uiHelpers.js';
import { CANId, CAN_FUNC } from '../CANBUS.js';

// ══════════════════════════════════════════
//  辅助函数
// ══════════════════════════════════════════

/**
 * 判断模块是否真正可用（既不离线也没有超时）
 * @param {Object} cc - 中央计算机实例
 * @param {string} moduleId - 模块ID ('ai', 'ao', 'di', 'do')
 * @returns {boolean} true 表示模块在线且无超时
 */
function isModuleAvailable(cc, moduleId) {
    const bus = cc.sys?.canBus;
    const isOnline = bus ? bus.isNodeOnline(moduleId) : false;

    // 检查该模块的所有通道是否有 hold 标志（超时标记）
    const dataKey = moduleId === 'ai' ? 'ai' : moduleId === 'ao' ? 'ao' : moduleId === 'di' ? 'di' : 'do';
    const moduleData = cc.data?.[dataKey];

    if (!moduleData) return isOnline;

    // 如果任何通道被标记为 hold（超时），则认为模块不可用
    const hasTimeout = Object.values(moduleData).some(ch => ch?.hold === true);

    return isOnline && !hasTimeout;
}

// ══════════════════════════════════════════
//  PAGE 0 — 报警
// ══════════════════════════════════════════
export function buildAlarmPage(cc) {
    const pg = cc._pages[0];
    const pw = W - 8, ph = BODY_H;

    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 2, text: '■ 报警列表', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

    pg.add(new Konva.Text({ x: 8, y: 22, text: '时间        状态   描述', fontSize: 11, fontFamily: 'Courier New', fill: C.textDim }));
    pg.add(new Konva.Line({ points: [6, 34, pw - 6, 34], stroke: C.border, strokeWidth: 1 }));

    cc._alarmLines = [];
    for (let i = 0; i < cc.maxAlarmLines; i++) {
        const t = new Konva.Text({
            x: 8, y: 42 + i * 21, width: pw - 16, text: '',
            fontSize: 12, fontFamily: 'Courier New', fill: C.textDim,
        });
        pg.add(t);
        cc._alarmLines.push(t);
    }

    const btnY = ph - 36;
    pg.add(new Konva.Line({ points: [6, btnY, pw - 6, btnY], stroke: C.border, strokeWidth: 1 }));

    cc._btnAck = mkBtn(pg, '  确  认  ', 120, btnY + 10, C.green);
    cc._btnMute = mkBtn(pg, '  消  音  ', 18, btnY + 10, C.yellow);
    cc._btnClrHist = mkBtn(pg, '  清  除  ', 224, btnY + 10, C.textDim);

    cc._btnAck.on('click tap', () => { cc.activeAlarms.forEach(a => { if (!a.isPhysicalActive && !a.confirmed) a.confirmed = true; }); });
    cc._btnMute.on('click tap', () => { cc.activeAlarms.forEach(a => { if (!a.confirmed) a.muted = true; }); });
    cc._btnClrHist.on('click tap', () => { cc.activeAlarms = cc.activeAlarms.filter(a => !a.confirmed); });

    cc._alarmLed = new Konva.Circle({ x: pw - 22, y: btnY + 12, radius: 10, fill: '#220000', stroke: C.border, strokeWidth: 1 });
    pg.add(cc._alarmLed);
    pg.add(new Konva.Text({ x: pw - 35, y: btnY + 25, text: 'ALARM', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
}

// ══════════════════════════════════════════
//  PAGE 1 — 参数显示（4块）
// ══════════════════════════════════════════
export function buildParamPage(cc) {
    const pg = cc._pages[1];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));

    const bw = Math.floor((pw - 12) / 2);
    const bh = Math.floor((ph - 12) / 2);
    const blocks = [
        { key: 'ai', title: 'AI  模拟量输入', x: 4, y: 4, color: C.blue },
        { key: 'ao', title: 'AO  模拟量输出', x: 4 + bw + 4, y: 4, color: C.orange },
        { key: 'di', title: 'DI  数字量输入', x: 4, y: 4 + bh + 4, color: C.green },
        { key: 'do_', title: 'DO  数字量输出', x: 4 + bw + 4, y: 4 + bh + 4, color: C.purple },
    ];

    cc._paramDisplays = {};
    blocks.forEach(b => {
        const g = new Konva.Group({ x: b.x, y: b.y });
        pg.add(g);
        //整个外框
        g.add(new Konva.Rect({ width: bw, height: bh, fill: C.bg, stroke: b.color + '55', strokeWidth: 1, cornerRadius: 3 }));
        //标题栏矩形
        g.add(new Konva.Rect({ width: bw, height: 18, fill: b.color + '18', cornerRadius: [3, 3, 0, 0] }));
        g.add(new Konva.Text({ x: 6, y: 5, text: b.title, fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: b.color }));

        const rows = [];
        const chLabels = {
            ai: ['CH1 4-20mA', 'CH2 4-20mA', 'CH3 RTD  ', 'CH4 TC   '],
            ao: ['CH1 4-20mA', 'CH2 4-20mA', 'CH3 PWM  ', 'CH4 PWM  '],
            di: ['CH1 干接点 ', 'CH2 干接点 ', 'CH3 湿接点', 'CH4 湿接点'],
            do_: ['CH1 继电器 ', 'CH2 继电器 ', 'CH3 24VPNP', 'CH4 24VPNP'],
        };
        // b.key就是 ‘ai','ao','di','do_'这4个。
        const lbls = chLabels[b.key];
        const rowH = Math.floor((bh - 22) / 4);

        for (let i = 0; i < 4; i++) {
            // 每一行，x坐标相同，改变y坐标
            const ry = 26 + i * rowH;
            // 索引就是最前面的标题文字
            g.add(new Konva.Text({ x: 6, y: ry + 4, text: lbls[i], fontSize: 14, fontFamily: 'Courier New', fill: C.textDim }));
            // 这是显示工程值、或故障的文本。
            const val = new Konva.Text({ x: bw - 90, y: ry + 4, width: 82, text: '---', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text, align: 'right' });
            // 这是进度条，需要修改的地方。
            const bar = new Konva.Rect({ x: 6, y: ry + 20, width: 0, height: 3, fill: b.color + 'aa' });
            g.add(val, bar);
            rows.push({ val, bar, maxBarW: bw - 14 });
        }
        // _paramDisplays，参数的更新就靠它，三个更新，数值（或故障）、进度条对象、最大宽度。
        cc._paramDisplays[b.key] = rows;
    });
}

// ══════════════════════════════════════════
//  PAGE 2 — 网络诊断
// ══════════════════════════════════════════
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

// ══════════════════════════════════════════
//  PAGE 3 — AI 设置
// ══════════════════════════════════════════
export function buildAISetPage(cc) {
    const pg = cc._pages[3];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ AI 模拟量输入设置', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: '4-20mA 压力', range: '0~10 bar' },
        { id: 'ch2', label: 'CH2', type: '4-20mA 压力', range: '0~1.0 MPa' },
        { id: 'ch3', label: 'CH3', type: 'PT100 温度', range: '-50~200°C' },
        { id: 'ch4', label: 'CH4', type: 'TC 温度', range: '0~400°C' },
    ];

    cc._aiRows = {};
    chDefs.forEach((ch, i) => {
        const y = 32 + i * 100;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 94, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 4, text: ch.label + ' ' + ch.type, fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.blue }));

        // 模式切换按钮组
        const modeGrp = new Konva.Group({ x: 234, y });
        const modeBg = new Konva.Rect({ width: 100, height: 20, fill: '#e2e6f4', stroke: C.border, strokeWidth: 1, cornerRadius: 4 });
        const modeTxt = new Konva.Text({ width: 100, height: 20, text: 'mode: --', align: 'center', verticalAlign: 'middle', fontSize: 11, fontFamily: 'Courier New', fill: C.textDim });
        modeGrp.add(modeBg, modeTxt);
        pg.add(modeGrp);

        // 鼠标进入/离开效果
        modeGrp.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ai')) {
                modeGrp.getStage().container().style.cursor = 'pointer';
                modeBg.fill('#d4dce8');
            }
        });
        modeGrp.on('mouseleave', () => {
            modeGrp.getStage().container().style.cursor = 'default';
            modeBg.fill(isModuleAvailable(cc, 'ai') ? '#e2e6f4' : C.textDim + '33');
        });

        modeGrp.on('click tap', () => {
            // 检查 AI 模块是否在线且无超时
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁用按钮

            const ai = cc.sys.comps['ai'];
            if (!ai || !cc.sys || !cc.sys.canBus) return;
            const cur = (ai.channels && ai.channels[ch.id] && ai.channels[ch.id].mode) || 'normal';
            const seq = ['normal', 'disable', 'test'];
            const next = seq[(seq.indexOf(cur) + 1) % seq.length];
            const modeMap = { normal: 0, test: 1, disable: 2 };
            const data = [0x05, i & 0xFF, (modeMap[next] || 0) & 0xFF, 0, 0, 0, 0, 0];
            try {
                if (!cc.data.ai[ch.id]) cc.data.ai[ch.id] = {};
                cc.data.ai[ch.id].mode = next;
                if (ai.channels && ai.channels[ch.id]) ai.channels[ch.id].mode = next;
                modeTxt.text(`Mode: ${next}`);
                modeTxt.fill(next === 'normal' ? C.green : next === 'test' ? C.orange : C.textDim);
                cc._updateAIRowFromModule(ch.id);
            } catch (e) { console.warn('optimistic UI update failed', e); }
            try {
                cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data, sender: cc.id, timestamp: Date.now() });
                setTimeout(() => cc._requestNodeConfig('ai', 0x0A, 0), 60);
            } catch (e) { console.warn(e); }
        });

        // 工程量显示
        pg.add(new Konva.Text({ x: 14, y: y + 71, text: '工程量:', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
        // 大小和单位在这里：
        const valDisplay = new Konva.Text({ x: 124, y: y + 71, width: 100, text: '---', fontSize: 13, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green, align: 'left' });
        pg.add(valDisplay);

        // 量程显示
        const urvText = new Konva.Text({ x: 14, y: y + 51, text: '上限: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const lrvText = new Konva.Text({ x: 124, y: y + 51, text: '下限: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const unitText = new Konva.Text({ x: 234, y: y + 51, text: '单位: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(urvText, lrvText, unitText);

        // 报警阈值显示
        const hhText = new Konva.Text({ x: 14, y: y + 31, text: 'HH: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const hText = new Konva.Text({ x: 124, y: y + 31, text: 'H: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const lText = new Konva.Text({ x: 234, y: y + 31, text: 'L: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const llText = new Konva.Text({ x: 344, y: y + 31, text: 'LL: --', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(hhText, hText, lText, llText);

        // 量程编辑
        urvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openRangeEditor(ch.id, { urvText, lrvText, unitText });
        });
        lrvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openRangeEditor(ch.id, { urvText, lrvText, unitText });
        });
        unitText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openRangeEditor(ch.id, { urvText, lrvText, unitText });
        });

        // 量程编辑文本的鼠标效果
        [urvText, lrvText, unitText].forEach(txt => {
            txt.on('mouseenter', () => {
                const bus = cc.sys?.canBus;
                const aiOnline = bus ? bus.isNodeOnline('ai') : false;
                if (aiOnline) {
                    txt.getStage().container().style.cursor = 'pointer';
                    txt.fill(C.blue);
                }
            });
            txt.on('mouseleave', () => {
                txt.getStage().container().style.cursor = 'default';
                txt.fill(C.textDim);
            });
        });

        // 报警编辑文本的鼠标效果
        [hhText, hText, lText, llText].forEach(txt => {
            txt.on('mouseenter', () => {
                if (isModuleAvailable(cc, 'ai')) {
                    txt.getStage().container().style.cursor = 'pointer';
                    txt.fill(C.blue);
                }
            });
            txt.on('mouseleave', () => {
                txt.getStage().container().style.cursor = 'default';
                txt.fill(C.textDim);
            });
        });

        // 工程量写入（test 模式）
        valDisplay.on('click tap', () => {
            const ai = cc.sys.comps['ai'];
            if (!ai || !cc.sys || !cc.sys.canBus) return;
            const chMode = (ai.channels && ai.channels[ch.id] && ai.channels[ch.id].mode) || 'normal';
            if (chMode !== 'test') return;
            const cur = ai.channels[ch.id] ? ai.channels[ch.id].value : 0;
            const v = prompt(`设置 ${ch.label} 测试工程量（当前 ${cur}）:`, String(cur));
            if (v === null) return;
            const num = parseFloat(v);
            if (isNaN(num)) return alert('请输入有效数字');
            const scale = (ch.id === 'ch1' || ch.id === 'ch2') ? 100 : 10;
            let raw = Math.round(num * scale);
            if (raw < 0) raw = (raw + 0x10000) & 0xFFFF;
            const data = [0x06, i & 0xFF, (raw >> 8) & 0xFF, raw & 0xFF, 0, 0, 0, 0];
            try {
                cc.sys.canBus.send({ id: CANId.encode(CAN_FUNC.AI_CONFIG, 1), extended: false, rtr: false, dlc: 8, data, sender: cc.id, timestamp: Date.now() });
                setTimeout(() => cc._requestNodeConfig('ai', 0x09, i), 60);
            } catch (e) { console.warn(e); }
        });

        // 报警阈值编辑
        [hhText, hText, lText, llText].forEach(t => t.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ai')) return; // 模块离线或超时，禁止修改
            cc._openAlarmEditor(ch.id);
        }));

        cc._aiRows[ch.id] = { modeGrp, modeBg, modeTxt, valDisplay, urvText, lrvText, unitText, hhText, hText, lText, llText };
    });

    // 初始化参数请求
    setTimeout(() => {
        try {
            const bus = cc.sys?.canBus;
            const aiOnline = bus ? bus.isNodeOnline('ai') : false;
            if (aiOnline && cc.busConnected && !cc.commFault) {
                cc.nodeConfigs.ai.available = true;
                cc.nodeConfigs.ai.pending = false;
                cc._initAIParams();
            } else {
                cc.nodeConfigs.ai.available = false;
                cc.nodeConfigs.ai.pending = true;
            }
        } catch (e) { console.warn(e); }
    }, 200);
}

// ══════════════════════════════════════════
//  PAGE 4 — AO 设置
// ══════════════════════════════════════════
export function buildAOPage(cc) {
    const pg = cc._pages[4];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ AO 模拟量输出控制', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.orange }));

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: '4-20mA' },
        { id: 'ch2', label: 'CH2', type: '4-20mA' },
        { id: 'ch3', label: 'CH3', type: 'PWM' },
        { id: 'ch4', label: 'CH4', type: 'PWM' },
    ];

    cc._aoRows = {};
    const sliderTrackW = 400;

    chDefs.forEach((ch, i) => {
        const y = 24 + i * 100;  // 增加行间距为 120px 以容纳安全输出配置
        pg.add(new Konva.Rect({ x: 6, y, width: pw - 12, height: 95, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 6, text: `${ch.label}  [${ch.type}]`, fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.orange }));

        const curVal = new Konva.Text({ x: 14, y: y + 66, text: '工程值：4.00mA', fontSize: 12, fontFamily: 'Courier New', fill: C.text });
        pg.add(curVal);

        // ── 三模式开关：hand / auto / disable ──
        const modeGrp = new Konva.Group({ x: 0.6 * pw, y: y + 4 });
        const modeBg = new Konva.Rect({ width: 100, height: 20, fill: '#e2e6f4', stroke: C.border, strokeWidth: 1, cornerRadius: 4 });
        const modeTxt = new Konva.Text({ width: 100, height: 20, text: 'mode: disable', align: 'center', verticalAlign: 'middle', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        modeGrp.add(modeBg, modeTxt);
        pg.add(modeGrp);
        const applyVal = (clamped) => {
            const pct = Math.round((clamped / sliderTrackW) * 100);
            cc.aoManualVal[ch.id] = pct;
            thumb.x(clamped);
            fillRect.width(clamped);
            valLabel.text(`${pct}%`);

            // 通过 CAN 总线发送输出指令（而不是直接调用 setOutput）
            // 只发送当前通道的值，其他通道保持 0xFFFF（Hold）
            const pctInt = Math.round(pct * 10);  // 百分比 × 100
            const chIdx = i;  // ch1=0, ch2=1, ch3=2, ch4=3

            // 初始化所有通道为 Hold（0xFFFF）
            const data = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];

            // 仅设置当前通道
            const bytePos = chIdx * 2;
            data[bytePos] = (pctInt >> 8) & 0xFF;
            data[bytePos + 1] = pctInt & 0xFF;

            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),  // 节点地址 2（AO模块）
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) {
                console.warn('输出指令发送失败', e);
            }
            cc._refreshCache();
        };

        modeGrp.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ao')) {
                modeGrp.getStage().container().style.cursor = 'pointer';
                modeBg.fill('#d4dce8');
            }
        });
        modeGrp.on('mouseleave', () => {
            modeGrp.getStage().container().style.cursor = 'default';
            modeBg.fill(isModuleAvailable(cc, 'ao') ? '#e2e6f4' : C.textDim + '33');
        });

        modeGrp.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.channels || !ao.channels[ch.id]) return;

            const cur = ao.channels[ch.id].mode || 'disable';
            const seq = ['hand', 'auto', 'disable'];
            const next = seq[(seq.indexOf(cur) + 1) % seq.length];

            // 发送 CAN 配置指令（扩展命令 0x12 = 模式设置）
            // 通过 AO_CMD 帧的字节 8 位置传递命令类型
            const modeMap = { hand: 0, auto: 1, disable: 2 };
            const data = [0x12, i & 0xFF, modeMap[next] & 0xFF, 0, 0, 0, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),  // 节点地址 2（AO模块）
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                cc.data.ao[ch.id].mode = next;
                modeTxt.text(`Mode: ${next}`);
                modeTxt.fill(next === 'hand' ? C.yellow : next === 'auto' ? C.green : C.textDim);
                sliderGrp.opacity(next === 'hand' ? 1 : 0.01);
                if (next === 'disable') {
                    applyVal(0); // 禁用时手动输出 0
                }

                // 延时读取以同步参数
                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x14, i);
                }, 200);
            } catch (e) {
                console.warn('模式切换失败', e);
            }
            cc._refreshCache();
        });

        // ── LRV/URV 显示和编辑 ──
        const lrvText = new Konva.Text({ x: 14, y: y + 38, text: 'LRV: 0%', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        const urvText = new Konva.Text({ x: 114, y: y + 38, text: 'URV: 100%', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(lrvText, urvText);

        lrvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.ranges || !ao.ranges[ch.id]) return;
            const v = prompt(`设置 ${ch.label} LRV（下限，当前 ${ao.ranges[ch.id].lrv}）:`, String(ao.ranges[ch.id].lrv));
            if (v === null) return;
            const num = parseFloat(v);
            if (isNaN(num)) return alert('请输入有效数字');
            const lrv = Math.max(0, Math.min(100, num));
            const urv = ao.ranges[ch.id].urv;

            // 发送 CAN 配置指令（0x13 = LRV/URV 设置）
            const lrvInt = Math.round(lrv * 100);
            const urvInt = Math.round(urv * 100);
            const data = [0x13, i & 0xFF, (lrvInt >> 8) & 0xFF, lrvInt & 0xFF, (urvInt >> 8) & 0xFF, urvInt & 0xFF, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),  // 节点地址 2（AO模块）
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                cc.data.ao[ch.id].lrv = lrv;
                lrvText.text(`LRV: ${lrv}%`);

                // 延时读取以同步参数
                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x14, i);
                }, 200);
            } catch (e) {
                console.warn('LRV 设置失败', e);
            }
            cc._refreshCache();
        });

        urvText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.ranges || !ao.ranges[ch.id]) return;
            const v = prompt(`设置 ${ch.label} URV（上限，当前 ${ao.ranges[ch.id].urv}）:`, String(ao.ranges[ch.id].urv));
            if (v === null) return;
            const num = parseFloat(v);
            if (isNaN(num)) return alert('请输入有效数字');
            const urv = Math.max(0, Math.min(100, num));
            const lrv = ao.ranges[ch.id].lrv;

            // 发送 CAN 配置指令（0x13 = LRV/URV 设置）
            const lrvInt = Math.round(lrv * 100);
            const urvInt = Math.round(urv * 100);
            const data = [0x13, i & 0xFF, (lrvInt >> 8) & 0xFF, lrvInt & 0xFF, (urvInt >> 8) & 0xFF, urvInt & 0xFF, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),  // 节点地址 2（AO模块）
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                cc.data.ao[ch.id].urv = urv;
                urvText.text(`URV: ${urv}%`);

                // 延时读取以同步参数
                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x14, i);
                }, 200);
            } catch (e) {
                console.warn('URV 设置失败', e);
            }
            cc._refreshCache();
        });

        // LRV/URV 文本鼠标效果
        [lrvText, urvText].forEach(txt => {
            txt.on('mouseenter', () => {
                if (isModuleAvailable(cc, 'ao')) {
                    txt.getStage().container().style.cursor = 'pointer';
                    txt.fill(C.blue);
                }
            });
            txt.on('mouseleave', () => {
                txt.getStage().container().style.cursor = 'default';
                txt.fill(C.textDim);
            });
        });

        // ── 滑块（hand 模式下可用）──
        const sliderGrp = new Konva.Group({ x: 154, y: y + 72, opacity: 1 });
        const trackRect = new Konva.Rect({ width: sliderTrackW, height: 6, fill: C.gridLine, stroke: C.border, strokeWidth: 1, cornerRadius: 3 });
        const fillRect = new Konva.Rect({ width: 0, height: 6, fill: C.orange, cornerRadius: 3 });
        const thumb = new Konva.Circle({ x: 0, y: 3, radius: 7, fill: C.orange, stroke: C.bg, strokeWidth: 2 });
        const valLabel = new Konva.Text({ x: sliderTrackW + 10, y: -2, text: '0%', fontSize: 10, fontFamily: 'Courier New', fill: C.orange });

        sliderGrp.add(trackRect, fillRect, thumb, valLabel);
        pg.add(sliderGrp);

        thumb.draggable(true);
        thumb.dragBoundFunc(pos => {
            // 检查是否为 hand 模式，不是则禁止拖动
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.channels || !ao.channels[ch.id] || ao.channels[ch.id].mode !== 'hand') {
                return { x: thumb.getAbsolutePosition().x, y: thumb.getAbsolutePosition().y };
            }

            const absGroupX = sliderGrp.getAbsolutePosition().x;
            const localX = pos.x - absGroupX;
            const clamped = Math.max(0, Math.min(sliderTrackW + 200, localX));
            return { x: clamped + absGroupX, y: thumb.getAbsolutePosition().y };
        });



        thumb.on('dragmove', () => {
            const ao = cc.sys.comps['ao'];
            if (ao && ao.channels && ao.channels[ch.id] && ao.channels[ch.id].mode === 'hand') {
                // 相对于 sliderGrp 的本地坐标
                const localX = thumb.x();
                applyVal(localX);
            }
        });

        // ── 安全输出配置显示和编辑 ──
        // 模式文本框：显示 "Safe: mode"，点击切换模式
        const safeModeText = new Konva.Text({ x: 214, y: y + 38, text: 'Safe: hold', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(safeModeText);

        // 预设值文本框：显示 "[50%]"，仅 preset 模式显示，点击修改
        const safePresetText = new Konva.Text({ x: 314, y: y + 38, text: '', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(safePresetText);

        // 模式切换事件
        safeModeText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.safeOutput || !ao.safeOutput[ch.id]) return;
            const safeOut = ao.safeOutput[ch.id];

            const curMode = safeOut.mode || 'hold';
            let presetVal = safeOut.presetPercent || 0;

            // 循环切换模式：hold → zero → preset
            const modeSeq = ['hold', 'preset', 'zero'];
            const nextMode = modeSeq[(modeSeq.indexOf(curMode) + 1) % modeSeq.length];

            // 发送 CAN 配置指令（0x16 = 安全输出设置）
            const modeMap = { hold: 0, preset: 1, zero: 2 };
            const presetInt = Math.round(presetVal * 100);
            const data = [0x16, i & 0xFF, modeMap[nextMode] & 0xFF,
                (presetInt >> 8) & 0xFF, presetInt & 0xFF, 0, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),  // 节点地址 2（AO模块）
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                if (!cc.data.ao[ch.id].safeOutput) cc.data.ao[ch.id].safeOutput = {};
                cc.data.ao[ch.id].safeOutput.mode = nextMode;
                cc.data.ao[ch.id].safeOutput.presetPercent = presetVal;

                // 更新模式文本
                safeModeText.text(`Safe: ${nextMode}`);
                // 更新预设值文本（仅 preset 模式显示）
                safePresetText.text(nextMode === 'preset' ? `[${presetVal}%]` : '');

                // 延时读取以同步参数
                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x15, i);
                }, 200);
            } catch (e) {
                console.warn('安全输出设置失败', e);
            }
            cc._refreshCache();
        });

        // 预设值修改事件（仅 preset 模式可用）
        safePresetText.on('click tap', () => {
            if (!isModuleAvailable(cc, 'ao')) return;
            const ao = cc.sys.comps['ao'];
            if (!ao || !ao.safeOutput || !ao.safeOutput[ch.id]) return;
            const safeOut = ao.safeOutput[ch.id];

            // 只有 preset 模式时才允许修改
            if (safeOut.mode !== 'preset') return;

            let presetVal = safeOut.presetPercent || 0;
            const input = prompt(`修改 ${ch.label} 预设值（0-100%）:`, String(presetVal));
            if (input === null) return;  // 用户取消
            const num = parseFloat(input);
            if (isNaN(num)) return alert('请输入有效数字');
            presetVal = Math.max(0, Math.min(100, num));

            // 发送 CAN 配置指令（0x16 = 安全输出设置）
            const modeMap = { hold: 0, preset: 1, zero: 2 };
            const presetInt = Math.round(presetVal * 100);
            const data = [0x16, i & 0xFF, modeMap['preset'] & 0xFF,
                (presetInt >> 8) & 0xFF, presetInt & 0xFF, 0, 0, 0];
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.AO_CMD, 2),
                    extended: false, rtr: false, dlc: 8, data,
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                if (!cc.data.ao[ch.id]) cc.data.ao[ch.id] = {};
                if (!cc.data.ao[ch.id].safeOutput) cc.data.ao[ch.id].safeOutput = {};
                cc.data.ao[ch.id].safeOutput.presetPercent = presetVal;
                safePresetText.text(`[${presetVal}%]`);

                // 延时读取以同步参数
                setTimeout(() => {
                    cc._requestNodeConfig('ao', 0x15, i);
                }, 200);
            } catch (e) {
                console.warn('预设值修改失败', e);
            }
            cc._refreshCache();
        });

        // 模式文本框鼠标效果
        safeModeText.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ao')) {
                safeModeText.getStage().container().style.cursor = 'pointer';
                safeModeText.fill(C.blue);
            }
        });
        safeModeText.on('mouseleave', () => {
            safeModeText.getStage().container().style.cursor = 'default';
            safeModeText.fill(C.textDim);
        });

        // 预设值文本框鼠标效果
        safePresetText.on('mouseenter', () => {
            if (isModuleAvailable(cc, 'ao')) {
                const ao = cc.sys.comps['ao'];
                // 仅 preset 模式时显示指针
                if (ao && ao.safeOutput && ao.safeOutput[ch.id] && ao.safeOutput[ch.id].mode === 'preset') {
                    safePresetText.getStage().container().style.cursor = 'pointer';
                    safePresetText.fill(C.blue);
                }
            }
        });
        safePresetText.on('mouseleave', () => {
            safePresetText.getStage().container().style.cursor = 'default';
            safePresetText.fill(C.textDim);
        });

        cc._aoRows[ch.id] = { curVal, modeGrp, modeBg, modeTxt, lrvText, urvText, safeModeText, safePresetText, sliderGrp, fillRect, thumb, valLabel };
    });
}

// ══════════════════════════════════════════
//  PAGE 5 — DI 设置
// ══════════════════════════════════════════
export function buildDISetPage(cc) {
    const pg = cc._pages[5];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ DI 数字量输入设置', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green }));

    ['通道', '类型', '当前状态', '计数器', '防抖时间', '复位计数', '报警触发'].forEach((h, i) => {
        pg.add(new Konva.Text({ x: [8, 72, 148, 240, 340, 420, 500][i], y: 30, text: h, fontSize: 12, fontFamily: 'Courier New', fill: C.textDim }));
    });

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: '干接点' },
        { id: 'ch2', label: 'CH2', type: '干接点' },
        { id: 'ch3', label: 'CH3', type: '湿接点' },
        { id: 'ch4', label: 'CH4', type: '湿接点' },
    ];

    cc._diRows = {};
    chDefs.forEach((ch, i) => {
        const y = 50 + i * 60;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 52, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 20, text: ch.label, fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
        pg.add(new Konva.Text({ x: 72, y: y + 20, text: ch.type, fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

        const stateDisp = new Konva.Text({ x: 148, y: y + 20, text: 'OFF', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim });
        const counterDisp = new Konva.Text({ x: 240, y: y + 20, text: '0', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan });
        pg.add(stateDisp, counterDisp);
        pg.add(new Konva.Text({ x: 340, y: y + 20, text: '20ms', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

        // 复位按钮 - 清除计数器
        const resetBtn = mkBtn(pg, '复位', 420, y + 14, C.orange);
        resetBtn.on('click tap', () => {
            // 发送 CAN 命令清除计数 (cmd=0x02, chMask对应当前通道)
            const chIdx = i;
            const chMask = 1 << chIdx;  // 仅清除当前通道
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DI_CONFIG, 3),  // 节点地址 3
                    extended: false, rtr: false, dlc: 2,
                    data: [0x02, chMask, 0, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
                // 乐观UI更新
                cc.data.di[ch.id].counter = 0;
                counterDisp.text('0');
                cc._refreshCache();
            } catch (e) {
                console.warn('计数器清除失败', e);
            }
        });

        // 报警按钮 - 切换触发方式 (ON -> OFF -> NONE -> ON)
        const triggerMap = { 'ON': '闭合报警', 'OFF': '断开报警', 'NONE': '不报警' };
        const reverseTriggerMap = { '闭合报警': 'ON', '断开报警': 'OFF', '不报警': 'NONE' };
        const triggerOrder = ['ON', 'OFF', 'NONE'];

        const currentTrigger = cc.data.di[ch.id].trigger || 'OFF';
        const alarmBtn = mkToggle(pg, triggerMap[currentTrigger], 500, y + 14, 80, 22, false, C.red);

        alarmBtn.on('click tap', () => {
            // 获取当前触发方式
            const currentText = alarmBtn.findOne('Text').text();
            const currentTrigger = reverseTriggerMap[currentText];

            // 循环到下一种方式
            const currentIdx = triggerOrder.indexOf(currentTrigger);
            const nextTrigger = triggerOrder[(currentIdx + 1) % triggerOrder.length];
            const nextText = triggerMap[nextTrigger];

            // 更新本地数据
            cc.data.di[ch.id].trigger = nextTrigger;

            // 发送 CAN 命令更改报警触发方式
            // 编码方案：Byte3 中对应位的值表示触发方式 (0=OFF, 1=ON, 2=NONE)
            const chIdx = i;
            const chMask = 1 << chIdx;
            const triggerValue = (nextTrigger === 'ON') ? 1 : (nextTrigger === 'NONE' ? 2 : 0);

            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DI_CONFIG, 3),  // 节点地址 3
                    extended: false, rtr: false, dlc: 4,
                    data: [0x01, chMask, chIdx, triggerValue, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) {
                console.warn('报警触发方式更改失败', e);
            }

            // 更新UI
            const btnColor = nextTrigger === 'NONE' ? C.textDim : (nextTrigger === 'ON' ? C.red : C.orange);
            const alarmBtnChildren = alarmBtn.getChildren();
            if (alarmBtnChildren && alarmBtnChildren.length >= 2) {
                alarmBtnChildren[0].fill(btnColor + '33');
                alarmBtnChildren[0].stroke(btnColor);
                alarmBtnChildren[1].text(nextText);
                alarmBtnChildren[1].fill(btnColor);
            }
            cc._refreshCache();
        });



        cc._diRows[ch.id] = { stateDisp, counterDisp, alarmBtn };
    });
    // 初始化参数请求
    setTimeout(() => {
        try {
            const bus = cc.sys?.canBus;
            const diOnline = bus ? bus.isNodeOnline('di') : false;
            if (diOnline && cc.busConnected && !cc.commFault) {
                cc.nodeConfigs.di.available = true;
                cc.nodeConfigs.di.pending = false;
                cc._initDIParams();
            } else {
                cc.nodeConfigs.di.available = false;
                cc.nodeConfigs.di.pending = true;
            }
        } catch (e) { console.warn(e); }
    }, 200);
}

// ══════════════════════════════════════════
//  PAGE 6 — DO 设置
// ══════════════════════════════════════════
export function buildDOPage(cc) {
    const pg = cc._pages[6];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ DO 数字量输出控制', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.purple }));

    ['通道', '类型', '当前状态', '控制模式', '手动手动', '脉冲参数', '安全输出'].forEach((h, i) => {
        pg.add(new Konva.Text({ x: [8, 68, 138, 220, 310, 400, 520][i], y: 24, text: h, fontSize: 11, fontFamily: 'Courier New', fill: C.textDim }));
    });

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: 'RELAY' },
        { id: 'ch2', label: 'CH2', type: 'RELAY' },
        { id: 'ch3', label: 'CH3', type: '24VPNP' },
        { id: 'ch4', label: 'CH4', type: '24VPNP' },
    ];

    // 模式名：内部值 → 显示文字
    const MODE_LABELS = { hand: '手  动', auto: '自  动', pulse: '脉冲模式', disable: '禁  用' };
    const MODE_COLORS = { hand: C.yellow, auto: C.green, pulse: C.cyan, disable: C.textDim };
    const MODE_SEQ    = ['hand', 'auto', 'pulse', 'disable'];

    cc._doRows = {};

    chDefs.forEach((ch, i) => {
        const y = 40 + i * 60;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 52, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 16, text: ch.label, fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
        pg.add(new Konva.Text({ x: 68, y: y + 16, text: ch.type, fontSize: 11, fontFamily: 'Courier New', fill: C.textDim }));

        // ── 当前状态 ──
        const stateDisp = new Konva.Text({
            x: 138, y: y + 12, width: 80, text: 'OFF',
            fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim
        });
        pg.add(stateDisp);

        // ── 模式按钮（4 种循环）──
        const modeBtn = mkToggle(pg, '手  动', 220, y + 10, 70, 24, false, C.yellow);

        // ── 手动手动按钮（仅 hand 模式激活）──
        const forceBtn = mkToggle(pg, '手动 OFF', 310, y + 10, 60, 24, false, C.textDim);
        forceBtn.opacity(0.35);

        // ── 脉冲参数按钮（仅 pulse 模式激活）──
        const pulseBtn = mkToggle(pg, '500  500  0', 400, y + 10, 98, 24, false, C.cyan);
        pulseBtn.opacity(0.35);

        // ── 安全输出按钮（循环 off / hold / preset）──
        const safeBtn = mkToggle(pg, 'Safe: off', 520, y + 10, 70, 24, false, C.textDim);

        // ── preset 预设状态按钮（仅 preset 模式才可见）──
        const presetBtn = mkToggle(pg, '预设: OFF', 600, y + 10, 52, 24, false, C.orange);
        presetBtn.visible(false);

        // ── 模式切换逻辑 ──
        modeBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const cur = doMod.channels?.[ch.id]?.mode || 'hand';
            const next = MODE_SEQ[(MODE_SEQ.indexOf(cur) + 1) % MODE_SEQ.length];
            const modeIdx = MODE_SEQ.indexOf(next);
            // 发送 CAN 0x10 设置模式
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x10, 1 << i, modeIdx & 0xFF, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            // 乐观 UI 更新
            if (doMod.channels?.[ch.id]) doMod.channels[ch.id].mode = next;
            if (!cc.data.do[ch.id]) cc.data.do[ch.id] = {};
            cc.data.do[ch.id].mode = next;
            _applyDoModeUI(modeBtn, forceBtn, pulseBtn, next, doMod, ch.id);
            cc._refreshCache();
        });

        // ── 手动手动切换 ──
        forceBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const curMode = doMod.channels?.[ch.id]?.mode || 'hand';
            if (curMode !== 'hand') return;
            const curState = doMod.channels?.[ch.id]?.state ?? false;
            const nextState = !curState;
            // 发送 CAN 0x01 直接输出控制
            const stateMask = nextState ? (1 << i) : 0;
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x01, 1 << i, stateMask, 0, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.channels?.[ch.id]) doMod.channels[ch.id].state = nextState;
            const onColor = C.red;
            const forceBtnChildren = forceBtn.getChildren();
            if (forceBtnChildren && forceBtnChildren.length >= 2) {
                forceBtnChildren[0].fill(nextState ? onColor + '33' : C.textDim + '22');
                forceBtnChildren[0].stroke(nextState ? onColor : C.textDim);
                forceBtnChildren[1].text(nextState ? '手动  ON ' : '手动 OFF');
                forceBtnChildren[1].fill(nextState ? onColor : C.textDim);
            }
            cc._refreshCache();
        });

        // ── 脉冲参数弹窗 ──
        pulseBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const curMode = doMod.channels?.[ch.id]?.mode || 'hand';
            if (curMode !== 'pulse') return;
            const pc = doMod.pulseConfig?.[ch.id] || { onMs: 500, offMs: 500, phaseStart: 0 };
            const input = prompt(
                `设置 ${ch.label} 脉冲参数\n格式：高电平时间(ms) 低电平时间(ms) 相位(ms)\n当前：${pc.onMs}  ${pc.offMs}  ${pc.phaseStart}`,
                `${pc.onMs} ${pc.offMs} ${pc.phaseStart}`
            );
            if (input === null) return;
            const parts = input.trim().split(/\s+/).map(Number);
            if (parts.length < 2 || parts.some(isNaN)) return alert('请输入有效数字，用空格分隔');
            const onMs  = Math.max(50, parts[0]);
            const offMs = Math.max(50, parts[1]);
            const phase = Math.max(0, parts[2] || 0);
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [
                        0x11, 1 << i,
                        (onMs >> 8) & 0xFF, onMs & 0xFF,
                        (offMs >> 8) & 0xFF, offMs & 0xFF,
                        (phase >> 8) & 0xFF, phase & 0xFF
                    ],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.pulseConfig?.[ch.id]) {
                doMod.pulseConfig[ch.id].onMs  = onMs;
                doMod.pulseConfig[ch.id].offMs = offMs;
                doMod.pulseConfig[ch.id].phaseStart = phase;
            }
            pulseBtn.findOne('Text').text(`${onMs}  ${offMs}  ${phase}`);
            cc._refreshCache();
        });

        // ── 安全输出模式切换 ──
        const SAFE_SEQ = ['off', 'hold', 'preset'];
        const SAFE_COLORS = { off: C.textDim, hold: C.yellow, preset: C.orange };
        safeBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const cur = doMod.safeOutput?.[ch.id]?.mode || 'off';
            const next = SAFE_SEQ[(SAFE_SEQ.indexOf(cur) + 1) % SAFE_SEQ.length];
            const modeIdx = SAFE_SEQ.indexOf(next);
            const presMask = doMod.safeOutput?.[ch.id]?.presetState ? (1 << i) : 0;
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x12, 1 << i, modeIdx & 0xFF, presMask, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.safeOutput?.[ch.id]) doMod.safeOutput[ch.id].mode = next;
            if (!cc.data.do[ch.id]) cc.data.do[ch.id] = {};
            cc.data.do[ch.id].safeMode = next;
            const sc = SAFE_COLORS[next];
            const safeBtnChildren = safeBtn.getChildren();
            if (safeBtnChildren && safeBtnChildren.length >= 2) {
                safeBtnChildren[0].fill(sc + '33');
                safeBtnChildren[0].stroke(sc);
                safeBtnChildren[1].text(`Safe: ${next}`);
                safeBtnChildren[1].fill(sc);
            }
            presetBtn.visible(next === 'preset');
            cc._refreshCache();
        });

        // ── preset 状态切换 ──
        presetBtn.on('click tap', () => {
            if (!isModuleAvailable(cc, 'do')) return;
            const doMod = cc.sys.comps['do'];
            if (!doMod) return;
            const curPreset = doMod.safeOutput?.[ch.id]?.presetState ?? false;
            const nextPreset = !curPreset;
            const modeIdx = SAFE_SEQ.indexOf(doMod.safeOutput?.[ch.id]?.mode || 'preset');
            const presMask = nextPreset ? (1 << i) : 0;
            try {
                cc.sys.canBus.send({
                    id: CANId.encode(CAN_FUNC.DO_CMD, 4),
                    extended: false, rtr: false, dlc: 8,
                    data: [0x12, 1 << i, modeIdx < 0 ? 2 : modeIdx, presMask, 0, 0, 0, 0],
                    sender: cc.id, timestamp: Date.now()
                });
            } catch (e) { console.warn(e); }
            if (doMod.safeOutput?.[ch.id]) doMod.safeOutput[ch.id].presetState = nextPreset;
            if (!cc.data.do[ch.id]) cc.data.do[ch.id] = {};
            cc.data.do[ch.id].presetState = nextPreset;
            const presetBtnChildren = presetBtn.getChildren();
            if (presetBtnChildren && presetBtnChildren.length >= 2) {
                presetBtnChildren[1].text(nextPreset ? '预设:  ON' : '预设: OFF');
                presetBtnChildren[0].fill(nextPreset ? C.orange + '33' : C.textDim + '22');
                presetBtnChildren[0].stroke(nextPreset ? C.orange : C.textDim);
                presetBtnChildren[1].fill(nextPreset ? C.orange : C.textDim);
            }
            cc._refreshCache();
        });

        cc._doRows[ch.id] = { stateDisp, modeBtn, forceBtn, pulseBtn, safeBtn, presetBtn };
    });

    // ── 初始化：DO 上线后读取参数 ──
    setTimeout(() => {
        try {
            const bus = cc.sys?.canBus;
            const doOnline = bus ? bus.isNodeOnline('do') : false;
            if (doOnline && cc.busConnected && !cc.commFault) {
                cc.nodeConfigs.do.available = true;
                cc.nodeConfigs.do.pending = false;
                cc._initDOParams();
            } else {
                cc.nodeConfigs.do.available = false;
                cc.nodeConfigs.do.pending = true;
            }
        } catch (e) { console.warn(e); }
    }, 200);
}

/**
 * 内部辅助：根据模式更新 DO 行按钮外观
 */
function _applyDoModeUI(modeBtn, forceBtn, pulseBtn, mode, doMod, chId) {
    const MODE_LABELS = { hand: '手  动', auto: '自  动', pulse: '脉冲模式', disable: '禁  用' };
    const MODE_COLORS = { hand: C.yellow, auto: C.green, pulse: C.cyan, disable: C.textDim };
    const mc = MODE_COLORS[mode] || C.textDim;
    
    // 直接访问 Group 的子元素
    let children = modeBtn.getChildren();
    if (children && children.length >= 2) {
        children[0].fill(mc + '33');
        children[0].stroke(mc);
        children[1].text(MODE_LABELS[mode] || mode);
        children[1].fill(mc);
    }

    const isHand  = mode === 'hand';
    const isPulse = mode === 'pulse';
    forceBtn.opacity(isHand  ? 1 : 0.35);
    pulseBtn.opacity(isPulse ? 1 : 0.35);

    if (isPulse && doMod?.pulseConfig?.[chId]) {
        const pc = doMod.pulseConfig[chId];
        const phMs = pc.phaseStart;
        children = pulseBtn.getChildren();
        if (children && children.length >= 2) {
            children[1].text(`${pc.onMs}  ${pc.offMs}  ${phMs}`);
        }
    }
}

// ══════════════════════════════════════════
//  PAGE 7 — 液位控制
// ══════════════════════════════════════════
export function buildLevelPage(cc) {
    const pg = cc._pages[7];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ 液位双位控制系统', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

    const tkX = 100, tkY = 26, tkW = 100, tkH = 210;
    pg.add(new Konva.Rect({ x: tkX, y: tkY, width: tkW, height: tkH, fill: '#eeeff1', stroke: C.cyan + '66', strokeWidth: 2, cornerRadius: 4 }));

    cc._lvFill = new Konva.Rect({ x: tkX + 2, y: tkY + tkH - 2, width: tkW - 4, height: 0, fill: C.cyan + '77', cornerRadius: [0, 0, 3, 3] });
    pg.add(cc._lvFill);

    // 刻度线
    [{ l: 'HH', p: 0.80, c: C.red }, { l: 'H', p: 0.70, c: C.yellow }, { l: 'L', p: 0.30, c: C.yellow }, { l: 'LL', p: 0.20, c: C.red }].forEach(s => {
        const ly = tkY + tkH * (1 - s.p);
        pg.add(new Konva.Line({ points: [tkX - 6, ly, tkX + tkW + 6, ly], stroke: s.c, strokeWidth: 1, dash: [4, 3] }));
        pg.add(new Konva.Text({ x: tkX + tkW + 8, y: ly - 5, text: s.l, fontSize: 8, fontFamily: 'Courier New', fill: s.c }));
    });

    cc._lvText = new Konva.Text({ x: tkX, y: tkY + tkH + 6, width: tkW, text: '45.0%', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan, align: 'center' });
    pg.add(cc._lvText);

    // 管道
    pg.add(new Konva.Rect({ x: tkX - 36, y: tkY + 18, width: 36, height: 12, fill: '#eaf0f5', stroke: C.blue + '66', strokeWidth: 1 }));
    cc._inletFlowBar = new Konva.Rect({ x: tkX - 34, y: tkY + 20, width: 0, height: 8, fill: C.blue + '88' });
    pg.add(cc._inletFlowBar);
    pg.add(new Konva.Text({ x: tkX - 30, y: tkY + 8, text: '进水', fontSize: 8, fontFamily: 'Courier New', fill: C.blue }));

    pg.add(new Konva.Rect({ x: tkX + tkW, y: tkY + tkH - 36, width: 36, height: 12, fill: '#f4f5f7', stroke: C.orange + '66', strokeWidth: 1 }));
    cc._drainFlowBar = new Konva.Rect({ x: tkX + tkW + 2, y: tkY + tkH - 34, width: 35, height: 8, fill: C.orange + '88' });
    pg.add(cc._drainFlowBar);
    pg.add(new Konva.Text({ x: tkX + tkW + 6, y: tkY + tkH - 18, text: '排水', fontSize: 8, fontFamily: 'Courier New', fill: C.orange }));

    // 右侧控制面板
    const cx = 285;
    pg.add(new Konva.Text({ x: cx, y: 22, text: '■ 控制参数', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

    cc._lvParamTexts = {};
    [{ label: 'HH报警', key: 'setHH', color: C.red }, { label: 'H  上限', key: 'setH', color: C.yellow },
    { label: 'L  下限', key: 'setL', color: C.yellow }, { label: 'LL报警', key: 'setLL', color: C.red }].forEach((p, i) => {
        const py = 42 + i * 22;
        pg.add(new Konva.Text({ x: cx, y: py, text: p.label + ' :', fontSize: 12, fontFamily: 'Courier New', fill: p.color }));
        const vt = new Konva.Text({ x: cx + 80, y: py, text: `${cc.levelCtrl[p.key]}%`, fontSize: 12, fontFamily: 'Courier New', fill: C.text });
        pg.add(vt);
        cc._lvParamTexts[p.key] = vt;
    });

    pg.add(new Konva.Text({ x: cx, y: 140, text: '■ 执行机构', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));
    cc._pumpText = new Konva.Text({ x: cx, y: 162, text: '进水阀:  OFF ○', fontSize: 12, fontFamily: 'Courier New', fill: C.textDim });
    cc._lvAlarmText = new Konva.Text({ x: cx, y: 190, text: '● 液位正常', fontSize: 12, fontFamily: 'Courier New', fill: C.green });
    pg.add(cc._pumpText, cc._lvAlarmText);

    // 仿真控制
    cc._simBtn = mkBtn(pg, '控制:自动', cx, 222, C.cyan);
    cc._pumpBtn = mkBtn(pg, '进水泵:运行', cx + 115, 222, C.blue);
    cc._switchBtn = mkBtn(pg, '液位开关:闭合', cx + 230, 222, C.orange);

    // 液位趋势
    const trX = 50, trY = 270, trW = 570, trH = 150;
    pg.add(new Konva.Rect({ x: trX, y: trY, width: trW, height: trH, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
    pg.add(new Konva.Text({ x: trX + 3, y: trY + 2, text: '液位趋势图', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));
    cc._lvTrendLine = new Konva.Line({ stroke: C.cyan, strokeWidth: 1.5 });
    pg.add(cc._lvTrendLine);
    cc._lvTrendMeta = { x: trX, y: trY, w: trW, h: trH };
}

// ══════════════════════════════════════════
//  PAGE 8 — 温度控制
// ══════════════════════════════════════════
export function buildTempPage(cc) {
    const pg = cc._pages[8];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ 温度控制系统', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.red }));

    const thX = 28, thY = 24, thW = 36, thH = 210;
    pg.add(new Konva.Rect({ x: thX, y: thY, width: thW, height: thH, fill: '#0a0808', stroke: C.red + '55', strokeWidth: 1, cornerRadius: 4 }));
    cc._thermFill = new Konva.Rect({ x: thX + 3, y: thY + thH - 3, width: thW - 6, height: 0, fill: C.red + '99', cornerRadius: [0, 0, 2, 2] });
    pg.add(cc._thermFill);

    // 刻度
    for (let t = 0; t <= 120; t += 20) {
        const gy = thY + thH - 2 - (t / 120) * (thH - 4);
        pg.add(new Konva.Line({ points: [thX - 4, gy, thX, gy], stroke: C.textDim, strokeWidth: 1 }));
        pg.add(new Konva.Text({ x: thX - 28, y: gy - 4, text: `${t}°`, fontSize: 7, fontFamily: 'Courier New', fill: C.textDim }));
    }
    cc._pvLabel = new Konva.Text({ x: thX, y: thY + thH + 5, width: thW, text: '25°C', fontSize: 8, fontFamily: 'Courier New', fill: C.red, align: 'center' });
    pg.add(cc._pvLabel);

    // PID 状态区
    const px = 92;
    pg.add(new Konva.Text({ x: px, y: 22, text: '■ PID 运行状态', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.red }));

    cc._tempDisp = {};
    [{ label: 'PV 测量值', key: 'pv', color: C.red }, { label: 'SV 设定值', key: 'sv', color: C.green }, { label: 'OUT 输出', key: 'out', color: C.yellow }].forEach((r, i) => {
        const ry = 38 + i * 28;
        pg.add(new Konva.Text({ x: px, y: ry, text: r.label + ' :', fontSize: 9, fontFamily: 'Courier New', fill: r.color }));
        const vt = new Konva.Text({ x: px + 120, y: ry - 2, text: '---', fontSize: 14, fontFamily: 'Courier New', fontStyle: 'bold', fill: r.color });
        pg.add(vt);
        cc._tempDisp[r.key] = vt;
    });

    // 控制模式
    pg.add(new Konva.Text({ x: px, y: 128, text: '控制模式 :', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
    cc._tempModeText = new Konva.Text({ x: px + 84, y: 128, text: 'AUTO', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.green });
    pg.add(cc._tempModeText);

    const amBtn = mkToggle(pg, '自  动', px + 130, 124, 76, 20, false, C.green);
    amBtn.on('click tap', () => {
        cc.tempCtrl.mode = cc.tempCtrl.mode === 'AUTO' ? 'MAN' : 'AUTO';
        const isM = cc.tempCtrl.mode === 'MAN';
        amBtn.findOne('Rect').fill(isM ? C.yellow + '33' : C.green + '22');
        amBtn.findOne('Rect').stroke(isM ? C.yellow : C.green);
        amBtn.findOne('Text').text(isM ? '手  动' : '自  动');
        amBtn.findOne('Text').fill(isM ? C.yellow : C.green);
        cc._tempModeText.text(cc.tempCtrl.mode);
        cc._tempModeText.fill(isM ? C.yellow : C.green);
        cc._refreshCache();
    });

    // SV 调节
    pg.add(new Konva.Text({ x: px, y: 154, text: 'SV 调节 :', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
    const svUp = mkBtn(pg, '▲+5', px + 78, 150, C.green);
    const svDn = mkBtn(pg, '▼-5', px + 130, 150, C.red);
    svUp.on('click tap', () => { cc.tempCtrl.sv = Math.min(150, cc.tempCtrl.sv + 5); });
    svDn.on('click tap', () => { cc.tempCtrl.sv = Math.max(0, cc.tempCtrl.sv - 5); });

    // 加热器 & 冷却器
    pg.add(new Konva.Text({ x: px, y: 182, text: '加热器', fontSize: 8, fontFamily: 'Courier New', fill: C.textDim }));
    pg.add(new Konva.Text({ x: px + 78, y: 182, text: '冷却器', fontSize: 8, fontFamily: 'Courier New', fill: C.textDim }));
    cc._heaterBox = new Konva.Rect({ x: px, y: 194, width: 64, height: 20, fill: '#1a0000', stroke: C.blue, strokeWidth: 1, cornerRadius: 2 });
    cc._heaterTxt = new Konva.Text({ x: px, y: 194, width: 64, height: 20, text: 'OFF', align: 'center', verticalAlign: 'middle', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim });
    cc._coolerBox = new Konva.Rect({ x: px + 78, y: 194, width: 64, height: 20, fill: '#001020', stroke: C.blue, strokeWidth: 1, cornerRadius: 2 });
    cc._coolerTxt = new Konva.Text({ x: px + 78, y: 194, width: 64, height: 20, text: 'OFF', align: 'center', verticalAlign: 'middle', fontSize: 9, fontFamily: 'Courier New', fill: C.textDim });
    pg.add(cc._heaterBox, cc._heaterTxt, cc._coolerBox, cc._coolerTxt);

    // 趋势图
    const trY = 226, trW = pw - 16, trH = ph - trY - 8;
    pg.add(new Konva.Rect({ x: 6, y: trY, width: trW, height: trH, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
    pg.add(new Konva.Text({ x: 10, y: trY + 2, text: 'PV ─   SV - -   OUT ···', fontSize: 7, fontFamily: 'Courier New', fill: C.textDim }));
    [0.25, 0.5, 0.75].forEach(f => {
        const gy = trY + trH * (1 - f);
        pg.add(new Konva.Line({ points: [6, gy, 6 + trW, gy], stroke: C.gridLine, strokeWidth: 1 }));
    });
    cc._tPV = new Konva.Line({ stroke: C.red, strokeWidth: 1.5 });
    cc._tSV = new Konva.Line({ stroke: C.green, strokeWidth: 1.5, dash: [6, 4] });
    cc._tOUT = new Konva.Line({ stroke: C.yellow, strokeWidth: 1, dash: [2, 2] });
    pg.add(cc._tPV, cc._tSV, cc._tOUT);
    cc._tempTrendMeta = { x: 6, y: trY, w: trW, h: trH };
}