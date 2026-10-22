

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

export const PROJECT_WORKFLOWS = {
    // ══════════════════════════════════════════════════════════════════
    //  1. 自动化电站主开关跳闸的应急处理（原动机组冷却水温高）
    //     手动模式下 1# 单机运行供电 → 电站转入「自动」模式 →
    //     1# 原动机冷却水温高保护动作停机、主开关跳闸、汇流排失电 →
    //     自动电站检测失电，按备用顺序自动识别并跳过 1#、自动起动 2#
    //     建压后自动合闸恢复供电 → 排除故障 → 故障复位 → 1# 恢复备用
    // ══════════════════════════════════════════════════════════════════
    'auto-prime-temp-trip': {
        id: 'auto-prime-temp-trip',
        name: '1. 自动化电站主开关跳闸的应急处理（原动机组冷却水温高）',
        steps: [
            // ── 1. 正常运行准备：手动起动 1# 单机供电 ──
            {
                mode: 'check',
                msg: '1. 手动起动 1# 发电机组，建压建频后合上 1# 主开关，由 1# 单机供电',
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
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return p.getPlantMode() === 'HAND' && !!s.run && !!s.cb && p.isBusLive();
                },
            },
            // ── 2. 电站转入自动模式 ──
            {
                mode: 'check',
                msg: '2. 电站转入自动化运行：点击并车屏「模式选择」开关，由“手动”位转到“自动”位',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '👉 点击「模式选择」开关，由“手动”档切换到“自动”档',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 4 && p.getPlantMode() !== 'AUTO'; i++) { _lvClick('plant-mode'); await _plSleep(500); }
                      } },
                ],
                check() { const p = _lvPanel(); return !!p && p.getPlantMode() === 'AUTO'; },
            },
            // ── 3. 设置原动机冷却水温高故障 → 停机跳闸 ──
            {
                mode: 'check',
                msg: '3. 通过「故障设置」界面设置「1#原动机冷却水温高」。原动机保护动作 → 1# 柴油机立即停机、1# 主开关跳闸、汇流排失电',
                op: [
                    { type: 'fault', fault: 'gen1_prime_temp',
                      msg: '打开「故障设置」界面，勾选「1#原动机冷却水温高」，点击「应用设置」',
                      async act() { await _plSleep(400); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    // 必须确认确已设置「冷却水温高」故障，否则 1# 本就停机时分闸条件恒真、会误判通过
                    return p.getPrimeFault('gen1') === 'temp' && !s.run && !s.cb;
                },
            },
            // ── 4. 观察自动化电站失电自动恢复 ──
            {
                mode: 'check',
                msg: '4. 观察自动化电站自动恢复：1# 跳闸后汇流排失电，自动电站检测“失电”→  自动起动 2# 备用机组、建压后自动合闸恢复供电',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '观察 1#「故障复位」灯亮、主开关分闸：原动机保护动作导致故障跳闸，1# 退出运行',
                      async act() { await _plSleep(2500); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen2-hz',
                      msg: '自动电站自动起动 2# 备用机组（约 3s 后起动、5s 后自动合闸），观察 2# 建压建频并自动并网',
                      async act() { await _lvWait(() => { const p = _lvPanel(); const s = p && p.getGenState('gen2'); return !!(s && s.run && s.cb && p.isBusLive()); }, 30000); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen2-ppu',
                      msg: '汇流排恢复带电，由 2# 单机供电（1# 保持故障停机）',
                      async act() { await _plSleep(3000); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s1 = p.getGenState('gen1'), s2 = p.getGenState('gen2');
                    return !!s2.run && !!s2.cb && p.isBusLive() && !s1.run;
                },
            },
            // ── 5. 排除原动机故障 ──
            {
                mode: 'check',
                msg: '5. 查明并排除冷却水温高原因（检查冷却水系统、清洗换热器等）后，在「故障设置」界面取消勾选并应用，修复「1#原动机冷却水温高」故障',
                op: [
                    { type: 'fault', fault: 'gen1_prime_temp', repair: true,
                      msg: '打开「故障设置」界面，取消勾选「1#原动机冷却水温高」，点击「应用设置」修复故障',
                      async act() { await _plSleep(400); } },
                ],
                check() { const p = _lvPanel(); return !!p && p.getPrimeFault('gen1') === null; },
            },
            // ── 6. 故障复位 ──
            {
                mode: 'check',
                msg: '6. 故障排除后按下 1#「故障复位」按钮，熄灭故障复位灯，1# 退出故障状态',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '👉 按下 1#「故障复位」按钮，熄灭故障复位灯',
                      async act() { _lvClick('gen1-reset'); } },
                ],
                check() { const p = _lvPanel(); return !!p && !p.getGenTrip('gen1'); },
            },
            // ── 7. 恢复备用状态 ──
            {
                mode: 'check',
                msg: '7. 恢复备用状态：1# 主开关已分闸、机组停机并复位，「准备好」灯恢复，1# 重新具备自动投入条件；当前由 2# 单机供电',
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
                msg: '8. 测试题：自动化电站原动机故障跳闸后的自动恢复',
                mode: 'quiz',
                quizConfig: {
                    question: '自动化电站运行中，1# 机组因原动机冷却水温高保护动作停机、1# 主开关跳闸导致汇流排失电。下列关于自动电站应急处理的描述，正确的是？',
                    options: [
                        '检测到汇流排失电后，按备用顺序自动识别并跳过故障的 1# 机组，自动起动 2# 机组，建压后自动合闸恢复供电',
                        '自动电站反复强合 1# 主开关，直至把电送出去',
                        '自动电站仅发出报警并停止工作，等待人工手动起动 2# 机组',
                        '自动电站自动恢复 1# 原动机运行并重新合上 1# 主开关',
                    ],
                    answer: 0,
                    analysis: '原动机（柴油机）冷却水温高属于原动机保护动作：为保护柴油机，保护装置立即使机组停机，主开关随之失压跳闸，汇流排失电。自动化电站检测到汇流排失电后，按设定的备用顺序依次查找可用机组：自动识别 1# 机组处于故障状态并跳过它，自动发出起动命令给 2# 机组；2# 机组建压建频完成后，自动电站再发出合闸命令，自动恢复供电，全过程无需人工干预。排除 1# 故障并按「故障复位」后，1# 才重新具备备用投入条件。这正是自动化电站相较非自动化电站的核心价值。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    //  2. 自动化电站主开关跳闸的硬件处理（汇流排短路）
    //     手动模式下 1# 单机运行供电 → 电站转入「自动」模式 →
    //     汇流排短路故障 → 1# 主开关短路保护瞬时跳闸、汇流排失电、短路报警 →
    //     自动电站检测短路立即阻塞自动模式（不自动起机/合闸）→
    //     将模式转回手动 → 排除短路故障 → 消音确认 → 故障复位 →
    //     手动合闸恢复供电
    // ══════════════════════════════════════════════════════════════════
    'auto-short-trip-hardware': {
        id: 'auto-short-trip-hardware',
        name: '2. 自动化电站主开关跳闸的硬件处理（汇流排短路）',
        steps: [
            // ── 1. 正常运行准备：手动起动 1# 单机供电 ──
            {
                mode: 'check',
                msg: '1. 手动起动 1# 发电机组，建压建频后合上 1# 主开关，由 1# 单机供电',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '检查：并车屏「模式选择」开关在“手动”位',
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
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s = p.getGenState('gen1');
                    return p.getPlantMode() === 'HAND' && !!s.run && !!s.cb && p.isBusLive();
                },
            },
            // ── 2. 电站转入自动模式 ──
            {
                mode: 'check',
                msg: '2. 点击并车屏「模式选择」开关，由“手动”位转到“自动”位',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '👉 点击「模式选择」开关，由“手动”档切换到“自动”档',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 4 && p.getPlantMode() !== 'AUTO'; i++) { _lvClick('plant-mode'); await _plSleep(500); }
                      } },
                ],
                check() { const p = _lvPanel(); return !!p && p.getPlantMode() === 'AUTO'; },
            },
            // ── 3. 设置汇流排短路故障 → 主开关短路保护跳闸 ──
            {
                mode: 'check',
                msg: '3. 通过「故障设置」界面设置「汇流排短路故障」 1# 主开关短路保护瞬时动作跳闸、汇流排失电、短路报警',
                op: [
                    { type: 'fault', fault: 'bus_short',
                      msg: '打开「故障设置」界面，勾选「汇流排短路故障」，点击「应用设置」',
                      async act() { await _plSleep(400); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '观察 1# 主开关短路保护瞬时跳闸、汇流排失电（故障复位灯亮）',
                      async act() { await _lvWait(() => { const p = _lvPanel(); return !!(p && !p.getGenState('gen1').cb); }, 10000); } },

                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getAlarm('short') && !p.getGenState('gen1').cb && !p.isBusLive();
                },
            },
            // ── 4. 观察自动模式被阻塞 → 消音 → 转回手动 ──
            {
                mode: 'check',
                msg: '4. 自动电站立即阻塞自动模式（PPU 显示 BLOCKED），不自动起动任何机组、不自动合闸，防止对短路点反复送电。先点击声光报警器「消音」，再点击「模式选择」开关把电站由“自动”转回“手动”',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察 1# PPU 模式显示 BLOCKED：自动模式被阻塞，不自动起机、不自动合闸',
                      async act() { await _plSleep(5000); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'alarm-silence',
                      msg: '👉 先点击「消音」，蜂鸣器停响、报警灯由闪烁转常亮（短路报警条件仍在，暂不能确认）',
                      async act() { _lvClick('alarm-silence'); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '👉 再点击「模式选择」开关，由“自动”档转回“手动”档，退出自动运行',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 4 && p.getPlantMode() !== 'HAND'; i++) { _lvClick('plant-mode'); await _plSleep(500); }
                      } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.isAutoBlocked() && p.getPlantMode() === 'HAND';
                },
            },
            // ── 5. 排除短路故障 ──
            {
                mode: 'check',
                msg: '5. 排除短路故障：查明并隔离短路点（绝缘损坏、误操作、检修遗留物等），确认汇流排绝缘正常后，在「故障设置」界面取消勾选并应用，修复「汇流排短路故障」',
                op: [
                    { type: 'fault', fault: 'bus_short', repair: true,
                      msg: '打开「故障设置」界面，取消勾选「汇流排短路故障」，点击「应用设置」修复故障',
                      async act() { await _plSleep(400); } },
                ],
                check() { const p = _lvPanel(); return !!p && !p.getAlarm('short'); },
            },
            // ── 6. 故障修复后报警确认 ──
            {
                mode: 'check',
                msg: '6. 报警确认：短路故障已修复、报警条件已消失，此时点击声光报警器「报警确认」熄灭报警灯',
                op: [
                    { type: 'switch', target: 'lv_switch_panel', part: 'alarm-ack',
                      msg: '👉 故障已修复，点击「报警确认」熄灭报警灯',
                      async act() { _lvClick('alarm-ack'); } },
                ],
                check() { const p = _lvPanel(); return !!p && !p.isAlarmLatched('short'); },
            },
            // ── 7. 故障复位 ──
            {
                mode: 'check',
                msg: '7. 故障复位：短路已排除，按下 1#「故障复位」按钮，熄灭故障复位灯',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-reset',
                      msg: '👉 按下 1#「故障复位」按钮，熄灭故障复位灯',
                      async act() { _lvClick('gen1-reset'); } },
                ],
                check() { const p = _lvPanel(); return !!p && !p.getGenTrip('gen1'); },
            },
            // ── 8. 手动合闸恢复供电 ──
            {
                mode: 'check',
                msg: '8. 恢复供电：1# 柴油机组仍在运行、短路已排除，在手动模式下重新合上 1# 主开关，恢复汇流排供电',
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
            // ── 9. 测试题 ──
            {
                msg: '9. 测试题：汇流排短路故障时自动电站的处理与恢复',
                mode: 'quiz',
                quizConfig: {
                    question: '自动化电站运行中，汇流排发生短路故障（主开关短路保护瞬时跳闸、全船失电），自动模式被阻塞。将控制模式转回手动后，正确的恢复步骤是？',
                    options: [
                        '查明并隔离短路点、确认汇流排绝缘恢复正常后，在手动模式下合闸恢复供电',
                        '清除短路故障后，立即将控制模式拨回“自动”，让自动电站自动恢复供电',
                        '自动模式被阻塞后，直接反复手动合闸主开关直到成功',
                        '短路故障无需排查，转回手动后直接起动备用机组并车供电即可',
                    ],
                    answer: 0,
                    analysis: '汇流排短路是船舶电站最严重的故障：短路电流巨大，主开关短路保护瞬时跳闸以切断短路点、保护发电机与人身安全。自动化电站检测到短路后立即阻塞自动模式（既不自动起动机组也不自动合闸），防止对短路点反复送电、扩大故障。操作人员确认阻塞后应将控制模式转回手动，人工查明并隔离短路点（绝缘损坏、进水、误操作、检修遗留物等），确认汇流排绝缘恢复正常后，才能手动合闸恢复供电。若短路未排除就拨回自动档，自动电站仍会因短路标记保持阻塞；若强行合闸，则会再次对短路点送电，扩大设备损坏甚至引发火灾，这体现了“选择性保护 + 人工确认”的安全原则。',
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
