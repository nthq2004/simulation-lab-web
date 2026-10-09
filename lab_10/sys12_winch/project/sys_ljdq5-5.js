// 船舶发电机主开关仿真工程（同步发电机 + 汇流排 + 船用框架式空气断路器）

import { SyncGenerator3P } from '../components/SyncGenerator3P.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineMainsSwitch } from '../components/MarineMainsSwitch.js';
import { GeneratorRemotePanel } from '../components/GeneratorRemotePanel.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';
import { ShipAutoControl } from '../components/ShipAutoControl.js';
import { HeavyLoadInquiry } from '../components/HeavyLoadInquiry.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
    // 1#机Ⅰ级故障（滑油压力下降/冷却水温度异常等）：报警级降级故障。
    // 发电机组继续运行（不停机）、主开关不调整（不跳闸不合闸），
    // 由自动化电站（ShipAutoControl）检测后执行自动换机：
    // 备用机组自动并车 → 负荷全部转移给新机组 → 自动解列故障机组 → 故障机组自动停机。
    gen1_lv1_fault: {
        id: 'gen1_lv1_fault',
        name: '1#机组Ⅰ级故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.hasLv1Fault && c.hasLv1Fault());
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setLv1Fault) {
                c.setLv1Fault('oilPress', true);
                c.setLv1Fault('coolantTemp', true);
            }
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setLv1Fault) {
                c.setLv1Fault('oilPress', false);
                c.setLv1Fault('coolantTemp', false);
            }
        },
    },
    // 1#机超速故障：原动机超速保护动作，立即停机，故障未清除前无法起动
    gen1_overspeed: {
        id: 'gen1_overspeed',
        name: '1#机超速故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.getEngineFaults && c.getEngineFaults().overspeed);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('overspeed', true);
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('overspeed', false);
        },
    },
    // 1#机滑油低压故障：滑油压力过低保护动作，立即停机，故障未清除前无法起动
    gen1_oil_press: {
        id: 'gen1_oil_press',
        name: '1#机滑油低压故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.getEngineFaults && c.getEngineFaults().oilPress);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('oilPress', true);
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('oilPress', false);
        },
    },
    // 1#机冷却水温高故障：并网运行时原动机故障、发电机被母线拖转（逆功率）；单机运行时停机
    gen1_coolant_temp: {
        id: 'gen1_coolant_temp',
        name: '1#机冷却水温高故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c.getEngineFaults && c.getEngineFaults().coolantTemp);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('coolantTemp', true);
        },
        repair() {
            const c = _fcomp('gen1');
            if (c && c.setEngineFault) c.setEngineFault('coolantTemp', false);
        },
    },
    // 1#机欠压故障：调压器（AVR）故障使输出电压跌至 200V（约 50% 额定），
    // 主开关简化欠压保护检测到欠压后 2s 延时跳闸（faultSimpleProtect）
    gen1_undervoltage: {
        id: 'gen1_undervoltage',
        name: '1#机欠压故障',
        system: '发电机',
        check() {
            const c = _fcomp('gen1');
            return !!(c && c._faultAVR);
        },
        trigger() {
            const c = _fcomp('gen1');
            if (c) c._faultAVR = true;
        },
        repair() {
            const c = _fcomp('gen1');
            if (c) c._faultAVR = false;
        },
    },
    // 汇流排干线短路故障：短路保护动作，两台主开关立即跳闸，全船失电
    bus_short: {
        id: 'bus_short',
        name: '汇流排干线短路故障',
        system: '汇流排',
        check() {
            const b = _fcomp('bus1');
            return !!(b && b._faultShort);
        },
        trigger() {
            const b = _fcomp('bus1');
            if (b) b._faultShort = true;
            // 干线短路 → 主开关短路保护动作：两台主开关全部跳闸，汇流排失电
            ['qf1', 'qf2'].forEach(id => {
                const q = _fcomp(id);
                if (q && q.getState() === 'on' && q.tryTrip) q.tryTrip();
            });
        },
        repair() {
            const b = _fcomp('bus1');
            if (b) b._faultShort = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {

    // ──────────────────────────────────────────────
    // 发电机组的自动并车、自动解列
    // 流程：自动接线供电 → 切自动模式 → 加载 50kW 观察自动并车（2# 自动起动、
    //     自动同期合闸、自动均分负荷）→ 卸载观察自动解列（2# 自动转移负荷、
    //     自动分闸、自动停机）→ 测试题
    // ──────────────────────────────────────────────
    'auto-parallel-decouple': {
        id: 'auto-parallel-decouple',
        name: '1.发电机组的自动并车、自动解列',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机并合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位：1# 机运行、2# 机停机、负载切除、两台主开关分闸、
                    // 自动电站复位为手动模式
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) {
                        g1.freq = 50; g1.isOn = false;
                        if (g1.setLv1Fault) { g1.setLv1Fault('oilPress', false); g1.setLv1Fault('coolantTemp', false); }
                    }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) { sys.comps.load3._loaded = false; sys.comps.load3.powerKw = 20; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const ac = sys.comps.auto_ctl;
                    if (ac) {
                        ac._switchIdx = -1; ac._switchPhase = '';
                        ac._decoupleIdx = -1; ac._decoupleTimer = 0; ac._stopTimer = 0;
                        ac._auto = false; ac.config.auto = 'manual';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, -45);
                    }
                    await _sleep(400);
                    // 起动 1# 发电机
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待储能
                    // 合闸
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1 && g1.isOn && !!q1 && q1.getState() === 'on';
                },
            },
            // ── 步骤 2：将电站切换为自动运行模式 ──
            {
                msg: '第 2 步：将电站切换为自动运行模式（备用顺序保持默认 1-2-3）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    if (ac && !ac._auto) {
                        ac._auto = true;
                        ac.config.auto = 'auto';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, 45);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    return !!ac && ac._auto === true && ac._powered === true;
                },
            },
            // ── 步骤 3：加载 50kW，观察 2# 自动起动并车 ──
            {
                msg: '第 3 步：加载 50kW 负载，观察 2# 机组自动起动、自动并车、自动转移负荷',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    if (load) { load.powerKw = 50; load._loaded = true; }
                    // 自动并车由负载超过单机额定 50% 触发（parallelKw=50 → 40kW 阈值）。
                    // 等待 2# 自动起动、自动同期合闸完成
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    for (let i = 0; i < 900; i++) {
                        if (g2 && g2.isOn && q2 && q2.getState() === 'on') break;
                        await _sleep(100);
                    }
                    await _sleep(3000); // 再等待自动均分负荷稳定
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 4：卸载，观察 2# 自动解列停机 ──
            {
                msg: '第 4 步：卸载负载，观察 2# 自动转移负荷、自动解列、自动停机',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    if (load) { load._loaded = false; load.powerKw = 0; }
                    // 低负载延时 20s 自动解列（分闸 2#）→ 再延时 30s 自动停机
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    for (let i = 0; i < 1800; i++) {
                        if (q2 && q2.getState() === 'off' && g2 && !g2.isOn) break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2, g1 = sys.comps.gen1;
                    // 2# 已自动解列停机，1# 继续单机供电
                    return !!g2 && !!q2 && q2.getState() === 'off' && !g2.isOn
                        && !!g1 && g1.isOn;
                },
            },
            // ── 步骤 5：测试题 ──
            {
                msg: '第 5 步：测试题——自动化电站的主要功能',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶自动化电站（自动控制系统）的主要功能包括哪些？',
                    options: [
                        '根据负荷变化自动完成备用机组的起动、并车、负荷分配与解列，并自动调节电网频率，实现全船发电用电的集中管理',
                        '仅用于监视发电机的电压与电流，不参与机组的起动与停机',
                        '只负责报警，故障时仍需值班人员手动倒闸操作',
                        '自动电站只能管理一台发电机，多机并联必须人工操作',
                    ],
                    answer: 0,
                    analysis: '自动化电站的核心功能是电力负荷自动管理：当负荷增大超过单机容量时自动起动备用机组并自动并车（自动同期合闸），随后自动均分负荷；当负荷减小后自动将多余机组解列并停机；同时根据电网频率自动调节调速器，维持频率稳定。整个过程无需人工干预，实现船舶电站的自动化运行。',
                },
            },
        ],
    },

    // ──────────────────────────────────────────────
    // Ⅰ级故障自动化电站换机
    // 流程：接线供电 → 带载 → 转自动模式 → 触发 1# 机Ⅰ级故障（滑油压力下降/
    //     冷却水温度异常，机组不停机、主开关不动作）→ 自动化电站自动换机：
    //     自动起动 2# 并车 → 负荷全部转移给 2# → 自动解列 1# → 1# 自动停机
    // ──────────────────────────────────────────────
    'lv1-fault-auto-switch': {
        id: 'lv1-fault-auto-switch',
        name: '2.Ⅰ级故障自动化电站带电换机',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位：1# 机运行，2# 机停机，负载切除，两台主开关分闸，清除Ⅰ级故障，
                    // 自动电站复位为手动模式
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) {
                        g1.freq = 50; g1.isOn = false;
                        if (g1.setLv1Fault) { g1.setLv1Fault('oilPress', false); g1.setLv1Fault('coolantTemp', false); }
                    }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) { sys.comps.load3._loaded = false; sys.comps.load3.powerKw = 20; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const ac = sys.comps.auto_ctl;
                    if (ac) {
                        ac._switchIdx = -1; ac._switchPhase = '';
                        ac._auto = false; ac.config.auto = 'manual';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, -45);
                    }
                    await _sleep(400);
                    // 起动 1# 发电机
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待储能
                    // 合闸
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1 && g1.isOn && !!q1 && q1.getState() === 'on';
                },
            },
            // ── 步骤 2：将电站切换为自动运行模式 ──
            {
                msg: '第 2 步：将电站切换为自动运行模式（备用顺序保持默认 1-2-3）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    if (ac && !ac._auto) {
                        ac._auto = true;
                        ac.config.auto = 'auto';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, 45);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    return !!ac && ac._auto === true && ac._powered === true;
                },
            },
            // ── 步骤 3：触发 1# 机Ⅰ级故障，观察自动化电站自动换机 ──
            {
                msg: '第 3 步：打开故障面板，勾选"1#机组Ⅰ级故障"，观察自动化电站自动换机：2# 自动起动并车 → 负荷全部转移给 2# → 自动解列 1# → 1# 自动停机',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（故障面板操作）+ 自动换机全流程完成
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    for (let i = 0; i < 1200; i++) {
                        // 换机完成条件：故障已触发、2# 运行且合闸、1# 主开关分闸且 1# 停机
                        if (g1 && g1.hasLv1Fault && g1.hasLv1Fault()
                            && g2 && g2.isOn && q2 && q2.getState() === 'on'
                            && q1 && q1.getState() === 'off' && !g1.isOn) break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (!g1 || !g2 || !q1 || !q2) return false;
                    // Ⅰ级故障已触发（机组不停机、主开关不动作由换机流程接管）
                    if (!(g1.hasLv1Fault && g1.hasLv1Fault())) return false;
                    // 自动换机完成：2# 运行且合闸（新机组接管供电）、1# 分闸且停机
                    return g2.isOn && q2.getState() === 'on'
                        && q1.getState() === 'off' && !g1.isOn;
                },
            },
            // ── 步骤 4：测试题──
            {
                msg: '第 4 步：测试题——Ⅰ级故障与自动换机',
                mode: 'quiz',
                quizConfig: {
                    question: '电站处于自动模式时，1# 机组发生Ⅰ级故障（滑油压力下降、冷却水温度异常），自动化电站会如何处理？',
                    options: [
                        '立即起动备用机组自动并车，将负荷全部转移给新机组，随后自动解列并停掉故障机组（换机运行），全船不断电',
                        'Ⅰ级故障只是报警级，发电机继续运行，自动化电站不做任何动作',
                        '发电机立即保护停机、主开关跳闸，全船失电',
                        '自动化电站仅发出报警信号，等待值班人员手动换机',
                    ],
                    answer: 0,
                    analysis: 'Ⅰ级故障为报警级故障，机组虽仍能运行但已不适合继续承担负荷。自动化电站在自动模式下会执行换机操作：自动起动备用机组并网（自动并车），通过调节调速器把负荷全部转移给新机组，然后自动解列故障机组并使之停机，全过程无需人工干预，实现"故障机组不带病运行、全船供电不间断"，这正是船舶自动化电站的核心价值。',
                },
            },
        ],
    },

    // ──────────────────────────────────────────────
    // Ⅱ级故障自动化电站断电切换
    // 流程：自动接线供电 → 切自动模式 → 触发 1# 机Ⅱ级故障（欠压或机械故障：
    //     超速/滑油低压/冷却水温高）→ 1# 主开关保护跳闸、母线失电 →
    //     自动化电站检测失电后自动起动 2# 备用机组并合闸恢复供电 → 测试题
    // ──────────────────────────────────────────────
    'lv2-fault-power-switch': {
        id: 'lv2-fault-power-switch',
        name: '3.Ⅱ级故障自动化电站断电切换',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机并合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位：1# 机运行、2# 机停机、负载切除、两台主开关分闸、
                    // 清除全部故障（含Ⅱ级故障与Ⅰ级故障）、自动电站复位为手动模式
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) {
                        g1.freq = 50; g1.isOn = false;
                        g1._faultAVR = false;
                        if (g1.setEngineFault) {
                            g1.setEngineFault('overspeed', false);
                            g1.setEngineFault('oilPress', false);
                            g1.setEngineFault('coolantTemp', false);
                        }
                        if (g1.setLv1Fault) { g1.setLv1Fault('oilPress', false); g1.setLv1Fault('coolantTemp', false); }
                    }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) { sys.comps.load3._loaded = false; sys.comps.load3.powerKw = 20; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const ac = sys.comps.auto_ctl;
                    if (ac) {
                        ac._switchIdx = -1; ac._switchPhase = '';
                        ac._decoupleIdx = -1; ac._decoupleTimer = 0; ac._stopTimer = 0;
                        ac._lossTimer = 0;
                        ac._auto = false; ac.config.auto = 'manual';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, -45);
                    }
                    await _sleep(400);
                    // 起动 1# 发电机
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待储能
                    // 合闸
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1 && g1.isOn && !!q1 && q1.getState() === 'on';
                },
            },
            // ── 步骤 2：将电站切换为自动运行模式 ──
            {
                msg: '第 2 步：将电站切换为自动运行模式（备用顺序保持默认 1-2-3）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    if (ac && !ac._auto) {
                        ac._auto = true;
                        ac.config.auto = 'auto';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, 45);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    return !!ac && ac._auto === true && ac._powered === true;
                },
            },
            // ── 步骤 3：触发 1# 机Ⅱ级故障，观察跳闸与备用机组自动恢复供电 ──
            {
                msg: '第 3 步：打开故障面板，勾选"1#机欠压故障"（或任一Ⅱ级故障：超速/滑油低压/冷却水温高），观察 1# 主开关保护跳闸、母线失电，2# 备用机组自动起动并合闸恢复供电',
                mode: 'check',
                async act() {
                    // 等待用户手动触发Ⅱ级故障（故障面板操作）：
                    //   1# 跳闸 + 母线失电 → 失电自动起动延时 3s → 2# 自动起动 →
                    //   建压储能 → 自动合闸恢复供电
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    for (let i = 0; i < 2400; i++) {
                        // Ⅱ级故障已触发
                        let lv2 = false;
                        if (g1) {
                            if (g1._faultAVR) lv2 = true;
                            else if (typeof g1.getEngineFaults === 'function') {
                                const e = g1.getEngineFaults();
                                lv2 = !!(e && (e.overspeed || e.oilPress || e.coolantTemp));
                            }
                        }
                        // 切换完成：1# 主开关跳闸、2# 自动起动并合闸恢复供电
                        if (lv2 && q1 && q1.getState() === 'off'
                            && g2 && g2.isOn && q2 && q2.getState() === 'on') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (!g1 || !g2 || !q1 || !q2) return false;
                    // Ⅱ级故障已触发（欠压或任一机械故障）
                    let lv2 = false;
                    if (g1._faultAVR) lv2 = true;
                    else if (typeof g1.getEngineFaults === 'function') {
                        const e = g1.getEngineFaults();
                        lv2 = !!(e && (e.overspeed || e.oilPress || e.coolantTemp));
                    }
                    if (!lv2) return false;
                    // 断电切换完成：故障机组主开关跳闸、2# 自动起动并合闸恢复供电
                    return q1.getState() === 'off' && g2.isOn && q2.getState() === 'on';
                },
            },
            // ── 步骤 4：测试题──
            {
                msg: '第 4 步：测试题——Ⅱ级故障不能带电切换的原因',
                mode: 'quiz',
                quizConfig: {
                    question: '1# 机组发生Ⅱ级故障（欠压或机械故障）后，自动化电站采用"断电切换"（先让故障机组跳闸、母线短时失电，再自动起动备用机组恢复供电），而不是像Ⅰ级故障那样"带电换机"（先并车再解列），其原因是什么？',
                    options: [
                        'Ⅱ级故障本身就会使故障机组停机或主开关保护跳闸，母线必然失电；且故障机组已不能继续承担负荷，只能先断电再由备用机组恢复供电',
                        '自动化电站不具备带电并车功能，因此只能断电起动备用机组',
                        'Ⅱ级故障不会导致跳闸或失电，切换过程母线始终有电',
                        '断电切换是为了保护用电设备，与故障性质无关',
                    ],
                    answer: 0,
                    analysis: 'Ⅱ级故障是严重故障，其本身就会导致供电中断：欠压故障使主开关欠压保护延时跳闸；机械故障（超速、滑油低压、冷却水温高等）使原动机保护停机，并网运行时发电机被母线反拖成电动机运行（逆功率），进而触发逆功率保护跳闸。因此Ⅱ级故障下母线失电是必然结果，无法带电切换。自动化电站在失电后自动检测并起动备用机组、建压后自动合闸恢复供电，体现了"先断电、后供电"的自动恢复能力——这正是Ⅱ级故障与Ⅰ级故障（可带电换机）的本质区别。',
                },
            },
        ],
    },

    // ──────────────────────────────────────────────
    // 4. 重载询问功能实操
    // 流程：自动接线并将电站转为自动模式 → 观察失电自动起动合闸供电 →
    //     调出重载询问面板并转为询问模式 → 按询问按钮观察并车过程（回应黄→绿）→
    //     再次按钮负载起动观察均分 → 停止按钮重载退出观察自动解列停机 → 测试题
    // ──────────────────────────────────────────────
    'heavyload-inquiry-practice': {
        id: 'heavyload-inquiry-practice',
        name: '4.重载询问功能实操',
        steps: [
            // ── 步骤 1：自动接线，电站转自动模式，观察失电自动起动合闸 ──
            {
                msg: '第 1 步：自动接线，将电站切换为自动运行模式，观察失电情况下自动起动 1# 发电机组、自动合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位：两机停机、主开关分闸、负载切除、重载询问退出并复位、
                    // 自动电站复位为手动模式后再切换自动模式（演示失电自动起动）
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) { g1.freq = 50; g1.isOn = false; }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) { sys.comps.load3._loaded = false; sys.comps.load3.powerKw = 20; }
                    _resetHeavyload(sys);
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const ac = sys.comps.auto_ctl;
                    if (ac) {
                        ac._switchIdx = -1; ac._switchPhase = '';
                        ac._decoupleIdx = -1; ac._decoupleTimer = 0; ac._stopTimer = 0;
                        ac._lossTimer = 0; ac._startTimer = {}; ac._syncTimer = {}; ac._freqAdjTimer = 0;
                        ac._heavyInquiry = false; ac._heavyResp = ''; ac._heavyForceParallel = false;
                        ac._auto = false; ac.config.auto = 'manual';
                    }
                    await _sleep(400);
                    // 切换为自动模式：失电 3s 后自动起动 1#，建压储能后再自动合闸
                    if (ac) {
                        ac._auto = true; ac.config.auto = 'auto';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, 45);
                    }
                    // 等待失电自动起动 + 合闸完成
                    const qf1 = sys.comps.qf1;
                    for (let i = 0; i < 2000; i++) {
                        if (g1 && g1.isOn && qf1 && qf1.getState() === 'on') break;
                        await _sleep(100);
                    }
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    if (!ac || ac._auto !== true) return false;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1 && g1.isOn && !!q1 && q1.getState() === 'on'
                        && typeof ac.getBusLive === 'function' && ac.getBusLive();
                },
            },
            // ── 步骤 2：调出重载询问面板，转为询问模式 ──
            {
                msg: '第 2 步：勾选"重载询问面板"调出面板（自动接线），并将面板选择开关切换为"重载询问"模式',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _showHeavyload(sys, true);
                    await _sleep(300);
                    const hv = sys.comps.heavyload;
                    if (hv) {
                        hv._mode = 'inquiry'; hv.config.mode = 'inquiry';
                        if (hv._ui && hv._ui.knob && hv._ui.knob.ptr) hv._ui.knob.ptr.rotation(45);
                    }
                    await _sleep(400);
                },
                check() {
                    const sys = this.sys;
                    const hv = sys.comps.heavyload;
                    if (!hv || !hv.group || hv.group.visible() !== true) return false;
                    if (hv._mode !== 'inquiry') return false;
                    return typeof hv._commConnected === 'function' && hv._commConnected();
                },
            },
            // ── 步骤 3：按询问按钮，观察并车过程（回灯黄→绿） ──
            {
                msg: '第 3 步：按下面板"起动/询问"按钮（第 1 次），观察回应指示灯变黄（等待），观察自动电站自动并车：2# 机组自动起动、同步、自动合闸；并车成功后回应指示灯变绿（允许）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hv = sys.comps.heavyload;
                    if (!hv) return;
                    // 第 1 次按：发出询问请求
                    hv._onBtnPressed();
                    // 等待 2# 自动并车完成
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    for (let i = 0; i < 2400; i++) {
                        if (g2 && g2.isOn && q2 && q2.getState() === 'on') break;
                        await _sleep(100);
                    }
                    // 并车成功后回应变为 allow
                    for (let i = 0; i < 600; i++) {
                        if (hv._resp === 'allow') break;
                        await _sleep(100);
                    }
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const hv = sys.comps.heavyload;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    if (!hv || hv._inquirying !== true) return false;
                    if (hv._resp !== 'allow') return false;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 4：再次按按钮，负载起动，观察均分 ──
            {
                msg: '第 4 步：再次按下"起动/询问"按钮，此时已获允许，侧推器负载起动，观察两台发电机组自动均分负荷',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hv = sys.comps.heavyload;
                    if (!hv) return;
                    if (hv._resp === 'allow') hv._onBtnPressed();
                    // 等待均分稳定（显示功率两机趋近）
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    for (let i = 0; i < 900; i++) {
                        if (hv._running !== true) break;
                        const p1 = g1 && g1._displayP || 0;
                        const p2 = g2 && g2._displayP || 0;
                        if (p1 > 5 && p2 > 5 && Math.abs(p1 - p2) < 12) break;
                        await _sleep(100);
                    }
                    await _sleep(1200);
                },
                check() {
                    const sys = this.sys;
                    const hv = sys.comps.heavyload;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (!hv || hv._running !== true) return false;
                    const p1 = g1._displayP || 0, p2 = g2._displayP || 0;
                    // 两机均已参与供电且显示功率接近均分（差值 < 单机额定 15%）
                    return p1 > 1 && p2 > 1 && Math.abs(p1 - p2) < 12;
                },
            },
            // ── 步骤 5：按停止按钮，重载退出，观察自动解列停机 ──
            {
                msg: '第 5 步：按下面板"停止"按钮，侧推器重载退出，观察自动解列（2# 自动分闸）与自动停机（2# 自动停机）过程，1# 单机继续供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hv = sys.comps.heavyload;
                    if (hv) hv._onStopPressed();
                    // 等待自动解列（2# 分闸）→ 自动停机（2# 停机）
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    for (let i = 0; i < 3000; i++) {
                        if (q2 && q2.getState() === 'off' && g2 && !g2.isOn) break;
                        await _sleep(100);
                    }
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const hv = sys.comps.heavyload;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    if (!hv || hv._running !== false) return false;
                    return !!q2 && q2.getState() === 'off' && !!g2 && !g2.isOn
                        && !!g1 && g1.isOn && !!q1 && q1.getState() === 'on';
                },
            },
            // ── 步骤 6：测试题：重载询问的定义 ──
            {
                msg: '第 6 步：测试题——重载询问的定义',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶电站中的"重载询问"（侧推器重载询问）是指什么？',
                    options: [
                        '大功率负载（如侧推器）起动前，先向自动化电站发出询问请求：单机在网时电站应答"等待"并自动并车备用机组，具备足够容量并车成功后才应答"允许"，负载方可起动，从而避免起动冲击导致电网过载或失电',
                        '负载起动前由值班人员口头确认，无需自动化电站参与',
                        '重载负载由人工直接起动，再由发电机自身过载能力硬扛起动冲击',
                        '重载询问是负载运行中随机发出的报警信号，与机组起动控制无关',
                    ],
                    answer: 0,
                    analysis: '重载询问是大功率负载（如侧推器）起动前与自动化电站的交互机制：侧推器功率大，若在电网容量不足时直接起动，起动冲击电流会使电压和频率跌落、甚至导致整个电站失电。因此侧推器面板发出"询问"请求后，自动化电站判断：并联（≥2 台在网）→ 直接应答允许；单机在网 → 应答"等待"并强制自动并车备用机组，待并车成功、容量充足后改答"允许"。面板在接到允许信号后才驱动负载起动。通过这一机制，大功率负载得以安全、有序地接入电网并在多机之间自动均分负荷。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', busId: 'bus1', visible:true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    { Class: Ground, id: 'gnd1', x: 1080, y: 600, visible: true },

    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    // dc_uv 负极、genpanel p24_n 共同接此接地，不再向线圈引出负极线
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1号主开关线圈接地（主开关右下角）──
    // 储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb 负端均接此接地
    { Class: Ground, id: 'gnd1_qf', x: 345, y: 465, label: '线圈接地', visible: true },
    // ── 1号遥控面板信号接地（面板上方）──
    // 合闸输出 close_b、分闸输出 open_b 负端接地
    { Class: Ground, id: 'gnd1_panel', x: 530, y: 670, label: '信号接地', visible: true },

    // ── 2号机组控制电源共地（遥控面板与控制电源的中间下方）──
    { Class: Ground, id: 'gnd2_uv', x: 1560, y: 990, label: '控制电源接地', visible: true },
    // ── 2号主开关线圈接地（主开关右下角）──
    { Class: Ground, id: 'gnd2_qf', x: 1606, y: 459, label: '线圈接地', visible: true },
    // ── 2号遥控面板信号接地（面板上方）──
    { Class: Ground, id: 'gnd2_panel', x: 1470, y: 660, label: '信号接地', visible: true },

    // ── 三相可调负载：汇流排第6口直连，N端接 gnd1 接地参考 ──
    { Class: ThreePhaseLoad, id: 'load3', x: 1050, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 重载询问---侧推器（HeavyLoadInquiry）──
    // 与 load3 同位置、默认隐藏（由工具栏「重载询问」选择框控制显隐），不参与 _autoWire 自动接线。
    // 顶部 l1/l2/l3 接汇流排第5口，N 端接地，左侧 heavy_a/heavy_b 与自动电站 auto_ctl 右下方通信口对接。
    { Class: HeavyLoadInquiry, id: 'heavyload', x: 1050, y: 180, powerKw: 45, mode: 'direct', loaded: false, label: '重载询问---侧推器', visible: false },

    // ── 船舶电站自动控制模块（自动化电站）──
    // 默认手动模式，学员在流程中切换到自动后，Ⅰ级故障（滑油压力下降/冷却水温度异常）
    // 会自动触发换机：备用机组自动并车 → 负荷全部转移 → 自动解列故障机组 → 故障机自动停机。
    { Class: ShipAutoControl, id: 'auto_ctl', x: 600, y: 180, genIds: 'gen1,gen2', qfIds: 'qf1,qf2', panelIds: 'genpanel,genpanel2', auto: 'manual', seq: '123', parallelKw: 60, decoupleKw: 28, label: '船舶电站自动控制模块', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1（第8列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1826, y: 80, initState: 'on', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1850, y: 770, coldResistance: 7.5, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1920, y: 770, coldResistance: 7.5, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1990, y: 770, coldResistance: 7.5, rotation: 90 },
    { Class: Ground, id: 'gnd_l', x: 1950, y: 890, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 模拟按住遥控面板按钮（btnKey: _userStartPressed / _userStopPressed / _userClosePressed / _userOpenPressed）
async function _pressPanelBtn(sys, pid, btnKey, ms = 900) {
    const gp = sys.comps[pid];
    if (!gp || !(btnKey in gp)) return;
    gp[btnKey] = true;
    await _sleep(ms);
    gp[btnKey] = false;
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
        { from: 'gen1_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen1_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen1_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 支路2：汇流排第8列三相 → QF3 → 三盏白炽灯（L1/L2/L3 各一）→ 接地 ──
        { from: 'bus1_wire_l1_8', to: 'acb_l_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_8', to: 'acb_l_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_8', to: 'acb_l_wire_l3', type: 'wire' },
        { from: 'acb_l_wire_t1', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t2', to: 'lamp2_wire_l', type: 'wire' },
        { from: 'acb_l_wire_t3', to: 'lamp3_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp2_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        { from: 'lamp3_wire_r', to: 'gnd_l_wire_gnd', type: 'wire' },
        // ── 2号机组：gen2 → qf2 → 汇流排（第7列接口）──
        { from: 'gen2_wire_u', to: 'qf2_wire_t1', type: 'wire' },
        { from: 'gen2_wire_v', to: 'qf2_wire_t2', type: 'wire' },
        { from: 'gen2_wire_w', to: 'qf2_wire_t3', type: 'wire' },
        { from: 'qf2_wire_l1', to: 'bus1_wire_l1_7', type: 'wire' },
        { from: 'qf2_wire_l2', to: 'bus1_wire_l2_7', type: 'wire' },
        { from: 'qf2_wire_l3', to: 'bus1_wire_l3_7', type: 'wire' },
        // ── 三相可调负载（load3）：汇流排第6口三相直连，N端接 gnd1 接地参考 ──
        { from: 'bus1_wire_l1_6', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_6', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_6', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 2号机组控制电源（dc_uv2）：失压线圈 / 储能电机 正端接电源；负端均接地 ──
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_uv1', type: 'wire' },
        { from: 'dc_uv2_wire_p', to: 'qf2_wire_m1', type: 'wire' },
        // 线圈负端接地（gnd2_qf，主开关右下角）
        { from: 'qf2_wire_uv2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_m2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        // ── 2号机组遥控面板 → gen2 / qf2 ──
        { from: 'genpanel2_wire_start_a', to: 'gen2_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel2_wire_start_b', to: 'gen2_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel2_wire_stop_a', to: 'gen2_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel2_wire_stop_b', to: 'gen2_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel2_wire_spd_p', to: 'gen2_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel2_wire_spd_n', to: 'gen2_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd2_panel）、线圈负端接地（gnd2_qf）
        { from: 'genpanel2_wire_close_a', to: 'qf2_wire_c1', type: 'wire' },
        { from: 'genpanel2_wire_open_a', to: 'qf2_wire_fla', type: 'wire' },
        { from: 'genpanel2_wire_close_b', to: 'gnd2_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel2_wire_open_b', to: 'gnd2_panel_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_c2', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        { from: 'qf2_wire_flb', to: 'gnd2_qf_wire_gnd', type: 'wire' },
        // 面板电源正端 ← dc_uv2；负端接地（gnd2_uv，面板与控制电源中间下方）
        { from: 'dc_uv2_wire_p', to: 'genpanel2_wire_p24_p', type: 'wire' },
        { from: 'dc_uv2_wire_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel2_wire_p24_n', to: 'gnd2_uv_wire_gnd', type: 'wire' },
        // ── 控制电源：DC 24V → 失压脱扣线圈 / 储能电机 正端；负端均接地 ──
        { from: 'dc_uv_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        // 线圈负端接地（gnd1_qf，主开关右下角）
        { from: 'qf1_wire_uv2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_m2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 发电机组遥控面板：左面板 → gen1 遥控端口 ──
        { from: 'genpanel_wire_start_a', to: 'gen1_wire_rm_start_a', type: 'wire' },
        { from: 'genpanel_wire_start_b', to: 'gen1_wire_rm_start_b', type: 'wire' },
        { from: 'genpanel_wire_stop_a', to: 'gen1_wire_rm_stop_a', type: 'wire' },
        { from: 'genpanel_wire_stop_b', to: 'gen1_wire_rm_stop_b', type: 'wire' },
        { from: 'genpanel_wire_spd_p', to: 'gen1_wire_freq_in_p', type: 'wire' },
        { from: 'genpanel_wire_spd_n', to: 'gen1_wire_freq_in_n', type: 'wire' },
        // 合闸/分闸正端 → 线圈正端；输出负端接地（gnd1_panel，面板上方）、线圈负端接地（gnd1_qf）
        { from: 'genpanel_wire_close_a', to: 'qf1_wire_c1', type: 'wire' },
        { from: 'genpanel_wire_open_a', to: 'qf1_wire_fla', type: 'wire' },
        { from: 'genpanel_wire_close_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_open_b', to: 'gnd1_panel_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd1_qf_wire_gnd', type: 'wire' },
        // ── 左面板 24V 电源 ← dc_uv（正端）；负端接地（gnd1_uv，面板与控制电源中间下方）──
        { from: 'dc_uv_wire_p', to: 'genpanel_wire_p24_p', type: 'wire' },
        { from: 'dc_uv_wire_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        { from: 'genpanel_wire_p24_n', to: 'gnd1_uv_wire_gnd', type: 'wire' },
        // ── 船舶电站自动控制模块（auto_ctl）──
        // 母线采集：汇流排第4列三相（L1/L2）→ 检测母线带电（用于自动控制判断）
        { from: 'bus1_wire_l1_4', to: 'auto_ctl_wire_bus_a', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'auto_ctl_wire_bus_b', type: 'wire' },
        // 24V 工作电源：正端接控制电源，负端接地（gnd1）
        { from: 'dc_uv_wire_p', to: 'auto_ctl_wire_p24_p', type: 'wire' },
        { from: 'gnd1_wire_gnd', to: 'auto_ctl_wire_p24_n', type: 'wire' },
        // 通信接口：comm1 ↔ 1#遥控面板，comm2 ↔ 2#遥控面板
        { from: 'auto_ctl_wire_comm1_a', to: 'genpanel_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm1_b', to: 'genpanel_wire_com_b', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_a', to: 'genpanel2_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_b', to: 'genpanel2_wire_com_b', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

// ─── 重载询问（heavyload）面板接线辅助 ───
// 面板显示/隐藏时自动连/删的 6 条线（与 main.js 中 HEAVYLOAD_WIRES 保持一致）：
// 顶部三相 L1/L2/L3 ← bus1 第 5 口；N ← gnd1；左侧通信 heavy_a/heavy_b ↔ auto_ctl。
const HEAVY_WIRES = [
    { from: 'bus1_wire_l1_5', to: 'heavyload_wire_l1', type: 'wire' },
    { from: 'bus1_wire_l2_5', to: 'heavyload_wire_l2', type: 'wire' },
    { from: 'bus1_wire_l3_5', to: 'heavyload_wire_l3', type: 'wire' },
    { from: 'heavyload_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
    { from: 'auto_ctl_wire_heavy_a', to: 'heavyload_wire_heavy_a', type: 'wire' },
    { from: 'auto_ctl_wire_heavy_b', to: 'heavyload_wire_heavy_b', type: 'wire' },
];
const _syncHeavyWires = (sys, on) => {
    if (!sys || !sys.connMgr) return;
    if (on) HEAVY_WIRES.forEach(c => sys.connMgr.addConn(c));
    else HEAVY_WIRES.forEach(c => sys.connMgr.removeConn(c));
};
const _showHeavyload = (sys, show) => {
    if (!sys || !sys.comps) return;
    if (typeof sys.toggleInstrumentVisibility === 'function') sys.toggleInstrumentVisibility('heavyload', show);
    _syncHeavyWires(sys, show);
    const cb = document.getElementById ? document.getElementById('heavyLoadShow') : null;
    if (cb) cb.checked = show;
};
// 复位重载询问模块：卸载、清询问状态、恢复直接起动模式
const _resetHeavyload = (sys) => {
    const hv = sys.comps && sys.comps.heavyload;
    if (!hv) return;
    hv._mode = 'direct';
    if (hv.config) hv.config.mode = 'direct';
    if (hv._ui && hv._ui.knob && hv._ui.knob.ptr) {
        if (hv._ui.knob.ptr._tw) hv._ui.knob.ptr._tw.destroy();
        hv._ui.knob.ptr.rotation(-45);
    }
    if (typeof hv._stopLoad === 'function') hv._stopLoad();
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
    // 起动发电机前先完整复位（防止上次流程残留的两机极端设定/负载/开关状态
    // 导致加载系统时两台发电机功率分配不均）：
    // 两台机设定频率归位 50Hz；只保留 1 号机运行，2 号机停机；负载全部切除；
    // 两台主开关分闸。
    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
    if (g1) { g1.freq = 50; g1.isOn = true; }
    if (g2) { g2.freq = 50; g2.isOn = false; }
    if (sys.comps.load3) { sys.comps.load3._loaded = false; }
    if (sys.comps.heavyload) { sys.comps.heavyload.powerKw = 45; sys.comps.heavyload._stopLoad(); }
    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
}

export function fiveStep() {
}
