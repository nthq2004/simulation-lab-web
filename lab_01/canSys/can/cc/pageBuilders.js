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
            do_: ['CH1 继电器 ', 'CH2 继电器 ', 'CH3 24VNPN', 'CH4 24VNPN'],
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
    const sliderTrackW = pw - 80;

    chDefs.forEach((ch, i) => {
        const y = 24 + i * 70;
        pg.add(new Konva.Rect({ x: 6, y, width: pw - 12, height: 64, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 6, text: `${ch.label}  [${ch.type}]`, fontSize: 10, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.orange }));

        const curVal = new Konva.Text({ x: 14, y: y + 22, text: '0.0%  /  4.00mA', fontSize: 9, fontFamily: 'Courier New', fill: C.text });
        pg.add(curVal);

        // 自动/手动切换
        const modeBtn = mkToggle(pg, '自  动', pw - 100, y + 4, 80, 22, false, C.green);
        const sliderGrp = new Konva.Group({ x: 14, y: y + 44, opacity: 0.3 });
        modeBtn.on('click tap', () => {
            cc.aoManual[ch.id] = !cc.aoManual[ch.id];
            const isM = cc.aoManual[ch.id];
            modeBtn.findOne('Rect').fill(isM ? C.yellow + '33' : C.green + '22');
            modeBtn.findOne('Rect').stroke(isM ? C.yellow : C.green);
            modeBtn.findOne('Text').text(isM ? '手  动' : '自  动');
            modeBtn.findOne('Text').fill(isM ? C.yellow : C.green);
            sliderGrp.opacity(isM ? 1 : 0.3);
            cc._refreshCache();
        });

        // 滑块
        const trackRect = new Konva.Rect({ width: sliderTrackW, height: 6, fill: C.gridLine, stroke: C.border, strokeWidth: 1, cornerRadius: 3 });
        const fillRect = new Konva.Rect({ width: 0, height: 6, fill: C.orange, cornerRadius: 3 });
        const thumb = new Konva.Circle({ x: 0, y: 3, radius: 7, fill: C.orange, stroke: C.bg, strokeWidth: 2 });
        const valLabel = new Konva.Text({ x: sliderTrackW + 10, y: -2, text: '0%', fontSize: 10, fontFamily: 'Courier New', fill: C.orange });

        sliderGrp.add(trackRect, fillRect, thumb, valLabel);
        pg.add(sliderGrp);

        thumb.draggable(true);
        thumb.dragBoundFunc(pos => {
            const absGroupX = sliderGrp.getAbsolutePosition().x;
            const localX = pos.x - absGroupX;
            const clamped = Math.max(0, Math.min(sliderTrackW, localX));
            return { x: clamped + absGroupX, y: thumb.getAbsolutePosition().y };
        });

        const applyVal = (clamped) => {
            const pct = Math.round((clamped / sliderTrackW) * 100);
            cc.aoManualVal[ch.id] = pct;
            thumb.x(clamped);
            fillRect.width(clamped);
            valLabel.text(`${pct}%`);
            try { cc.sys.getModule('AO').setOutput(ch.id, pct); } catch (_) { }
            cc._refreshCache();
        };

        thumb.on('dragmove', () => { if (cc.aoManual[ch.id]) applyVal(thumb.x()); });
        trackRect.on('click tap', (e) => {
            if (!cc.aoManual[ch.id]) return;
            const localX = e.evt.clientX - sliderGrp.getAbsolutePosition().x;
            applyVal(Math.max(0, Math.min(sliderTrackW, localX)));
        });

        cc._aoRows[ch.id] = { curVal, modeBtn, sliderGrp, fillRect, thumb, valLabel };
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

    ['通道', '类型', '当前状态', '计数器', '防抖时间', '动作'].forEach((h, i) => {
        pg.add(new Konva.Text({ x: [8, 72, 148, 240, 340, 420][i], y: 28, text: h, fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));
    });
    pg.add(new Konva.Line({ points: [6, 40, pw - 6, 40], stroke: C.border, strokeWidth: 1 }));

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: '干接点' },
        { id: 'ch2', label: 'CH2', type: '干接点' },
        { id: 'ch3', label: 'CH3', type: '湿接点' },
        { id: 'ch4', label: 'CH4', type: '湿接点' },
    ];

    cc._diRows = {};
    chDefs.forEach((ch, i) => {
        const y = 48 + i * 58;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 52, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 4, text: ch.label, fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
        pg.add(new Konva.Text({ x: 72, y: y + 4, text: ch.type, fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

        const stateDisp = new Konva.Text({ x: 148, y: y + 4, text: 'OFF', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim });
        const counterDisp = new Konva.Text({ x: 240, y: y + 4, text: '0', fontSize: 11, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan });
        pg.add(stateDisp, counterDisp);
        pg.add(new Konva.Text({ x: 340, y: y + 4, text: '20ms', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim }));

        const resetBtn = mkBtn(pg, '复位', 420, y + 4, C.orange);
        resetBtn.on('click tap', () => { counterDisp.text('0'); });

        cc._diRows[ch.id] = { stateDisp, counterDisp };
    });
}

// ══════════════════════════════════════════
//  PAGE 6 — DO 设置
// ══════════════════════════════════════════
export function buildDOPage(cc) {
    const pg = cc._pages[6];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ DO 数字量输出控制', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.purple }));

    ['通道', '类型', '当前状态', '控制模式', '手动强制'].forEach((h, i) => {
        pg.add(new Konva.Text({ x: [8, 72, 148, 258, 370][i], y: 22, text: h, fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));
    });
    pg.add(new Konva.Line({ points: [6, 34, pw - 6, 34], stroke: C.border, strokeWidth: 1 }));

    const chDefs = [
        { id: 'ch1', label: 'CH1', type: 'RELAY' },
        { id: 'ch2', label: 'CH2', type: 'RELAY' },
        { id: 'ch3', label: 'CH3', type: '24V' },
        { id: 'ch4', label: 'CH4', type: '24V' },
    ];

    cc._doRows = {};
    chDefs.forEach((ch, i) => {
        const y = 40 + i * 54;
        pg.add(new Konva.Rect({ x: 6, y: y - 2, width: pw - 12, height: 48, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
        pg.add(new Konva.Text({ x: 14, y: y + 4, text: ch.label, fontSize: 10, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.text }));
        pg.add(new Konva.Text({ x: 72, y: y + 4, text: ch.type, fontSize: 9, fontFamily: 'Courier New', fill: C.textDim }));

        const stateDisp = new Konva.Text({ x: 148, y: y + 2, width: 90, text: 'OFF', fontSize: 16, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.textDim });
        pg.add(stateDisp);

        const modeBtn = mkToggle(pg, '自  动', 258, y + 2, 78, 22, false, C.green);
        const forceBtn = mkToggle(pg, '强制 OFF', 370, y + 2, 90, 22, false, C.textDim);
        forceBtn.opacity(0.35);

        modeBtn.on('click tap', () => {
            cc.doManual[ch.id] = !cc.doManual[ch.id];
            const isM = cc.doManual[ch.id];
            modeBtn.findOne('Rect').fill(isM ? C.yellow + '33' : C.green + '22');
            modeBtn.findOne('Rect').stroke(isM ? C.yellow : C.green);
            modeBtn.findOne('Text').text(isM ? '手  动' : '自  动');
            modeBtn.findOne('Text').fill(isM ? C.yellow : C.green);
            forceBtn.opacity(isM ? 1 : 0.35);
            cc._refreshCache();
        });

        forceBtn.on('click tap', () => {
            if (!cc.doManual[ch.id]) return;
            cc.doManualState[ch.id] = !cc.doManualState[ch.id];
            const on = cc.doManualState[ch.id];
            forceBtn.findOne('Rect').fill(on ? C.red + '33' : C.textDim + '22');
            forceBtn.findOne('Rect').stroke(on ? C.red : C.textDim);
            forceBtn.findOne('Text').text(on ? '强制  ON ' : '强制 OFF');
            forceBtn.findOne('Text').fill(on ? C.red : C.textDim);
            try { cc.sys.getModule('DO').setOutput(ch.id, on); } catch (_) { }
            cc._refreshCache();
        });

        const infoText = new Konva.Text({ x: 148, y: y + 28, text: '', fontSize: 8, fontFamily: 'Courier New', fill: C.textDim });
        pg.add(infoText);

        cc._doRows[ch.id] = { stateDisp, modeBtn, forceBtn, infoText };
    });
}

// ══════════════════════════════════════════
//  PAGE 7 — 液位控制
// ══════════════════════════════════════════
export function buildLevelPage(cc) {
    const pg = cc._pages[7];
    const pw = W - 8, ph = BODY_H;
    pg.add(new Konva.Rect({ width: pw, height: ph, fill: C.panel, cornerRadius: 3 }));
    pg.add(new Konva.Text({ x: 8, y: 6, text: '■ 液位双位控制系统', fontSize: 12, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

    const tkX = 50, tkY = 26, tkW = 100, tkH = 210;
    pg.add(new Konva.Rect({ x: tkX, y: tkY, width: tkW, height: tkH, fill: '#050e18', stroke: C.cyan + '66', strokeWidth: 2, cornerRadius: 4 }));

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
    pg.add(new Konva.Rect({ x: tkX - 36, y: tkY + 18, width: 36, height: 12, fill: '#081520', stroke: C.blue + '66', strokeWidth: 1 }));
    cc._inletFlowBar = new Konva.Rect({ x: tkX - 34, y: tkY + 20, width: 0, height: 8, fill: C.blue + '88' });
    pg.add(cc._inletFlowBar);
    pg.add(new Konva.Text({ x: tkX - 50, y: tkY + 8, text: '进水', fontSize: 8, fontFamily: 'Courier New', fill: C.blue }));

    pg.add(new Konva.Rect({ x: tkX + tkW, y: tkY + tkH - 36, width: 36, height: 12, fill: '#081520', stroke: C.orange + '66', strokeWidth: 1 }));
    cc._drainFlowBar = new Konva.Rect({ x: tkX + tkW + 2, y: tkY + tkH - 34, width: 0, height: 8, fill: C.orange + '88' });
    pg.add(cc._drainFlowBar);
    pg.add(new Konva.Text({ x: tkX + tkW + 2, y: tkY + tkH - 48, text: '排水', fontSize: 8, fontFamily: 'Courier New', fill: C.orange }));

    // 右侧控制面板
    const cx = 185;
    pg.add(new Konva.Text({ x: cx, y: 22, text: '■ 控制参数', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));

    cc._lvParamTexts = {};
    [{ label: 'HH报警', key: 'setHH', color: C.red }, { label: 'H  上限', key: 'setH', color: C.yellow },
    { label: 'L  下限', key: 'setL', color: C.yellow }, { label: 'LL报警', key: 'setLL', color: C.red }].forEach((p, i) => {
        const py = 38 + i * 24;
        pg.add(new Konva.Text({ x: cx, y: py, text: p.label + ' :', fontSize: 9, fontFamily: 'Courier New', fill: p.color }));
        const vt = new Konva.Text({ x: cx + 80, y: py, text: `${cc.levelCtrl[p.key]}%`, fontSize: 9, fontFamily: 'Courier New', fill: C.text });
        pg.add(vt);
        cc._lvParamTexts[p.key] = vt;
    });

    pg.add(new Konva.Text({ x: cx, y: 140, text: '■ 执行机构', fontSize: 9, fontFamily: 'Courier New', fontStyle: 'bold', fill: C.cyan }));
    cc._pumpText = new Konva.Text({ x: cx, y: 156, text: '进水阀:  OFF ○', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim });
    cc._drainText = new Konva.Text({ x: cx, y: 174, text: '排水泵:  OFF ○', fontSize: 10, fontFamily: 'Courier New', fill: C.textDim });
    cc._lvAlarmText = new Konva.Text({ x: cx, y: 198, text: '● 液位正常', fontSize: 10, fontFamily: 'Courier New', fill: C.green });
    pg.add(cc._pumpText, cc._drainText, cc._lvAlarmText);

    // 仿真控制
    cc._simBtn = mkBtn(pg, '仿真:运行', cx, 222, C.cyan);
    cc._simBtn.on('click tap', () => {
        cc.levelCtrl.simMode = !cc.levelCtrl.simMode;
        const r = cc.levelCtrl.simMode;
        cc._simBtn.findOne('Rect').fill(r ? C.cyan + '33' : C.textDim + '22');
        cc._simBtn.findOne('Rect').stroke(r ? C.cyan : C.textDim);
        cc._simBtn.findOne('Text').text(r ? '仿真:运行' : '仿真:停止');
        cc._simBtn.findOne('Text').fill(r ? C.cyan : C.textDim);
    });

    const manInBtn = mkBtn(pg, '进水:强制', cx + 115, 222, C.blue);
    const manDrBtn = mkBtn(pg, '排水:强制', cx + 230, 222, C.orange);
    manInBtn.on('click tap', () => { cc.levelCtrl.inletOn = !cc.levelCtrl.inletOn; });
    manDrBtn.on('click tap', () => { cc.levelCtrl.drainOn = !cc.levelCtrl.drainOn; });

    // 液位趋势
    const trX = cx, trY = 252, trW = 350, trH = 50;
    pg.add(new Konva.Rect({ x: trX, y: trY, width: trW, height: trH, fill: C.bg, stroke: C.border, strokeWidth: 1, cornerRadius: 2 }));
    pg.add(new Konva.Text({ x: trX + 3, y: trY + 2, text: 'LEVEL TREND', fontSize: 7, fontFamily: 'Courier New', fill: C.textDim }));
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