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
import { Syncroscope } from '../components/Syncroscope.js';
import { SP4TSwitch } from '../components/SP4TSwitch.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';

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
    'mech-trip-recovery': {
        id: 'mech-trip-recovery',
        name: '1.机械故障导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // 自动接线
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位：1# 机运行，2# 机停机，负载切除，两台主开关分闸
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) { g1.freq = 50; g1.isOn = false; }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const sel = sys.comps.sync_sel;
                    if (sel && sel.getPosition() !== 1) sel.switchTo(1);
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
            // ── 步骤 2：触发任意 1 种原动机机械故障 ──
            {
                msg: '第 2 步：打开故障面板，触发 3 种原动机故障中的任意 1 种，观察 1# 机停机、主开关跳闸',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（面板操作）
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    // 等待故障触发并跳闸
                    for (let i = 0; i < 400; i++) {
                        if (g1 && !g1.isOn && q1 && q1.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    if (!g1 || !q1) return false;
                    // 检查发电机已停机且主开关已跳闸
                    if (g1.isOn || q1.getState() !== 'off') return false;
                    // 检查 3 种原动机故障中至少 1 种被触发
                    const f = g1.getEngineFaults();
                    return !!(f.overspeed || f.oilPress || f.coolantTemp);
                },
            },
            // ── 步骤 3：起动 2# 机组，合闸供电 ──
            {
                msg: '第 3 步：起动 2# 机组，合闸恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sel = sys.comps.sync_sel;
                    // 切换同步表选择开关到 2 号档位
                    if (sel && sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(400);
                    // 起动 2# 发电机
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待储能
                    // 合闸
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 4：测试题——全船失电处理 ──
            {
                msg: '第 4 步：测试题——主开关跳闸导致全船失电的处理措施',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶运行中，主开关因机械故障跳闸导致全船失电（黑船），首先应采取什么原则？后续应如何处理？',
                    options: [
                        '首先：起动备用机组恢复供电、接通重要负载；后续：查明故障原因并排除',
                        '首先：立即手动强行合闸恢复供电；后续：等故障自行消失后再检查',
                        '首先：等待电网自动恢复；后续：关闭所有负载以减轻电网负担',
                        '首先：立即切断所有负载；后续：通知机舱等待检修',
                    ],
                    answer: 0,
                    analysis: '主开关跳闸导致全船失电时，首先应起动备用发电机组恢复供电并接通重要负载，保障船舶安全运行。后续查明跳闸的故障原因（机械故障、过载、短路等），排除故障后恢复正常供电。',
                },
            },
        ],
    },

    'overload-trip-recovery': {
        id: 'overload-trip-recovery',
        name: '2.过载故障导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) { g1.freq = 50; g1.isOn = false; }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) { sys.comps.load3._loaded = false; sys.comps.load3.powerKw = 20; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const sel = sys.comps.sync_sel;
                    if (sel && sel.getPosition() !== 1) sel.switchTo(1);
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
            // ── 步骤 2：加载 70kW，引发过载，等待跳闸 ──
            {
                msg: '第 2 步：加载 70kW，观察过载保护延时跳闸',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    if (load) {
                        load.powerKw = 70;
                        load._loaded = true;
                    }
                    // 等待过载保护延时跳闸（overloadTime=15s + 余量）
                    const q1 = sys.comps.qf1;
                    for (let i = 0; i < 400; i++) {
                        if (q1 && q1.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const q1 = sys.comps.qf1, g1 = sys.comps.gen1;
                    // 主开关跳闸 + 发电机仍在运行（过载不停机）+ 负载仍设置 70kW
                    return !!q1 && q1.getState() === 'off'
                        && !!g1 && g1.isOn;
                },
            },
            // ── 步骤 3：直接合闸恢复供电 ──
            {
                msg: '第 3 步：1# 发电机仍在运行，直接按遥控面板"合闸"恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    return !!sys.comps.qf1 && sys.comps.qf1.getState() === 'on';
                },
            },
            // ── 步骤 4：起动 2# 机组，合闸并车 ──
            {
                msg: '第 4 步：起动 2# 机组，并车合闸',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const sel = sys.comps.sync_sel;
                    const sc = sys.comps.sync1;
                    // 2号机频率与1号机对齐
                    g2.freq = (g1._freqOut ?? g1.freq) + 0.3;
                    await _sleep(2500);
                    // 切换同步表到 2 号档位
                    if (sel && sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(300);
                    // 起动 2# 发电机
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(3000);
                    // 等待同步表相位进入允许区
                    const degOf = () => { const d = (sc._phaseDiff || 0) * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                    let hit = false;
                    for (let i = 0; i < 400 && !hit; i++) {
                        const d = degOf();
                        if (d < 60 || d > 270) hit = true;
                        else await _sleep(50);
                    }
                    // 合闸 2 号主开关
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(2000);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 5：再次加载（两机分担，不再过载） ──
            {
                msg: '第 5 步：两机并联后,再次投入大负荷，确认负载运行正常',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    // 确保负载仍为 70kW 且已加载
                    if (load) { load.powerKw = 70; load._loaded = true; }
                    await _sleep(3000);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    const load = sys.comps.load3;
                    // 两台发电机都在运行、两台主开关都在合闸、负载已加载
                    return !!g1 && g1.isOn && !!g2 && g2.isOn
                        && !!q1 && q1.getState() === 'on'
                        && !!q2 && q2.getState() === 'on'
                        && !!load && load._loaded;
                },
            },
            // ── 步骤 6：测试题 ──
            {
                msg: '第 6 步：测试题——过载跳闸后为何能直接合闸？',
                mode: 'quiz',
                quizConfig: {
                    question: '过载导致主开关跳闸后，为什么可以直接合闸恢复供电？',
                    options: [
                        '过载跳闸只断开了主开关，发电机仍在运行，负载已随跳闸断开，合闸即恢复供电',
                        '过载跳闸后发电机自动停机，需要先重新起动才能合闸',
                        '过载跳闸后需要等待 5 分钟冷却才能再次合闸',
                        '过载跳闸后必须先排除过载原因才能合闸',
                    ],
                    answer: 0,
                    analysis: '过载保护跳闸只是主开关分闸断开负载回路，发电机本身并未停机（与机械故障停机不同）。跳闸后负载随主开关断开而脱离电网，汇流排恢复正常电压，因此可以直接合闸恢复供电。合闸后需注意控制负载，避免再次过载。',
                },
            },
        ],
    },

    'rev-power-recovery': {
        id: 'rev-power-recovery',
        name: '3.逆功率故障导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：接线、起动 1# 机组、合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) { g1.freq = 50; g1.isOn = false; }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) { sys.comps.load3._loaded = false; sys.comps.load3.powerKw = 20; }
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    // 白炽灯支路 QF3 合闸（模拟基础照明负载）
                    const acb = sys.comps.acb_l;
                    if (acb && acb.getState() !== 'on' && acb.close) acb.close();
                    const sel = sys.comps.sync_sel;
                    if (sel && sel.getPosition() !== 1) sel.switchTo(1);
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
            // ── 步骤 2：起动 2# 机组、并车、转移负荷 ──
            {
                msg: '第 2 步：起动 2# 机组并车合闸，转移负荷功率均分',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const sel = sys.comps.sync_sel;
                    const sc = sys.comps.sync1;
                    // 2号机频率与1号机对齐
                    g2.freq = (g1._freqOut ?? g1.freq) + 0.3;
                    await _sleep(2500);
                    // 切换同步表到 2 号档位
                    if (sel && sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(300);
                    // 起动 2# 发电机
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(3000);
                    // 等待同步表相位进入允许区
                    const degOf = () => { const d = (sc._phaseDiff || 0) * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                    let hit = false;
                    for (let i = 0; i < 400 && !hit; i++) {
                        const d = degOf();
                        if (d < 60 || d > 270) hit = true;
                        else await _sleep(50);
                    }
                    // 合闸 2 号主开关（并车）
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(2000);
                    // 转移负荷：调高 2# 机设定频率，使 2# 机承担总负荷约 50%
                    for (let i = 0; i < 400; i++) {
                        const p1 = g1._displayP || 0, p2 = g2._displayP || 0;
                        const tot = p1 + p2;
                        if (tot <= 0.5 || p2 >= tot * 0.5) break;
                        const err = tot * 0.5 - p2;
                        const step = Math.max(0.002, Math.min(0.03, Math.abs(err) * 0.002));
                        g1.freq -= step;
                        g2.freq += step;
                        await _sleep(100);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 3：加载 70kW，观察功率分配 ──
            {
                msg: '第 3 步：加载 70kW，观察两机功率分配',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    if (load) {
                        load.powerKw = 70;
                        load._loaded = true;
                    }
                    await _sleep(2500); // 等待功率分配收敛
                },
                check() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    // 两机并联运行、两主开关合闸、负载已加载
                    return !!load && load._loaded
                        && !!g1 && g1.isOn && !!g2 && g2.isOn
                        && !!q1 && q1.getState() === 'on'
                        && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 4：触发 2# 冷却水高温故障（用户手动）──
            {
                msg: '第 4 步：在故障面板触发"1#机冷却水温高故障"，观察 1# 机逆功率跳闸、2# 机过载跳闸',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（面板操作）
                    const sys = this.sys;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    // 等待两个主开关都跳闸（2# 逆功率 5s、1# 过载 15s，共约 20s）
                    for (let i = 0; i < 600; i++) {
                        if (q1 && q2 && q1.getState() === 'off' && q2.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (!g1 || !q1 || !q2) return false;
                    // 1# 机冷却水高温故障已触发
                    const f = g1.getEngineFaults();
                    if (!(f && f.coolantTemp)) return false;
                    // 2# 主开关逆功率跳闸 + 1# 主开关过载跳闸
                    return q2.getState() === 'off' && q1.getState() === 'off';
                },
            },
            // ── 步骤 5：迅速合上 1# 机组主开关，恢复供电 ──
            {
                msg: '第 5 步：2# 发电机仍在运行（过载仅跳开关不停机），直接按遥控面板"合闸"恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const q2 = sys.comps.qf2;
                    return !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 6：测试题 ──
            {
                msg: '第 6 步：测试题——一台机组逆功率导致全船失电的原因',
                mode: 'quiz',
                quizConfig: {
                    question: '两台机组并联运行，一台机组因原动机故障逆功率跳闸后，为什么会导致全船失电？',
                    options: [
                        '一台机组发生逆功率故障，其承担的全部负荷转移给另一台机组，另一台机组严重过载，延时后跳闸，全船失电',
                        '逆功率跳闸直接损坏汇流排，导致全船失电',
                        '逆功率跳闸后电网频率瞬间崩溃，保护装置全部误动作',
                        '逆功率跳闸的机组倒灌电流烧毁电网设备，全船失电',
                    ],
                    answer: 0,
                    analysis: '两台机组并联运行时，若一台机组因原动机故障（如冷却水高温）被母线拖转产生逆功率，逆功率保护延时跳闸使该机组退出运行。其原来承担的全部负荷瞬间转移到另一台机组上，另一台机组因承担超过自身额定 120% 的负荷而过载，过载保护延时跳闸，最终全船失电。因此并联运行时应保持各机组负载均衡，并监视原动机运行状态。',
                },
            },
        ],
    },

    'under-voltage-recovery': {
        id: 'under-voltage-recovery',
        name: '4.欠压故障导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位：1# 机运行，2# 机停机，负载切除，两台主开关分闸
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) { g1.freq = 50; g1.isOn = false; g1._faultAVR = false; }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const sel = sys.comps.sync_sel;
                    if (sel && sel.getPosition() !== 1) sel.switchTo(1);
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
            // ── 步骤 2：触发 1# 机欠压故障，观察主开关欠压跳闸 ──
            {
                msg: '第 2 步：打开故障面板，触发"1#机欠压故障"，观察 1# 机输出电压跌落、主开关欠压保护延时跳闸',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（故障面板操作）
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    // 等待欠压故障触发且主开关跳闸（欠压保护延时 2s）
                    for (let i = 0; i < 400; i++) {
                        if (g1 && g1._faultAVR && q1 && q1.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    if (!g1 || !q1) return false;
                    // 欠压故障已触发（AVR 故障）
                    if (!g1._faultAVR) return false;
                    // 主开关欠压保护跳闸（发电机仍在运行，仅开关分闸）
                    return q1.getState() === 'off' && g1.isOn;
                },
            },
            // ── 步骤 3：迅速起动 2# 机组，合闸恢复供电 ──
            {
                msg: '第 3 步：迅速起动 2# 机组，切换同步表到 2 号档位并合闸，恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const sel = sys.comps.sync_sel;
                    // 切换同步表选择开关到 2 号档位
                    if (sel && sel.getPosition() !== 3) sel.switchTo(3);
                    await _sleep(400);
                    // 起动 2# 发电机
                    await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                    await _sleep(3000); // 等待储能
                    // 合闸
                    await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 4：测试题——主开关跳闸应急处理的首要目标 ──
            {
                msg: '第 4 步：测试题——主开关跳闸应急处理的首要目标',
                mode: 'quiz',
                quizConfig: {
                    question: '主开关因欠压故障跳闸导致全船失电后，应急处理的首要目标是什么？',
                    options: [
                        '尽快起动备用发电机组恢复供电，接通重要负载，保障船舶安全；查明欠压原因可后续进行',
                        '立即强行合闸跳闸的主开关先恢复供电，欠压故障不排除也不影响运行',
                        '先断开全部负载，待查明并排除欠压故障原因后再恢复供电',
                        '记录故障报警并通知机舱值班人员，等待上级指示后再处理',
                    ],
                    answer: 0,
                    analysis: '主开关跳闸导致全船失电时，应急处理的首要目标是尽快恢复供电：迅速起动备用发电机组，合上主开关接通重要负载，保障船舶航行与安全。查明欠压故障原因、排除故障属于后续工作，应与恢复供电并行开展，切不可因等待排查欠压原因而延误供电恢复。',
                },
            },
        ],
    },

    'short-circuit-recovery': {
        id: 'short-circuit-recovery',
        name: '5.短路故障导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 复位：1# 机运行，2# 机停机，负载切除，两台主开关分闸，清除短路标记
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    if (g1) { g1.freq = 50; g1.isOn = false; }
                    if (g2) { g2.freq = 50; g2.isOn = false; }
                    if (sys.comps.bus1) sys.comps.bus1._faultShort = false;
                    if (sys.comps.load3) sys.comps.load3._loaded = false;
                    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                    if (q1 && q1.getState() === 'on' && q1.tryTrip) q1.tryTrip();
                    if (q2 && q2.getState() === 'on' && q2.tryTrip) q2.tryTrip();
                    const sel = sys.comps.sync_sel;
                    if (sel && sel.getPosition() !== 1) sel.switchTo(1);
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
            // ── 步骤 2：触发汇流排短路故障，观察主开关瞬时跳闸 ──
            {
                msg: '第 2 步：打开故障面板，触发"汇流排干线短路故障"，观察 1# 主开关因短路保护瞬时跳闸、全船失电',
                mode: 'check',
                async act() {
                    // 等待用户手动触发故障（故障面板操作）
                    const sys = this.sys;
                    const b = sys.comps.bus1, q1 = sys.comps.qf1;
                    // 等待短路故障触发且主开关跳闸（短路保护瞬时动作）
                    for (let i = 0; i < 400; i++) {
                        if (b && b._faultShort && q1 && q1.getState() === 'off') break;
                        await _sleep(100);
                    }
                },
                check() {
                    const sys = this.sys;
                    const b = sys.comps.bus1, q1 = sys.comps.qf1;
                    if (!b || !q1) return false;
                    // 汇流排短路故障已触发
                    if (!b._faultShort) return false;
                    // 主开关短路保护瞬时跳闸
                    return q1.getState() === 'off';
                },
            },
            // ── 步骤 3：测试题——汇流排干线短路时的处理方法 ──
            {
                msg: '第 3 步：测试题——汇流排干线短路时的处理方法',
                mode: 'quiz',
                quizConfig: {
                    question: '船舶电站运行中，汇流排干线发生短路故障导致主开关跳闸，正确的处理方法是什么？',
                    options: [
                        '查明并排除短路点（绝缘损坏、进水、误操作、检修遗留物等），隔离故障后确认绝缘正常，方可合闸恢复供电，严禁强行合闸',
                        '短路跳闸后立即反复强行合闸，短路点通常能自行消除',
                        '短路后无需处理，等待一段时间短路会自动消失再合闸',
                        '短路只影响本机组，直接起动备用机组并车供电即可，无需排查短路点',
                    ],
                    answer: 0,
                    analysis: '汇流排干线短路是船舶电站最严重的故障之一，短路电流巨大，短路保护瞬时动作跳闸以保护发电机与人身设备安全。处理时应先查明短路原因（绝缘老化损坏、进水受潮、误操作、检修遗留导电物等），隔离并排除短路点，确认汇流排绝缘正常后方可合闸恢复供电。严禁在原因不明时强行合闸，否则会扩大事故损坏设备。',
                },
            },
            // ── 步骤 4：测试题——短路保护选择性不当导致主开关跳闸的处理方法 ──
            {
                msg: '第 4 步：测试题——因短路保护选择性不当导致主开关跳闸的处理方法',
                mode: 'quiz',
                quizConfig: {
                    question: '短路保护选择性配合不当，导致主开关也发生误跳闸、扩大停电范围，应如何处理？',
                    options: [
                        '隔离故障支路，合上主开关恢复供电，恢复重要负载，再隔离检修发生短路的故障支路',
                        '误跳闸的主开关必须保持分闸，待全部短路故障处理完毕后统一恢复供电',
                        '短路保护误跳闸说明保护已失效，应对所有主开关挂牌停用，等待厂家检修',
                        '保护选择性不当与运行无关，直接合上所有主开关继续运行即可',
                    ],
                    answer: 0,
                    analysis: '电网选择性配合要求：距短路点最近一级的保护动作、上级保护不应动作。若选择性配合不当造成非故障段主开关误跳闸、扩大停电范围，应急处置应优先恢复非故障支路的供电（合上正常的主开关），确保船舶重要负载连续供电；同时对故障支路进行隔离，查明并排除短路原因。事后应核对调整各级保护的整定值与动作时限，恢复电网选择性，避免同类误动作再次发生。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 2, visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 3, visible:true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 750, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 改为同步表中性点接地
    { Class: Ground, id: 'gnd1', x: 680, y: 500, visible: true },

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

    // ── 数字同步表：上=汇流排A相，左=待并机A相(经选择开关)，下=接地 ──
    { Class: Syncroscope, id: 'sync1', x: 600, y: 170, label: '数字同步表', visible: true },

    // ── 三相可调负载：置于同步表与2号主开关之间（汇流排第5口直连，N端悬空不接）──
    { Class: ThreePhaseLoad, id: 'load3', x: 950, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 待并机选择开关：单刀四掷（OFF / 待并机1 / 待并机2 / 待并机3）──
    // 档位1=OFF（同步表关闭）、档位2=1号机、档位3=2号机、档位4=3号机（预留）
    { Class: SP4TSwitch, id: 'sync_sel', x: 650, y: 530, label: '同步表选择开关', function: '同步表选择开关', labelNames: ['OFF', '1', '2', '3'], initPosition: 1, visible: true },

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
        // ── 三相可调负载（load3）：汇流排第5口三相直连，N端接同步表旁接地 gnd1 ──
        { from: 'bus1_wire_l1_5', to: 'load3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_5', to: 'load3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_5', to: 'load3_wire_l3', type: 'wire' },
        { from: 'load3_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 数字同步表：汇流排A相 + 待并机A相(经待并机选择开关 COM) + 接地参考 ──
        { from: 'bus1_wire_l1_3', to: 'sync1_wire_bus', type: 'wire' },
        { from: 'sync_sel_wire_com', to: 'sync1_wire_gen', type: 'wire' },
        { from: 'sync1_wire_gnd', to: 'gnd1_wire_gnd', type: 'wire' },
        // ── 待并机选择开关：T2=1号机，T3=2号机，T4=3号机(预留悬空)，T1=OFF(悬空) ──
        { from: 'sync_sel_wire_t2', to: 'gen1_wire_u', type: 'wire' },
        { from: 'sync_sel_wire_t3', to: 'gen2_wire_u', type: 'wire' },
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
