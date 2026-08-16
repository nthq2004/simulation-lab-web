/**
 * simulation.js — 物理过程仿真
 * 包含液位双位控制仿真和温度 PID 仿真，每 tick 由主循环调用。
 */

/**
 * 液位仿真（双位控制逻辑）
 * @param {CentralComputer} cc
 */
export function simLevel(cc) {
    const lc = cc.levelCtrl;
    if (!lc.simMode) return;

    if (lc.inletOn) lc.level = Math.min(100, lc.level + 0.3);
    if (lc.drainOn) lc.level = Math.max(0,   lc.level - 0.5);
    lc.level = Math.max(0, lc.level - 0.04); // 自然消耗

    // 双位控制逻辑
    if (lc.level <= lc.setL) lc.inletOn = true;
    if (lc.level >= lc.setH) lc.inletOn = false;
    if (lc.level <= lc.setL) lc.drainOn = false;
    if (lc.level >= lc.setH) lc.drainOn = true;

    cc._levelTrendHistory.push(lc.level);
    if (cc._levelTrendHistory.length > 350) cc._levelTrendHistory.shift();
}

/**
 * 温度仿真（简单 P 控制 + 热量模型）
 * @param {CentralComputer} cc
 */
export function simTemp(cc) {
    const tc  = cc.tempCtrl;
    const err = tc.sv - tc.pv;
    if (tc.mode === 'AUTO') tc.out = Math.max(0, Math.min(100, 50 + err * 1.8));
    const heat = (tc.out / 100) * 0.6;
    const cool = (tc.pv - 20) * 0.012;
    tc.pv = Math.max(0, Math.min(200, tc.pv + heat - cool));
    tc.history.push({ pv: tc.pv, sv: tc.sv, out: tc.out });
    if (tc.history.length > tc.maxHist) tc.history.shift();
}