/**
 * pageRenderers.js — 各页面每 tick 刷新函数（_renderXxxPage）
 * 负责根据运行时数据更新 Konva 图形元素的属性（文字、颜色、尺寸等）。
 * 每个函数在 _tick() 中根据当前激活页面被调用。
 */

import { C } from './constants.js';
import { NMT_STATE } from '../CANBUS.js';

// ── 页面 0：报警 ─────────────────────────────
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

// ── 页面 1：参数一览 ──────────────────────────
export function renderParamPage(cc) {
    const chKeys = ['ch1', 'ch2', 'ch3', 'ch4'];
    const bus = cc.sys?.canBus;
    const aiOnline = bus ? bus.isNodeOnline('ai') : false;

    // AI
    chKeys.forEach((id, i) => {
        const d = cc.data.ai[id]; if (!d ) return;
        const r = cc._paramDisplays.ai[i];
        
        // 检查是否超时（hold 标志）
        const isTimeout = d.hold === true;
        const isAvailable = aiOnline && !isTimeout;
        
        if (!isAvailable) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }
        
        const c = d.fault ? C.red : (d.alarm !== 'normal' ? C.yellow : C.green);
        r.val.text(d.fault ? `${d.faultText}` : `${d.value.toFixed(2)} ${d.unit}`);
        r.val.fill(c);
        // 使用量程上下限计算进度条比例，兜底回退到 0~100
        if (d.fault) {
            r.bar.width(0);
        } else {
            const rng = d.ranges || {};
            const urv = (typeof rng.urv === 'number') ? rng.urv : 100;
            const lrv = (typeof rng.lrv === 'number') ? rng.lrv : 0;
            const span = urv - lrv;
            let frac;
            if (span === 0) {
                frac = Math.min(1, Math.max(0, (d.value || 0) / 100));
            } else {
                frac = Math.min(1, Math.max(0, ((d.value || 0) - lrv) / span));
            }
            r.bar.width(Math.round(frac * r.maxBarW));
        }
    });

    // AO
    const aoOnline = bus ? bus.isNodeOnline('ao') : false;
    chKeys.forEach((id, i) => {
        const d = cc.data.ao[id]; if (!d) return;
        const r = cc._paramDisplays.ao[i];
        
        if (!aoOnline) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }
        
        r.val.text(d.fault ? 'FAULT' : `${(d.percent ?? 0).toFixed(1)}%`);
        r.val.fill(d.fault ? C.red : (d.percent > 0 ? C.orange : C.textDim));
        r.bar.width(Math.round((d.percent ?? 0) / 100 * r.maxBarW));
    });

    // DI
    const diOnline = bus ? bus.isNodeOnline('di') : false;
    chKeys.forEach((id, i) => {
        const d = cc.data.di[id]; if (!d) return;
        const r = cc._paramDisplays.di[i];
        
        if (!diOnline) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }
        
        r.val.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
        r.val.fill(d.fault ? C.red : (d.state ? C.green : C.textDim));
        r.bar.width(d.state ? r.maxBarW : 0);
    });

    // DO
    const doOnline = bus ? bus.isNodeOnline('do') : false;
    chKeys.forEach((id, i) => {
        const d = cc.data.do[id]; if (!d) return;
        const r = cc._paramDisplays['do_'][i];
        
        if (!doOnline) {
            r.val.text('---');
            r.val.fill(C.textDim);
            r.bar.width(0);
            return;
        }
        
        r.val.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
        r.val.fill(d.fault ? C.red : (d.state ? C.purple : C.textDim));
        r.bar.width(d.state ? r.maxBarW : 0);
    });
}

