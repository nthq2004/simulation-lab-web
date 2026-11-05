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

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
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
    // 自动化电站：机械故障导致主开关跳闸的应急处理
    // 流程：接线供电 → 转自动模式 → 触发1#机冷却水温高故障
    //      → 主开关跳闸 → 自动电站失电自动起动2#机组并自动合闸恢复
    // ──────────────────────────────────────────────
    'auto-mech-trip-recovery': {
        id: 'auto-mech-trip-recovery',
        name: '1.自动化电站机械故障导致主开关跳闸',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 完整复位：清全部故障残留，1# 机运行，2# 机停机，负载切除，主开关分闸
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) {
                        g1.freq = 50; g1.isOn = false;
                        if (g1.setEngineFault) {
                            g1.setEngineFault('overspeed', false);
                            g1.setEngineFault('oilPress', false);
                            g1.setEngineFault('coolantTemp', false);
                        }
                        g1._faultAVR = false;
                    }
                    if (g2) {
                        g2.freq = 50; g2.isOn = false;
                        if (g2.setEngineFault) {
                            g2.setEngineFault('overspeed', false);
                            g2.setEngineFault('oilPress', false);
                            g2.setEngineFault('coolantTemp', false);
                        }
                        g2._faultAVR = false;
                    }
                    if (sys.comps.bus1) sys.comps.bus1._faultShort = false;
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    const ac = sys.comps.auto_ctl;
                    if (ac) { ac._shortFault = false; ac._auto = false; ac.config.auto = 'manual'; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    await _sleep(400);
                    // 起动 1# 发电机
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待建压
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
            // ── 步骤 2：将电站投入自动运行模式（备用顺序默认 123）──
            {
                msg: '第 2 步：将电站切换为自动运行模式，备用顺序保持默认 1-2-3',
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
            // ── 步骤 3：触发 1# 机冷却水温高故障（用户手动），观察停机与跳闸 ──
            {
                msg: '第 3 步：打开故障面板，勾选"1#机冷却水温高故障"，观察 1# 机停机、1# 主开关失压跳闸、全船失电',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（面板操作）
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    for (let i = 0; i < 600; i++) {
                        const f = g1 && g1.getEngineFaults ? g1.getEngineFaults() : null;
                        if (f && f.coolantTemp && g1 && !g1.isOn && q1 && q1.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    if (!g1 || !q1) return false;
                    const f = g1.getEngineFaults();
                    if (!(f && f.coolantTemp)) return false;
                    // 1# 机停机（单机运行时故障保护停机）+ 1# 主开关失压跳闸
                    return !g1.isOn && q1.getState() === 'off';
                },
            },
            // ── 步骤 4：观察自动电站失电自动起动 2# 机组并自动合闸恢复 ──
            {
                msg: '第 4 步：母线失电后，自动电站检测"全船失电"：自动起动 2# 机组，建压储能后自动合闸恢复供电',
                mode: 'check',
                async act() {
                    // 自动等待：失电 3s 检测 → 起动 2# → 建压储能 3s → 自动合闸（约 10~16s）
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    for (let i = 0; i < 400; i++) {
                        if (g2 && g2.isOn && q2 && q2.getState() === 'on') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 5：测试题 ──
            {
                msg: '第 5 步：测试题——自动化电站在机械故障跳闸后的自动恢复流程',
                mode: 'quiz',
                quizConfig: {
                    question: '自动化电站运行中，1# 机组发生冷却水温高机械故障停机、1# 主开关跳闸导致全船失电，自动电站接下来会怎样处理？',
                    options: [
                        '检测到母线失电后，按备用顺序自动起动 2# 机组，建压储能后自动合闸恢复供电',
                        '检测到失电后自动恢复 1# 机继续运行并重新合闸',
                        '自动电站立即报警并停止工作，等待人工手动起动 2# 机组',
                        '自动电站反复尝试合闸 1# 主开关直至成功',
                    ],
                    answer: 0,
                    analysis: '自动化电站检测到母线失电（全船失电）后，按设定的备用顺序依次查找可用机组：自动识别 1# 机组处于机械故障状态（冷却水温高）并跳过它，接着自动发出起动命令给 2# 机组；2# 机组建压且储能完成后，自动电站再延时发出合闸命令，自动恢复全船供电。整个"失电→起动→合闸→恢复供电"过程无需人工干预，这正是自动化电站的核心价值。',
                },
            },
        ],
    },

    // ──────────────────────────────────────────────
    // 自动化电站：欠压故障导致主开关跳闸的应急处理
    // 流程：接线供电 → 转自动模式 → 触发1#机欠压故障（AVR）
    //      → 主开关欠压保护跳闸 → 自动电站起动2#机组并自动合闸恢复
    // ──────────────────────────────────────────────
    'auto-uv-trip-recovery': {
        id: 'auto-uv-trip-recovery',
        name: '2.自动化电站欠压故障导致主开关跳闸',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 完整复位：清全部故障残留，1# 机运行，2# 机停机，负载切除，主开关分闸
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) {
                        g1.freq = 50; g1.isOn = false;
                        if (g1.setEngineFault) {
                            g1.setEngineFault('overspeed', false);
                            g1.setEngineFault('oilPress', false);
                            g1.setEngineFault('coolantTemp', false);
                        }
                        g1._faultAVR = false;
                    }
                    if (g2) {
                        g2.freq = 50; g2.isOn = false;
                        if (g2.setEngineFault) {
                            g2.setEngineFault('overspeed', false);
                            g2.setEngineFault('oilPress', false);
                            g2.setEngineFault('coolantTemp', false);
                        }
                        g2._faultAVR = false;
                    }
                    if (sys.comps.bus1) sys.comps.bus1._faultShort = false;
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    const ac = sys.comps.auto_ctl;
                    if (ac) { ac._shortFault = false; ac._auto = false; ac.config.auto = 'manual'; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    await _sleep(400);
                    // 起动 1# 发电机
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000);
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
            // ── 步骤 2：将电站投入自动运行模式 ──
            {
                msg: '第 2 步：将电站切换为自动运行模式，备用顺序保持默认 1-2-3',
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
            // ── 步骤 3：触发 1# 机欠压故障（用户手动），观察主开关欠压保护跳闸 ──
            {
                msg: '第 3 步：打开故障面板，勾选"1#机欠压故障"，观察 1# 机输出电压跌落、1# 主开关欠压保护延时跳闸、全船失电',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（面板操作）
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    for (let i = 0; i < 600; i++) {
                        if (g1 && g1._faultAVR && q1 && q1.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    if (!g1 || !q1) return false;
                    // 欠压故障（AVR）已触发 + 主开关欠压保护跳闸（发电机仍在运行）
                    return !!g1._faultAVR && q1.getState() === 'off' && g1.isOn;
                },
            },
            // ── 步骤 4：观察自动电站失电自动起动 2# 机组并自动合闸恢复 ──
            {
                msg: '第 4 步：母线失电后，自动电站检测"全船失电"：自动起动 2# 机组，建压储能后自动合闸恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    for (let i = 0; i < 400; i++) {
                        if (g2 && g2.isOn && q2 && q2.getState() === 'on') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 5：测试题 ──
            {
                msg: '第 5 步：测试题——欠压故障跳闸后自动电站的恢复过程',
                mode: 'quiz',
                quizConfig: {
                    question: '自动化电站中，1# 机组欠压（AVR 调压器）故障导致 1# 主开关欠压保护跳闸、全船失电，自动电站为什么选择起动 2# 机组而不是恢复 1# 机组？',
                    options: [
                        '1# 机组带欠压故障,不能正常向电网供电，自动电站转而按备用顺序起动无故障的 2# 机组恢复供电',
                        '欠压故障只影响电压显示，不影响电源，自动电站可继续使用 1# 机组',
                        '自动电站只能起动 1# 机组，与故障无关',
                        '欠压故障会自动恢复，自动电站等待 1# 机组重新建压后继续供电',
                    ],
                    answer: 0,
                    analysis: '自动电站的机组可用性判定：AVR 欠压故障或任一原动机故障（超速/滑油低压/水温高）都会把该机组标记为"不可用"。母线失电时，自动电站按备用顺序逐台查找可用机组：1# 机带欠压故障被跳过，2# 机无故障被选中，自动发出起动命令；2# 机建压且储能完成后自动合闸恢复全船供电。将带故障机组隔离在电网之外，是保证恢复供电可靠性的关键措施。',
                },
            },
        ],
    },

    // ──────────────────────────────────────────────
    // 自动化电站：短路故障导致主开关跳闸的应急处理
    // 流程：接线供电 → 转自动模式 → 触发汇流排干线短路故障
    //      → 两台主开关瞬时跳闸 → 短路检测阻塞自动模式（不自动恢复）
    // ──────────────────────────────────────────────
    'auto-short-trip-recovery': {
        id: 'auto-short-trip-recovery',
        name: '3.自动化电站短路故障导致主开关跳闸',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 完整复位：清全部故障残留，1# 机运行，2# 机停机，负载切除，主开关分闸
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) {
                        g1.freq = 50; g1.isOn = false;
                        if (g1.setEngineFault) {
                            g1.setEngineFault('overspeed', false);
                            g1.setEngineFault('oilPress', false);
                            g1.setEngineFault('coolantTemp', false);
                        }
                        g1._faultAVR = false;
                    }
                    if (g2) {
                        g2.freq = 50; g2.isOn = false;
                        if (g2.setEngineFault) {
                            g2.setEngineFault('overspeed', false);
                            g2.setEngineFault('oilPress', false);
                            g2.setEngineFault('coolantTemp', false);
                        }
                        g2._faultAVR = false;
                    }
                    if (sys.comps.bus1) sys.comps.bus1._faultShort = false;
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    const ac = sys.comps.auto_ctl;
                    if (ac) { ac._shortFault = false; ac._auto = false; ac.config.auto = 'manual'; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    await _sleep(400);
                    // 起动 1# 发电机
                    await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                    await _sleep(3000);
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
            // ── 步骤 2：将电站投入自动运行模式 ──
            {
                msg: '第 2 步：将电站切换为自动运行模式，备用顺序保持默认 1-2-3',
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
            // ── 步骤 3：触发汇流排干线短路故障（用户手动），观察两台主开关瞬时跳闸 ──
            {
                msg: '第 3 步：打开故障面板，勾选"汇流排干线短路故障"，观察1#机组主开关短路保护瞬时跳闸、全船失电',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（面板操作）
                    const sys = this.sys;
                    const b = sys.comps.bus1, q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    for (let i = 0; i < 600; i++) {
                        if (b && b._faultShort && q1 && q1.getState() === 'off' && q2 && q2.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const b = sys.comps.bus1, q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (!b || !q1 || !q2) return false;
                    // 短路故障已触发 + 两台主开关全部瞬时跳闸
                    return !!b._faultShort && q1.getState() === 'off' && q2.getState() === 'off';
                },
            },
            // ── 步骤 4：观察短路期间自动模式被阻塞，随后将控制模式转回手动 ──
            {
                msg: '第 4 步：干线短路时，自动电站立即检测到"短路"并阻塞自动模式（自动指示灯熄灭）：不自动起动任何机组、不自动合闸，防止对短路点反复送电。确认自动模式已阻塞后，将自动控制模块旋钮拨回"手动"档，退出自动运行',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    // 观察期：等待约 6s，确认短路阻塞生效（自动模式不会自动起动 2# 机、不会自动合闸）
                    await _sleep(6000);
                    // 观察到自动模式已阻塞后，将控制模式转回手动（拨回旋钮）
                    if (ac && ac._auto) {
                        ac._auto = false;
                        ac.config.auto = 'manual';
                        if (ac._tweenKnob && ac._ui && ac._ui.knobMode) ac._tweenKnob(ac._ui.knobMode.ptr, -45);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const ac = sys.comps.auto_ctl;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    // 短路标记仍在 + 2# 机未被自动起动合闸（短路不恢复）+ 控制模式已转回手动
                    return !!ac && ac._shortFault === true && ac._auto === false
                        && !(g2 && g2.isOn) && !(q2 && q2.getState() === 'on');
                },
            },
            // ── 步骤 5：测试题 ──
            {
                msg: '第 5 步：测试题——短路故障时自动电站的处理与恢复方式',
                mode: 'quiz',
                quizConfig: {
                    question: '自动化电站运行中，汇流排干线发生短路故障（主开关瞬时跳闸全船失电），自动模式被阻塞，操作人员将控制模式转回手动后，正确的恢复步骤是什么？',
                    options: [
                        '查明并隔离短路点（绝缘损坏、进水、误操作、检修遗留物等），清除短路故障、确认汇流排绝缘正常后，在手动模式下起动/恢复机组并合闸恢复供电',
                        '清除短路故障后，将控制模式拨回"自动"，让自动电站自动恢复供电',
                        '自动模式被阻塞后，直接手动反复合闸主开关直到成功',
                        '短路故障无需排查，转回手动后直接起动备用机组并车供电即可',
                    ],
                    answer: 0,
                    analysis: '干线短路是船舶电站最严重的故障：短路电流巨大，主开关瞬时跳闸切断短路点以保护发电机与人身安全。自动化电站设有短路检测机制：检测到系统中存在短路标记时立即阻塞自动模式（既不自动起动机组也不自动合闸），防止对短路点反复送电、扩大故障。操作人员确认自动模式阻塞后应将控制模式转回手动，然后人工查明并隔离短路点（绝缘损坏、进水、误操作、检修遗留物等），清除短路标记、确认汇流排绝缘恢复正常后，才能手动合闸恢复供电。若未排除短路即拨回自动档，自动电站仍会因短路标记保持阻塞，不会自动恢复；若直接强行合闸，则会再次对短路点送电，扩大设备损坏甚至引发火灾。这也体现了"选择性保护+人工确认"的安全原则。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', visible:true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 负载中性点接地
    { Class: Ground, id: 'gnd1', x:1080, y: 500, visible: true },

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

    // ── 电站自动控制模块 ──
    // 置于原数字同步表的位置；自动起动/并车/解列/调频，经通信接口控制两台遥控面板
    { Class: ShipAutoControl, id: 'auto_ctl', x: 600, y: 170, genIds: 'gen1,gen2', qfIds: 'qf1,qf2', panelIds: 'genpanel,genpanel2', auto: 'manual', seq: '123', parallelKw: 80, decoupleKw: 30, label: '船舶电站自动控制模块', visible: true },

    // ── 三相可调负载：汇流排第5口三相直连，N端接地 gnd1 ──
    { Class: ThreePhaseLoad, id: 'load3', x: 1050, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

    // ── 汇流排馈出支路 ──
    // 支路1（第8列）：三相空气开关 QF3 → 三盏白炽灯（分别接 L1/L2/L3）
    { Class: DiagramThreePhaseACB, id: 'acb_l', x: 1826, y: 80, initState: 'on', label: 'QF3', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: IncandescentLamp, id: 'lamp1', x: 1850, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp2', x: 1920, y: 770, coldResistance: 4.84, rotation: 90 },
    { Class: IncandescentLamp, id: 'lamp3', x: 1990, y: 770, coldResistance: 4.84, rotation: 90 },
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
        // ── 三相可调负载（load3）：汇流排第5口三相直连，N端接地 gnd1 ──
        { from: 'bus1_wire_l1_5', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_5', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_5', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 电站自动控制模块：母线采集（第4列）+ 24V 电源（正极接母线电源，负极接旁边接地 gnd1）──
        { from: 'bus1_wire_l1_4', to: 'auto_ctl_wire_bus_a', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'auto_ctl_wire_bus_b', type: 'wire' },
        { from: 'dc_uv_wire_p', to: 'auto_ctl_wire_p24_p', type: 'wire' },
        { from: 'gnd1_wire_gnd', to: 'auto_ctl_wire_p24_n', type: 'wire' },
        { from: 'auto_ctl_wire_comm1_a', to: 'genpanel_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm1_b', to: 'genpanel_wire_com_b', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_a', to: 'genpanel2_wire_com_a', type: 'wire' },
        { from: 'auto_ctl_wire_comm2_b', to: 'genpanel2_wire_com_b', type: 'wire' },
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
    ];
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
    // 起动发电机前先完整复位（防止上次流程残留的两机极端设定/负载/开关状态
    // 导致加载系统时两台发电机功率分配不均）：
    // 两台机设定频率归位 50Hz；只保留 1 号机运行，2 号机停机；负载全部切除；
    // 两台主开关分闸。
    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
    if (g1) { g1.freq = 50; g1.isOn = true; }
    if (g2) { g2.freq = 50; g2.isOn = false; }
    if (sys.comps.load3) { sys.comps.load3._loaded = false; }
    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
}

export function fiveStep() {
}
