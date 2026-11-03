

import { LvPowerOneLine } from '../components/LvPowerOneLine.js';
import { LvSwitchPanel } from '../components/LvSwitchPanel.js';
import { ImportantDistPanel } from '../components/ImportantDistPanel.js';

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';



export const FAULT_CONFIGS = {
    // ── 发电机组故障（低压配电板发电机控制屏“准备好”灯条件之一）──
    gen1_fault: {
        id: 'gen1_fault', name: '1. 1#发电机组故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenFault('gen1') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen1', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen1', false); },
    },
    gen2_fault: {
        id: 'gen2_fault', name: '2. 2#发电机组故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenFault('gen2') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen2', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen2', false); },
    },
    load_ground: {
        id: 'load_ground', name: '3. 左动力负载屏接地', system: '负载',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getLoadGroundFault() : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setLoadGroundFault(true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setLoadGroundFault(false); },
    },
    gen1_class1: {
        id: 'gen1_class1', name: '4. 1#发电机组I级故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenClass1('gen1') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenClass1('gen1', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenClass1('gen1', false); },
    },
    bus_short: {
        id: 'bus_short', name: '5. 汇流排短路故障', system: '汇流排',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getAlarm('short') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setAlarm('short', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setAlarm('short', false); },
    },
    gen1_prime_temp: {
        id: 'gen1_prime_temp', name: '6. 1#原动机冷却水温高', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'temp' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'temp', true); },
        // 三种原动机故障共用保护动作槽 _primeFault.gen1：「应用设置」会对未勾选项调用 repair()，
        // 无条件清除会误清刚设置的本故障；仅在当前动作确为本类型时才复位。
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p && p.getPrimeFault('gen1') === 'temp') p.setPrimeFault('gen1', null, false); },
    },
    gen1_prime_lo: {
        id: 'gen1_prime_lo', name: '7. 1#原动机滑油压力低', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'lo' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'lo', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p && p.getPrimeFault('gen1') === 'lo') p.setPrimeFault('gen1', null, false); },
    },
    gen1_prime_over: {
        id: 'gen1_prime_over', name: '8. 1#原动机超速', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'over' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'over', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p && p.getPrimeFault('gen1') === 'over') p.setPrimeFault('gen1', null, false); },
    },
    gen1_gov_fault: {
        id: 'gen1_gov_fault', name: '9. 1#原动机调速器故障', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGovFault('gen1') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGovFault('gen1', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGovFault('gen1', false); },
    },
};

// ══════════════════════════════════════════════════════════════════════════
//  并车 / 解列 自动演示辅助函数
//  规范：操作一律“像真的一样点击”部件节点（触发组件自身 click 处理），
//        不绕过交互直接给属性赋值；接线/读数/参数调整按对应专用 op 处理。
// ══════════════════════════════════════════════════════════════════════════

/** 左组合起动屏 4 台 SQ 辅机全部自动起动运行（1# 单机正常带载稳定） */
function _comboLoaded() {
    const p = _lvPanel();
    if (!p) return false;
    return ['comboL-0', 'comboL-1', 'comboL-2', 'comboL-3'].every(k => p.getMotorState(k));
}

// ══════════════════════════════════════════════════════════════════════════
//  自动化电站应急处理 —— 自动演示辅助函数
//  规范：操作一律“像真的一样点击”部件节点（触发组件自身 click 处理），
//        不绕过交互直接给属性赋值；故障设置/修复走故障界面（type:'fault'）。
// ══════════════════════════════════════════════════════════════════════════
const _plSleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 当前低压配电板组件（可能尚未创建） */
function _lvPanel() {
    return (window.sys && window.sys.comps) ? window.sys.comps.lv_switch_panel : null;
}

/**
 * 像真的一样点击某部件节点（触发组件自身的 click 处理逻辑，含手柄联动/刷新），
 * 而不是直接给内部属性赋值。
 * @param {string} partId 已在 LvSwitchPanel._registerParts 注册的部件 id
 */