// ── 页面 2：网络诊断 ──────────────────────────
export function renderNetworkPage(cc) {
    if (!cc._netRowDisps) return;
    const bus = cc.sys?.canBus;
    const now = Date.now();
    const TIMEOUT = 2000;
    const nodeIdMap = { 1: 'ai', 2: 'ao', 3: 'di', 4: 'do' };
    const nodeTypeMap = { 1: 'ai', 2: 'ao', 3: 'di', 4: 'do' };

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

// ── 页面 3：AI 设置 ───────────────────────────
export function renderAISetPage(cc) {
    if (!cc._aiRows) return;
    const bus = cc.sys?.canBus;
    const aiOnline = bus ? bus.isNodeOnline('ai') : false;
    
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const row = cc._aiRows[id];
        const d = cc.data.ai[id];
        if (!row || !d) return;
        
        // 检查是否超时（hold 标志）
        const isTimeout = d.hold === true;
        const isAvailable = aiOnline && !isTimeout;
        
        if (!isAvailable) {
            row.valDisplay.text('---');
            row.valDisplay.fill(C.textDim);
            
            // 禁用模式切换按钮
            if (row.modeBg) {
                row.modeBg.fill(C.textDim + '33');
                row.modeBg.stroke(C.textDim);
            }
            if (row.modeTxt) {
                row.modeTxt.fill(C.textDim);
            }
            
            // 禁用量程编辑
            if (row.urvText) row.urvText.fill(C.textDim);
            if (row.lrvText) row.lrvText.fill(C.textDim);
            if (row.unitText) row.unitText.fill(C.textDim);
            
            // 禁用报警编辑
            if (row.hhText) row.hhText.fill(C.textDim);
            if (row.hText) row.hText.fill(C.textDim);
            if (row.lText) row.lText.fill(C.textDim);
            if (row.llText) row.llText.fill(C.textDim);
        } else {
            row.valDisplay.text(d.fault ? `${d.faultText}` : `${d.value.toFixed(2)} ${d.unit}`);
            row.valDisplay.fill(d.fault ? C.red : C.green);
            
            // 启用模式切换按钮
            if (row.modeBg) {
                row.modeBg.fill('#e2e6f4');
                row.modeBg.stroke(C.border);
            }
            if (row.modeTxt) {
                const mode = d.mode || 'normal';
                row.modeTxt.fill(mode === 'normal' ? C.green : mode === 'test' ? C.orange : C.textDim);
            }
            
            // 启用量程编辑
            if (row.urvText) row.urvText.fill(C.textDim);
            if (row.lrvText) row.lrvText.fill(C.textDim);
            if (row.unitText) row.unitText.fill(C.textDim);
            
            // 启用报警编辑
            if (row.hhText) row.hhText.fill(C.textDim);
            if (row.hText) row.hText.fill(C.textDim);
            if (row.lText) row.lText.fill(C.textDim);
            if (row.llText) row.llText.fill(C.textDim);
        }
    });
}

// ── 页面 4：AO 设置 ───────────────────────────
export function renderAOPage(cc) {
    const bus = cc.sys?.canBus;
    const aoOnline = bus ? bus.isNodeOnline('ao') : false;
    
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const d = cc.data.ao[id];
        const row = cc._aoRows[id];
        if (!d || !row) return;
        
        if (!aoOnline) {
            row.curVal.text('---');
            row.curVal.fill(C.textDim);
        } else {
            const isMa = d.type === '4-20mA';
            row.curVal.text(d.fault ? 'FAULT' : `${(d.percent ?? 0).toFixed(1)}%  /  ${isMa ? `${(d.actual ?? 4).toFixed(2)} mA` : `${(d.actual ?? 0).toFixed(0)}% PWM`}`);
            row.curVal.fill(d.fault ? C.red : C.text);
        }
    });
}

// ── 页面 5：DI 设置 ───────────────────────────
export function renderDISetPage(cc) {
    if (!cc._diRows) return;
    const bus = cc.sys?.canBus;
    const diOnline = bus ? bus.isNodeOnline('di') : false;
    
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const d = cc.data.di[id];
        const row = cc._diRows[id];
        if (!d || !row) return;
        
        if (!diOnline) {
            row.stateDisp.text('---');
            row.stateDisp.fill(C.textDim);
            row.counterDisp.text('---');
        } else {
            row.stateDisp.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
            row.stateDisp.fill(d.fault ? C.red : (d.state ? C.green : C.textDim));
            row.counterDisp.text(String(d.counter || 0));
        }
    });
}

// ── 页面 6：DO 设置 ───────────────────────────
export function renderDOPage(cc) {
    const bus = cc.sys?.canBus;
    const doOnline = bus ? bus.isNodeOnline('do') : false;
    
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const d = cc.data.do[id];
        const row = cc._doRows[id];
        if (!d || !row) return;
        
        if (!doOnline) {
            row.stateDisp.text('---');
            row.stateDisp.fill(C.textDim);
            row.infoText.text('---');
            row.infoText.fill(C.textDim);
        } else {
            row.stateDisp.text(d.fault ? 'FAULT' : (d.state ? ' ON ' : 'OFF'));
            row.stateDisp.fill(d.fault ? C.red : (d.state ? C.purple : C.textDim));
            row.infoText.text(d.hold ? '⚠ 通信超时，已进入安全保持' : (cc.doManual[id] ? '手动控制模式' : '自动控制模式'));
            row.infoText.fill(d.hold ? C.yellow : C.textDim);
        }
    });
}

