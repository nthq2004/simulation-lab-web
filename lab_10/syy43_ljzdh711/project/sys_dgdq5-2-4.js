

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
    if (!node || typeof node.fire !== 'function') { console.warn('[并车流程] 未找到可点击部件：', partId); return false; }
    try { node.fire('click', { evt: { cancelBubble: false } }); return true; }
    catch (e) { console.warn('[并车流程] 点击部件失败：', partId, e); return false; }
}

/** 轮询等待条件成立（超时返回最终判定） */
async function _lvWait(cond, timeout = 20000, gap = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (cond()) return true; await _plSleep(gap); }
    return cond();
}

/** 机组建压建频完成（电压约 450V） */
function _genUp(id) { const p = _lvPanel(); const v = p && p.getGenValue ? p.getGenValue(id) : null; return !!(v && v.U >= 445); }

/** 左组合起动屏 4 台 SQ 辅机全部自动起动运行（1# 单机正常带载稳定） */
function _comboLoaded() {
    const p = _lvPanel();
    if (!p) return false;
    return ['comboL-0', 'comboL-1', 'comboL-2', 'comboL-3'].every(k => p.getMotorState(k));
}

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════════════
    //  1. 发电机原动机故障导致主开关跳闸的应急处理（非自动化电站）
    //     手动模式下 1# 单机运行供电 → 原动机保护动作停机跳闸 → 观察确认 →
    //     手动起动 2# 备用机组恢复供电 → 排除故障 → 故障复位 → 恢复备用
    // ══════════════════════════════════════════════════════════════════
    'prime-trip-emergency': {
        id: 'prime-trip-emergency',
        name: '1. 发电机原动机故障导致主开关跳闸的应急处理',
        steps: [
            // ── 1. 正常运行准备：1# 单机供电 ──
            {
                mode: 'check',
                msg: '1. 正常运行准备：确认电站运行模式在「手动」位，起动 1# 发电机组并合上 1# 主开关，建立单机供电',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '检查：并车屏「模式选择」开关在“手动”位（非自动化电站，允许手动起停 / 合分闸），确认后进行单机起动',
                      async act() { await _plSleep(400); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-start',
                      msg: '👉 按下 1# 机组「起动」按钮，柴油机起动、发电机建压建频',
                      async act() { _lvClick('gen1-start'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-hz',
                      msg: '观察 1# 频率表：约 5s 内电压、频率建立至额定值（450V / 60Hz）',
                      async act() { await _lvWait(() => _genUp('gen1'), 15000); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-close',
                      msg: '👉 此刻汇流排无电，直接按下 1# 主开关「合闸」按钮，向汇流排供电',
                      async act() { _lvClick('gen1-close'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return p.getPlantMode() === 'HAND' && !!s.run && !!s.cb;
                },
            },
            // ── 2. 设置原动机故障 → 停机跳闸 ──
            {
                mode: 'check',
                msg: '2. 设置原动机故障：通过「故障设置」界面设置「1#原动机冷却水温高」。原动机保护动作 → 柴油机立即停机、1# 主开关跳闸、汇流排失电',
                op: [
                    { type: 'fault', fault: 'gen1_prime_temp',
                      msg: '打开「故障设置」界面，勾选「1#原动机冷却水温高」，点击「应用设置」',
                      async act() { await _plSleep(400); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return p.getPrimeFault('gen1') === 'temp' && !s.run && !s.cb;
                },
            },
            // ── 3. 观察跳闸现象 ──
            {
                mode: 'check',
                msg: '3. 观察跳闸现象：1#「故障复位」灯亮、主开关分闸、汇流排失电（频率表归零、PPU 电压电流为 0）',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '观察 1# 控制屏「故障复位」灯亮：原动机保护动作，主开关故障跳闸，待排除故障后复位',
                      async act() { await _plSleep(3000); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察 1# PPU / 频率表：柴油机已停机，电压、电流、频率归零，汇流排失电',
                      async act() { await _plSleep(2500); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getGenTrip('gen1') && !p.isBusLive();
                },
            },
            // ── 4. 应急恢复供电：起动 2# 备用机组并合闸 ──
            {
                mode: 'check',
                msg: '4. 应急恢复供电：手动起动 2# 备用发电机组，建压建频后合上 2# 主开关，恢复汇流排供电',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-start',
                      msg: '👉 按下 2# 备用机组「起动」按钮，柴油机起动、发电机建压建频',
                      async act() { _lvClick('gen2-start'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen2-hz',
                      msg: '观察 2# 频率表：等待建压建频完成（约 5s，450V / 60Hz）',
                      async act() { await _lvWait(() => _genUp('gen2'), 15000); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-close',
                      msg: '👉 汇流排仍无电，按下 2# 主开关「合闸」按钮，恢复汇流排供电',
                      async act() { _lvClick('gen2-close'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen2');
                    return !!s.run && !!s.cb && p.isBusLive();
                },
            },
            // ── 5. 排除原动机故障 ──
            {
                mode: 'check',
                msg: '5. 排除原动机故障：查明并排除冷却水温高原因后，在「故障设置」界面取消勾选并应用，修复「1#原动机冷却水温高」故障',
                op: [
                    { type: 'fault', fault: 'gen1_prime_temp', repair: true,
                      msg: '打开「故障设置」界面，取消勾选「1#原动机冷却水温高」，点击「应用设置」修复故障',
                      async act() { await _plSleep(400); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getPrimeFault('gen1') === null;
                },
            },
            // ── 6. 故障复位 ──
            {
                mode: 'check',
                msg: '6. 故障复位：故障排除后按下 1#「故障复位」按钮，熄灭故障复位灯',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '👉 按下 1#「故障复位」按钮，熄灭故障复位灯，1# 退出故障状态',
                      async act() { _lvClick('gen1-reset'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return !p.getGenTrip('gen1');
                },
            },
            // ── 7. 恢复备用状态 ──
            {
                mode: 'check',
                msg: '7. 恢复备用状态：1# 主开关已分闸、机组停机并复位，「准备好」灯恢复，1# 重新具备投入条件；当前由 2# 单机供电',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-ready',
                      msg: '确认 1#「准备好」灯恢复（遥控、无故障、停机），1# 已重新处于备用待命状态',
                      async act() { await _plSleep(2500); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s1 = p.getGenState('gen1'), s2 = p.getGenState('gen2');
                    return !s1.run && !s1.cb && p.getPrimeFault('gen1') === null
                        && !p.getGenTrip('gen1') && !!s2.run && !!s2.cb;
                },
            },
            // ── 8. 测试题 ──
            {
                msg: '8. 测试题：原动机保护与主开关跳闸的应急处理',
                mode: 'quiz',
                quizConfig: {
                    question: '航行中 1# 发电机组因原动机冷却水温高导致其主开关跳闸、汇流排失电。作为值班人员，正确的应急处理顺序是？',
                    options: [
                        '确认跳闸现象并判断跳闸机组 → 起动备用 2# 发电机组，建压建频后合闸恢复供电 → 查明并排除原动机故障 → 故障排除后按「故障复位」使机组恢复备用',
                        '反复强合 1# 主开关，先把电送出去，再慢慢处理原动机',
                        '无需起动备用机组，直接重新合上 1# 主开关让 1# 继续带全负荷运行',
                        '断开所有负载后原地等待，直到 1# 原动机自行恢复',
                    ],
                    answer: 0,
                    analysis: '原动机（柴油机）冷却水温高属于原动机保护动作：为保护柴油机，保护装置立即使机组停机，主开关随之失压跳闸，汇流排失电。应急处理应先确认现象并判断是哪台机组跳闸，再起动备用发电机组、建压建频后合闸恢复供电，保证电网连续供电；随后查明并排除原动机故障，故障排除后按「故障复位」熄灭故障复位灯，该机组才重新具备投入（备用）条件。在故障未排除前强合主开关，会因保护再次动作而反复跳闸，并可能损坏机组，是错误的。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    //  2. 发电机过载导致主开关跳闸的应急处理（非自动化电站）
    //     1# 单机运行、等待船用辅机自动起动加载稳定 → 投入 400kW + 600kW
    //     测试负载使单机过载 → 分级卸载后主开关跳闸 → 消音确认、卸载、
    //     故障复位、重新合闸恢复供电
    // ══════════════════════════════════════════════════════════════════
    'overload-trip-emergency': {
        id: 'overload-trip-emergency',
        name: '2. 发电机过载导致主开关跳闸的应急处理',
        steps: [
            // ── 1. 正常运行准备：1# 单机供电 ──
            {
                mode: 'check',
                msg: '1. 正常运行准备：确认电站运行模式在「手动」位，起动 1# 发电机组并合上 1# 主开关，建立单机供电',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '检查：并车屏「模式选择」开关在“手动”位，确认后进行单机起动',
                      async act() { await _plSleep(400); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-start',
                      msg: '👉 按下 1# 机组「起动」按钮，柴油机起动、发电机建压建频',
                      async act() { _lvClick('gen1-start'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-hz',
                      msg: '观察 1# 频率表：约 5s 内电压、频率建立至额定值（450V / 60Hz）',
                      async act() { await _lvWait(() => _genUp('gen1'), 15000); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-close',
                      msg: '👉 此刻汇流排无电，直接按下 1# 主开关「合闸」按钮，向汇流排供电',
                      async act() { _lvClick('gen1-close'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return p.getPlantMode() === 'HAND' && !!s.run && !!s.cb;
                },
            },
            // ── 2. 等待 1# 加载稳定（船用辅机 SQ 顺序自动起动） ──
            {
                mode: 'check',
                msg: '2. 等待 1# 发电机加载稳定：汇流排带电后，左组合起动屏的船用辅机（燃油泵→滑油泵→淡水泵→海水泵）按 SQ 顺序自动起动，连同日用变压器、应急配电板等常态负载，等待负荷稳定（约 460kW）',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察 1# PPU：辅机按 SQ 顺序陆续自动起动，功率逐级上升（SQ1 燃油泵→SQ2 滑油泵→SQ3 淡水泵→SQ4 海水泵）',
                      async act() { await _lvWait(_comboLoaded, 30000); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '辅机全部起动完毕，等待 1# 负荷稳定……',
                      async act() { await _plSleep(3000); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return !!s.run && !!s.cb
                        && ['comboL-0', 'comboL-1', 'comboL-2', 'comboL-3'].every(k => p.getMotorState(k));
                },
            },
            // ── 3. 投入测试负载1（400KW） ──
            {
                mode: 'check',
                msg: '3. 投入测试负载1（400KW）：合上左动力负载屏「测试负载1」开关，单机负荷升至约 860kW',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-1',
                      msg: '👉 合上「测试负载1（400KW）」开关',
                      async act() { _lvClick('test-load-1'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getMCBState('ld-loadL-4-0') === true;
                },
            },
            // ── 4. 投入测试负载2（600KW）→ 单机过载 ──
            {
                mode: 'check',
                msg: '4. 投入测试负载2（600KW）：再合上「测试负载2」开关，单机总负荷约 1460kW，超过额定 1000kW（约 146%），过载保护启动计时',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-2',
                      msg: '👉 合上「测试负载2（600KW）」开关，1# 单机过载运行',
                      async act() { _lvClick('test-load-2'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getMCBState('ld-loadL-4-0') === true && p.getMCBState('ld-loadL-4-1') === true;
                },
            },
            // ── 5. 观察过载保护分级动作与主开关跳闸 ──
            {
                mode: 'check',
                msg: '5. 观察过载保护动作：P>120% 延时 5s → 一级卸载（PT-1 分励脱扣）；仍>110% 再延时 5s → 二级卸载（PT-2）；仍>100% 再延时 5s → 主开关跳闸、故障复位灯亮、优先脱扣报警',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'test-load-2',
                      msg: '过载持续：观察过载保护分级卸载计时（测试负载无 PT 标签，卸载后仍过载，约 15s 后主开关跳闸）',
                      async act() { await _lvWait(() => { const p = _lvPanel(); return p && !p.getGenState('gen1').cb; }, 30000); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '观察 1#「故障复位」灯亮、主开关分闸、汇流排失电；优先脱扣报警灯闪亮',
                      async act() { await _plSleep(3000); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const prot = p.getGenProtection('gen1') || '';
                    return !p.getGenState('gen1').cb && prot.indexOf('过载') >= 0 && p.getGenTrip('gen1');
                },
            },
            // ── 6. 报警消音与确认 ──
            {
                mode: 'check',
                msg: '6. 报警处理：过载产生「优先脱扣」报警，点击声光报警器「消音」，再点击「报警确认」熄灭报警灯',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'alarm-silence',
                      msg: '👉 点击「消音」，报警灯由闪烁转常亮、蜂鸣器停响',
                      async act() { _lvClick('alarm-silence'); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'alarm-ack',
                      msg: '👉 报警条件已消失，点击「报警确认」熄灭报警灯',
                      async act() { _lvClick('alarm-ack'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return !p.isAlarmLatched('trip');
                },
            },
            // ── 7. 卸载：分断测试负载 ──
            {
                mode: 'check',
                msg: '7. 卸载：分断两台测试负载开关，消除过载原因（否则重新合闸后又会再次过载跳闸）',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-2',
                      msg: '👉 先分断「测试负载2（600KW）」开关',
                      async act() { _lvClick('test-load-2'); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-1',
                      msg: '👉 再分断「测试负载1（400KW）」开关，单机负荷恢复正常',
                      async act() { _lvClick('test-load-1'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getMCBState('ld-loadL-4-0') === false && p.getMCBState('ld-loadL-4-1') === false;
                },
            },
            // ── 8. 故障复位 ──
            {
                mode: 'check',
                msg: '8. 故障复位：过载原因已消除，1# 柴油机组仍在运行，按下 1#「故障复位」按钮，熄灭故障复位灯',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '👉 按下 1#「故障复位」按钮，熄灭故障复位灯',
                      async act() { _lvClick('gen1-reset'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return !!p.getGenState('gen1').run && !p.getGenTrip('gen1');
                },
            },
            // ── 9. 恢复供电：重新合上 1# 主开关 ──
            {
                mode: 'check',
                msg: '9. 恢复供电：负荷已降至正常范围，重新合上 1# 主开关，1# 恢复对汇流排供电',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-close',
                      msg: '👉 重新合上 1# 主开关，汇流排恢复由 1# 供电',
                      async act() { _lvClick('gen1-close'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return !!s.run && !!s.cb && p.isBusLive();
                },
            },
            // ── 10. 测试题 ──
            {
                msg: '10. 测试题：发电机过载保护与应急处理',
                mode: 'quiz',
                quizConfig: {
                    question: '1# 发电机组单机供电时，若机组过载导致主开关跳闸。关于应急处理，正确的是？',
                    options: [
                        '发电机过载后，主开关合不上闸',
                        '过载保护应瞬时跳闸，无需分级延时卸载',
                        '主开关跳闸后必须更换发电机才能重新合闸',
                        '一般过载跳闸后，进行故障复位后，直接合上主开关即可恢复供电',
                    ],
                    answer: 3,
                    analysis: '发电机过载保护采用反时限分级卸载：过载达到 120% 额定功率并持续 5s 先一级卸载（PT-1 分励脱扣非重要负载）；若仍超过 110% 再延时 5s 二级卸载（PT-2）；若卸载后仍超过 100% 额定，再延时 5s 使主开关跳闸，以保护发电机不因长时间过载而损坏。本次测试负载（400kW+600kW）不带 PT 标签，分级卸载对其无效，故最终跳闸。按「故障复位」清除跳闸锁存，确认机组运行正常后重新合上主开关恢复供电；跳闸不等于发电机损坏，无需更换机组，也不能在不卸载的情况下盲目重新合闸。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    //  3. 发电机逆功率跳闸的故障处理（非自动化电站）
    //     1#+2# 准同步并车、均分负荷 → 投入 400kW + 600kW 测试负载 →
    //     设置 1# 调速器故障（原动机失去动力、主开关不跳闸，进入逆功率）→
    //     逆功率保护延时 8s 跳闸 → 2# 独自带载过载、分级卸载后跳闸 →
    //     处置：卸载、故障复位、恢复 2# 供电，并排除 1# 调速器故障恢复备用
    // ══════════════════════════════════════════════════════════════════
    'reverse-power-trip': {
        id: 'reverse-power-trip',
        name: '3. 发电机逆功率跳闸的故障处理',
        steps: [
            // ── 1. 1# 单机运行准备 ──
            {
                mode: 'check',
                msg: '1. 正常运行准备：确认电站运行模式在「手动」位，起动 1# 发电机组并合上 1# 主开关，先由 1# 单机供电',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '检查：并车屏「模式选择」开关在“手动”位，确认后进行单机起动',
                      async act() { await _plSleep(400); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-start',
                      msg: '👉 按下 1# 机组「起动」按钮，柴油机起动、发电机建压建频',
                      async act() { _lvClick('gen1-start'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-hz',
                      msg: '观察 1# 频率表：约 5s 内电压、频率建立至额定值（450V / 60Hz）',
                      async act() { await _lvWait(() => _genUp('gen1'), 15000); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-close',
                      msg: '👉 按下 1# 主开关「合闸」按钮，向汇流排供电',
                      async act() { _lvClick('gen1-close'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return p.getPlantMode() === 'HAND' && !!s.run && !!s.cb;
                },
            },
            // ── 2. 等待 1# 加载稳定 ──
            {
                mode: 'check',
                msg: '2. 等待 1# 发电机加载稳定并调频：汇流排带电后，左组合起动屏的船用辅机按 SQ 顺序自动起动，待负荷稳定后，点击「1# 调速」把电网频率调到额定 60Hz，再并车',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察 1# PPU：船用辅机按 SQ 顺序陆续自动起动，功率逐级上升',
                      async act() { await _lvWait(_comboLoaded, 30000); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '辅机全部起动完毕，等待 1# 负荷稳定……',
                      async act() { await _plSleep(3000); } },
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen1-gov-up',
                      msg: '👉 点击并车屏「1# 调速」开关“升速”（↻），把电网频率由约 59Hz 调到额定 60Hz',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 24 && Math.abs(p.getBusFreq() - 60) > 0.05; i++) {
                              _lvClick(p.getBusFreq() < 60 ? 'gen1-gov-up' : 'gen1-gov-down');
                              await _plSleep(240);
                          }
                      } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return !!s.run && !!s.cb
                        && ['comboL-0', 'comboL-1', 'comboL-2', 'comboL-3'].every(k => p.getMotorState(k))
                        && Math.abs(p.getBusFreq() - 60) <= 0.15;
                },
            },
            // ── 3. 起动 2# 并准同步并车 ──
            {
                mode: 'check',
                msg: '3. 起动 2# 并准同步并车：起动 2# 建压建频，把「同步选择」开关转到 2#，微调 2# 调速使其与电网频差很小，待同步表指针转到 11~12 点瞬间合上 2# 主开关并车',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-start',
                      msg: '👉 按下 2# 机组「起动」按钮，柴油机起动、发电机建压建频',
                      async act() { _lvClick('gen2-start'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen2-hz',
                      msg: '观察 2# 频率表：等待建压建频完成（约 5s，450V / 60Hz）',
                      async act() { await _lvWait(() => _genUp('gen2'), 15000); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'sync-select',
                      msg: '👉 把「同步选择」开关由 0 位依次转到 2#（选定待并机），同步表开始指示',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 6 && p.getSyncSelection() !== 'gen2'; i++) { _lvClick('sync-select'); await _plSleep(300); }
                      } },
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen2-gov-up',
                      msg: '👉 微调「2# 调速」，使待并机与电网频差约 0.2Hz（同步表指针缓慢旋转）',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 25; i++) {
                              const df = (60.1 + p.getGovernor('gen2')) - p.getBusFreq();
                              if (df >= 0.15 && df <= 0.3) break;
                              _lvClick(df < 0.15 ? 'gen2-gov-up' : 'gen2-gov-down');
                              await _plSleep(200);
                          }
                      } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-close',
                      msg: '👉 在同步表指针转到 11~12 点的瞬间按下 2# 主开关「合闸」按钮，把 2# 并入电网',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 600; i++) {
                              const ang = p.getSyncAngle();
                              const df = (60.1 + p.getGovernor('gen2')) - p.getBusFreq();
                              if (ang >= 315 && ang <= 350 && Math.abs(df) <= 0.5) {
                                  _lvClick('gen2-close');
                                  if (p.getGenState('gen2').cb) break;
                              }
                              await _plSleep(40);
                          }
                      } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'sync-select',
                      msg: '并车成功后，把「同步选择」开关转回“0”位，关闭同步表',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 4 && p.getSyncSelection() !== null; i++) { _lvClick('sync-select'); await _plSleep(320); }
                      } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return !!p.getGenState('gen1').cb && !!p.getGenState('gen2').run && !!p.getGenState('gen2').cb
                        && p.getSyncSelection() === null;
                },
            },
            // ── 4. 均分功率 ──
            {
                mode: 'check',
                msg: '4. 均分功率：两台机组并联后，用调速开关把负荷在两机间重新分配，使 1#、2# 出力基本均分',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察两台机组 PPU 功率：并车瞬间两机出力可能不均，需调节调速开关重新分配',
                      async act() { await _plSleep(1500); } },
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen2-gov-up',
                      msg: '👉 调节调速开关，使两台机组出力趋于均分',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 20 && Math.abs(p.getGenPower('gen1') - p.getGenPower('gen2')) > 20; i++) {
                              if (p.getGenPower('gen2') < p.getGenPower('gen1')) _lvClick('gen2-gov-up');
                              else _lvClick('gen1-gov-up');
                              await _plSleep(220);
                          }
                      } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return !!p.getGenState('gen2').cb
                        && Math.abs(p.getGenPower('gen1') - p.getGenPower('gen2')) <= 20;
                },
            },
            // ── 5. 投入测试负载 ──
            {
                mode: 'check',
                msg: '5. 投入测试负载：依次合上「测试负载1（400KW）」「测试负载2（600KW）」，两台机组均分约 1000kW 测试负载',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-1',
                      msg: '👉 合上「测试负载1（400KW）」开关',
                      async act() { _lvClick('test-load-1'); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-2',
                      msg: '👉 再合上「测试负载2（600KW）」开关，两台机组均分测试负载',
                      async act() { _lvClick('test-load-2'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getMCBState('ld-loadL-4-0') === true && p.getMCBState('ld-loadL-4-1') === true
                        && !!p.getGenState('gen1').cb && !!p.getGenState('gen2').cb;
                },
            },
            // ── 6. 设置 1# 调速器故障，连续观察逆功率与过载连锁跳闸 ──
            //     逆功率保护 8s、2# 过载分级卸载约 15s，时间尺度接近自动演示的单步节奏：
            //     若把「设故障」与两次跳闸观察拆成多步，等下一步开始时故障往往已结束。
            //     故本步把设置故障与"1# 逆功率跳闸→2# 过载连锁跳闸"连续演示，保证时序连贯可见。
            {
                mode: 'check',
                msg: '6. 设置 1# 调速器故障并观察连锁跳闸：1# 原动机失去动力停机，但因与 2# 并联，主开关不跳闸、出现约 100kW 逆功率，逆功率保护延时 8s 使 1# 跳闸；1# 跳闸后 2# 独自带载过载，经 PT-1、PT-2 分级卸载后也跳闸',
                op: [
                    { type: 'fault', fault: 'gen1_gov_fault',
                      msg: '打开「故障设置」界面，勾选「1#发电机调速器故障（并联逆功率）」，点击「应用设置」',
                      async act() { await _plSleep(400); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察 1# PPU：功率变为约 -100kW（逆功率），说明 1# 成为同步电动机、从电网吸收功率；逆功率保护延时 8s 后使 1# 主开关跳闸',
                      async act() { await _lvWait(() => { const p = _lvPanel(); return p && !p.getGenState('gen1').cb; }, 20000); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen2-ppu',
                      msg: '1# 跳闸后全部负荷转移到 2#：观察 2# PPU 功率骤增超过额定，过载保护分级卸载（PT-1、PT-2）后仍过载，延时后 2# 主开关也跳闸',
                      async act() { await _lvWait(() => { const p = _lvPanel(); return p && !p.getGenState('gen2').cb; }, 25000); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const pr1 = p.getGenProtection('gen1') || '';
                    const pr2 = p.getGenProtection('gen2') || '';
                    return p.getGovFault('gen1') && !p.getGenState('gen1').cb && pr1.indexOf('逆功率') >= 0
                        && !p.getGenState('gen2').cb && pr2.indexOf('过载') >= 0;
                },
            },
            // ── 7. 报警处理 ──
            {
                mode: 'check',
                msg: '7. 报警处理：过载产生「优先脱扣」报警，点击声光报警器「消音」，再点击「报警确认」熄灭报警灯',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'alarm-silence',
                      msg: '👉 点击「消音」，报警灯由闪烁转常亮、蜂鸣器停响',
                      async act() { _lvClick('alarm-silence'); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'alarm-ack',
                      msg: '👉 报警条件已消失，点击「报警确认」熄灭报警灯',
                      async act() { _lvClick('alarm-ack'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return !p.isAlarmLatched('trip');
                },
            },
            // ── 8. 恢复 2# 供电 ──
            {
                mode: 'check',
                msg: '8. 恢复 2# 供电：先分断两台测试负载消除过载，再按 2#「故障复位」，重新合上 2# 主开关恢复供电',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-2',
                      msg: '👉 先分断「测试负载2（600KW）」开关卸载',
                      async act() { _lvClick('test-load-2'); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'test-load-1',
                      msg: '👉 再分断「测试负载1（400KW）」开关卸载',
                      async act() { _lvClick('test-load-1'); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-reset',
                      msg: '👉 按下 2#「故障复位」按钮，熄灭故障复位灯',
                      async act() { _lvClick('gen2-reset'); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-close',
                      msg: '👉 重新合上 2# 主开关，恢复 2# 供电',
                      async act() { _lvClick('gen2-close'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s2 = p.getGenState('gen2');
                    return p.getMCBState('ld-loadL-4-0') === false && p.getMCBState('ld-loadL-4-1') === false
                        && !!s2.run && !!s2.cb && p.isBusLive();
                },
            },
            // ── 9. 排除 1# 调速器故障、恢复备用 ──
            {
                mode: 'check',
                msg: '9. 恢复 1# 备用：在「故障设置」界面排除「1#发电机调速器故障」，再按 1#「故障复位」，1# 重新具备投入条件',
                op: [
                    { type: 'fault', fault: 'gen1_gov_fault', repair: true,
                      msg: '打开「故障设置」界面，取消勾选「1#发电机调速器故障」，点击「应用设置」修复',
                      async act() { await _plSleep(400); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '👉 按下 1#「故障复位」按钮，1# 恢复备用状态',
                      async act() { _lvClick('gen1-reset'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return !p.getGovFault('gen1') && !p.getGenTrip('gen1') && !p.getGenState('gen1').cb;
                },
            },
            // ── 10. 测试题 ──
            {
                msg: '10. 测试题：发电机逆功率保护与故障处理',
                mode: 'quiz',
                quizConfig: {
                    question: '两台发电机并联运行、均分负荷时，1# 发电机调速器故障使原动机失去动力。关于该故障的现象与处理，正确的是？',
                    options: [
                        '1# 主开关不会立即跳闸，1# 变成同步电动机从电网吸收功率（出现约 100kW 逆功率），逆功率保护延时 8s 后使 1# 主开关跳闸；2# 独自承担全部负荷而过载，分级卸载后也跳闸，应卸载后恢复 2# 供电',
                        '1# 调速器故障后主开关立即失压跳闸，不会出现逆功率',
                        '1# 出现逆功率时，逆功率保护应瞬时跳闸，没有延时',
                        '2# 不会过载，因为并联运行的两台机组会自动均分负荷',
                    ],
                    answer: 0,
                    analysis: '并列运行的同步发电机中，若某台机组的原动机失去动力（如调速器故障、滑油低压等），而主开关仍保持合闸，该机即由发电机转变为同步电动机，从电网吸收有功功率，形成逆功率（约 10% 额定，即 100kW）。逆功率保护检测到逆功率超过 10% 额定并延时 8s 后，使该机主开关跳闸，防止其长时间作为电动机运行而损坏原动机。1# 跳闸后，全部负荷转移到 2#，2# 严重过载，经 PT-1、PT-2 两级卸载后仍过载，最终过载保护使 2# 主开关跳闸；此时应分断测试负载消除过载，对 2# 故障复位后重新合闸恢复供电，并排除 1# 调速器故障使其恢复备用。',
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