function _lvClick(partId) {
    const p = _lvPanel();
    if (!p) return false;
    let node = null;
    try { if (typeof p.getClickablePartNode === 'function') node = p.getClickablePartNode(partId); } catch (e) { /* ignore */ }
    if (!node && p._parts && p._parts[partId]) node = p._parts[partId].node;
    if (!node || typeof node.fire !== 'function') { console.warn('[应急处理] 未找到可点击部件：', partId); return false; }
    try { node.fire('click', { evt: { cancelBubble: false } }); return true; }
    catch (e) { console.warn('[应急处理] 点击部件失败：', partId, e); return false; }
}

/** 轮询等待条件成立（超时返回最终判定） */
async function _lvWait(cond, timeout = 20000, gap = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (cond()) return true; await _plSleep(gap); }
    return cond();
}

/** 机组建压建频完成（电压约 450V） */
function _genUp(id) { const p = _lvPanel(); const v = p && p.getGenValue ? p.getGenValue(id) : null; return !!(v && v.U >= 445); }

// ══════════════════════════════════════════════════════════════════════════
//  应急配电板的功能测试 —— 自动演示辅助函数
//  规范：操作一律"像真的一样点击"部件节点（触发组件自身 click 处理），
//        不绕过交互直接给属性赋值；面板显隐走工具栏复选框（type:'instrument' + checkbox）。
// ══════════════════════════════════════════════════════════════════════════

/** 当前重要配电装置组件（应急发电机机旁控制箱 / 应急配电板 / 岸电箱 / 重载问询 / 应急风油切断） */
function _ipPanel() {
    return (window.sys && window.sys.comps) ? window.sys.comps.important_panel : null;
}

/** 重要配电装置面板是否已调出（可见） */
function _ipVisible() {
    const p = _ipPanel();
    return !!(p && p.group && p.group.visible());
}

/** 像真的一样点击重要配电装置上的某部件节点（触发组件自身 click 处理逻辑），而不是直接赋值 */
function _ipClick(partId) {
    const p = _ipPanel();
    if (!p) return false;
    let node = null;
    try { if (typeof p.getClickablePartNode === 'function') node = p.getClickablePartNode(partId); } catch (e) { /* ignore */ }
    if (!node && p._parts && p._parts[partId]) node = p._parts[partId].node;
    if (!node || typeof node.fire !== 'function') { console.warn('[应急配电板测试] 未找到可点击部件：', partId); return false; }
    try { node.fire('click', { evt: { cancelBubble: false } }); return true; }
    catch (e) { console.warn('[应急配电板测试] 点击部件失败：', partId, e); return false; }
}