// ── 页面 7：液位控制 ──────────────────────────
export function renderLevelPage(cc) {
    const lc = cc.levelCtrl;
    const tkH = 210, tkY = 26;
    const fillH = Math.round(tkH * lc.level / 100);
    cc._lvFill.y(tkY + tkH - fillH - 2);
    cc._lvFill.height(fillH);
    let fc = C.cyan + '77';
    if (lc.level >= lc.setHH || lc.level <= lc.setLL) fc = C.red + '99';
    else if (lc.level >= lc.setH || lc.level <= lc.setL) fc = C.yellow + '88';
    cc._lvFill.fill(fc);
    cc._lvText.text(`${lc.level.toFixed(1)}%`);

    cc._inletFlowBar.width(lc.inletOn ? 32 : 0);
    cc._drainFlowBar.width(lc.drainOn ? 32 : 0);

    cc._pumpText.text(`进水阀:  ${lc.inletOn ? 'ON ●' : 'OFF ○'}`);
    cc._pumpText.fill(lc.inletOn ? C.blue : C.textDim);
    cc._drainText.text(`排水泵:  ${lc.drainOn ? 'ON ●' : 'OFF ○'}`);
    cc._drainText.fill(lc.drainOn ? C.orange : C.textDim);

    if (lc.level >= lc.setHH) { cc._lvAlarmText.text('⚠ HH 高高液位报警'); cc._lvAlarmText.fill(C.red); }
    else if (lc.level <= lc.setLL) { cc._lvAlarmText.text('⚠ LL 低低液位报警'); cc._lvAlarmText.fill(C.red); }
    else if (lc.level >= lc.setH) { cc._lvAlarmText.text('△ H  高液位'); cc._lvAlarmText.fill(C.yellow); }
    else if (lc.level <= lc.setL) { cc._lvAlarmText.text('△ L  低液位'); cc._lvAlarmText.fill(C.yellow); }
    else { cc._lvAlarmText.text('● 液位正常'); cc._lvAlarmText.fill(C.green); }

    if (cc._levelTrendHistory.length > 1) {
        const m = cc._lvTrendMeta, pts = [];
        cc._levelTrendHistory.forEach((v, i) => {
            pts.push(m.x + i * (m.w / 350), m.y + m.h - (v / 100) * m.h);
        });
        cc._lvTrendLine.points(pts);
    }
}

// ── 页面 8：温度控制 ──────────────────────────
export function renderTempPage(cc) {
    const tc = cc.tempCtrl;
    const maxT = 120, thH = 210, thY = 24;
    const fillH = Math.round(Math.min(1, tc.pv / maxT) * (thH - 4));
    cc._thermFill.y(thY + thH - 2 - fillH);
    cc._thermFill.height(fillH);
    const tc_ = tc.pv > 80 ? C.red : (tc.pv > 50 ? C.yellow : C.blue);
    cc._thermFill.fill(tc_ + '99');
    cc._pvLabel.text(`${tc.pv.toFixed(1)}°C`);
    cc._pvLabel.fill(tc_);

    cc._tempDisp.pv.text(`${tc.pv.toFixed(1)} °C`);
    cc._tempDisp.sv.text(`${tc.sv.toFixed(1)} °C`);
    cc._tempDisp.out.text(`${tc.out.toFixed(1)} %`);

    const htOn = tc.out > 50;
    const clOn = tc.out < 20;
    cc._heaterBox.fill(htOn ? '#3a0000' : '#1a0000');
    cc._heaterTxt.text(htOn ? (cc.flashState ? '■ ON ' : '□ ON ') : ' OFF ');
    cc._heaterTxt.fill(htOn ? C.red : C.textDim);
    cc._coolerBox.fill(clOn ? '#001533' : '#000e1a');
    cc._coolerTxt.text(clOn ? (cc.flashState ? '■ ON ' : '□ ON ') : ' OFF ');
    cc._coolerTxt.fill(clOn ? C.blue : C.textDim);

    if (tc.history.length > 1) {
        const m = cc._tempTrendMeta, pts_pv = [], pts_sv = [], pts_out = [];
        tc.history.forEach((d, i) => {
            const x = m.x + i * (m.w / tc.maxHist);
            pts_pv.push(x, m.y + m.h - (d.pv / maxT) * m.h);
            pts_sv.push(x, m.y + m.h - (d.sv / maxT) * m.h);
            pts_out.push(x, m.y + m.h - (d.out / 100) * m.h);
        });
        cc._tPV.points(pts_pv);
        cc._tSV.points(pts_sv);
        cc._tOUT.points(pts_out);
    }
}