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
import { LampRotationSync } from '../components/LampRotationSync.js';
import { SP4TSwitch } from '../components/SP4TSwitch.js';
import { ThreePhaseLoad } from '../components/ThreePhaseLoad.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
    gen2_coolant_temp: {
        id: 'gen2_coolant_temp',
        name: '2#发电机冷却水温度高',
        system: '发电机',
        check() {
            const c = _fcomp('gen2');
            return !!(c && c._faultCoolantTemp);
        },
        trigger() {
            const c = _fcomp('gen2');
            if (c) c._faultCoolantTemp = true;
        },
        repair() {
            const c = _fcomp('gen2');
            if (c) c._faultCoolantTemp = false;
        },
    },
};

export const PROJECT_WORKFLOWS = {
    'parallel-load-shift': {
        id: 'parallel-load-shift', name: '1.发电机准同步并车、并联负荷转移、解列',
        steps: [
            {
                msg: '第 1 步：自动接线，起动 1 号发电机，合闸供电，调频至 50Hz', mode: 'check',
                op: [
                    { type: 'wire',
                        async act() {
                            const sys = this.sys;
                            _autoWire(sys);
                            const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                            const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
                            g1.isOn = false; g2.isOn = false;
                            g1.freq = 50; g2.freq = 50;
                            if (sys.comps.load3) sys.comps.load3._loaded = false;
                            if (q1.getState() === 'on' && q1.tryTrip) { q1.tryTrip(); await _sleep(600); }
                            if (q2.getState() === 'on' && q2.tryTrip) { q2.tryTrip(); await _sleep(600); }
                            if (sys.comps.sync_sel.getPosition() !== 1) sys.comps.sync_sel.switchTo(1);
                            await _sleep(300);
                        } },
                    { type: 'btn', target: 'genpanel', part: 'btn-start',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                            await _sleep(3000); // 等待储能电机将合闸弹簧储能到位
                        } },
                    { type: 'btn', target: 'genpanel', part: 'btn-close',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 800);
                            await _sleep(2000);
                        } },
                    { type: 'knob', target: 'genpanel', part: 'knob',
                        async act() {
                            const sys = this.sys;
                            // 最后按住 1 号机调速旋钮，将输出频率调至 50Hz（后续频差演示的基准）
                            await _tuneFreqTo(sys, 'genpanel', 'gen1', 50.0);
                            await _sleep(300);
                        } },                           
                ],
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1.isOn && q1.getState() === 'on' && Math.abs(g1.freq - 50) <= 0.12;
                },
            },
            {
                msg: '第 2 步：填空题——准同步并车必须满足的三个条件', mode: 'fill',
                target: 'genpanel2',
                fields: [
                    { label: '电压差不超过', unit: '%Un', placeholder: '', answer: 10 },
                    { label: '频率差不超过', unit: 'Hz', placeholder: '', answer: 0.5 },
                    { label: '相位差不超过', unit: '°', placeholder: '', answer: 15 },
                ],
            },
            {
                msg: '第 3 步：检查 2 号发电机遥控面板 READY FOR START 指示灯（点击该灯即可跳过）', mode: 'find',
                target: 'genpanel2', subTarget: 'ready-led',
            },
            {
                msg: '第 4 步：起动 2 号发电机组，调频到 50.2Hz', mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-start',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                            await _sleep(1800);
                        } },
                    { type: 'knob', target: 'genpanel2', part: 'knob',
                        async act() {
                            const sys = this.sys;
                            const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                            // 等待 1 号机单机频率下垂收敛稳定后再取基准，避免合闸/负载过渡期漂移
                            let last = g1._freqOut ?? g1.freq;
                            for (let i = 0; i < 60; i++) {
                                await _sleep(200);
                                const now = g1._freqOut ?? g1.freq;
                                if (Math.abs(now - last) < 0.003) break;
                                last = now;
                            }
                            g2.freq = last + 0.25;      // 待并机调频到比电网高 0.25Hz
                            g2._baseFreq = last;       // 基准快照（防 1 号机频率微漂）
                            await _sleep(2500);
                        } },
                ],
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    return !!g2.isOn 
                        && Math.abs(g2.freq - 50.2) < 0.05;
                },
            },
            {
                msg: '第 5 步：打开同步表，观察灯光旋转法并车组件——正频差 0.2~0.33Hz，灯光顺时针 3-5s 旋转一圈', mode: 'check',
                op: [
                    { type: 'switch', target: 'sync_sel', part: 'sel-knob',
                        async act() {
                            const sys = this.sys;
                            const sel = sys.comps.sync_sel;
                            if (sel.getPosition() !== 3) sel.switchTo(3);
                            await _sleep(300);
                        } },


                { type: 'observe', target: 'lampsync1' ,
                async act() {
                    
                    // 纯观察步骤：演示模式停留几秒让学员看清三灯明暗顺时针旋转
                    await _sleep(4500);
                }
            }],
                check() {
                    const sys = this.sys;
                    const sc = sys.comps.lampsync1;
                    const dF = sc._fGen - sc._fBus;
                    return sc && sys.comps.sync_sel.getPosition() === 3&& !sc._off && sc._hasVolt && dF >= 0.2 && dF <= 0.33;
                },
            },
            {
                msg: '第 6 步：观察 12 点位置的灯接近熄灭时合闸 2 号主开关，随后同步选择开关转回 OFF', mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-close',
                        async act() {
                            const sys = this.sys;
                            const sc = sys.comps.lampsync1;
                            // 相位差 330° = 12 点位置的灯接近熄灭（熄灭点 0° 对侧相差 180° 处最亮），
                            // 合闸窗口 315°~345°（灯渐暗至接近熄灭区间）
                            let hit = false;
                            for (let i = 0; i < 800 && !hit; i++) {
                                const d = (Math.round((sc._phaseDiff || 0) * 180 / Math.PI) % 360 + 360) % 360;
                                if (d >= 315 && d <= 345) hit = true;
                                else await _sleep(50);
                            }
                            await _pressPanelBtn(sys, 'genpanel2', '_userClosePressed', 700);
                            await _sleep(2000);
                        } },
                    { type: 'switch', target: 'sync_sel', part: 'sel-knob',
                        async act() {
                            const sys = this.sys;
                            const sel = sys.comps.sync_sel;
                            if (sel.getPosition() !== 1) sel.switchTo(1);
                            await _sleep(300);
                        } },
                ],
                check() {
                    const sys = this.sys;
                    return sys.comps.qf2.getState() === 'on' && sys.comps.sync_sel.getPosition() === 1;
                },
            },
            {
                msg: '第 7 步：负荷转移——调节两台机调速器，使功率均分', mode: 'check',
                op: { type: 'knob', target: 'genpanel', part: 'knob' },
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 比例调节：并车后原负载按频差份额分配（2# 仅分 3%~5%），均分需要
                    // 把设定差调到数 Hz（trans 补偿 ratio 失衡）。差值大 → 大步进、
                    // 差值小 → 小步进，接近目标时步长自动收缩，避免固定步长过冲振荡。
                    for (let i = 0; i < 400; i++) {
                        const p1 = g1._displayP, p2 = g2._displayP;
                        if (Math.abs(p1 - p2) <= 1.5) break;
                        const err = p1 - p2;
                        const step = Math.max(0.002, Math.min(0.03, Math.abs(err) * 0.002));
                        const dir = err > 0 ? -1 : 1;   // 1 号机功率偏高 → 减 1 号油门、增 2 号油门
                        g1.freq += dir * step;
                        g2.freq -= dir * step;
                        await _sleep(100);
                    }
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    return Math.abs(g1._displayP - g2._displayP) <= 2;
                },
            },
            {
                msg: '第 8 步：突加负载 20kW（投入三相可调负载），观察两台机功率分配情况', mode: 'check',
                op: { type: 'load', target: 'load3' },
                async act() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    load.powerKw = 20; load._loaded = true;
                    await _sleep(2000); // 等待功率分配收敛
                },
                check() {
                    const sys = this.sys;
                    const load = sys.comps.load3;
                    return !!(load && load.isLoaded())
                        && sys.comps.qf1.getState() === 'on' && sys.comps.qf2.getState() === 'on'
                        && sys.comps.gen1.isOn && sys.comps.gen2.isOn;
                },
            },
            {
                msg: '第 9 步：增大 1 号机油门、减小 2 号机油门，使电网频率维持在 50Hz 且 2 号机承担功率降到 3kW', mode: 'check',
                op: { type: 'knob', target: 'genpanel', part: 'knob' },
                async act() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 并联运行时：2 号机功率由频差(f2−f1)决定，电网频率由平均设定(f1+f2)/2 决定，
                    // 两者正交。第一个循环只调频差转移功率（比例调节，接近目标步长自动收缩）；
                    // 第二个循环同步平移两台设定调频率。
                    for (let i = 0; i < 400; i++) {
                        const p2 = g2._displayP;
                        if (Math.abs(p2 - 3) <= 0.5) break;
                        const err = p2 - 3;
                        const step = Math.max(0.002, Math.min(0.03, Math.abs(err) * 0.002));
                        const dir = err > 0 ? 1 : -1;   // 2 号机功率偏高 → 增大 1 号油门、减小 2 号油门
                        g1.freq += dir * step;
                        g2.freq -= dir * step;
                        await _sleep(100);
                    }
                    // 频率环：两台同步平移（保持频差不变 → 功率分配不变），把电网频率调到 50Hz
                    for (let i = 0; i < 80; i++) {
                        const f = g1._freqOut ?? g1.freq;
                        if (Math.abs(f - 50) <= 0.05) break;
                        const d = f > 50 ? -0.01 : 0.01;
                        g1.freq += d; g2.freq += d;
                        await _sleep(180);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2;
                    const f = sys.comps.gen1._freqOut ?? sys.comps.gen1.freq;
                    return Math.abs(g2._displayP - 3) <= 1 && Math.abs(f - 50) <= 0.5;
                },
            },
            {
                msg: '第 10 步：2 号发电机主开关分闸（解列）,2 号发电机停机，负荷全部由 1 号机承担', mode: 'check',
                op: [
                    { type: 'btn', target: 'genpanel2', part: 'btn-open',
                        async act() {
                            const sys = this.sys;
                            // 分闸解列 2#：模型自动把两机设定软复位到解列前等效设定
                            // （SyncGenerator3P 解列分支 autoDecoupleTrim），频率连续过渡——
                            // 1# 承接 2# 负载频率微降（约 0.075Hz）、2# 卸载空载频率微升（特征对称）。
                            await _pressPanelBtn(sys, 'genpanel2', '_userOpenPressed', 500);
                            await _sleep(4000);  // 等两机频率过渡到新平衡
                        } },
                    { type: 'btn', target: 'genpanel2', part: 'btn-stop',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel2', '_userStopPressed', 1200);
                            await _sleep(2000);
                        } },
                ],
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                    // 解列完成：2 号主开关分闸、2 号机停机；1 号机单独带全部负载。
                    // 同时校验两机设定已回归正常位（防止步骤 9 转移负荷残留的极端频差
                    // 使解列后 1 号机显示 52Hz+、2 号机 46Hz——不符合实际）：
                    // 2 号机设定须回 50Hz（空载）；1 号机带载，频率下垂后约 49.2Hz。
                    return sys.comps.qf2.getState() === 'off'
                        && sys.comps.qf1.getState() === 'on'
                        && !g2.isOn && g1.isOn
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：同步发电机 → 主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen1', x: -100, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '1#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    // ── 并车保护数据源：qf1（首台并车，母线无电时保护不参与）→ 数字同步表；
    //    qf2（灯光旋转法并车对象）→ 灯光旋转法并车组件（常显常接线，
    //    相位差/频差始终实时，保证旋转法并车越限时可靠触发全船跳闸）。
    //    相位差保护窗口 [60°, 300°]、频差限值 ±0.5Hz ──
    { Class: MarineMainsSwitch, id: 'qf1', x: -180, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 300, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 2, visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', syncScopeId: 'lampsync1', phaseMin: 60, phaseMax: 300, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, visible: true },
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

    // ── 数字同步表：上=汇流排A相，左=待并机A相(经选择开关)，下=接地；
    //    默认隐藏，由工具栏「同步表」勾选框控制显隐与接线 ──
    { Class: Syncroscope, id: 'sync1', x: 600, y: 170, label: '数字同步表', visible: false },

    // ── 灯光旋转法并车指示器：三灯圆周均布(12/4/8点)，接线与同步表一致，
    //    用于并车时频差和相位差检测（尺寸为同步表的 2/3）──
    { Class: LampRotationSync, id: 'lampsync1', x: 630, y: 190, label: '灯光旋转法并车', visible: true },

    // ── 三相可调负载：置于同步表与2号主开关之间（汇流排第5口直连，N端悬空不接）──
    { Class: ThreePhaseLoad, id: 'load3', x: 950, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 待并机选择开关：单刀四掷（OFF / 待并机1 / 待并机2 / 待并机3）──
    // 档位1=OFF（同步表关闭）、档位2=1号机、档位3=2号机、档位4=3号机（预留）
    { Class: SP4TSwitch, id: 'sync_sel', x: 650, y: 530, label: '同步表选择开关', function: '同步表选择开关', labelNames: ['OFF', '1', '2', '3'], initPosition: 1, animDur: 0.6, visible: true },

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

// 等待同步表选择开关转动动画完成（最多 maxMs）
async function _waitSwitchAnim(sel, maxMs = 3000) {
    const t0 = Date.now();
    while (sel.isAnimating && sel.isAnimating() && Date.now() - t0 < maxMs) await _sleep(30);
}

// 转动调速开关将频率调至目标（迭代微调式）：
// 每次按住旋钮短调一步（指针转到 ±45°，可见转动动作）→ 松开 → 等输出频率收敛 → 再观察修正。
// 目标以输出频率（_freqOut，即面板表计显示值）为准，自动计入带载下垂；步长随剩余误差收缩，避免冲过头。
async function _tuneFreqTo(sys, pid, genId, target, tol = 0.06, maxRounds = 8) {
    const gp = sys.comps[pid], g = sys.comps[genId];
    if (!gp || !g) return;
    const get = () => {
        const f = g._freqOut ?? g.freq;
        return (isFinite(f) && f > 0) ? f : (g.freq || 50);
    };
    for (let r = 0; r < maxRounds; r++) {
        const err = target - get();
        if (Math.abs(err) <= tol) break;                 // 已在目标频率
        // 按住时长与剩余误差成比例（调速速度 0.6Hz/s），短按偏保守
        const holdMs = Math.max(150, Math.min(600, Math.abs(err) * 650));
        gp._userSpdVolt = err > 0 ? 1 : -1;              // 按住旋钮升/降速（指针转到 ±45°）
        await _sleep(holdMs);
        gp._userSpdVolt = 0;                             // 松开旋钮（指针回中）
        await _sleep(700);                               // 等待输出频率向设定收敛（转子二阶惯性）
    }
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
        // ── 灯光旋转法并车指示器：上端三相接汇流排 L1/L2/L3（第3口）；
        //    右侧第1/2/3相端子默认接待并机（2# 发电机）：第1相→L1(u)、
        //    第2相→L3(w)、第3相→L2(v)（B/C 两相交叉，构成旋转法）。
        //    灯与端子按相序位置对应（12/4/8 点灯＝上边与右边的第1/2/3相之间），
        //    使能由同步表选择开关控制，任一灯一端断线该灯熄灭 ──
        { from: 'bus1_wire_l1_3', to: 'lampsync1_wire_busL1', type: 'wire' },
        { from: 'bus1_wire_l2_3', to: 'lampsync1_wire_busL2', type: 'wire' },
        { from: 'bus1_wire_l3_3', to: 'lampsync1_wire_busL3', type: 'wire' },
        { from: 'gen2_wire_u', to: 'lampsync1_wire_genP1', type: 'wire' },
        { from: 'gen2_wire_w', to: 'lampsync1_wire_genP2', type: 'wire' },
        { from: 'gen2_wire_v', to: 'lampsync1_wire_genP3', type: 'wire' },
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
