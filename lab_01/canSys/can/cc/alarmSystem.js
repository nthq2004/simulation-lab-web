/**
 * alarmSystem.js — 报警系统逻辑
 * 负责检测故障/越限，维护活跃报警列表，处理延时触发与闪烁。
 */

/**
 * 每 tick 检测所有报警条件，触发或清除报警记录
 * @param {CentralComputer} cc
 */
export function processAlarms(cc) {
    const now      = Date.now();
    const detected = [];

    // 采集各模块故障
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const faultText = cc.data.ai[id]?.faultText;
        if (cc.data.ai[id]?.faultText !== 'normal') detected.push(`AI ${id.toUpperCase()}通道 ${faultText}故障`);
        if (cc.data.ao[id]?.fault) detected.push(`AO ${id.toUpperCase()}通道 输出故障`);
        if (cc.data.di[id]?.fault) detected.push(`DI ${id.toUpperCase()}通道 回路故障`);
        if (cc.data.do[id]?.fault) detected.push(`DO ${id.toUpperCase()}通道 输出故障`);
    });

    // AI 报警阈值
    ['ch1', 'ch2', 'ch3', 'ch4'].forEach(id => {
        const alm = cc.data.ai[id]?.alarm;
        if (alm && alm !== 'normal' && alm !== 'FAULT') {
            detected.push(`AI ${id.toUpperCase()}通道 ${alm}报警`);
        }
    });

    // 液位报警
    const lc = cc.levelCtrl;
    if (lc.level >= lc.setHH) detected.push('液位 HH 高高报警');
    if (lc.level <= lc.setLL) detected.push('液位 LL 低低报警');

    // 温度报警
    if (cc.tempCtrl.pv > 90) detected.push(`出口温度过高 (${cc.tempCtrl.pv.toFixed(1)}°C)`);

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