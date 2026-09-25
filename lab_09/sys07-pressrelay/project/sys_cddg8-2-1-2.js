import { AirCompressor } from '../components/AirCompressor.js';
import { AirBottle } from '../components/AirBottle.js';
import { TeeConnector } from '../components/TeeConnector.js';
import { PressMeter } from '../components/PressMeter.js';
import { PressRelay } from '../components/PressRelay.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

export const FAULT_CONFIGS = {};

// ─────────────────────────────────────────────────────────────
// 仿真电路：压力继电器的调整和应用测试
//
//   气路：压缩机排气 → 空气瓶 → 三通接头 ┬→ 压力表（显示瓶压）
//                                        └→ 压力开关（检测瓶压）
//   电路：压力开关 NC/COM 触点串入压缩机控制端子
//         （瓶压低 → 继电器励磁、NC 闭合 → 压缩机运转充气；
//           瓶压高 → 继电器释放、NC 断开 → 压缩机停机）
//
//   气瓶设有微小耗气/泄漏，系统自动形成“充气—停机—泄压—再启动”双位控制循环。
// ─────────────────────────────────────────────────────────────

const PIPE_CONNS = [
    { from: 'ac_pipe_o',  to: 'cab_pipe_i', type: 'pipe' },   // ① 压缩机排气 → 空气瓶
    { from: 'cab_pipe_o', to: 'tee_pipe_r', type: 'pipe' },   // ② 空气瓶出气 → 三通接头
    { from: 'tee_pipe_l', to: 'pm_pipe_i',  type: 'pipe' },   // ③ 三通支路 → 压力表
    { from: 'tee_pipe_u', to: 'yt_pipe_i',  type: 'pipe' },   // ④ 三通支路 → 压力开关
];
const WIRE_CONNS = [
    { from: 'yt_wire_NC',  to: 'ac_wire_l', type: 'wire' },   // ⑤ 压力开关 NC → 压缩机控制端 L
    { from: 'yt_wire_COM', to: 'ac_wire_r', type: 'wire' },   // ⑥ 压力开关 COM → 压缩机控制端 R
];
const ALL_CONNS = [...PIPE_CONNS, ...WIRE_CONNS];

function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

/** 动画接线（约 3s/根，用于自动演示逐根接线） */
async function _addAnim(sys, from, to, type) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type });
}

/** 压缩机遥控 + 气瓶耗气：使系统进入由压力开关控制的双位运行状态 */
function _initControl(sys) {
    const  cab = sys.comps['cab'];
    if (cab) {
        cab.isConsuming = true;         // 气瓶模拟系统耗气/泄漏
        cab.consumptionRate = 0.3;      // 耗气速率（MPa/s 基准，配合容积换算）
    }
}

/** 瞬时接线（用于工具栏「自动接线」/「启动系统」） */
function _wireAll(sys) {
    for (const c of ALL_CONNS) {
        if (!_hasConn(sys, c.from, c.to)) sys.connMgr.addConn(c);
    }
    _initControl(sys);
    sys.redrawAll();
}

/** 轮询等待条件成立（用于等待压力升降等物理过程） */
async function _waitFor(fn, timeoutMs = 60000, stepMs = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { if (fn()) return true; } catch (e) { /* 忽略 */ }
        await new Promise(r => setTimeout(r, stepMs));
    }
    return false;
}

