

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
    gen3_fault: {
        id: 'gen3_fault', name: '3. 3#发电机组故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenFault('gen3') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen3', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenFault('gen3', false); },
    },
    load_ground: {
        id: 'load_ground', name: '4. 左动力负载屏接地（绝缘降低）', system: '动力负载',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getLoadGroundFault() : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setLoadGroundFault(true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setLoadGroundFault(false); },
    },
    gen1_class1: {
        id: 'gen1_class1', name: '5. 1#发电机组I级故障', system: '发电机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getGenClass1('gen1') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenClass1('gen1', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setGenClass1('gen1', false); },
    },
    bus_short: {
        id: 'bus_short', name: '6. 汇流排短路故障', system: '汇流排',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getAlarm('short') : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setAlarm('short', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setAlarm('short', false); },
    },
    gen1_prime_temp: {
        id: 'gen1_prime_temp', name: '7. 1#原动机冷却水温高', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'temp' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'temp', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', null, false); },
    },
    gen1_prime_lo: {
        id: 'gen1_prime_lo', name: '8. 1#原动机滑油压力低', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'lo' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'lo', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', null, false); },
    },
    gen1_prime_over: {
        id: 'gen1_prime_over', name: '9. 1#原动机超速', system: '原动机',
        check() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; return p ? p.getPrimeFault('gen1') === 'over' : false; },
        trigger() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', 'over', true); },
        repair() { const p = window.sys && window.sys.comps && window.sys.comps.lv_switch_panel; if (p) p.setPrimeFault('gen1', null, false); },
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

