import { WT1226 } from '../components/WT1226.js';
import { CoolingSys } from '../components/CoolingSys.js';
import { ACPower } from '../components/ACPower.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 动画接线（约 3s/根，用于自动演示中 ≤8 根的逐根接线） */
async function _addAnim(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 轮询等待条件成立（自动演示中用于等待温度变化等物理过程） */
async function _waitFor(fn, timeoutMs = 90000, stepMs = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (fn()) return true; } catch (e) { /* 忽略 */ }
        await new Promise(r => setTimeout(r, stepMs));
    }
    return false;
}

/** 接线：交流电源与温度开关接入制冷系统（≤8 根，逐根动画接入） */
async function _wireSystem(sys) {
    sys.conns.length = 0;
    sys.redrawAll();
    await _addAnim(sys, 'ac_wire_p', 'cs_wire_pwl');
    await _addAnim(sys, 'ac_wire_n', 'cs_wire_pwn');
    await _addAnim(sys, 'wt_wire_NO', 'cs_wire_l');
    await _addAnim(sys, 'wt_wire_COM', 'cs_wire_r');
    sys.redrawAll();
}

/** 打开参数配置界面仅查看指定字段（逐个高亮提示后关闭） */
async function _demoViewConfig(wf, compId, items, tip) {
    const comp = wf.sys.comps[compId];
    if (!comp) return;
    comp.showConfigDialog();
    await new Promise(r => setTimeout(r, 600));
    if (tip) wf._tipWorkflow(tip, 4000);
    let modal = null;
    for (const it of items) {
        const el = document.getElementById('diag_' + it.key);
        if (el) {
            if (!modal) modal = el.closest('div[style*="position: fixed"]');
            await wf._flashDomElement(el, it.tip, 2000);
        }
    }
    if (modal) {
        const cancelBtn = [...modal.querySelectorAll('button')].find(b => b.textContent.indexOf('取消') !== -1);
        if (cancelBtn) {
            await wf._flashDomElement(cancelBtn, '查看完毕，点击「取消」关闭参数配置界面', 1500);
            cancelBtn.click();
        }
    }
    await new Promise(r => setTimeout(r, 400));
}