/** 打开参数配置界面，逐个高亮查看指定字段后关闭 */
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
    'pressrelay-test': {
        id: 'pressrelay-test',
        name: '1. 压力继电器的调整和应用测试',
        steps: [
            // ── 步骤 1：按组成接线 ──
            {
                msg: '1. 连接气路和电路：压缩机排气口→空气瓶→三通接头；三通一路接压力表、一路接压力开关；压力开关 NC/COM 触点串入压缩机控制端子。',
                mode: 'check',
                check() {
                    const sys = this.sys;
                    return ALL_CONNS.every(c => _hasConn(sys, c.from, c.to));
                },
                op: [
                    {
                        type: 'observe', target: 'ac', part: 'o',
                        msg: '接线①：压缩机排气口 → 空气瓶进气口',
                        act() { return _addAnim(this.sys, 'ac_pipe_o', 'cab_pipe_i', 'pipe'); },
                    },
                    {
                        type: 'observe', target: 'cab', part: 'o',
                        msg: '接线②：空气瓶出气口 → 三通接头',
                        act() { return _addAnim(this.sys, 'cab_pipe_o', 'tee_pipe_r', 'pipe'); },
                    },
                    {
                        type: 'observe', target: 'tee', part: 'l',
                        msg: '接线③：三通支路 → 压力表（显示空气瓶压力）',
                        act() { return _addAnim(this.sys, 'tee_pipe_l', 'pm_pipe_i', 'pipe'); },
                    },
                    {
                        type: 'observe', target: 'tee', part: 'u',
                        msg: '接线④：三通另一支路 → 压力开关（检测空气瓶压力）',
                        act() { return _addAnim(this.sys, 'tee_pipe_u', 'yt_pipe_i', 'pipe'); },
                    },
                    {
                        type: 'observe', target: 'yt', part: 'nc',
                        msg: '接线⑤：压力开关 NC 触点 → 压缩机控制端 L',
                        act() { return _addAnim(this.sys, 'yt_wire_NC', 'ac_wire_l', 'wire'); },
                    },
                    {
                        type: 'observe', target: 'yt', part: 'com',
                        msg: '接线⑥：压力开关 COM 触点 → 压缩机控制端 R',
                        act() { return _addAnim(this.sys, 'yt_wire_COM', 'ac_wire_r', 'wire'); },
                    },
                ],
            },

            // ── 步骤 2：查看参数配置界面 ──
            {
                msg: '2. 打开压力开关参数界面，查看量程范围、切换差范围以及当前的动作下限和上限。',
                mode: 'check',
                check() {
                    const el = document.getElementById('diag_lowStart');
                    if (!el) return false;
                    const modal = el.closest('div[style*="position: fixed"]');
                    return !!modal && /配置设备[:：]\s*yt/.test(modal.textContent || '');
                },
                op: [
                    {
                        type: 'observe', target: 'yt', part: 'scale',
                        msg: '右键压力开关 → 参数设置，打开参数配置界面',
                        async act() {
                            await _demoViewConfig(this, 'yt', [
                                { key: 'lowStart',  tip: '查看「给定值下限」＝ 0.0 MPa' },
                                { key: 'lowEnd',    tip: '查看「给定值上限」＝ 0.2 MPa（给定值在 0～0.2 MPa 量程内按百分比调节）' },
                                { key: 'diffStart', tip: '查看「幅差下限」＝ 0.07 MPa' },
                                { key: 'diffEnd',   tip: '查看「幅差上限」＝ 0.25 MPa' },
                                { key: 'lowSet',    tip: '查看当前「动作下限」＝ 0.10 MPa（压力低于该值，继电器励磁）' },
                                { key: 'highSet',   tip: '查看当前「动作上限」＝ 0.26 MPa（压力高于该值，继电器释放）' },
                            ], '压力开关量程 0～0.2 MPa，幅差范围 0.07～0.25 MPa');
                        },
                    },
                ],
            },

            // ── 步骤 3：调整给定值 ──
            {
                msg: '3. 旋转压力开关的「给定值」调节螺钉，把动作下限由 0.10 MPa 调高到 0.12 MPa。',
                mode: 'check',
                check() {
                    const yt = this.sys.comps['yt'];
                    return !!(yt && Math.abs(yt.setPoint - 60) < 0.5);
                },
                op: [
                    {
                        type: 'knob', target: 'yt', part: 'setscrew',
                        msg: '连续点击「给定值调节」螺钉上半部，给定值由 50% 调到 60%（每格 2%）',
                        async act() {
                            const yt = this.sys.comps['yt'];
                            if (!yt || typeof yt.turnSetScrew !== 'function') return;
                            let guard = 0;
                            while (yt.setPoint < 60 - 1e-6 && guard++ < 40) {
                                yt.turnSetScrew(1);
                                await new Promise(r => setTimeout(r, 300));
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'yt', part: 'scale',
                        msg: '给定值调至 60% → 动作下限升到 0.12 MPa，动作上限随之升到 0.28 MPa',
                        async act() { await new Promise(r => setTimeout(r, 1500)); },
                    },
                ],
            },

            // ── 步骤 4：调整幅差 ──
            {
                msg: '4. 旋转「幅差」调节螺钉，将幅差调整为0.18MPa（第6格）。',
                mode: 'check',
                check() {
                    const yt = this.sys.comps['yt'];
                    return !!(yt && Math.abs(yt.differential - 60) < 0.5);
                },
                op: [
                    {
                        type: 'knob', target: 'yt', part: 'diffscrew',
                        msg: '连续点击「幅差调节」螺钉右半部，幅差由 50% 调到 60%',
                        async act() {
                            const yt = this.sys.comps['yt'];
                            if (!yt || typeof yt.turnDiffScrew !== 'function') return;
                            let guard = 0;
                            while (yt.differential < 60 + 1e-6 && guard++ < 40) {
                                yt.turnDiffScrew(1);
                                await new Promise(r => setTimeout(r, 300));
                            }
                        },
                    },
                    {
                        type: 'observe', target: 'yt', part: 'diffscale',
                        msg: '幅差调到 60% → 切换差增大，动作上限降到约 0.3 MPa',
                        async act() { await new Promise(r => setTimeout(r, 1500)); },
                    },
                ],
            },

            // ── 步骤 5：压缩机转遥控 ──
            {
                msg: '5. 将压缩机控制模式由 LOCAL 旋到 REMOTE，启停交由压力开关触点控制；同时空气瓶开始模拟系统耗气。',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac'], cab = this.sys.comps['cab'];
                    return !!(ac && ac.mode === 'remote' && cab && cab.isConsuming === true);
                },
                op: [
                    {
                        type: 'switch', target: 'ac', part: 'mode',
                        msg: '点击压缩机顶部模式旋钮，LOCAL → REMOTE',
                        async act() {
                            const ac = this.sys.comps['ac'];
                            if (ac) {
                                if (typeof ac.setMode === 'function') ac.setMode('remote');
                                else ac.mode = 'remote';
                            }
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'cab', part: 'tank',
                        msg: '转入遥控后空气瓶开始耗气/泄漏，瓶压缓慢下降',
                        async act() {
                            const cab = this.sys.comps['cab'];
                            if (cab) cab.isConsuming = true;   // 遥控运行后开启气瓶耗气
                            await new Promise(r => setTimeout(r, 1200));
                        },
                    },
                ],
            },

            // ── 步骤 6：低压启动、压缩机充气 ──
            {
                msg: '6. 空气瓶耗气使瓶压下降，低于动作下限时压力开关 NC 触点闭合，压缩机自动运转向空气瓶充气。',
                mode: 'check',
                check() {
                    const ac = this.sys.comps['ac'], yt = this.sys.comps['yt'];
                    return !!(ac && ac.running === true && yt && yt.isEnergized === true);
                },
                op: [
                    {
                        type: 'observe', target: 'cab', part: 'lcd',
                        msg: '观察瓶压由 0.35 MPa 缓慢下降，降至动作下限以下时压力开关励磁',
                        async act() {
                            const ac = this.sys.comps['ac'];
                            // 等待瓶压降到下限、压力开关 NC 闭合、压缩机自动起动
                            await _waitFor(() => ac && ac.running === true, 90000);
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'ac', part: 'o',
                        msg: '压缩机持续运转，排气口不断向空气瓶输送压缩空气',
                        async act() { await new Promise(r => setTimeout(r, 1200)); },
                    },
                ],
            },

            // ── 步骤 7：高压停止 ──
            {
                msg: '7. 瓶压升到动作上限时，压力开关NC 触点断开，压缩机自动停机。',
                mode: 'check',
                check() {
                    const yt = this.sys.comps['yt'], ac = this.sys.comps['ac'];
                    return !!(yt && yt.isEnergized === false && ac && ac.running === false);
                },
                op: [
                    {
                        type: 'observe', target: 'yt', part: 'contact',
                        msg: '压力升到动作上限，继电器释放，NC 触点断开',
                        async act() {
                            await _waitFor(() => {
                                const yt = this.sys.comps['yt'];
                                return yt && yt.isEnergized === false;
                            }, 30000);
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'pm', part: 'dial',
                        msg: '压力表读数到达动作上限，压缩机停机',
                        async act() { await new Promise(r => setTimeout(r, 1500)); },
                    },
                ],
            },

            // ── 步骤 8：泄压后自动重启（双位控制循环）──
            {
                msg: '8. 空气瓶耗气/泄漏使压力缓慢回落；当瓶压低于动作下限时，压缩机再次启动，形成双位控制循环。',
                mode: 'check',
                check() {
                    const yt = this.sys.comps['yt'], ac = this.sys.comps['ac'];
                    return !!(yt && yt.isEnergized === true && ac && ac.running === true);
                },
                op: [
                    {
                        type: 'observe', target: 'cab', part: 'lcd',
                        msg: '观察瓶压缓慢下降（气瓶耗气），降至动作下限以下时压力开关重新励磁',
                        async act() {
                            await _waitFor(() => {
                                const yt = this.sys.comps['yt'];
                                return yt && yt.isEnergized === true;
                            }, 40000);
                            await new Promise(r => setTimeout(r, 1200));
                        },
                    },
                    {
                        type: 'observe', target: 'ac', part: 'off',
                        msg: '压缩机重新启动充气，系统进入“充气—停机—泄压—再启动”双位控制循环',
                        async act() { await new Promise(r => setTimeout(r, 2000)); },
                    },
                ],
            },
        ],
    },
};

export const componentConfigs = [
    // ── 空气压缩机（气源）：排气口 → 空气瓶 ──
    { Class: AirCompressor, id: 'ac', x: 1220, y: 130, mode: 'local', refillRate: 0.001, visible: true },

    // ── 空气瓶（储气）：容积 50 L，初始压力 0 MPa ──
    { Class: AirBottle, id: 'cab', x: 1330, y: 630, initialPressure: 0.35, unit: 'MPa', volume: 50,
      isConsuming: false, consumptionRate: 0.3, visible: true },

    // ── 三通接头：把瓶压分送压力表与压力开关 ──
    { Class: TeeConnector, id: 'tee', x: 880, y: 730, direction: 'up', visible: true },

    // ── 压力表：显示空气瓶压力（量程 0～0.5 MPa）──
    { Class: PressMeter, id: 'pm', x: 600, y: 680, min: 0, max: 1, title: '空气瓶压力 MPa', visible: true },

    // ── 压力继电器（压力开关）：检测瓶压，控制压缩机启停 ──
    { Class: PressRelay, id: 'yt', x: 620, y: 70, model: 'YT1226',
      lowStart: 0, lowEnd: 0.2, diffStart: 0.07, diffEnd: 0.25,
      setPoint: 50, differential: 50, visible: true },

    // ── 保留的 7 种仪表（默认隐藏）──
    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

/** 一键自动接线（工具栏按钮）：瞬时接好全部管路与电路，并进入遥控双位控制 */
export function applyAllPresets() {
    // 初始化时（this 为 ControlSystem，无 .sys）不接线；工具栏「自动接线」时（this 为 WorkflowManager）执行接线
    if (!this || !this.sys) return;
    _wireAll(this.sys);
}

export function initSlider(sys) {

}

/** 启动系统：接好电路并进入由压力开关控制的双位运行状态 */
export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _wireAll(sys);
}

export function fiveStep() {

}
