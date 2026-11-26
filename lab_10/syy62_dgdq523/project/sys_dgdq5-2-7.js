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
    // 储能电机线圈接触不良：储能电机线圈接触电阻增大（约 50 倍），电机电流不足、
    // 无法自动储能 → 主开关合闸弹簧充不上能、无法合闸；手动储能仍可。
    // 万用表测储能电机线圈阻值明显偏大（非断线的 O.L），可与"控制回路断线"区分。
    qf1_motor_poor: {
        id: 'qf1_motor_poor',
        name: '储能电机线圈接触不良',
        system: '1#主开关',
        check() {
            const q = _fcomp('qf1');
            return !!(q && q._faultMotorPoor);
        },
        trigger() {
            const q = _fcomp('qf1');
            if (q && q.setMotorPoorContact) q.setMotorPoorContact(true);
        },
        repair() {
            const q = _fcomp('qf1');
            if (q && q.setMotorPoorContact) q.setMotorPoorContact(false);
        },
    },
    // 失压线圈断线：失压脱扣线圈开路（电阻无穷大），通电无法吸合 →
    // 主开关无法合闸（合闸瞬间被分闸弹簧拉回）；合闸运行中一旦失压线圈失电即跳闸。
    qf1_uv_coil_open: {
        id: 'qf1_uv_coil_open',
        name: '失压线圈断线',
        system: '1#主开关',
        check() {
            const q = _fcomp('qf1');
            return !!(q && q._faultUVCoilOpen);
        },
        trigger() {
            const q = _fcomp('qf1');
            if (q && q.setUvCoilOpen) q.setUvCoilOpen(true);
        },
        repair() {
            const q = _fcomp('qf1');
            if (q && q.setUvCoilOpen) q.setUvCoilOpen(false);
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
    'acb-ops': {
        id: 'acb-ops',
        name: '1. 主开关储能、合闸、分闸',
        steps: [
            {
                msg: '1. 使用储能手柄为储能弹簧储能：请点击主开关储能手柄，连续按压 5 次',
                mode: 'check',
                op: {
                    type: 'btn', target: 'qf1', part: 'handle',
                    async act() {
                        await _sleep(300);
                        const qf = this.sys.comps['qf1'];
                        if (!qf) return;
                        this.sys.showFloatingTip('正在按压储能手柄储能…', 2000);
                        // 手动储能：模拟按压储能手柄5次
                        for (let i = 0; i < 5; i++) {
                            qf._handleDown = true;
                            qf._chargeProg = Math.min(5, qf._chargeProg + 1);
                            qf._charged = qf._chargeProg >= 5;
                            await _sleep(400);
                            qf._handleDown = false;
                            await _sleep(200);
                        }
                    }
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.isCharged();
                },
            },
            {
                msg: '2. 接通储能电机电源，自动储能：观察主开关储能弹簧，接通储能电机（m1/m2）供电自动储能',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'store-spring',
                    async act() {
                        await _sleep(300);
                        // 只接通储能电机供电（dc_uv → m1/m2），不自动接线其余部分
                        await _wireMotor(this.sys);
                        const dc = this.sys.comps['dc_uv'];
                        if (dc) dc.isOn = true;
                        // 起动 1# 发电机（否则合闸后母线无压，主开关欠压保护 2s 后跳闸）
                        const g1 = this.sys.comps['gen1'];
                        if (g1) { g1.freq = 50; g1.isOn = true; }
                        this.sys.showFloatingTip('储能电机电源已单独接通', 1200);
                        await _sleep(800);
                    }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'store-spring',
                        async act() {
                            const qf = this.sys.comps['qf1'];
                            if (!qf) return;
                            this.sys.showFloatingTip('储能电机得电，正在自动储能…', 2500);
                            // 储能电机电源已接通（m1/m2 得电），自动储能至满
                            qf._chargeProg = 0; qf._charged = false;
                            await _sleep(3000);
                        }
                    },
                ],
                check() {
                    // 储能电机端口 m1/m2 有额定电压 → 电机得电自动储能
                    const sys = this.sys;
                    if (!sys || typeof sys.getVoltageBetween !== 'function') return false;
                    const v = sys.getVoltageBetween('qf1_wire_m1', 'qf1_wire_m2');
                    return v !== undefined && isFinite(v) && Math.abs(v) > 18;
                },
            },
            {
                msg: '3. 按下手动合闸按钮，释放储能弹簧能量',
                mode: 'check',
                op: {
                    type: 'btn', target: 'qf1', part: 'btn-close',
                    async act() {
                        await _sleep(300);
                        const sys = this.sys;
                        const dc = sys.comps['dc_uv'];
                        if (dc) dc.isOn = true;
                        const qf = sys.comps['qf1'];
                        if (!qf) return;
                        // 失压线圈有电（脱扣轴正常位）才能合闸成功
                        qf._uvOn = true;
                        qf.tryClose();
                        this.sys.showFloatingTip('储能弹簧能量释放，主轴推动主触头动作', 1500);
                        await _sleep(1000);
                    }
                },
                check() {
                    // 只检查储能释放状态：储能弹簧能量已释放（储能清空）
                    const qf = this.sys.comps['qf1'];
                    return qf && qf._chargeProg < 1;
                },
            },
            {
                msg: '4. 单独接通失压线圈供电，使脱扣轴回归正常位（观察主开关失压脱扣器）',
                mode: 'check',
                op: {
                    type: 'observe', target: 'qf1', part: 'uv-trip',
                    async act() {
                        await _sleep(300);
                        // 单独接通失压线圈供电（dc_uv → uv1/uv2）
                        await _wireUV(this.sys);
                        const dc = this.sys.comps['dc_uv'];
                        if (dc) dc.isOn = true;
                        const qf = this.sys.comps['qf1'];
                        if (!qf) return;
                        qf._uvOn = true;
                        this.sys.showFloatingTip('失压线圈单独得电，脱扣轴回归正常位', 1200);
                        await _sleep(1500);
                    }
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf._uvOn === true;
                },
            },
            {
                msg: '5. 按下手动分闸按钮，观察脱扣轴动作',
                mode: 'check',
                op: {
                    type: 'btn', target: 'qf1', part: 'btn-open',
                    async act() {
                        await _sleep(300);
                        const qf = this.sys.comps['qf1'];
                        if (!qf) return;
                        this.sys.showFloatingTip('按住手动分闸按钮，机械推动脱扣轴…', 1200);
                        // 按住手动分闸按钮：机械推动脱扣轴，保持按住状态
                        qf._tripPressed = true;
                        qf.tryTrip();
                        await _sleep(1500);
                        // 脱扣器动作后松开按钮，使脱扣轴复位
                        qf._tripPressed = false;
                        this.sys.showFloatingTip('已松开按钮，脱扣轴复位', 1000);
                        await _sleep(800);
                    }
                },
                check() {
                    // 分闸完成且按钮已释放
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'off' && qf._tripPressed === false;
                },
            },
            {
                msg: '6. 先接通分励线圈供电，再按 1# 遥控面板「分闸」按钮，观察脱扣轴动作',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'shunt-coil',
                        async act() {
                            await _sleep(300);
                            // 先接通分励线圈供电（经 1# 遥控面板分闸按钮常开触头）
                            await _wireFL(this.sys);
                            const dc = this.sys.comps['dc_uv'];
                            if (dc) dc.isOn = true;
                            this.sys.showFloatingTip('分励线圈电源已接通', 1000);
                            await _sleep(800);
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-open',
                        async act() {
                            const sys = this.sys;
                            // 按下 1# 遥控面板"分闸"按钮 → 分励线圈得电脱扣
                            await _pressPanelBtn(sys, 'genpanel', '_userOpenPressed', 2500);
                            this.sys.showFloatingTip('分励线圈得电，脱扣轴转动分闸', 1500);
                            await _sleep(500);
                        }
                    },
                ],
                check() {
                    // 分励线圈端口 fla/flb 得电（按下 1# 遥控面板分闸按钮接通分励脱扣器电源）才通过
                    const sys = this.sys;
                    if (!sys || typeof sys.getVoltageBetween !== 'function') return false;
                    const v = sys.getVoltageBetween('qf1_wire_fla', 'qf1_wire_flb');
                    return v !== undefined && isFinite(v) && Math.abs(v) > 18;
                },
            },
            {
                msg: '7. 按下手动合闸按钮，观察合闸过程',
                mode: 'check',
                op: {
                    type: 'btn', target: 'qf1', part: 'btn-close',
                    async act() {
                        await _sleep(300);
                        const dc = this.sys.comps['dc_uv'];
                        if (dc) dc.isOn = true;
                        const qf = this.sys.comps['qf1'];
                        if (!qf) return;
                        if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
                        qf._uvOn = true;
                        qf.tryClose();
                        this.sys.showFloatingTip('合闸完成：主触头闭合，主开关合闸', 1500);
                        await _sleep(2000);
                    }
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'on';
                },
            },
            {
                msg: '8. 按下手动分闸按钮，观察分闸过程',
                mode: 'check',
                op: {
                    type: 'btn', target: 'qf1', part: 'btn-open',
                    async act() {
                        await _sleep(300);
                        const qf = this.sys.comps['qf1'];
                        if (!qf) return;
                        this.sys.showFloatingTip('分闸弹簧释放能量，动触头与静触头分离', 1500);
                        qf._tripPressed = true;
                        qf.tryTrip();
                        await _sleep(1500);
                        qf._tripPressed = false;
                        await _sleep(500);
                    }
                },
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'off';
                },
            },
            {
                msg: '9. 先接通合闸线圈回路供电，再按 1# 遥控面板「合闸」按钮，观察合闸过程',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'qf1', part: 'close-coil',
                        async act() {
                            await _sleep(300);
                            // 先接通合闸线圈回路供电（经 1# 遥控面板合闸按钮常开触头）
                            await _wireClose(this.sys);
                            const dc = this.sys.comps['dc_uv'];
                            if (dc) dc.isOn = true;
                            this.sys.showFloatingTip('合闸线圈回路供电已接通', 1200);
                            await _sleep(800);
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        async act() {
                            const sys = this.sys;
                            const qf = sys.comps['qf1'];
                            if (!qf) return;
                            if (!qf.isCharged()) { qf._chargeProg = 5; qf._charged = true; }
                            qf._uvOn = true;
                            // 按下 1# 遥控面板"合闸"按钮 → 合闸线圈得电自动合闸
                            await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 2500);
                            this.sys.showFloatingTip('合闸线圈得电，释放储能弹簧锁扣，主开关合闸', 1500);
                            await _sleep(500);
                        }
                    },
                ],
                check() {
                    const qf = this.sys.comps['qf1'];
                    return qf && qf.getState() === 'on';
                },
            },
            {
                msg: '10. 测试题：合闸线圈的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '框架式空气断路器中合闸线圈的作用是什么？',
                    options: [
                        '得电后释放储能弹簧的锁扣，使储能弹簧能量推动主轴合闸',
                        '分闸时拉动主轴与动触头分离',
                        '为储能电机提供工作电源',
                        '检测主回路的电流并发出跳闸信号',
                    ],
                    answer: 0,
                    analysis: '合闸线圈得电吸合后，释放储能弹簧的锁扣，储能弹簧储存的能量通过主轴推动三对动触头与静触头闭合，完成合闸。',
                },
            },
        ],
    },
    // ══════════════════════════════════════════════════════════════════════
    //  2. 主开关合不上闸的判断（储能电机回路不得电）
    //     · 故障：储能电机线圈接触不良 → 储能电机回路实际不得电（电流不足，线圈
    //       得电但不足以驱动电机）→ 不能自动储能 → 合闸弹簧充不上能 → 主开关合不上闸。
    //     · 手动储能仍有效（本流程不涉及），用于与"储能弹簧无法储能"区分。
    //     · 判断方法：看储能指示 → 按合闸按钮不动作 → 万用表测储能电机线圈电阻
    //       （先断控制电源、再断开电机与 24V 正极接线后测，约 10kΩ 明显偏大、2kΩ 档显示 O.L；
    //        正常约 0.2kΩ）→ 判定储能电机线圈接触不良/回路不得电。
    // ══════════════════════════════════════════════════════════════════════
    'no-close-motor-circuit': {
        id: 'no-close-motor-circuit',
        name: '2. 主开关合不上闸的判断（储能电机回路不得电）',
        steps: [
            // ── 步骤 1：设置故障并释放残余储能，使主开关处于"未储能、分闸"初始态 ──
            {
                msg: '第 1 步：打开「故障设置」界面，勾选「储能电机线圈接触不良」并应用',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'qf1_motor_poor',
                        msg: '打开「故障设置」界面，勾选「储能电机线圈接触不良」，点击「应用设置」'
                    },
                ],
                check() {
                    const q = this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q._faultMotorPoor && !q.isCharged() && q.getState() !== 'on');
                },
            },
            // ── 步骤 2：自动接线复位、起动 1# 机，观察储能指示牌始终未储能 ──
            {
                msg: '第 2 步：自动接线并复位系统，按住 1# 遥控面板「起动」按钮起动 1# 发电机；观察储能指示牌始终显示未储能',
                mode: 'check',
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏"自动接线"按钮完成接线，并把系统复位到初始状态（分闸、未储能、控制电源接通）',
                        async act() {
                            const sys = this.sys;
                            _autoWire(sys);
                            await _sleep(400);
                            _resetNoCloseRig(sys);
                            await _sleep(400);
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-start',
                        msg: '按住 1# 发电机组遥控面板"起动"按钮，起动 1# 发电机，等待储能电机储能（约 3s）',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                            await _sleep(3000); // 给储能电机足够时间"尝试"储能（回路不得电，无效）
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'store-ind',
                        msg: '观察储能指示牌：储能电机回路不得电、电机不转，储能弹簧无法储能（指示牌带红色斜线）',
                        async act() {
                            const q = _fcomp('qf1');
                            this._tipWorkflow(q && q.isCharged()
                                ? '储能指示牌显示已储能（异常，需先释放储能再观察）' : '储能指示牌显示未储能 → 储能机构未动作', 3000);
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1 && g1.isOn && !!q1 && !q1.isCharged();
                },
            },
            // ── 步骤 3：按合闸按钮，观察合不上闸（未储能） ──
            {
                msg: '第 3 步：按住 1# 遥控面板「合闸」按钮，观察主开关合不上闸，初步判断为储能回路不得电',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '按住 1# 遥控面板"合闸"按钮，因储能未到位，主开关无法合闸',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 800);
                            await _sleep(1200);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '观察 1# 主开关：主触头保持分闸位（合闸失败）→ 判断为储能电机回路不得电（未储能所致）',
                        async act() {
                            const q = _fcomp('qf1');
                            this._tipWorkflow(q && q.getState() === 'on'
                                ? '主开关已合闸（异常）' : '主开关仍分闸 → 合闸失败，疑因储能未到位', 3000);
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const q1 = sys.comps && sys.comps.qf1;
                    const gp = sys.comps && sys.comps.genpanel;
                    if (!q1 || !gp) return false;
                    // 记录本步首次检测时 1# 遥控面板"合闸"按压次数的基线，
                    // 确保"合闸按钮被按下过"发生在本步（而不是之前流程/步骤遗留）
                    this._projFlag = this._projFlag || {};
                    if (this._projFlag.s3CloseBase === undefined) {
                        this._projFlag.s3CloseBase = gp._closeAttempts || 0;
                    }
                    const pressed = (gp._closeAttempts || 0) > this._projFlag.s3CloseBase;
                    // 必须同时满足：① 已按下 1# 遥控面板合闸按钮；② 主开关仍未合闸（合不上闸）
                    return pressed && q1.getState() !== 'on';
                },
            },
            // ── 步骤 4：万用表测储能电机线圈电阻（诊断） ──
            {
                msg: '第 4 步：调出数字万用表，旋至 2kΩ 电阻档；先切断控制电源、再断开储能电机与 24V 正极的接线，然后测量储能电机线圈两端电阻，读数明显偏大（超量程显示 O.L）→ 判断线圈接触不良、回路不得电',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '点击工具栏"选择仪表"，勾选并显示数字万用表',
                    },
                    {
                        type: 'knob', target: 'multimeter',
                        msg: '将万用表旋至 2kΩ 电阻档',
                        async act() {
                            await _setMultimeterRes(this.sys);
                            this._tipWorkflow('万用表已旋至 2kΩ 电阻档', 1500);
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'btn', target: 'dc_uv', part: 'power',
                        msg: '按下控制电源「电源键」切断 24V 控制电源（带电测电阻不准确，须先断电）',
                        async act() {
                            _setDcPower(this.sys, 'dc_uv', false);
                            this._tipWorkflow('控制电源已切断，可安全测量线圈电阻', 1800);
                            await _sleep(900);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', ports: ['qf1_wire_m1'],
                        msg: '断开储能电机与 24V 正极（dc_uv_p）的接线，排除其他并联回路对测量的影响',
                        async act() {
                            _disconnectPort(this.sys, 'qf1_wire_m1');
                            this._tipWorkflow('已断开储能电机与 24V 正极的接线，可单独测量电机线圈', 1800);
                            await _sleep(800);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1',
                        ports: ['multimeter_wire_v', 'qf1_wire_m1', 'multimeter_wire_com', 'qf1_wire_m2'],
                        msg: '红表笔接储能电机线圈 m1、黑表笔接 m2，测量线圈电阻',
                        async act() {
                            const sys = this.sys;
                            await _wireMotorProbe(sys);
                            await _sleep(1200);
                            const mm = sys.comps.multimeter;
                            const v = mm ? mm.value : NaN;
                            if (isFinite(v) && v >= 2000) {
                                this._tipWorkflow(`储能电机线圈实测电阻约 ${(v / 1000).toFixed(1)}kΩ，超出 2kΩ 档量程（显示 O.L），远大于正常约 0.2kΩ → 线圈接触不良、回路不得电`, 4000);
                            } else if (isFinite(v)) {
                                this._tipWorkflow(`储能电机线圈实测电阻约 ${(v / 1000).toFixed(2)}kΩ（正常约 0.2kΩ）`, 3000);
                            } else {
                                this._tipWorkflow('储能电机线圈实测电阻超量程（O.L）', 3000);
                            }
                            await _sleep(2000);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps.multimeter;
                    const qf = sys.comps.qf1;
                    if (!mm || !qf) return false;
                    // ① 必须调出数字万用表
                    if (!(mm.group && mm.group.visible())) return false;
                    // ② 必须旋至电阻档
                    if (!(mm.mode && mm.mode.startsWith('RES'))) return false;
                    // ③ 必须将红黑表笔接到储能电机线圈两端（V/COM ↔ m1/m2）
                    const vs = sys.voltageSolver;
                    if (!vs || !vs.portToCluster) return false;
                    const mv = vs.portToCluster.get('multimeter_wire_v');
                    const mc = vs.portToCluster.get('multimeter_wire_com');
                    const m1 = vs.portToCluster.get('qf1_wire_m1');
                    const m2 = vs.portToCluster.get('qf1_wire_m2');
                    if (mv === undefined || mc === undefined || m1 === undefined || m2 === undefined) return false;
                    const connected = (mv === m1 && mc === m2) || (mv === m2 && mc === m1);
                    if (!connected) return false;
                    // ④ 必须已读到有效测量值
                    return typeof mm.value === 'number' && isFinite(mm.value);
                },
            },
            // ── 步骤 5：收起万用表、恢复控制电源、修复故障 ──
            {
                msg: '第 5 步：收起万用表，恢复储能电机与 24V 正极的接线并恢复 24V 控制电源；在「故障设置」界面取消勾选「储能电机线圈接触不良」并应用，修复故障',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'store-spring',
                        msg: '移除万用表表笔接线并收起数字万用表',
                        async act() {
                            const sys = this.sys;
                            _disconnectPort(sys, 'multimeter_wire_v');
                            _disconnectPort(sys, 'multimeter_wire_com');
                            await _sleep(600);
                            const mm = sys.comps.multimeter;
                            if (mm && mm.group && mm.group.visible()) sys.toggleInstrumentVisibility('multimeter', false);
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', ports: ['qf1_wire_m1'],
                        msg: '恢复储能电机与 24V 正极的接线（测量完毕，复原电路）',
                        async act() {
                            const sys = this.sys;
                            const has = sys.conns.some(c => (c.from === 'dc_uv_wire_p' && c.to === 'qf1_wire_m1') || (c.from === 'qf1_wire_m1' && c.to === 'dc_uv_wire_p'));
                            if (!has) sys.connMgr.addConn({ from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' });
                            sys.redrawAll();
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'btn', target: 'dc_uv', part: 'power',
                        msg: '再次按下控制电源「电源键」恢复 24V 控制电源（为失压线圈供电）',
                        async act() {
                            _setDcPower(this.sys, 'dc_uv', true);
                            await _sleep(900);
                        }
                    },
                    {
                        type: 'fault', fault: 'qf1_motor_poor', repair: true,
                        msg: '打开「故障设置」界面，取消勾选「储能电机线圈接触不良」，点击「应用设置」修复故障'
                    },
                ],
                check() {
                    const sys = this.sys;
                    const q = sys.comps.qf1, dc = sys.comps.dc_uv, mm = sys.comps.multimeter;
                    if (!q || !dc || !dc.isOn) return false;
                    if (q._faultMotorPoor) return false;
                    // 储能电机与 24V 正极的接线应已恢复
                    const motorPlus = sys.conns.some(c => (c.from === 'dc_uv_wire_p' && c.to === 'qf1_wire_m1') || (c.from === 'qf1_wire_m1' && c.to === 'dc_uv_wire_p'));
                    if (!motorPlus) return false;
                    // 表笔应已拆除
                    const probesOn = sys.conns.some(c => c.type === 'wire'
                        && (c.from === 'multimeter_wire_v' || c.to === 'multimeter_wire_v'
                            || c.from === 'multimeter_wire_com' || c.to === 'multimeter_wire_com'));
                    if (probesOn) return false;
                    if (mm && mm.group && mm.group.visible()) return false;
                    return true;
                },
            },
            // ── 步骤 6：储能到位后合闸成功 ──
            {
                msg: '第 6 步：故障排除后储能电机自动储能到位，按住 1# 遥控面板「合闸」按钮，主开关合闸成功向汇流排供电',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'store-ind',
                        msg: '观察储能指示牌：故障排除后储能电机回路恢复得电，自动储能到位（红色斜线消失）',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf1'); return !q || q.isCharged(); }, 10000);
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '储能到位后按住 1# 遥控面板"合闸"按钮，主开关合闸成功',
                        async act() {
                            const sys = this.sys;
                            await _closeQf(sys, 'genpanel', 'qf1');
                            await _sleep(1500);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '观察主开关：主触头合闸到位、向汇流排供电，故障已排除、恢复供电',
                        async act() {
                            const q = _fcomp('qf1');
                            this._tipWorkflow(q && q.getState() === 'on' ? '主开关已合闸，恢复供电' : '主开关仍未合闸', 2500);
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const q1 = this.sys.comps && this.sys.comps.qf1;
                    return !!q1 && q1.isCharged() && q1.getState() === 'on';
                },
            },
            // ── 步骤 7：测试题 ──
            {
                msg: '第 7 步：测试题——主开关合不上闸（储能电机回路不得电）的判断与处理',
                mode: 'quiz',
                quizConfig: {
                    question: '1# 发电机已运行，按下遥控合闸按钮主开关却不动作，检查储能指示牌显示未储能。下列判断与处理正确的是？',
                    options: [
                        '先判断储能是否到位：未储能则检查储能电机回路（控制电源、接线、电机线圈）。本案例为线圈接触不良致回路不得电，可断电用万用表测线圈电阻（明显偏大于正常 0.2kΩ），排除后储能到位再合闸',
                        '合不上闸一定是失压脱扣器故障，直接更换失压线圈即可',
                        '反复多次按合闸按钮，直到储能弹簧自行充满能量后合闸',
                        '立即增大控制电源电压，强行让储能电机转动储能',
                    ],
                    answer: 0,
                    analysis: '主开关合不上闸时应先看储能指示：储能未到位则合闸弹簧无能量，开关不可能合上。储能回路由控制电源、接线和储能电机（线圈）组成，任一环节"不得电"都会导致电机不能自动储能。可用万用表在断电状态下测量储能电机线圈两端电阻（注意储能电机线圈与失压线圈共用 24V 正端与接地，测量前须先切断控制电源并断开电机与 24V 正极的接线以隔离并联回路）：正常约 0.2kΩ，接触不良时明显偏大（本案例约 10kΩ，2kΩ 档超量程显示 O.L），断线则为无穷大（O.L）。查明并排除（修复线圈/接线）后储能恢复，即可正常合闸。',
                },
            },
        ],
    },
    // ══════════════════════════════════════════════════════════════════════
    //  3. 主开关合不上闸的判断（失压线圈断线）
    //     · 故障：失压线圈断线 → 失压脱扣器通电无法吸合、脱扣轴停在脱扣位 →
    //       即使储能到位、合闸弹簧释放能量，主开关也合不上闸。
    //     · 与流程1区分：储能电机回路正常，储能能到位（合不上闸另有原因）。
    //     · 判断方法：看储能（已储能）→ 按合闸按钮"储能释放却不合闸"→ 查失压脱扣器
    //       （控制电源已通，衔铁却不吸合）→ 万用表测失压线圈电阻（先断开储能电机
    //       接线以排除并联影响：正常约 2kΩ，断线为 O.L）→ 判定失压线圈断线。
    // ══════════════════════════════════════════════════════════════════════
    'no-close-uv-open': {
        id: 'no-close-uv-open',
        name: '3. 主开关合不上闸的判断（失压线圈断线）',
        steps: [
            // ── 步骤 1：设置故障（走故障界面） ──
            {
                msg: '第 1 步：打开「故障设置」界面，勾选「失压线圈断线」并应用',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'qf1_uv_coil_open',
                        msg: '打开「故障设置」界面，勾选「失压线圈断线」，点击「应用设置」'
                    },
                ],
                check() {
                    const q = this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q._faultUVCoilOpen);
                },
            },
            // ── 步骤 2：自动接线复位、起动 1# 机，观察储能正常到位 ──
            {
                msg: '第 2 步：自动接线并复位系统，按住 1# 遥控面板「起动」按钮起动 1# 发电机；观察储能指示牌显示已储能（储能电机回路正常）',
                mode: 'check',
                op: [
                    {
                        type: 'wire',
                        msg: '点击工具栏"自动接线"按钮完成接线，并把系统复位到初始状态（分闸、未储能、控制电源接通）',
                        async act() {
                            const sys = this.sys;
                            _autoWire(sys);
                            await _sleep(400);
                            _resetNoCloseRig(sys);
                            await _sleep(400);
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-start',
                        msg: '按住 1# 发电机组遥控面板"起动"按钮，起动 1# 发电机，等待储能电机储能（约 3s）',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                            await _sleep(3000);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'store-ind',
                        msg: '观察储能指示牌：储能电机回路正常，合闸弹簧已储能到位（红色斜线消失）',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf1'); return !q || q.isCharged(); }, 8000);
                            this._tipWorkflow('储能指示牌显示已储能 → 储能回路正常，合不上闸另有原因', 3000);
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1 && g1.isOn && !!q1 && q1.isCharged();
                },
            },
            // ── 步骤 3：按合闸按钮 → 储能释放却不合闸；查失压脱扣器 ──
            {
                msg: '第 3 步：按住 1# 遥控面板「合闸」按钮，观察储能弹簧释放（储能指示牌恢复未储能）但主开关合不上闸；再观察失压脱扣器：控制电源已通、衔铁却不吸合 → 判断失压脱扣回路故障',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '按住 1# 遥控面板"合闸"按钮：合闸弹簧释放能量，但脱扣轴停在脱扣位，主开关合不上闸',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 800);
                            await _sleep(1500);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '观察 1# 主开关：储能已释放，但主触头仍保持分闸位（合闸失败）',
                        async act() {
                            const q = _fcomp('qf1');
                            this._tipWorkflow(q && q.getState() === 'on'
                                ? '主开关已合闸（异常）' : '主开关仍分闸 → 合闸机构已动作却合不上，疑脱扣回路故障', 3000);
                            await _sleep(1200);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'uv-trip',
                        msg: '观察失压脱扣器：控制电源已接通，动衔铁却未被吸合、杠杆停在脱扣位 → 失压线圈回路未得电（断线）',
                        async act() {
                            const q = _fcomp('qf1');
                            this._tipWorkflow(q && q._uvOn
                                ? '失压脱扣器已吸合（异常）' : '失压脱扣器未吸合 → 失压线圈未得电/断线', 3000);
                            await _sleep(1500);
                        }
                    },
                ],
                async check() {
                    const sys = this.sys;
                    const q1 = sys.comps && sys.comps.qf1;
                    const gp = sys.comps && sys.comps.genpanel;
                    if (!q1 || !gp) return false;
                    this._projFlag = this._projFlag || {};
                    // 记录本步首次检测时 1# 遥控面板"合闸"按压次数的基线，
                    // 确保是"本步按下过"合闸按钮（而非其它步骤/流程遗留）
                    if (this._projFlag.s3uvCloseBase === undefined) {
                        this._projFlag.s3uvCloseBase = gp._closeAttempts || 0;
                    }
                    const pressed = (gp._closeAttempts || 0) > this._projFlag.s3uvCloseBase;
                    if (!pressed) return false;   // 尚未按下合闸按钮 → 不通过
                    // 检测到合闸按钮按下后，延时 3s 让合闸过程完成，再判定主开关是否合闸
                    if (!this._projFlag.s3uvDelayDone) {
                        await new Promise(r => setTimeout(r, 3000));
                        this._projFlag.s3uvDelayDone = true;
                    }
                    // 合闸过程完成仍未合闸（主开关分闸）→ 通过
                    return q1.getState() !== 'on';
                },
            },
            // ── 步骤 4：万用表测失压线圈电阻（隔离储能电机）→ O.L ──
            {
                msg: '第 4 步：调出数字万用表，旋至 2kΩ 电阻档；切断控制电源并断开储能电机接线（排除其与失压线圈并联对测量的影响）；测失压线圈两端电阻为 O.L（超量程）→ 判定失压线圈断线',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter',
                        msg: '点击工具栏"选择仪表"，勾选并显示数字万用表',
                    },
                    {
                        type: 'knob', target: 'multimeter',
                        msg: '将万用表旋至 2kΩ 电阻档',
                        async act() {
                            await _setMultimeterRes(this.sys);
                            this._tipWorkflow('万用表已旋至 2kΩ 电阻档', 1500);
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'btn', target: 'dc_uv', part: 'power',
                        msg: '按下控制电源「电源键」切断 24V 控制电源（测电阻须断电）',
                        async act() {
                            _setDcPower(this.sys, 'dc_uv', false);
                            this._tipWorkflow('控制电源已切断，可安全测量线圈电阻', 1800);
                            await _sleep(900);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', ports: ['qf1_wire_m1'],
                        msg: '断开储能电机 m1 接线，排除其与失压线圈并联对测量结果的影响',
                        async act() {
                            _disconnectPort(this.sys, 'qf1_wire_m1');
                            this._tipWorkflow('已断开储能电机接线，可单独测量失压线圈', 1800);
                            await _sleep(800);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1',
                        ports: ['multimeter_wire_v', 'qf1_wire_uv1', 'multimeter_wire_com', 'qf1_wire_uv2'],
                        msg: '红表笔接失压线圈 uv1、黑表笔接 uv2，测量失压线圈电阻',
                        async act() {
                            const sys = this.sys;
                            await _wireUvProbe(sys);
                            await _sleep(1200);
                            const mm = sys.comps.multimeter;
                            const v = mm ? mm.value : NaN;
                            if (isFinite(v) && v >= 2e6) {
                                this._tipWorkflow('失压线圈实测电阻超量程（O.L，无穷大）→ 失压线圈断线', 4000);
                            } else if (isFinite(v)) {
                                this._tipWorkflow(`失压线圈实测电阻约 ${(v / 1000).toFixed(2)}kΩ（正常约 2kΩ）`, 3000);
                            } else {
                                this._tipWorkflow('失压线圈实测电阻超量程（O.L）', 3000);
                            }
                            await _sleep(2000);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const mm = sys.comps.multimeter;
                    const qf = sys.comps.qf1;
                    if (!mm || !qf) return false;
                    if (!(mm.group && mm.group.visible())) return false;
                    if (!(mm.mode && mm.mode.startsWith('RES'))) return false;
                    const vs = sys.voltageSolver;
                    if (!vs || !vs.portToCluster) return false;
                    const mv = vs.portToCluster.get('multimeter_wire_v');
                    const mc = vs.portToCluster.get('multimeter_wire_com');
                    const u1 = vs.portToCluster.get('qf1_wire_uv1');
                    const u2 = vs.portToCluster.get('qf1_wire_uv2');
                    if (mv === undefined || mc === undefined || u1 === undefined || u2 === undefined) return false;
                    const connected = (mv === u1 && mc === u2) || (mv === u2 && mc === u1);
                    if (!connected) return false;
                    return typeof mm.value === 'number' && isFinite(mm.value);
                },
            },
            // ── 步骤 5：收起万用表、恢复电机接线与控制电源、修复故障 ──
            {
                msg: '第 5 步：收起万用表并恢复储能电机接线与 24V 控制电源；在「故障设置」界面取消勾选「失压线圈断线」并应用，修复故障',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'uv-trip',
                        msg: '移除万用表表笔接线并收起数字万用表',
                        async act() {
                            const sys = this.sys;
                            _disconnectPort(sys, 'multimeter_wire_v');
                            _disconnectPort(sys, 'multimeter_wire_com');
                            await _sleep(600);
                            const mm = sys.comps.multimeter;
                            if (mm && mm.group && mm.group.visible()) sys.toggleInstrumentVisibility('multimeter', false);
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', ports: ['qf1_wire_m1'],
                        msg: '恢复储能电机 m1 接线（测量完毕，复原电路）',
                        async act() {
                            const sys = this.sys;
                            const has = sys.conns.some(c => (c.from === 'dc_uv_wire_p' && c.to === 'qf1_wire_m1') || (c.from === 'qf1_wire_m1' && c.to === 'dc_uv_wire_p'));
                            if (!has) sys.connMgr.addConn({ from: 'dc_uv_wire_p', to: 'qf1_wire_m1', type: 'wire' });
                            sys.redrawAll();
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'btn', target: 'dc_uv', part: 'power',
                        msg: '再次按下控制电源「电源键」恢复 24V 控制电源（为失压线圈供电）',
                        async act() {
                            _setDcPower(this.sys, 'dc_uv', true);
                            await _sleep(900);
                        }
                    },
                    {
                        type: 'fault', fault: 'qf1_uv_coil_open', repair: true,
                        msg: '打开「故障设置」界面，取消勾选「失压线圈断线」，点击「应用设置」修复故障'
                    },
                ],
                check() {
                    const sys = this.sys;
                    const q = sys.comps.qf1, dc = sys.comps.dc_uv, mm = sys.comps.multimeter;
                    if (!q || !dc || !dc.isOn) return false;
                    if (q._faultUVCoilOpen) return false;
                    const probesOn = sys.conns.some(c => c.type === 'wire'
                        && (c.from === 'multimeter_wire_v' || c.to === 'multimeter_wire_v'
                            || c.from === 'multimeter_wire_com' || c.to === 'multimeter_wire_com'));
                    if (probesOn) return false;
                    const motorWire = sys.conns.some(c => (c.from === 'dc_uv_wire_p' && c.to === 'qf1_wire_m1') || (c.from === 'qf1_wire_m1' && c.to === 'dc_uv_wire_p'));
                    if (!motorWire) return false;
                    if (mm && mm.group && mm.group.visible()) return false;
                    return true;
                },
            },
            // ── 步骤 6：修复后失压吸合、储能到位、合闸成功 ──
            {
                msg: '第 6 步：故障排除后失压脱扣器恢复吸合、储能到位，按住 1# 遥控面板「合闸」按钮，主开关合闸成功向汇流排供电',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'qf1', part: 'uv-trip',
                        msg: '观察失压脱扣器：修复后线圈恢复得电、动衔铁吸合（杠杆复位）',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf1'); return !q || q._uvOn; }, 8000);
                            this._tipWorkflow('失压脱扣器已吸合复位', 2000);
                            await _sleep(800);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'store-ind',
                        msg: '观察储能指示牌：储能电机自动储能到位（红色斜线消失）',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf1'); return !q || q.isCharged(); }, 8000);
                            await _sleep(600);
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '储能到位后按住 1# 遥控面板"合闸"按钮，主开关合闸成功',
                        async act() {
                            const sys = this.sys;
                            await _closeQf(sys, 'genpanel', 'qf1');
                            await _sleep(1500);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '观察主开关：主触头合闸到位、向汇流排供电，故障已排除、恢复供电',
                        async act() {
                            const q = _fcomp('qf1');
                            this._tipWorkflow(q && q.getState() === 'on' ? '主开关已合闸，恢复供电' : '主开关仍未合闸', 2500);
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const q1 = this.sys.comps && this.sys.comps.qf1;
                    return !!q1 && q1._uvOn && q1.isCharged() && q1.getState() === 'on';
                },
            },
            // ── 步骤 7：测试题 ──
            {
                msg: '第 7 步：测试题——主开关合不上闸（失压线圈断线）的判断与处理',
                mode: 'quiz',
                quizConfig: {
                    question: '1# 发电机已运行、储能指示牌显示已储能，但按下遥控合闸按钮时合闸弹簧释放、主开关却不合闸。下列判断与处理正确的是？',
                    options: [
                        '储能已到位说明储能回路正常，问题在脱扣回路：失压脱扣器未吸合、脱扣轴停在脱扣位。检查控制电源与失压线圈，本案例为线圈断线，断开储能电机接线后测失压线圈电阻为 O.L（正常约 2kΩ），修复后即可合闸',
                        '储能不能合闸，直接更换储能电机即可',
                        '合不上闸是控制电源电压太低，升高控制电压即可',
                        '反复按合闸按钮，等脱扣轴自行复位后就能合上',
                    ],
                    answer: 0,
                    analysis: '主开关合闸必须同时满足"储能到位"和"失压脱扣器吸合（脱扣轴复位）"两个条件。储能到位说明储能回路正常，故障在脱扣回路：失压线圈断线后失压脱扣器无法吸合，脱扣轴停在脱扣位，合闸弹簧虽释放能量却无法保持合闸。判断时先看储能是否到位，再观察失压脱扣器衔铁是否吸合，最后用万用表测失压线圈电阻（正常约 2kΩ，断线为 O.L）。注意失压线圈与储能电机线圈常并联接在控制电源两端，测量时应先断开储能电机接线以排除并联影响。',
                },
            },
        ],
    },
    'mech-trip-recovery': {
        id: 'mech-trip-recovery',
        name: '4. 冷却水温高导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                op: [
                    {
                        type: 'wire', msg: '点击工具栏"自动接线"按钮完成全船电网接线，并将系统复位到初始状态',
                        async act() {
                            const sys = this.sys;
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
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-start',
                        msg: '按住 1# 发电机组遥控面板"起动"按钮，起动 1# 发电机，随后等待合闸弹簧储能（约 3s）',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                            await _sleep(3000); // 等待储能
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '储能到位后按住 1# 遥控面板"合闸"按钮，1# 主开关合闸向汇流排供电',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    return !!g1 && g1.isOn && !!q1 && q1.getState() === 'on';
                },
            },
            // ── 步骤 2：设置 1# 机冷却水温高故障，观察停机、跳闸 ──
            {
                msg: '第 2 步：打开故障面板，设置「1#机冷却水温高故障」，观察 1# 机原动机保护停机、主开关跳闸',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'gen1_coolant_temp',
                        msg: '打开故障设置面板，勾选"1#机冷却水温高故障"并应用'
                    },
                    {
                        type: 'observe', target: 'gen1',
                        msg: '观察 1# 同步发电机：冷却水温高保护动作，单机运行原动机立即停机',
                        async act() {
                            await _waitUntil(() => { const g = _fcomp('gen1'); return !g || !g.isOn; }, 10000);
                            await _sleep(500);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '观察 1# 主开关：发电机停机后母线失压，失压脱扣动作跳闸、全船失电',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf1'); return !q || q.getState() === 'off'; }, 15000);
                            await _sleep(500);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const g1 = sys.comps.gen1, q1 = sys.comps.qf1;
                    if (!g1 || !q1) return false;
                    // 检查发电机已停机且主开关已跳闸
                    if (g1.isOn || q1.getState() !== 'off') return false;
                    // 检查 1# 机冷却水温高故障已触发
                    const f = g1.getEngineFaults();
                    return !!f.coolantTemp;
                },
            },
            // ── 步骤 3：起动 2# 机组，合闸供电 ──
            {
                msg: '第 3 步：起动 2# 机组，合闸恢复供电',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-start',
                        msg: '按住 2# 发电机组遥控面板"起动"按钮，起动 2# 发电机，等待合闸弹簧储能（约 3s）',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                            await _sleep(3000); // 等待储能
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-close',
                        msg: '储能到位后按住 2# 遥控面板"合闸"按钮，2# 主开关合闸恢复供电',
                        async act() {
                            const sys = this.sys;
                            await _closeQf(sys, 'genpanel2', 'qf2');
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    const g2 = sys.comps.gen2, q2 = sys.comps.qf2;
                    return !!g2 && g2.isOn && !!q2 && q2.getState() === 'on';
                },
            },
            // ── 步骤 4：测试题——全船失电处理 ──
            {
                msg: '第 4 步：测试题——冷却水温高导致主开关跳闸、全船失电的处理措施',
                mode: 'quiz',
                quizConfig: {
                    question: '1# 发电机运行时突发冷却水温高故障，原动机保护动作停机，主开关跳闸导致全船失电（黑船）。下列处理原则正确的是？',
                    options: [
                        '首先：起动备用发电机组恢复供电、接通重要负载；后续：查明并排除冷却水温高的原因（如冷却水泵故障、管路堵塞、水量不足等）',
                        '首先：立即手动强行合闸恢复供电；后续：等水温自行下降后再检查',
                        '首先：等待电网自动恢复；后续：关闭所有负载以减轻电网负担',
                        '首先：直接复位 1# 机冷却水温高故障并重新起动 1# 机合闸，无需检查冷却系统',
                    ],
                    answer: 0,
                    analysis: '冷却水温高属原动机保护性故障：单机运行时保护动作使原动机立即停机，母线失压、主开关失压跳闸、全船失电。应急处理首先应起动备用发电机组恢复供电并接通重要负载，保障船舶安全；随后查明并排除水温高的根本原因（冷却水泵、海水/淡水管路、热交换器、水量等），故障消除、冷却系统恢复正常后方可重新起动 1# 机组并车供电。故障未排除前强行复位重新起动，会因原动机保护再次停机，甚至损坏设备。',
                },
            },
        ],
    },

    'overload-trip-recovery': {
        id: 'overload-trip-recovery',
        name: '5.过载故障导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                op: [
                    {
                        type: 'wire', msg: '点击工具栏"自动接线"按钮完成全船电网接线，并将系统复位到初始状态',
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
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-start',
                        msg: '按住 1# 发电机组遥控面板"起动"按钮，起动 1# 发电机，等待合闸弹簧储能（约 3s）',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                            await _sleep(3000);
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '储能到位后按住 1# 遥控面板"合闸"按钮，1# 主开关合闸向汇流排供电',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                            await _sleep(1500);
                        }
                    },
                ],
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
                op: [
                    {
                        type: 'load', target: 'load3', part: 'power',
                        msg: '点击"三相可调负载"功率输入框，将有功功率从 20kW 改为 70kW',
                        async act() {
                            const load = this.sys.comps.load3;
                            if (!load) return;
                            // 与功率输入框内联编辑确认等效：改设定值并刷新显示
                            load.powerKw = 70;
                            load._recalcLoad();
                            if (load._ui && load._ui.power) load._ui.power.text('70');
                            if (load.config) load.config.powerKw = 70;
                            load._touchDirty();
                            await _sleep(800);
                        }
                    },
                    {
                        type: 'load', target: 'load3', part: 'btn-load',
                        msg: '再按"加载"按钮投入负载，70kW 全部加到电网（1# 机额定 80kW，重负荷运行）',
                        async act() {
                            const load = this.sys.comps.load3;
                            if (!load) return;
                            // 与"加载"按钮点击处理等效：置加载状态并刷新 LCD
                            load._loaded = true;
                            if (load.config) load.config.loaded = true;
                            if (typeof load._refresh === 'function') load._refresh();
                            await _sleep(1000);
                        }
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '观察 1# 主开关：过载保护延时（约 15s）动作跳闸，发电机不停机、负载随跳闸断开',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf1'); return !q || q.getState() === 'off'; }, 40000);
                            await _sleep(500);
                        }
                    },
                ],
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
                op: [
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '1# 发电机仍在运行（过载只跳开关不停机），等弹簧重新储能后按 1# 遥控面板"合闸"直接恢复供电',
                        async act() {
                            const sys = this.sys;
                            await _closeQf(sys, 'genpanel', 'qf1');
                            await _sleep(1500);
                        }
                    },
                ],
                check() {
                    const sys = this.sys;
                    return !!sys.comps.qf1 && sys.comps.qf1.getState() === 'on';
                },
            },
            // ── 步骤 4：起动 2# 机组，合闸并车 ──
            {
                msg: '第 4 步：起动 2# 机组，并车合闸',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'genpanel2', part: 'btn-start',
                        msg: '按住 2# 发电机组遥控面板"起动"按钮，起动 2# 发电机，等待合闸弹簧储能（约 3s）',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel2', '_userStartPressed', 1200);
                            await _sleep(3000);
                        }
                    },
                    {
                        type: 'knob', target: 'genpanel2', part: 'knob',
                        msg: '调节 2# 机组转速，将设定频率调到比电网高约 0.3Hz（正频差待并）',
                        async act() {
                            const sys = this.sys;
                            const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
                            g2.freq = (g1._freqOut ?? g1.freq) + 0.3;
                            await _sleep(2500);
                        }
                    },
                    {
                        type: 'switch', target: 'sync_sel', part: 'sel-knob',
                        msg: '将同步表待并机选择开关切到"2"档，同步表监测 2# 待并机',
                        async act() {
                            const sel = this.sys.comps.sync_sel;
                            if (sel && sel.getPosition() !== 3) sel.switchTo(3);
                            await _sleep(300);
                        }
                    },

                    {
                        type: 'observe', target: 'sync1',
                        msg: '观察数字同步表：待并机与电网相位差进入允许区（接近同相）时准备合闸',
                        async act() {
                            const sc = this.sys.comps.sync1;
                            const degOf = () => { const d = (sc._phaseDiff || 0) * 180 / Math.PI; return (Math.round(d % 360 + 360)) % 360; };
                            await _waitUntil(() => { const d = degOf(); return d < 60 || d > 270; }, 20000);
                            await _closeQf(sys, 'genpanel2', 'qf2');
                            await _sleep(2000);
                        }
                    },
                ],
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
                op: [
                    {
                        type: 'load', target: 'load3', part: 'power',
                        msg: '确认"三相可调负载"功率输入框设定值为 70kW',
                        async act() {
                            const load = this.sys.comps.load3;
                            if (!load) return;
                            // 与功率输入框内联编辑确认等效：确保设定值 70kW 并刷新显示
                            load.powerKw = 70;
                            load._recalcLoad();
                            if (load._ui && load._ui.power) load._ui.power.text('70');
                            if (load.config) load.config.powerKw = 70;
                            load._touchDirty();
                            await _sleep(800);
                        }
                    },
                    {
                        type: 'load', target: 'load3', part: 'btn-load',
                        msg: '按"加载"按钮再次投入 70kW 大负荷，观察两机各分担约 35kW、运行正常',
                        async act() {
                            const load = this.sys.comps.load3;
                            if (!load) return;
                            // 与"加载"按钮点击处理等效：置加载状态并刷新 LCD
                            load._loaded = true;
                            if (load.config) load.config.loaded = true;
                            if (typeof load._refresh === 'function') load._refresh();
                            await _sleep(3000); // 等待两机功率分配收敛
                        }
                    },
                ],
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

    'short-circuit-recovery': {
        id: 'short-circuit-recovery',
        name: '6.短路故障导致主开关跳闸的应急处理',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 发电机，合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 发电机并合闸供电',
                mode: 'check',
                op: [
                    {
                        type: 'wire', msg: '点击工具栏"自动接线"按钮完成全船电网接线，并复位到初始状态（清除短路标记）',
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
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-start',
                        msg: '按住 1# 发电机组遥控面板"起动"按钮，起动 1# 发电机，等待合闸弹簧储能（约 3s）',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userStartPressed', 1200);
                            await _sleep(3000); // 等待储能
                        }
                    },
                    {
                        type: 'btn', target: 'genpanel', part: 'btn-close',
                        msg: '储能到位后按住 1# 遥控面板"合闸"按钮，1# 主开关合闸向汇流排供电',
                        async act() {
                            const sys = this.sys;
                            await _pressPanelBtn(sys, 'genpanel', '_userClosePressed', 700);
                            await _sleep(1500);
                        }
                    },
                ],
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
                op: [
                    {
                        type: 'fault', fault: 'bus_short',
                        msg: '打开故障设置面板，勾选"汇流排干线短路故障"并应用'
                    },
                    {
                        type: 'observe', target: 'qf1', part: 'main-contact',
                        msg: '观察 1# 主开关：短路电流巨大，短路保护瞬时动作跳闸（两台主开关同时跳闸、全船失电）',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf1'); return !q || q.getState() === 'off'; }, 15000);
                            await _sleep(500);
                        }
                    },
                    {
                        type: 'observe', target: 'qf2', part: 'main-contact',
                        msg: '观察 2# 主开关：短路保护同样瞬时动作跳闸',
                        async act() {
                            await _waitUntil(() => { const q = _fcomp('qf2'); return !q || q.getState() === 'off'; }, 5000);
                            await _sleep(500);
                        }
                    },
                ],
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
    { Class: MarineMainsSwitch, id: 'qf1', x: -120, y: 180, ratedCtrlVoltage: 24, label: '主开关', genId: 'gen1', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel', x: 330, y: 700, genId: 'gen1', qfId: 'qf1', label: '1#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 2, visible: true },

    // ── 2号机组：2号同步发电机 → 2号主开关 → 汇流排 ──
    { Class: SyncGenerator3P, id: 'gen2', x: 850, y: 700, vRms: 230, freq: 50, isOn: false, mode: 'remote', label: '2#同步发电机', ratedPower: 80, ratedVoltage: 400, ratedCosPhi: 0.8, maxDropV: 200, avrMaxComp: 1, avrDelay: 2, avrTime: 5, autoDecoupleTrim: true, visible: true },
    { Class: MarineMainsSwitch, id: 'qf2', x: 1100, y: 180, ratedCtrlVoltage: 24, label: '主开关2', genId: 'gen2', syncScopeId: 'sync1', phaseMin: 60, phaseMax: 270, freqDiffMax: 0.5, revPowerKw: 8, revTime: 5, faultSimpleProtect: true, visible: true },
    { Class: GeneratorRemotePanel, id: 'genpanel2', x: 1300, y: 700, genId: 'gen2', qfId: 'qf2', label: '2#发电机组遥控面板', busId: 'bus1', syncSelId: 'sync_sel', selPos: 3, visible: true },
    { Class: DCPower, id: 'dc_uv2', x: 1580, y: 700, voltage: 24, isOn: true, label: '失压脱扣电源2', visible: true },
    { Class: Busbar3P, id: 'bus1', x: 220, y: 30, tapsPerPhase: 6, label: '汇流排', visible: true },
    // 改为同步表中性点接地
    { Class: Ground, id: 'gnd1', x: 680, y: 500, visible: true },

    // ── 1号机组控制电源共地（遥控面板与控制电源的中间下方）──
    // dc_uv 负极、genpanel p24_n 共同接此接地，不再向线圈引出负极线
    { Class: Ground, id: 'gnd1_uv', x: 590, y: 1000, label: '控制电源接地', visible: true },
    // ── 1号主开关线圈接地（主开关右下角）──
    // 储能电机 m2 / 失压 uv2 / 合闸 c2 / 分励 flb 负端均接此接地
    { Class: Ground, id: 'gnd1_qf', x: 330, y: 480, label: '线圈接地', visible: true },
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
    { Class: Syncroscope, id: 'sync1', x: 650, y: 120, label: '数字同步表', visible: true },

    // ── 三相可调负载：置于同步表与2号主开关之间（汇流排第5口直连，N端悬空不接）──
    { Class: ThreePhaseLoad, id: 'load3', x: 950, y: 180, powerKw: 20, cosPhi: 1, reactive: 'ind', loaded: false, label: '三相可调负载', visible: true },

    // ── 待并机选择开关：单刀四掷（OFF / 待并机1 / 待并机2 / 待并机3）──
    // 档位1=OFF（同步表关闭）、档位2=1号机、档位3=2号机、档位4=3号机（预留）
    { Class: SP4TSwitch, id: 'sync_sel', x: 650, y: 530, label: '同步表选择开关', function: '同步表选择开关', labelNames: ['OFF', '1', '2', '3'], initPosition: 1, visible: true },

    // ── 控制电源（DC 24V）：失压脱扣线圈 ──
    { Class: DCPower, id: 'dc_uv', x: 600, y: 700, voltage: 24, isOn: true, label: '失压脱扣电源', visible: true },

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

// 轮询等待条件成立（100ms 间隔，超时返回 false，不中断演示节奏）
async function _waitUntil(fn, timeout = 40000) {
    for (let i = 0, n = Math.ceil(timeout / 100); i < n; i++) {
        if (fn()) return true;
        await _sleep(100);
    }
    return false;
}

// 遥控面板合闸：先等主开关合闸弹簧重新储能到位（跳闸释放后约 2s 充满），再按住"合闸"
async function _closeQf(sys, pid, qfid) {
    const qf = sys.comps[qfid];
    if (qf && typeof qf.isCharged === 'function' && !qf.isCharged()) {
        await _waitUntil(() => qf.isCharged(), 10000);
    }
    await _pressPanelBtn(sys, pid, '_userClosePressed', 700);
}

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

// ─── 流程1（合不上闸判断）辅助函数 ───

// 复位到"主开关合不上闸判断"所需初始态：两机停机、主开关分闸且未储能、负载切除、
// 同步选择开关回 1 档、控制电源接通。
function _resetNoCloseRig(sys) {
    if (!sys || !sys.comps) return;
    const g1 = sys.comps.gen1, g2 = sys.comps.gen2;
    if (g1) { g1.freq = 50; g1.isOn = false; }
    if (g2) { g2.freq = 50; g2.isOn = false; }
    if (sys.comps.load3) sys.comps.load3._loaded = false;
    const q1 = sys.comps.qf1, q2 = sys.comps.qf2;
    [q1, q2].forEach(q => { if (q && q.getState() === 'on' && q.tryTrip) q.tryTrip(); });
    if (q1) { q1._chargeProg = 0; q1._charged = false; } // 未储能（配合储能电机回路故障，不会再自动储能）
    const sel = sys.comps.sync_sel;
    if (sel && typeof sel.getPosition === 'function' && sel.getPosition() !== 1) sel.switchTo(1);
    _setDcPower(sys, 'dc_uv', true); // 控制电源接通（为失压线圈供电）
}

// 接通/切断直流控制电源：优先模拟按下电源键（触发组件自身 mousedown 处理），
// 无法取到节点时兜底直接置位。
function _setDcPower(sys, compId, on) {
    const dc = sys && sys.comps ? sys.comps[compId] : null;
    if (!dc) return;
    if (dc.isOn === on) return;
    const btn = dc.powerBtnGroup;
    if (btn && typeof btn.fire === 'function') {
        btn.fire('mousedown', { cancelBubble: true });
    }
    if (dc.isOn !== on) { dc.isOn = on; dc.update(); } // 兜底：点击未生效时直接置位
}

// 断开某端口上的所有连线（万用表表笔）
function _disconnectPort(sys, portId) {
    sys.conns.filter(c => c.type === 'wire' && (c.from === portId || c.to === portId))
        .forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

// ─── 流程1（主开关储能、合闸、分闸）接线辅助（按当前电路）───
// 动画接线（约 3s/根）：已存在的连线跳过，不重复接
async function _animateWires(sys, pairs) {
    for (const [from, to] of pairs) {
        const has = sys.conns.some(c => (c.from === from && c.to === to) || (c.from === to && c.to === from));
        if (has) continue;
        await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
    }
    sys.redrawAll();
}
// 储能电机：控制电源 dc_uv 正端 → m1，m2 → 线圈接地，电源负端接地（得电自动储能）
async function _wireMotor(sys) {
    await _animateWires(sys, [
        ['dc_uv_wire_p', 'qf1_wire_m1'],
        ['qf1_wire_m2', 'gnd1_qf_wire_gnd'],
        ['dc_uv_wire_n', 'gnd1_uv_wire_gnd'], // 控制电源负端接地，构成回路
    ]);
}
// 失压线圈：控制电源 dc_uv 正端 → uv1，uv2 → 线圈接地，电源负端接地（脱扣轴回归正常位）
async function _wireUV(sys) {
    await _animateWires(sys, [
        ['dc_uv_wire_p', 'qf1_wire_uv1'],
        ['qf1_wire_uv2', 'gnd1_qf_wire_gnd'],
        ['dc_uv_wire_n', 'gnd1_uv_wire_gnd'], // 控制电源负端接地，构成回路
    ]);
}
// 分励脱扣：由 1# 遥控面板「分闸」按钮接通分励线圈（open_a→fla，open_b→信号地）
async function _wireFL(sys) {
    await _animateWires(sys, [
        ['genpanel_wire_open_a', 'qf1_wire_fla'],
        ['genpanel_wire_open_b', 'gnd1_panel_wire_gnd'],
        ['qf1_wire_flb', 'gnd1_qf_wire_gnd'],
        ['dc_uv_wire_p', 'genpanel_wire_p24_p'],
        ['dc_uv_wire_n', 'gnd1_uv_wire_gnd'],
        ['genpanel_wire_p24_n', 'gnd1_uv_wire_gnd'],
    ]);
}
// 合闸：由 1# 遥控面板「合闸」按钮接通合闸线圈（close_a→c1，close_b→信号地）
async function _wireClose(sys) {
    await _animateWires(sys, [
        ['genpanel_wire_close_a', 'qf1_wire_c1'],
        ['genpanel_wire_close_b', 'gnd1_panel_wire_gnd'],
        ['qf1_wire_c2', 'gnd1_qf_wire_gnd'],
        ['dc_uv_wire_p', 'genpanel_wire_p24_p'],
        ['dc_uv_wire_n', 'gnd1_uv_wire_gnd'],
        ['genpanel_wire_p24_n', 'gnd1_uv_wire_gnd'],
    ]);
}

// 动画接线：万用表红表笔(V)→储能电机线圈 m1，黑表笔(COM)→ m2（约 3s/根）
async function _wireMotorProbe(sys) {
    _disconnectPort(sys, 'multimeter_wire_v');
    _disconnectPort(sys, 'multimeter_wire_com');
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_v', to: 'qf1_wire_m1', type: 'wire' });
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_com', to: 'qf1_wire_m2', type: 'wire' });
    sys.redrawAll();
}

// 动画接线：万用表红表笔(V)→失压线圈 uv1，黑表笔(COM)→ uv2（约 3s/根）。
// 注意：失压线圈与储能电机线圈共用 24V 正端/接地，测量前需先断开储能电机接线，
// 否则读数为两线圈并联值（无法判断失压线圈是否断线）。
async function _wireUvProbe(sys) {
    _disconnectPort(sys, 'multimeter_wire_v');
    _disconnectPort(sys, 'multimeter_wire_com');
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_v', to: 'qf1_wire_uv1', type: 'wire' });
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_com', to: 'qf1_wire_uv2', type: 'wire' });
    sys.redrawAll();
}

// 将数字万用表旋至 2kΩ 电阻档（动态转动指针，触发档位映射与一次测量）
// 说明：储能电机线圈与失压线圈共用 24V 正端与接地；测量电机线圈前须先切断控制电源，
// 并断开电机与 24V 正极（dc_uv_p）的接线，以隔离并联回路。隔离后正常约 0.2kΩ；
// 本故障（接触不良）线圈电阻约 10kΩ，超出 2kΩ 档量程、显示 O.L。
async function _setMultimeterRes(sys) {
    const mm = sys && sys.comps ? sys.comps.multimeter : null;
    if (!mm || !mm.pointer) return;
    const to = 90; // 2kΩ 档角度（储能电机回路电阻约 0.2~2kΩ，2kΩ 档量程合适）
    await new Promise(resolve => {
        const tween = new Konva.Tween({
            node: mm.pointer, rotation: to, duration: 0.9,
            onFinish: () => {
                tween.destroy();
                if (mm._updateModeByAngle) mm._updateModeByAngle(to);
                if (mm._measureNow) mm._measureNow();
                resolve();
            },
        });
        tween.play();
    });
}

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;    
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