export const PROJECT_WORKFLOWS = {
    'wt-adjust': {
        id: 'wt-adjust',
        name: '1. 温度继电器的调整和应用',
        steps: [
            // ── 步骤 1 ──
            {
                msg: '1. 制冷系统连接电源和温度开关，接通电源；观察温度，确认温度开关 NO 触点闭合（温度高于上限）。',
                mode: 'check',
                check() {
                    const sys = this.sys, ac = sys.comps['ac'], wt = sys.comps['wt'];
                    return !!(ac && ac.isOn && wt && wt.isEnergized === false
                        && _hasConn(sys, 'ac_wire_p', 'cs_wire_pwl')
                        && _hasConn(sys, 'ac_wire_n', 'cs_wire_pwn')
                        && _hasConn(sys, 'wt_wire_NO', 'cs_wire_l')
                        && _hasConn(sys, 'wt_wire_COM', 'cs_wire_r'));
                },
                op: [
                    {
                        type: 'observe', target: 'cs', part: 'pwl',
                        msg: '接线：交流电源 L/N → 制冷系统右侧电源接口；温度开关 NO/COM → 制冷系统左侧控制端',
                        async act() {
                            await _wireSystem(this.sys);
                            await new Promise(r => setTimeout(r, 600));
                        },
                    },
                    {
                        type: 'switch', target: 'ac', part: 'power',
                        msg: '按下交流电源面板「电源」按钮，接通电源（220V / 50Hz）',
                        async act() {
                            const ac = this.sys.comps['ac'];
                            if (ac) { ac.isOn = true; ac.update(); }
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'cs', part: 'lcd',
                        msg: '观察制冷系统液晶屏温度：环境温度 10℃，高于动作上限 3.5℃',
                        async act() { await new Promise(r => setTimeout(r, 2000)); },
                    },
                    {
                        type: 'observe', target: 'wt', part: 'no',
                        msg: '确认温度开关 NO 触点闭合（温度高于上限，触点接通）',
                        async act() { await new Promise(r => setTimeout(r, 2000)); },
                    },
                ],
            },

            // ── 步骤 2 ──
            {
                msg: '2. 打开温度继电器的参数配置界面，查看动作下限和动作上限（默认 0℃ 和 3.5℃）。',
                mode: 'check',
                check() {
                    // 必须已打开温度继电器的参数配置界面（对话框内的字段 id 为 diag_lowSet）才能跳过
                    const el = document.getElementById('diag_lowSet');
                    if (!el) return false;
                    const modal = el.closest('div[style*="position: fixed"]');
                    return !!modal && /配置设备[:：]\s*wt/.test(modal.textContent || '');
                },
                op: [
                    {
                        type: 'observe', target: 'wt', part: 'scale',
                        msg: '右键温度继电器 → 参数设置，打开参数配置界面',
                        async act() {
                            await _demoViewConfig(this, 'wt', [
                                { key: 'lowSet', tip: '查看「动作下限」＝ 0.0℃（温度低于该值，NO 断开）' },
                                { key: 'diffTemp', tip: '查看「幅差」＝ 3.5℃（动作上、下限之差）' },
                                { key: 'highSet', tip: '查看「动作上限」＝ 3.5℃（温度高于该值，NO 闭合）' },
                            ], '温控器默认动作下限 0℃、动作上限 3.5℃');
                        },
                    },
                ],
            },

            // ── 步骤 3 ──
            {
                msg: '3. 手动开启压缩机，温度开始下降；当温度下降到低于下限 0℃ 时，NO 触点断开。',
                mode: 'check',
                check() {
                    const wt = this.sys.comps['wt'];
                    return !!(wt && wt.isEnergized === true);   // NO 断开
                },
                op: [
                    {
                        type: 'btn', target: 'cs', part: 'start',
                        msg: '按下制冷系统面板「起动」按钮，手动开启压缩机（LOCAL 模式）',
                        async act() {
                            const cs = this.sys.comps['cs'];
                            if (cs) { cs.mode = 'local'; cs.running = true; cs.targetPower = 1.0; }
                            await new Promise(r => setTimeout(r, 200));
                        },
                    },
                    {
                        type: 'observe', target: 'cs', part: 'lcd',
                        msg: '观察温度持续下降；降到下限 0℃ 以下时 NO 触点断开（随即停止压缩机，避免温度继续下探）',
                        async act() {
                            const cs = this.sys.comps['cs'], wt = this.sys.comps['wt'];
                            await _waitFor(() => wt && wt.isEnergized === true, 45000);   // 等待温度降到 0℃ 以下
                            if (cs) { cs.running = false; cs.targetPower = 0; }           // 立即停机，防止过冷
                            await new Promise(r => setTimeout(r, 300));
                        },
                    },
                    {
                        type: 'observe', target: 'wt', part: 'no',
                        msg: 'NO 触点已断开',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
            },

            // ── 步骤 4 ──
            {
                msg: '4. 手动停止压缩机，温度开始上升；当温度高于上限 3.5℃ 时，NO 触点恢复闭合。',
                mode: 'check',
                check() {
                    const wt = this.sys.comps['wt'];
                    return !!(wt && wt.isEnergized === false);  // NO 恢复闭合
                },
                op: [
                    {
                        type: 'btn', target: 'cs', part: 'stop',
                        msg: '按下制冷系统面板「停止」按钮，停止压缩机',
                        async act() {
                            const cs = this.sys.comps['cs'];
                            if (cs) { cs.running = false; cs.targetPower = 0; }   // 立即停机，不额外延时
                        },
                    },
                    {
                        type: 'observe', target: 'cs', part: 'lcd',
                        msg: '观察温度自然回升（向环境温度 10℃ 回升）',
                        async act() {
                            const wt = this.sys.comps['wt'];
                            await _waitFor(() => wt && wt.isEnergized === false, 60000);  // 等待温度升到 3.5℃ 以上
                            await new Promise(r => setTimeout(r, 500));
                        },
                    },
                    {
                        type: 'observe', target: 'wt', part: 'no',
                        msg: '温度升到上限 3.5℃ 以上，NO 触点恢复闭合',
                        async act() { await new Promise(r => setTimeout(r, 1200)); },
                    },
                ],
            },

            // ── 步骤 5 ──
            {
                msg: '5. 将温度开关的动作下限值调为 -5℃。',
                mode: 'check',
                check() {
                    const wt = this.sys.comps['wt'];
                    return !!(wt && Math.abs(wt.lowSet - (-5)) < 0.3);
                },
                op: [
                    {
                        type: 'knob', target: 'wt', part: 'setscrew',
                        msg: '连续点击「设定值调节」螺钉下半部，每点击一次下限降低 1℃，由 0℃ 调到 -5℃',
                        async act() {
                            const wt = this.sys.comps['wt'];
                            if (!wt || typeof wt.turnSetScrew !== 'function') return;
                            const steps = Math.round(((-5) - wt.lowSet) / wt.setValueStep);
                            for (let i = 0; i < Math.abs(steps); i++) {
                                wt.turnSetScrew(steps > 0 ? 1 : -1);
                                await new Promise(r => setTimeout(r, 350));
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'wt', part: 'scale',
                        msg: '动作下限已调到 -5℃（动作上限随之变为 -1.5℃）',
                        async act() { await new Promise(r => setTimeout(r, 1500)); },
                    },
                ],
            },

            // ── 步骤 6 ──
            {
                msg: '6. 将温度开关的幅差调为 4℃，则动作上限变为 -1℃。',
                mode: 'check',
                check() {
                    const wt = this.sys.comps['wt'];
                    return !!(wt && Math.abs((wt.highSet - wt.lowSet) - 4) < 0.3 && Math.abs(wt.highSet - (-1)) < 0.3);
                },
                op: [
                    {
                        type: 'knob', target: 'wt', part: 'diffscrew',
                        msg: '连续点击「幅差调节」螺钉右半部，把幅差由 3.5℃ 调到 4℃（上限随之变为 -1℃）',
                        async act() {
                            const wt = this.sys.comps['wt'];
                            if (!wt || typeof wt.turnDiffScrew !== 'function') return;
                            const step = wt.diffStep !== undefined ? wt.diffStep : 2;
                            const diffSpan = wt.diffMax - wt.diffMin;
                            const targetPct = diffSpan > 0 ? ((4 - wt.diffMin) / diffSpan) * 100 : wt.differential;
                            let guard = 0;
                            while (Math.abs(wt.differential - targetPct) > step / 2 && guard++ < 60) {
                                wt.turnDiffScrew(wt.differential < targetPct ? 1 : -1);
                                await new Promise(r => setTimeout(r, 300));
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'wt', part: 'scale',
                        msg: '幅差已调到 4℃ → 动作上限 ＝ -5 ＋ 4 ＝ -1℃',
                        async act() { await new Promise(r => setTimeout(r, 1500)); },
                    },
                ],
            },

            // ── 步骤 7 ──
            {
                msg: '7. 将制冷控制模式转为遥控（REMOTE），观察系统温度进入双位控制。',
                mode: 'check',
                check() {
                    const cs = this.sys.comps['cs'];
                    return !!(cs && cs.mode === 'remote');
                },
                op: [
                    {
                        type: 'switch', target: 'cs', part: 'mode',
                        msg: '将制冷系统模式旋钮由 LOCAL 旋到 REMOTE（遥控）',
                        async act() {
                            const cs = this.sys.comps['cs'];
                            if (cs) { cs.mode = 'remote'; }
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'cs', part: 'lcd',
                        msg: '观察双位控制：温度高于上限 -1℃ 时，NO 闭合自动起动压缩机降温',
                        async act() {
                            const cs = this.sys.comps['cs'];
                            await _waitFor(() => cs && cs.running === true, 30000);
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'cs', part: 'lcd',
                        msg: '温度低于下限 -5℃ 时，NO 断开自动停止压缩机，进入双位（通断）控制循环',
                        async act() {
                            const wt = this.sys.comps['wt'];
                            await _waitFor(() => wt && wt.isEnergized === true, 45000);   // 低于 -5℃ 停机
                            await new Promise(r => setTimeout(r, 1200));
                            await _waitFor(() => wt && wt.isEnergized === false, 45000);  // 高于 -1℃ 重新起动
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                ],
            },
        ],
    },
};

export const componentConfigs = [
    { Class: WT1226, id: 'wt', x: 350, y: 130, tempMin: -20, tempMax: 20, setValueMin: -20, setValueMax: 20, setValueStep: 1, visible: true },
    { Class: CoolingSys, id: 'cs', x: 850, y: 130, initTemp: 10, ambientTemp: 10, coolRate: 1.0, warmRate: 0.5 / 3, visible: true },
    // 制冷系统右侧：单相交流电源（默认关闭，接通后液晶屏点亮、压缩机才能起动）
    { Class: ACPower, id: 'ac', x: 1380, y: 220, vRms: 220, freq: 50, isOn: false, label: '单相电源', visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'wt_wire_NO', to: 'cs_wire_l', type: 'wire' },
        { from: 'wt_wire_COM', to: 'cs_wire_r', type: 'wire' },
        // 单相交流电源 → 制冷系统右侧电源接口
        { from: 'ac_wire_p', to: 'cs_wire_pwl', type: 'wire' },
        { from: 'ac_wire_n', to: 'cs_wire_pwn', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(sys) {

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
