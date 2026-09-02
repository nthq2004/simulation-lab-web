/**
 * alarmPage.js — 报警页面构建与刷新
 */

import { W, BODY_H, C } from './constants.js';
import { mkBtn, isModuleAvailable } from './utils.js';

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

// ── 每 tick 刷新 ──────────────────────────────
export function renderAlarmPage(cc) {
    cc._alarmLines.forEach((line, i) => {
        const a = cc.activeAlarms[i];
        if (a) {
            line.text(`${a.timestamp}  ${a.isPhysicalActive ? '[ACT]' : '[CLR]'}  ${a.text}`);
            if (!a.confirmed) line.fill((!a.muted && cc.flashState) ? C.text : C.red);
            else line.fill(C.green);
        } else {
            line.text(i === 0 && cc.activeAlarms.length === 0 ? '--:--:--  ● 系统运行正常，无报警' : '');
            line.fill(C.green);
        }
    });

    const flashing = cc.activeAlarms.some(a => !a.confirmed && !a.muted);
    const unconf = cc.activeAlarms.some(a => !a.confirmed);
    if (flashing) cc._alarmLed.fill(cc.flashState ? C.red : '#330000');
    else if (unconf) cc._alarmLed.fill(C.red);
    else cc._alarmLed.fill('#220000');
}

/**
 * alarmSystem.js — 报警系统逻辑
 * 负责检测故障/越限，维护活跃报警列表，处理延时触发与闪烁。
 */

/**
 * 每 tick 检测所有报警条件，触发或清除报警记录
 * @param {CentralComputer} cc
 */
export function processAlarms(cc) {
    const now = Date.now();
    const detected = [];
    const ai = cc.sys.comps.ai;

    // 节点通信超时检测（如果某节点从在线转为超时，应触发报警）
    try {
        const TIMEOUT = 2000;
        [1, 2, 3, 4].forEach(addr => {
            const lastSeen = cc._canNodeLastSeen?.[addr] || 0;
            const timeout = lastSeen > 0 && (now - lastSeen) > TIMEOUT;
            if (timeout) detected.push(`节点${addr} 通信 异常报警`);
        });
    } catch (e) { /* ignore */ }

    // 采集各模块故障
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const faultText = cc.data.ai[id]?.faultText;
          if (cc.data.ai[id]?.faultText !== 'normal' &&ai.channels[id].mode !=='disable') detected.push(`AI ${id.toUpperCase()}通道 ${faultText}故障`);
        if (cc.data.ao[id]?.fault) detected.push(`AO ${id.toUpperCase()}通道 输出故障`);
        if (cc.data.di[id]?.fault ) detected.push(`DI ${id.toUpperCase()}通道 回路故障`);
        if (cc.data.do[id]?.fault) detected.push(`DO ${id.toUpperCase()}通道 输出故障`);
    });

    // AI 报警阈值
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const alm = cc.data.ai[id]?.alarm;
        if (alm && alm !== 'normal' && alm !== 'FAULT' &&cc.data.ai[id].mode !=='disable'
        ) {
            detected.push(`AI ${id.toUpperCase()}通道 ${alm}报警`);
        }
    });

    // DI 报警（基于报警触发方式和状态）
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        if (cc.data.di[id]?.alarm ) {
            // detected.push(`DI ${id.toUpperCase()}通道 异常报警`);
            if(id === 'ch1')detected.push(`DI ${id.toUpperCase()}通道 压力高报警`)
        }
    });

    // 液位报警
    const lc = cc.levelCtrl;
    if (isModuleAvailable(cc, 'ai')) {
        if (lc.level >= lc.setH+5) detected.push('液位H 高位报警');
        if (lc.level <= lc.setL-5) detected.push('液位L 低位报警');
        // 温度报警
        if (cc.tempCtrl.pv > 140) detected.push(`出口温度 过高报警`);
        if (cc.tempCtrl.pv < 50) detected.push(`出口温度 过低报警`);
    }
    // 延时触发
    detected.forEach(txt => {
        if (!cc.faultTimers[txt]) cc.faultTimers[txt] = now;
        else if (now - cc.faultTimers[txt] >= cc.alarmDelay) triggerAlarm(cc, txt);
    });

    // 清理已消失的计时器
    Object.keys(cc.faultTimers).forEach(k => { if (!detected.includes(k)) delete cc.faultTimers[k]; });

    // 更新物理激活状态
    cc.activeAlarms.forEach(a => {
        if (!a.confirmed) a.isPhysicalActive = detected.includes(a.text);
    });

    if (cc.activeAlarms.length > cc.maxAlarmLines)
        cc.activeAlarms = cc.activeAlarms.slice(0, cc.maxAlarmLines);
}

/**
 * 向活跃报警列表插入一条新报警（去重）
 * @param {CentralComputer} cc
 * @param {string}          txt  报警描述文字
 */
export function triggerAlarm(cc, txt) {
    if (!cc.activeAlarms.find(a => a.text === txt && !a.confirmed)) {
        cc.activeAlarms.unshift({
            id: ++cc.alarmIdCounter,
            text: txt,
            confirmed: false,
            muted: false,
            isPhysicalActive: true,
            timestamp: new Date().toTimeString().slice(0, 8),
        });
    }
}

export function simAlarm(cc) {
    // 参考 simLevel：通过设置 cc.doManual / cc.doManualState 下发 DO 命令
    const diCh1 = cc.data && cc.data.di && cc.data.di['ch1'];
    if (!diCh1) return;

    // 仅在 DI ch1 接通时，令 DO ch3 状态与之相反，并把 DO 置为手动以便发送
        const newState = !diCh1.state;
        cc.data.do['ch3'].state = newState;
        cc.doManual['ch3'] = true;
        cc.doManualState['ch3'] = newState;

}