export const PROJECT_WORKFLOWS = {
    'dg-sync-parallel': {
        id: 'dg-sync-parallel', name: '1. 同步发电机的并车和解列',
        steps: [
            // ── 1. 检查并车条件 ──
            {
                mode: 'check',
                msg: '1. 检查并车条件：确认电站模式在“手动”位，并点击 1#（或 2#）机组「准备好」指示灯，确认机组具备投入条件',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'plant-mode',
                      msg: '检查①：并车屏「模式选择」开关应在“手动”位（本流程演示手动准同步并车）' },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen1-ready',
                      msg: '检查②：点击 1#（或 2#）机组「准备好」指示灯（遥控、无故障、停机时亮），确认机组可投入',
                      async act() { _lvClick('gen1-ready'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const lc = (window.sys && window.sys.lastClickedPartId) || '';
                    const clickedReady = lc.endsWith('gen1-ready') || lc.endsWith('gen2-ready');
                    return clickedReady && p.getPlantMode() === 'HAND';
                },
            },
            // ── 2. 单机起动 1# 发电机组 ──
            {
                mode: 'check',
                msg: '2. 单机起动：按下 1# 机组「起动」按钮，等待建压建频，再合上 1# 主开关，由 1# 单机供电',
                op: [
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
                check() { const p = _lvPanel(); if (!p) return false; const s = p.getGenState('gen1'); return !!(s.run && s.cb); },
            },
            // ── 3. 等待负载起动（SQ 顺序自动起动） ──
            {
                mode: 'check',
                msg: '3. 等待负载起动：汇流排带电后，各电动机按 SQ 顺序自动起动（SQ1 燃油泵→SQ2 滑油泵→SQ3 淡水泵→SQ4 海水泵），约 15s 后负荷稳定',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察 1# PPU：电压稳定，频率随负荷增加略降，电流、功率逐步上升',
                      async act() { await _plSleep(6000); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '负载陆续投入……等待 SQ4「1# 主海水泵」起动运行、负荷稳定',
                      async act() { await _lvWait(() => { const p = _lvPanel(); return p && p.getMotorState('comboL-0'); }, 25000); await _plSleep(1200); } },
                ],
                check() { const p = _lvPanel(); return !!(p && p.getMotorState('comboL-0') && p.getGenState('gen1').cb); },
            },
            // ── 4. 调频：把电网频率调回额定 60Hz ──
            {
                mode: 'check',
                msg: '4. 调节原动机转速：点击并车屏「1# 调速」开关“升速”侧，把电网频率由约 59Hz 升到额定 60Hz',
                op: [
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen1-gov-up',
                      msg: '👉 反复点击「1# 调速」开关“升速”（↻），把电网频率升到 60Hz',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 24 && p.getBusFreq() < 59.95; i++) { _lvClick('gen1-gov-up'); await _plSleep(240); }
                      } },
                ],
                check() { const p = _lvPanel(); return !!(p && Math.abs(p.getBusFreq() - 60) <= 0.15); },
            },
            // ── 5. 准同步准备：选机 + 起动 2# ──
            {
                mode: 'check',
                msg: '5. 准同步并车准备：先起动 2# 发电机组建压建频，再把「同步选择」开关转到 2#（选定待并机）',
                op: [
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-start',
                      msg: '👉 先按下 2# 机组「起动」按钮，柴油机起动、发电机建压建频',
                      async act() { _lvClick('gen2-start'); } },
                    { type: 'observe', target: 'lv_switch_panel', part: 'sync-meter',
                      msg: '等待 2# 建压建频完成（约 5s，电压升至 450V）',
                      async act() { await _lvWait(() => _genUp('gen2'), 15000); } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'sync-select',
                      msg: '👉 再把「同步选择」开关由 0 位依次转到 2#（选定待并机），同步表开始指示',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 6 && p.getSyncSelection() !== 'gen2'; i++) { _lvClick('sync-select'); await _plSleep(360); }
                      } },
                ],
                check() { const p = _lvPanel(); return !!(p && p.getSyncSelection() === 'gen2' && p.getGenState('gen2').run); },
            },
            // ── 6. 手动准同步：指针过 12 点时合闸并车 ──
            {
                mode: 'check',
                msg: '6. 手动准同步并车：微调 2# 使频差约 0.2Hz（同步表指针缓慢旋转），在指针转到 11 点（同相点提前）瞬间按下 2# 主开关「合闸」',
                op: [
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen2-gov-up',
                      msg: '👉 微调「2# 调速」，使待并机与电网频差约为 0.2Hz（指针缓慢旋转）',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 20; i++) {
                              const df = (60.1 + p.getGovernor('gen2')) - p.getBusFreq();
                              if (df >= 0.15 && df <= 0.3) break;
                              _lvClick(df < 0.15 ? 'gen2-gov-up' : 'gen2-gov-down');
                              await _plSleep(240);
                          }
                      } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-close',
                      msg: '👉 在指针转到 11 点（同相点提前）的瞬间按下 2# 主开关「合闸」按钮，把 2# 并入电网',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 500; i++) {
                              const df = (60.1 + p.getGovernor('gen2')) - p.getBusFreq();
                              const ang = p.getSyncAngle();
                              // 11 点 ≈ 330°（同相点 12 点前 30°），提前合闸
                              if (ang >= 315 && ang <= 348 && Math.abs(df) <= 0.5) {
                                  _lvClick('gen2-close');
                                  if (p.getGenState('gen2').cb) break;
                              }
                              await _plSleep(45);
                          }
                      } },
                    { type: 'switch', target: 'lv_switch_panel', part: 'sync-select',
                      msg: '并车成功，把「同步选择」开关转回“0”位，关闭同步表',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 4 && p.getSyncSelection() !== null; i++) { _lvClick('sync-select'); await _plSleep(320); }
                      } },
                ],
                check() { const p = _lvPanel(); if (!p) return false; const s = p.getGenState('gen2'); return !!(s.run && s.cb); },
            },
            // ── 7. 分功：负荷转移、两机出力均分 ──
            {
                mode: 'check',
                msg: '7. 分功（负荷均分）：两台机组并联后，用调速开关把负荷在两机间转移，使 1#、2# 出力基本均分',
                op: [
                    { type: 'observe', target: 'lv_switch_panel', part: 'ppu',
                      msg: '观察两台机组 PPU 功率：并车瞬间两机出力不均，需调节调速开关重新分配',
                      async act() { await _plSleep(1500); } },
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen2-gov-up',
                      msg: '👉 提高出力较小的机组（「2# 调速」升速）使其多带负荷，两机出力趋于均分',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 14 && Math.abs(p.getGenPower('gen1') - p.getGenPower('gen2')) > 30; i++) {
                              if (p.getGenPower('gen2') < p.getGenPower('gen1')) _lvClick('gen2-gov-up');
                              else _lvClick('gen1-gov-up');
                              await _plSleep(340);
                          }
                      } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    return p.getGenState('gen2').cb && Math.abs(p.getGenPower('gen1') - p.getGenPower('gen2')) <= 45;
                },
            },
            // ── 8. 调频：两机同步调速，频率回到 60Hz ──
            {
                mode: 'check',
                msg: '8. 调频：两台机组同步升/降速（成对操作，出力分配不变），把电网频率调回 60Hz',
                op: [
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen2-gov-up',
                      msg: '👉 两机同步调整调速开关，使频率稳定在 60Hz（保持负荷均分）',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 14 && Math.abs(p.getBusFreq() - 60) > 0.05; i++) {
                              const dir = p.getBusFreq() < 60 ? 'up' : 'down';
                              _lvClick('gen1-gov-' + dir); _lvClick('gen2-gov-' + dir);
                              await _plSleep(340);
                          }
                      } },
                ],
                check() { const p = _lvPanel(); return !!(p && p.getGenState('gen2').cb && Math.abs(p.getBusFreq() - 60) <= 0.15); },
            },
            // ── 9. 解列 2# 机组 ──
            {
                mode: 'check',
                msg: '9. 解列 2# 机组：先把 2# 负荷转移给 1#（2# 降速，剩约 5% 时停止转移），再按 2# 主开关「分闸」解列，最后按「停止」停机',
                op: [
                    { type: 'knob', target: 'lv_switch_panel', part: 'gen2-gov-down',
                      msg: '👉 连续点击「2# 调速」降速，把 2# 负荷转移给 1#；当 2# 仅剩约 5%（≈50kW）时停止转移',
                      async act() {
                          const p = _lvPanel(); if (!p) return;
                          for (let i = 0; i < 20 && p.getGenPower('gen2') > 50; i++) { _lvClick('gen2-gov-down'); await _plSleep(260); }
                      } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-open',
                      msg: '👉 按下 2# 主开关「分闸」按钮，2# 退出并联（解列）',
                      async act() { _lvClick('gen2-open'); } },
                    { type: 'btn', target: 'lv_switch_panel', part: 'gen2-stop',
                      msg: '👉 按下 2# 机组「停止」按钮，2# 停机',
                      async act() { _lvClick('gen2-stop'); } },
                ],
                check() {
                    const p = _lvPanel(); if (!p) return false;
                    const s1 = p.getGenState('gen1'), s2 = p.getGenState('gen2');
                    return !s2.run && !s2.cb && s1.run && s1.cb;
                },
            },
            // ── 10. 测试题 ──
            {
                msg: '10. 测试题：同步发电机并车条件',
                mode: 'quiz',
                quizConfig: {
                    question: '同步发电机手动准同步并车，合闸瞬间必须满足的条件是？',
                    options: [
                        '待并机与电网的电压、频率（频差）、相位均接近一致，尤其是相位差接近 0°',
                        '只要待并机电压高于电网电压即可合闸',
                        '待并机频率必须远高于电网频率，以便“抢带”负荷',
                        '只要两台发电机都处于运行状态，任何时候合闸都不会有冲击',
                    ],
                    answer: 0,
                    analysis: '准同步并车的三个条件是：待并机电压与电网电压接近相等、频率接近相等（频差足够小，同步表指针转得慢）、相位一致（在同步表指针过 12 点的瞬间合闸）。频率差过大指针转得快，相位差大时合闸会产生巨大冲击电流；频差过大合闸还会触发并车保护使主开关跳闸。并车后通过调速开关转移负荷实现分功，并同步调整使频率保持额定。',
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