/** 应急发电机是否已建压建频完成（450V / 60Hz，约 5s） */
function _ipReady() { const p = _ipPanel(); return !!(p && typeof p.isEGenReady === 'function' && p.isEGenReady()); }

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════════════
    //  1. 应急配电板的功能测试
    //     手动起动 1# 发电机组建压合闸供电（建立主电网）→ 调出其它配电装置面板 →
    //     自动模式试验：联络开关打“试验”位 → 联络自动分闸、应急发电机自动起动、
    //       建压后应急主开关自动合闸 → 联络转回“正常”位 → 应急主开关自动分闸、
    //       联络自动合闸恢复主电、应急发电机延时自动停机 →
    //     手动模式试验：应急配电板转手动、联络转试验 → 应急发电机转手动、机旁手动起动 →
    //       应急主开关手动合闸 → 分闸、停机、模式恢复自动 →
    //     恢复：联络转正常、应急配电板转自动
    // ══════════════════════════════════════════════════════════════════
    'emergency-panel-function-test': {
        id: 'emergency-panel-function-test',
        name: '1. 应急配电板的功能测试',
        steps: [
            // ── 1. 手动起动 1# 发电机组，合闸供电 ──
            {
                mode: 'check',
                msg: '1. 手动起动 1# 发电机组，建压建频后合上 1# 主开关，由 1# 单机供电（为应急配电板提供主电网电源）',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '检查：并车屏「模式选择」开关在“手动”位（允许手动起停 / 合分闸）',
                      async act() { await _plSleep(400); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-start',
                      msg: '👉 按下 1# 机组「起动」按钮，柴油机起动、发电机建压建频',
                      async act() { _lvClick('gen1-start'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-hz',
                      msg: '观察 1# 频率表：约 5s 内电压、频率建立至额定值（450V / 60Hz）',
                      async act() { await _lvWait(() => _genUp('gen1'), 15000); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-close',
                      msg: '👉 汇流排无电，直接按下 1# 主开关「合闸」按钮，向汇流排供电',
                      async act() { _lvClick('gen1-close'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-close',
                      msg: '主电网建立：1# 单机向汇流排供电，应急配电板自动转电装置复归“待机”（应急发电机自动停机、联络开关复归）',
                      async act() {
                          await _lvWait(() => { const p = _ipPanel(); return !!(p && p._phase === 'idle' && !p.getEmergencyGen()); }, 25000);
                      } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return p.getPlantMode() === 'HAND' && !!s.run && !!s.cb && p.isBusLive();
                },
            },
            // ── 2. 调出其它配电装置面板 ──
            {
                mode: 'check',
                msg: '2. 调出“其它配电装置”面板：勾选工具栏「其他配电装置」复选框，显示应急发电机机旁控制箱、应急配电板等装置',
                op: [
                    { type: 'instrument', checkbox: 'btnImpPanel', checkState: true,
                      msg: '👉 勾选工具栏「其他配电装置」复选框，调出应急发电机机旁控制箱、应急配电板等装置面板',
                      async act() { await _plSleep(400); } },
                ],
                check() { return _ipVisible(); },
            },
            // ── 3. 自动模式试验：联络开关打“试验”位 → 自动分闸 / 应发自动起动 / 自动合闸 ──
            {
                mode: 'check',
                msg: '3. 将应急配电板「联络开关」打到“试验”位：联络开关自动分闸 → 应急发电机自动起动、建压后应急主开关自动合闸',
                op: [
                    { type: 'switch', target: 'important_panel', part: 'ep-tie',
                      msg: '👉 将联络开关由“正常”打到“试验”位，联络开关立即自动分闸（模拟主电网失电）',
                      async act() { _ipClick('ep-tie'); await _lvWait(() => { const p = _ipPanel(); return !!(p && !p.isTieClosed()); }, 6000); } },
                    { type: 'observe', target: 'important_panel', part: 'eg-start',
                      msg: '观察：应急发电机自动起动（约 3s 起动、5s 建压建频）',
                      async act() { await _lvWait(() => { const p = _ipPanel(); return !!(p && p.getEmergencyGen()); }, 12000); } },
                    { type: 'observe', target: 'important_panel', part: 'ep-close',
                      msg: '观察：应急发电机建压完成后，应急主开关延时自动合闸，应急配电板转为应发供电',
                      async act() { await _lvWait(() => { const p = _ipPanel(); return !!(p && p.isEGenClosed()); }, 20000); } },
                ],
                check() {
                    const p = _ipPanel(); if (!p) return false;
                    return p.getEpTest() === 0 && !p.isTieClosed() && p.getEmergencyGen() && p.isEGenClosed();
                },
            },
            // ── 4. 自动模式恢复：联络转回“正常”位 → 应发自动分闸 / 联络自动合闸 / 应发延时停机 ──
            {
                mode: 'check',
                msg: '4. 将联络开关转回“正常”位：应急主开关自动分闸 → 联络开关自动合闸恢复主电 → 应急发电机延时自动停机',
                op: [
                    { type: 'switch', target: 'important_panel', part: 'ep-tie',
                      msg: '👉 将联络开关由“试验”转回“正常”位，应急主开关立即自动分闸',
                      async act() { _ipClick('ep-tie'); await _lvWait(() => { const p = _ipPanel(); return !!(p && !p.isEGenClosed()); }, 6000); } },
                    { type: 'observe', target: 'important_panel', part: 'ep-close',
                      msg: '观察：延时约 3s 后联络开关自动合闸，恢复由主电网供电',
                      async act() { await _lvWait(() => { const p = _ipPanel(); return !!(p && p.isTieClosed()); }, 10000); } },
                    { type: 'observe', target: 'important_panel', part: 'eg-stop',
                      msg: '观察：应急发电机延时约 10s 后自动停机，应急配电板回到待机',
                      async act() { await _lvWait(() => { const p = _ipPanel(); return !!(p && !p.getEmergencyGen()); }, 20000); } },
                ],
                check() {
                    const p = _ipPanel(); if (!p) return false;
                    return p.getEpTest() === 1 && p.isTieClosed() && !p.isEGenClosed() && !p.getEmergencyGen();
                },
            },
            // ── 5. 应急配电板转手动、联络开关转试验 ──
            {
                mode: 'check',
                msg: '5. 将应急配电板「控制模式」转为“手动”，并将「联络开关」转为“试验”位，为机旁手动起停试验做准备',
                op: [
                    { type: 'switch', target: 'important_panel', part: 'ep-ctl',
                      msg: '👉 点击应急配电板「控制模式」开关，由“自动”转到“手动”，ATS 自动功能退出',
                      async act() { _ipClick('ep-ctl'); await _lvWait(() => { const p = _ipPanel(); return !!(p && p.getEpCtl() === 0); }, 5000); } },
                    { type: 'switch', target: 'important_panel', part: 'ep-tie',
                      msg: '👉 将联络开关由“正常”打到“试验”位（手动模式下仅断开联络开关，不自动起动）',
                      async act() { _ipClick('ep-tie'); await _lvWait(() => { const p = _ipPanel(); return !!(p && !p.isTieClosed()); }, 6000); } },
                ],
                check() { const p = _ipPanel(); return !!p && p.getEpCtl() === 0 && p.getEpTest() === 0; },
            },
            // ── 6. 应急发电机转手动，机旁手动起动 ──
            {
                mode: 'check',
                msg: '6. 将应急发电机「控制方式」转为“手动”，在机旁控制箱手动起动应急发电机',
                op: [
                    { type: 'switch', target: 'important_panel', part: 'eg-mode',
                      msg: '👉 点击机旁控制箱「控制方式」开关，由“自动”转到“手动”',
                      async act() { _ipClick('eg-mode'); await _lvWait(() => { const p = _ipPanel(); return !!(p && p.getEgMode() === 0); }, 5000); } },
                    { type: 'btn', target: 'important_panel', part: 'eg-start',
                      msg: '👉 按下机旁控制箱「起动」按钮，手动起动应急发电机（约 5s 建压建频）',
                      async act() { _ipClick('eg-start'); } },
                ],
                check() { const p = _ipPanel(); return !!p && p.getEgMode() === 0 && p.getEmergencyGen(); },
            },
            // ── 7. 应急配电板上手动合上应急主开关 ──
            {
                mode: 'check',
                msg: '7. 应急发电机建压完成后，在应急配电板上手动合上应急主开关，向应急配电板供电',
                op: [
                    { type: 'observe', target: 'important_panel', part: 'eg-start',
                      msg: '观察：应急发电机建压建频完成（450V / 60Hz），具备合闸条件',
                      async act() { await _lvWait(() => _ipReady(), 15000); } },
                    { type: 'btn', target: 'important_panel', part: 'ep-close',
                      msg: '👉 手动模式、联络开关在“试验”位，按下应急主开关「合闸」按钮',
                      async act() { _ipClick('ep-close'); await _lvWait(() => { const p = _ipPanel(); return !!(p && p.isEGenClosed()); }, 6000); } },
                ],
                check() { const p = _ipPanel(); return !!p && p.isEGenClosed(); },
            },
            // ── 8. 应急主开关分闸、应急发电机停机、控制方式转回自动 ──
            {
                mode: 'check',
                msg: '8. 将应急主开关分闸、应急发电机停机，并将应急发电机「控制方式」转回“自动”',
                op: [
                    { type: 'btn', target: 'important_panel', part: 'ep-open',
                      msg: '👉 按下应急主开关「分闸」按钮，断开应急配电板供电',
                      async act() { _ipClick('ep-open'); await _lvWait(() => { const p = _ipPanel(); return !!(p && !p.isEGenClosed()); }, 5000); } },
                    { type: 'btn', target: 'important_panel', part: 'eg-stop',
                      msg: '👉 按下机旁控制箱「停止」按钮，应急发电机停机',
                      async act() { _ipClick('eg-stop'); await _lvWait(() => { const p = _ipPanel(); return !!(p && !p.getEmergencyGen()); }, 5000); } },
                    { type: 'switch', target: 'important_panel', part: 'eg-mode',
                      msg: '👉 将应急发电机「控制方式」由“手动”转回“自动”，恢复自动备用',
                      async act() { _ipClick('eg-mode'); await _lvWait(() => { const p = _ipPanel(); return !!(p && p.getEgMode() === 1); }, 5000); } },
                ],
                check() { const p = _ipPanel(); return !!p && !p.isEGenClosed() && !p.getEmergencyGen() && p.getEgMode() === 1; },
            },
            // ── 9. 恢复：联络转正常、应急配电板转自动 ──
            {
                mode: 'check',
                msg: '9. 恢复系统自动运行：将联络开关转为“正常”位，应急配电板「控制模式」转回“自动”',
                op: [
                    { type: 'switch', target: 'important_panel', part: 'ep-tie',
                      msg: '👉 将联络开关由“试验”转回“正常”位（手动模式下暂不自动合闸）',
                      async act() { _ipClick('ep-tie'); await _plSleep(600); } },
                    { type: 'switch', target: 'important_panel', part: 'ep-ctl',
                      msg: '👉 将应急配电板「控制模式」由“手动”转回“自动”，联络开关自动合闸恢复主电供电，ATS 恢复自动备用',
                      async act() { _ipClick('ep-ctl'); await _lvWait(() => { const p = _ipPanel(); return !!(p && p.isTieClosed()); }, 6000); } },
                ],
                check() {
                    const p = _ipPanel(); if (!p) return false;
                    return p.getEpTest() === 1 && p.getEpCtl() === 1 && p.isTieClosed() && !p.getEmergencyGen();
                },
            },
            // ── 10. 测试题 ──
            {
                msg: '10. 测试题：应急配电板自动转电功能',
                mode: 'quiz',
                quizConfig: {
                    question: '在应急配电板功能试验中，将联络开关由“正常”位打到“试验”位后，下列现象描述正确的是？',
                    options: [
                        '联络开关自动分闸，应急发电机自动起动、建压后应急主开关自动合闸，向应急配电板供电',
                        '联络开关保持合闸，应急发电机不会起动，只能手动合上应急主开关',
                        '联络开关自动分闸，但应急发电机必须人工在机旁手动起动后才能供电',
                        '应急发电机立即起动并直接向主汇流排送电，联络开关随后自动合闸',
                    ],
                    answer: 0,
                    analysis: '应急配电板的自动转电装置（ATS）在联络开关打到“试验”位时，等效于模拟主电网失电：联络开关先自动分闸切断主电网；随后按“起动延时（约 3s）→ 应急发电机自动起动 → 建压建频（约 5s）→ 合闸延时（约 10s）→ 应急主开关自动合闸”的顺序，自动把应急发电机投入，向应急配电板供电，全过程无需人工干预，这正是应急配电板自动模式的核心功能。将联络开关转回“正常”位后，装置按相反顺序恢复：应急主开关先自动分闸，约 3s 后联络开关自动合闸恢复主电网供电，应急发电机延时约 10s 自动停机。若应急配电板处于“手动”模式，则上述自动动作均退出，需人工在机旁控制箱手动起动应急发电机、并在应急配电板上手动合闸。',
                },
            },
        ],
    },

};

export const componentConfigs = [


    // ── 船舶低压电力系统单线图（交互组件，替代高压单线图）──
    { Class: LvPowerOneLine, id: 'lv_one_line', x: 1200, y: 0, label: '低压电力系统单线图', visible: true },

    // ── 低压配电板组件图（主配电板，默认显示）──
    { Class: LvSwitchPanel, id: 'lv_switch_panel', x: 20, y: 30, label: '主配电板', visible: true },

    // ── 重要配电装置（应急发电机机旁控制箱 / 应急配电板 / 岸电箱 / 重载问询 / 应急风油切断）──
    { Class: ImportantDistPanel, id: 'important_panel', x: 20, y: 300, label: '重要配电装置', visible: true },

    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    // ── 手摇式兆欧表（摇表，2500V 型；隐藏，测试绝缘时按需调出）──
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));



function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);

}

export function fiveStep() {
}
