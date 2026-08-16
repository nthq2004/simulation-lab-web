// 三相空气断路器仿真工程

import { DiagramACPower3P } from '../components/DiagramACPower3P.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { InductionMotor2 } from '../components/InductionMotor2.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { TsCurveDisplay } from '../components/TsCurveDisplay.js';
import { SinglePhaseFuse } from '../components/SinglePhaseFuse.js';
import { DiagramStopButton } from '../components/DiagramStopButton.js';
import { DiagramStartButton } from '../components/DiagramStartButton.js';

import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';
import { MotorStarterPanel } from '../components/MotorStarterPanel.js';
import { AuxNCContact } from '../device/AuxNCContact.js';
import { TimeRelayCoil } from '../device/TimeRelayCoil.js';
import { TimeDelayNOContact } from '../device/TimeDelayNOContact.js';
import { TimeDelayNCContact } from '../device/TimeDelayNCContact.js';

export const FAULT_CONFIGS = {
    // ── 故障一：主电路缺相（3 种可能原因，随机选 1）──
    'phase-loss': {
        id: 'phase-loss',
        name: '主电路缺相',
        system: '主电路',
        check() {
            const sys = window.sys;
            if (!sys) return false;
            const mc = sys.comps['km1-mc'];
            if (mc && mc._faultOpenPoles && mc._faultOpenPoles.l3) return true;
            const poor = sys._poorContactPorts;
            if (poor && (poor.has('im01_wire_u1') || poor.has('ac_wire_u'))) return true;
            return false;
        },
        trigger(fixedVariant) {
            const sys = window.sys;
            if (!sys) return;
            const mc = sys.comps['km1-mc'];
            const poor = (sys._poorContactPorts ??= new Set());
            if (mc) mc._faultOpenPoles = {};
            poor.delete('im01_wire_u1');
            poor.delete('ac_wire_u');
            const variants = [
                () => { if (mc) mc._faultOpenPoles = { l3: true }; },
                () => { poor.add('im01_wire_u1'); },
                () => { poor.add('ac_wire_u'); },
            ];
            if (fixedVariant !== undefined && variants[fixedVariant]) {
                variants[fixedVariant]();
            } else {
                variants[Math.floor(Math.random() * variants.length)]();
            }
        },
        repair() {
            const sys = window.sys;
            if (!sys) return;
            const mc = sys.comps['km1-mc'];
            if (mc) mc._faultOpenPoles = {};
            sys._poorContactPorts?.delete('im01_wire_u1');
            sys._poorContactPorts?.delete('ac_wire_u');
        },
    },

    // ── 故障二：控制电路断路（3 种可能原因，随机选 1）──
    'control-open': {
        id: 'control-open',
        name: '控制电路断路',
        system: '控制回路',
        check() {
            const sys = window.sys;
            if (!sys) return false;
            if (sys.comps['fu5']?.isBlown?.()) return true;
            if (sys.comps['km1-coil']?._faultCoilOpen) return true;
            if (sys.comps['sb']?._faultOpen) return true;
            return false;
        },
        trigger(fixedVariant) {
            const sys = window.sys;
            if (!sys) return;
            const coil = sys.comps['km1-coil'];
            const sb = sys.comps['sb'];
            sys.comps['fu5']?.replace?.(0);
            if (coil) coil._faultCoilOpen = false;
            if (sb) sb._faultOpen = false;
            const variants = [
                () => { sys.comps['fu5']?.blow?.(0); },
                () => { if (coil) coil._faultCoilOpen = true; },
                () => { if (sb) sb._faultOpen = true; },
            ];
            if (fixedVariant !== undefined && variants[fixedVariant]) {
                variants[fixedVariant]();
            } else {
                variants[Math.floor(Math.random() * variants.length)]();
            }
        },
        repair() {
            const sys = window.sys;
            if (!sys) return;
            sys.comps['fu5']?.replace?.(0);
            if (sys.comps['km1-coil']) sys.comps['km1-coil']._faultCoilOpen = false;
            if (sys.comps['sb']) sys.comps['sb']._faultOpen = false;
        },
    },

    // ── 故障三：点动运行故障（KM1 自锁触点 3 种接触不良，随机选 1）──
    'jog-fault': {
        id: 'jog-fault',
        name: '点动运行故障',
        system: '控制回路（自锁）',
        check() {
            const sys = window.sys;
            const no1 = sys && sys.comps['km1-no1'];
            return !!(no1 && (no1._faultOpen || no1._faultOpenEnd));
        },
        trigger(fixedVariant) {
            const sys = window.sys;
            if (!sys) return;
            const no1 = sys.comps['km1-no1'];
            if (!no1) return;
            no1._faultOpen = false;
            no1._faultOpenEnd = null;
            const variants = [
                () => { no1._faultOpen = true; },
                () => { no1._faultOpenEnd = 'com'; },
                () => { no1._faultOpenEnd = 'no'; },
            ];
            if (fixedVariant !== undefined && variants[fixedVariant]) {
                variants[fixedVariant]();
            } else {
                variants[Math.floor(Math.random() * variants.length)]();
            }
        },
        repair() {
            const sys = window.sys;
            const no1 = sys && sys.comps['km1-no1'];
            if (no1) { no1._faultOpen = false; no1._faultOpenEnd = null; }
        },
    },
};

export const PROJECT_WORKFLOWS = {
    // ── 操作流程：主电路缺相——断电查找法 ──
    // 场景：接触器 KM 主触头 L3-T3 接触不良（W 相缺相）
    // 步骤使用 check（行为检测，可演可练）/ quiz（测试题）
    'phase-loss-poweroff': {
        id: 'phase-loss-poweroff', name: '1. 主电路缺相——断电查找法',
        steps: [
            {
                msg: '第 1 步：触发主电路缺相故障', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mc = sys.comps['km1-mc'];
                    sys._poorContactPorts?.clear();
                    if (mc) mc._faultOpenPoles = { l3: true };   // 演示固定为 L3-T3 变体
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const sys = this.sys;
                    const mc = sys.comps['km1-mc'];
                    const poor = sys._poorContactPorts;
                    // 任一缺相变体（L3-T3 断路 / 电机U1接触不良 / 电源U接触不良）均视为故障已触发
                    return !!mc && (!!mc._faultOpenPoles?.l3
                        || (!!poor && (poor.has('im01_wire_u1') || poor.has('ac_wire_u'))));
                },
            },
            {
                msg: '第 2 步：接线、接通电源，按下起动按钮。观察现象：电机不能正常起动（缺相运行，可能不转或运转异常），初步判定为主电路缺相故障', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.conns.length = 0;
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 200));
                    const ac = sys.comps['ac'];
                    if (ac) ac.isOn = true;
                    const acb = sys.comps['acb'];
                    if (acb) acb.close();
                    await new Promise(r => setTimeout(r, 300));
                    _pressButton(sys, 'ss', 2000);
                    await new Promise(r => setTimeout(r, 2600));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const ac = sys.comps['ac'];
                    const acb = sys.comps['acb'];
                    const coil = sys.comps['km1-coil'];
                    const wired = c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t3', 'fr_wire_l3')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('ss_wire_no2', 'km1-coil_wire_a1');
                    const energized = coil && coil.deviceRef && coil.deviceRef.isPickup && coil.deviceRef.isPickup();
                    const poor = sys._poorContactPorts;
                    const faultOn = !!sys.comps['km1-mc']?._faultOpenPoles?.l3
                        || (!!poor && (poor.has('im01_wire_u1') || poor.has('ac_wire_u')));
                    return wired && ac && ac.isOn && acb && acb.isClosed() && energized && faultOn;
                },
            },
            {
                msg: '第 3 步：将三相交流电源设为关闭状态，然后右键点击接触器主触头 KM，选择"模拟闭合"，使主触头强制闭合，便于断电测阻', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    if (ac) ac.isOn = false;
                    const mc = sys.comps['km1-mc'];
                    if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(true);
                    await new Promise(r => setTimeout(r, 600));
                },
                check() {
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    const mc = sys.comps['km1-mc'];
                    return ac && !ac.isOn
                        && mc && mc.deviceRef && mc.deviceRef.getManualOverride() === true;
                },
            },
            {
                msg: '第 4 步：调出数字万用表，打到 200Ω 档。红表笔依次接电源相线 U/V/W（ac 输出端），黑表笔接电机对应接线柱 U1/V1/W1，测量三相通路阻抗。正常相约 0Ω；断线相阻抗显著偏大或为无穷大（O.L），即为断线相', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.group.position({ x: 560, y: 620 });
                        mm.mode = 'RES200';
                        mm._updateAngleByMode();
                        mm.update(0);
                    }
                    // 根据断线相自动接表笔：L3-T3 断→W 相；电机U1/电源U 断→U 相
                    const mc = sys.comps['km1-mc'];
                    const poor = sys._poorContactPorts;
                    let pa = 'ac_wire_u', pb = 'im01_wire_u1';
                    if (mc?._faultOpenPoles?.l3) { pa = 'ac_wire_w'; pb = 'im01_wire_w1'; }
                    sys.conns = sys.conns.filter(c => !(c.from.startsWith('multimeter') || c.to.startsWith('multimeter')));
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: pa, type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: pb, type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    const hasWire = (a, b) => sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                    const wMeas = (hasWire('multimeter_wire_v', 'ac_wire_w') && hasWire('multimeter_wire_com', 'im01_wire_w1'))
                        || (hasWire('multimeter_wire_v', 'im01_wire_w1') && hasWire('multimeter_wire_com', 'ac_wire_w'));
                    const uMeas = (hasWire('multimeter_wire_v', 'ac_wire_u') && hasWire('multimeter_wire_com', 'im01_wire_u1'))
                        || (hasWire('multimeter_wire_v', 'im01_wire_u1') && hasWire('multimeter_wire_com', 'ac_wire_u'));
                    return mm && mm.group.visible() && mm.mode === 'RES200' && (wMeas || uMeas) && mm.value > 5;
                },
            },
            {
                msg: '第 5 步：二分法定位。断线相通路上依次为：电源相线 → 断路器QF → 接触器主触头 → 热继电器FR → 电机接线柱。取中间元件分段测量，阻抗显著偏大或 O.L 的一段即为断点所在', mode: 'check',
                async act() {
                    const sys = this.sys;
                    // 根据断点自动接表笔：L3-T3 断→接触器L3-T3；电机U1→fr_t1-u1；电源U→ac_wire_u-acb_l1
                    const mc = sys.comps['km1-mc'];
                    const poor = sys._poorContactPorts;
                    let pa = null, pb = null;
                    if (mc?._faultOpenPoles?.l3) { pa = 'km1-mc_wire_l3'; pb = 'km1-mc_wire_t3'; }
                    else if (poor?.has('im01_wire_u1')) { pa = 'fr_wire_t1'; pb = 'im01_wire_u1'; }
                    else if (poor?.has('ac_wire_u')) { pa = 'ac_wire_u'; pb = 'acb_wire_l1'; }
                    sys.conns = sys.conns.filter(c => !(c.from.startsWith('multimeter') || c.to.startsWith('multimeter')));
                    if (pa && pb) {
                        sys.connMgr.addConn({ from: 'multimeter_wire_v', to: pa, type: 'wire' });
                        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: pb, type: 'wire' });
                    }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    const hasWire = (a, b) => sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                    const l3t3 = (hasWire('multimeter_wire_v', 'km1-mc_wire_l3') && hasWire('multimeter_wire_com', 'km1-mc_wire_t3'))
                        || (hasWire('multimeter_wire_v', 'km1-mc_wire_t3') && hasWire('multimeter_wire_com', 'km1-mc_wire_l3'));
                    const u1Span = (hasWire('multimeter_wire_v', 'fr_wire_t1') && hasWire('multimeter_wire_com', 'im01_wire_u1'))
                        || (hasWire('multimeter_wire_v', 'im01_wire_u1') && hasWire('multimeter_wire_com', 'fr_wire_t1'));
                    const acUSpan = (hasWire('multimeter_wire_v', 'ac_wire_u') && hasWire('multimeter_wire_com', 'acb_wire_l1'))
                        || (hasWire('multimeter_wire_v', 'acb_wire_l1') && hasWire('multimeter_wire_com', 'ac_wire_u'));
                    return mm && mm.mode === 'RES200' && (l3t3 || u1Span || acUSpan) && mm.value > 5;
                },
            },
            {
                msg: '第 6 步：保持万用表 200Ω 档、表笔仍在断点两端，打开"故障设置"，取消勾选"主电路缺相"并点击"应用设置"修复故障。观察万用表读数变为接近 0Ω（导通）', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mc = sys.comps['km1-mc'];
                    if (mc) mc._faultOpenPoles = {};
                    sys._poorContactPorts?.clear();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const sys = this.sys;
                    const mc = sys.comps['km1-mc'];
                    const poor = sys._poorContactPorts;
                    const mm = sys.comps['multimeter'];
                    const hasWire = (a, b) => sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                    const l3t3 = (hasWire('multimeter_wire_v', 'km1-mc_wire_l3') && hasWire('multimeter_wire_com', 'km1-mc_wire_t3'))
                        || (hasWire('multimeter_wire_v', 'km1-mc_wire_t3') && hasWire('multimeter_wire_com', 'km1-mc_wire_l3'));
                    const u1Span = (hasWire('multimeter_wire_v', 'fr_wire_t1') && hasWire('multimeter_wire_com', 'im01_wire_u1'))
                        || (hasWire('multimeter_wire_v', 'im01_wire_u1') && hasWire('multimeter_wire_com', 'fr_wire_t1'));
                    const acUSpan = (hasWire('multimeter_wire_v', 'ac_wire_u') && hasWire('multimeter_wire_com', 'acb_wire_l1'))
                        || (hasWire('multimeter_wire_v', 'acb_wire_l1') && hasWire('multimeter_wire_com', 'ac_wire_u'));
                    const repaired = mc && !mc._faultOpenPoles?.l3
                        && !(poor && (poor.has('im01_wire_u1') || poor.has('ac_wire_u')));
                    return repaired && (l3t3 || u1Span || acUSpan) && mm && mm.mode === 'RES200' && mm.value < 5;
                },
            },
            {
                msg: '第 7 步：右键接触器主触头 KM，选择"模拟分闸"复位；接通三相电源（将电源设为打开状态），按下起动按钮 SB2，电机应正常起动并保持运行', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mc = sys.comps['km1-mc'];
                    if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(false);
                    const ac = sys.comps['ac'];
                    if (ac) ac.isOn = true;
                    await new Promise(r => setTimeout(r, 300));
                    _pressButton(sys, 'ss', 2000);
                    await new Promise(r => setTimeout(r, 6000));
                },
                check() {
                    const sys = this.sys;
                    const mc = sys.comps['km1-mc'];
                    const ac = sys.comps['ac'];
                    const motor = sys.comps['im01'];
                    return mc && mc.deviceRef && mc.deviceRef.getManualOverride() === false
                        && ac && ac.isOn
                        && motor && motor.rpm > 30;
                },
            },
            {
                msg: '第 8 步：测试题——查找断线的二分法', mode: 'quiz',
                quizConfig: {
                    question: '用万用表电阻档排查主电路缺相（一相断线）故障时，采用二分法分段测量的正确思路是？',
                    options: [
                        '先测电源进线端到电机接线端之间是否导通；若不通，则取中间元件（如接触器主触头）两侧分段测量，逐步缩小范围，定位断点',
                        '从电机端开始，依次拆下每个元件逐个测量，直到找到断点',
                        '只需测量电源三相电压是否正常，电压正常即可排除断线故障',
                        '断线一定在电源线，直接更换电源线即可',
                    ],
                    answer: 0,
                    analysis: '二分法：先在首尾两端（电源进线与电机接线柱）测量通断。若不通，取通路中间元件（如接触器主触头 L3-T3）为分界点分段测量：中间点前段不通，断点在中间点之前；前段通而后段不通，断点在中间点之后。如此反复，以最少测量次数快速定位断线的导线或元件。',
                },
            },
        ],
    },
    // ── 操作流程：控制电路断线——带电查找法 ──
    // 场景：接触器线圈 KM 断路（控制回路断线）
    // 原理：带电查找法——回路只有一个断点时，断点两端电压等于电源电压（变压器副边 220V）
    'control-open-energized': {
        id: 'control-open-energized', name: '2. 控制电路断线——带电查找法',
        steps: [
            {
                msg: '第 1 步：触发控制电路断线故障', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const coil = sys.comps['km1-coil'];
                    const sb = sys.comps['sb'];
                    sys.comps['fu4']?.replace?.(0);
                    if (sb) sb._faultOpen = false;
                    if (coil) coil._faultCoilOpen = true;   // 演示固定为线圈断路变体
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const sys = this.sys;
                    const coil = sys.comps['km1-coil'];
                    const sb = sys.comps['sb'];
                    // 任一断线变体（FU4 熔断 / 线圈断路 / 停止按钮断路）均视为故障已触发
                    return !!(sys.comps['fu4']?.isBlown?.()
                        || coil?._faultCoilOpen
                        || sb?._faultOpen);
                },
            },
            {
                msg: '第 2 步：接线、接通电源，按下起动按钮。观察现象：电路无任何反应（接触器不吸合、电机不转），初步判定控制回路断线', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.conns.length = 0;
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 200));
                    const ac = sys.comps['ac'];
                    if (ac) ac.isOn = true;
                    const acb = sys.comps['acb'];
                    if (acb) acb.close();
                    await new Promise(r => setTimeout(r, 300));
                    _pressButton(sys, 'ss', 2000);
                    await new Promise(r => setTimeout(r, 2400));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const ac = sys.comps['ac'];
                    const acb = sys.comps['acb'];
                    const coil = sys.comps['km1-coil'];
                    const wired = c('ac_wire_u', 'acb_wire_l1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('sb_wire_nc4', 'ss_wire_no1')
                        && c('ss_wire_no2', 'km1-coil_wire_a1')
                        && c('km1-coil_wire_a2', 'fr-nc_wire_nc');
                    const notPickup = coil && (!coil.deviceRef || !coil.deviceRef.isPickup || !coil.deviceRef.isPickup());
                    const faultOn = !!(sys.comps['fu4']?.isBlown?.()
                        || coil?._faultCoilOpen
                        || sys.comps['sb']?._faultOpen);
                    return wired && ac && ac.isOn && acb && acb.isClosed() && notPickup && faultOn;
                },
            },
            {
                msg: '第 3 步：右键点击起动按钮 SB2，选择"模拟闭合"，使按钮保持闭合（等效于一直按下），便于带电测量', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ss = sys.comps['ss'];
                    if (ss) ss.setManualOverride(true);
                    await new Promise(r => setTimeout(r, 400));
                },
                check() {
                    const ss = this.sys.comps['ss'];
                    return !!ss && ss.getManualOverride() === true;
                },
            },
            {
                msg: '第 4 步：将万用表打到交流 500V 档（ACV500），带电测量。用二分法沿控制回路测各元件两端电压：正常导通的导线与元件两端电压约为 0，断点两端电压等于电源电压（变压器副边约 220V，一次侧熔断器处约 380V）。测到电压等于电源电压的两端即为断线点', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.group.position({ x: 560, y: 620 });
                        mm.mode = 'ACV500';
                        mm._updateAngleByMode();
                        mm.update(0);
                    }
                    // 根据当前断线变体自动接表笔到断点两端
                    const fu4 = sys.comps['fu4'];
                    const coil = sys.comps['km1-coil'];
                    const sb = sys.comps['sb'];
                    let pa = null, pb = null;
                    if (fu4 && fu4.isBlown()) { pa = 'fu4_wire_l'; pb = 'fu4_wire_t'; }
                    else if (coil && coil._faultCoilOpen) { pa = 'km1-coil_wire_a1'; pb = 'km1-coil_wire_a2'; }
                    else if (sb && sb._faultOpen) { pa = 'sb_wire_nc3'; pb = 'sb_wire_nc4'; }
                    sys.conns = sys.conns.filter(c => !(c.from.startsWith('multimeter') || c.to.startsWith('multimeter')));
                    if (pa && pb) {
                        sys.connMgr.addConn({ from: 'multimeter_wire_v', to: pa, type: 'wire' });
                        sys.connMgr.addConn({ from: 'multimeter_wire_com', to: pb, type: 'wire' });
                    }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    const hasWire = (a, b) => sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                    // 断点候选：FU4 两端 / 线圈 A1-A2 / 停止按钮 NC3-NC4
                    const fu4Span = (hasWire('multimeter_wire_v', 'fu4_wire_l') && hasWire('multimeter_wire_com', 'fu4_wire_t'))
                        || (hasWire('multimeter_wire_v', 'fu4_wire_t') && hasWire('multimeter_wire_com', 'fu4_wire_l'));
                    const coilSpan = (hasWire('multimeter_wire_v', 'km1-coil_wire_a1') && hasWire('multimeter_wire_com', 'km1-coil_wire_a2'))
                        || (hasWire('multimeter_wire_v', 'km1-coil_wire_a2') && hasWire('multimeter_wire_com', 'km1-coil_wire_a1'));
                    const sbSpan = (hasWire('multimeter_wire_v', 'sb_wire_nc3') && hasWire('multimeter_wire_com', 'sb_wire_nc4'))
                        || (hasWire('multimeter_wire_v', 'sb_wire_nc4') && hasWire('multimeter_wire_com', 'sb_wire_nc3'));
                    return mm && mm.group.visible() && mm.mode === 'ACV500'
                        && (fu4Span || coilSpan || sbSpan)
                        && mm.value > 50 && mm.value < 500;
                },
            },
            {
                msg: '第 5 步：右键起动按钮选择"模拟断开"恢复按钮状态；打开"故障设置"，取消勾选"控制电路断路"并点击"应用设置"修复故障；按下起动按钮，电机应正常起动并保持运行', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ss = sys.comps['ss'];
                    if (ss) ss.setManualOverride(false);
                    sys.comps['fu4']?.replace?.(0);
                    const coil = sys.comps['km1-coil'];
                    if (coil) coil._faultCoilOpen = false;
                    const sb = sys.comps['sb'];
                    if (sb) sb._faultOpen = false;
                    await new Promise(r => setTimeout(r, 300));
                    _pressButton(sys, 'ss', 2000);
                    await new Promise(r => setTimeout(r, 6000));
                },
                check() {
                    const sys = this.sys;
                    const ss = sys.comps['ss'];
                    const coil = sys.comps['km1-coil'];
                    const motor = sys.comps['im01'];
                    const repaired = !sys.comps['fu4']?.isBlown?.()
                        && !coil?._faultCoilOpen
                        && !sys.comps['sb']?._faultOpen;
                    const pickup = coil && coil.deviceRef && coil.deviceRef.isPickup && coil.deviceRef.isPickup();
                    return ss && ss.getManualOverride() === false
                        && repaired
                        && pickup
                        && motor && motor.rpm > 30;
                },
            },
            {
                msg: '第 6 步：测试题——带电查找法的原理', mode: 'quiz',
                quizConfig: {
                    question: '控制回路只有一个断点时，用交流电压档带电测量，判断断点的依据是？',
                    options: [
                        '断点两端的电压等于电源电压（回路电压），其余正常导通元件两端电压约为 0',
                        '断点两端的电压为 0，其余正常导通元件两端电压等于电源电压',
                        '断点两端没有电流，因此测任何点电压都相同',
                        '只能断开电源用电阻档测量，带电无法测量电压',
                    ],
                    answer: 0,
                    analysis: '带电查找法：控制回路只有一个断点时，回路无电流，正常导通的导线与元件两端电压约为 0；断点两端因隔断了两侧电位（一侧为 0V、一侧为电源电压），电压差正好等于电源电压（此处为控制变压器副边 220V）。因此测到电压等于电源电压的两端即为断点，可据此二分定位。',
                },
            },
        ],
    },
    // ── 操作流程：电动机点动——断点查找法 ──
    // 场景：KM1 自锁常开辅助触头 KM 接触不良（点动运行故障）
    // 现象：按下起动按钮电机转动，松开按钮接触器失电（自锁失效）
    // 排查：断电测自锁触头 COM-NO 两端，电阻超量程（O.L）即为断线点
    'jog-fault-finder': {
        id: 'jog-fault-finder', name: '3. 电动机点动——断电查找法',
        steps: [
            {
                msg: '第 1 步：触发电动机点动运行故障', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const no1 = sys.comps['km1-no1'];
                    if (no1) { no1._faultOpen = true; no1._faultOpenEnd = null; }
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const no1 = this.sys.comps['km1-no1'];
                    // 任一自锁触头接触不良变体（整体断 / COM 端断 / NO 端断）均视为故障已触发
                    return !!no1 && (no1._faultOpen === true || !!no1._faultOpenEnd);
                },
            },
            {
                msg: '第 2 步：接线、接通电源，按下起动按钮，电动机转动；松开按钮，接触器失电、电动机停止（自锁失效）。据此初步判断为点动运行故障', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.conns.length = 0;
                    _autoWire(sys);
                    await new Promise(r => setTimeout(r, 200));
                    const ac = sys.comps['ac'];
                    if (ac) ac.isOn = true;
                    const acb = sys.comps['acb'];
                    if (acb) acb.close();
                    await new Promise(r => setTimeout(r, 300));
                    _pressButton(sys, 'ss', 2000);
                    await new Promise(r => setTimeout(r, 4500));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const ac = sys.comps['ac'];
                    const acb = sys.comps['acb'];
                    const coil = sys.comps['km1-coil'];
                    const no1 = sys.comps['km1-no1'];
                    const wired = c('ac_wire_u', 'acb_wire_l1')
                        && c('tc_wire_s2', 'sb_wire_nc3')
                        && c('ss_wire_no2', 'km1-coil_wire_a1')
                        && c('km1-coil_wire_a2', 'fr-nc_wire_nc');
                    const released = coil && (!coil.deviceRef || !coil.deviceRef.isPickup || !coil.deviceRef.isPickup());
                    const faultOn = !!(no1?._faultOpen || no1?._faultOpenEnd);
                    return wired && ac && ac.isOn && acb && acb.isClosed() && released && faultOn;
                },
            },
            {
                msg: '第 3 步：断开空气开关 QF（切断电源）；右键接触器主触头 KM，选择"模拟闭合"（使自锁辅助触头处于吸合位置便于测阻）；将万用表打到 200Ω 档', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const acb = sys.comps['acb'];
                    if (acb) acb.open();
                    const mc = sys.comps['km1-mc'];
                    if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(true);
                    const mm = sys.comps['multimeter'];
                    if (mm) {
                        mm.group.visible(true);
                        mm.group.position({ x: 560, y: 620 });
                        mm.mode = 'RES200';
                        mm._updateAngleByMode();
                        mm.update(0);
                    }
                    await new Promise(r => setTimeout(r, 600));
                },
                check() {
                    const sys = this.sys;
                    const acb = sys.comps['acb'];
                    const mc = sys.comps['km1-mc'];
                    const mm = sys.comps['multimeter'];
                    return acb && !acb.isClosed()
                        && mc && mc.deviceRef && mc.deviceRef.getManualOverride() === true
                        && mm && mm.group.visible() && mm.mode === 'RES200';
                },
            },
            {
                msg: '第 4 步：用万用表测量自锁常开辅助触头 COM 与 NO 两端（触头的两个引出线）：正常（触点吸合）应接近 0Ω；故障触头实测阻抗显著偏大（约 1000Ω，为经线圈的旁路，200Ω 档显示超量程 O.L），即为断线点', mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.conns = sys.conns.filter(c => !(c.from.startsWith('multimeter') || c.to.startsWith('multimeter')));
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'km1-no1_wire_com', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'km1-no1_wire_no', type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    const hasWire = (a, b) => sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                    const span = (hasWire('multimeter_wire_v', 'km1-no1_wire_com') && hasWire('multimeter_wire_com', 'km1-no1_wire_no'))
                        || (hasWire('multimeter_wire_v', 'km1-no1_wire_no') && hasWire('multimeter_wire_com', 'km1-no1_wire_com'));
                    return mm && mm.group.visible() && mm.mode === 'RES200' && span && mm.value > 5;
                },
            },
            {
                msg: '第 5 步：修复断线故障（"故障设置"中取消勾选"点动运行故障"并应用）；右键接触器"模拟分闸"复位；合上空气开关 QF，按下起动按钮再松开，电动机应自锁保持运行', mode: 'check',
                async act() {
                    const sys = this.sys;
                    const no1 = sys.comps['km1-no1'];
                    if (no1) { no1._faultOpen = false; no1._faultOpenEnd = null; }
                    const mc = sys.comps['km1-mc'];
                    if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(false);
                    const acb = sys.comps['acb'];
                    if (acb) acb.close();
                    await new Promise(r => setTimeout(r, 300));
                    _pressButton(sys, 'ss', 2000);
                    await new Promise(r => setTimeout(r, 6000));
                },
                check() {
                    const sys = this.sys;
                    const no1 = sys.comps['km1-no1'];
                    const mc = sys.comps['km1-mc'];
                    const acb = sys.comps['acb'];
                    const coil = sys.comps['km1-coil'];
                    const motor = sys.comps['im01'];
                    const repaired = no1 && !no1._faultOpen && !no1._faultOpenEnd;
                    const selfLocked = coil && coil.deviceRef && coil.deviceRef.isPickup && coil.deviceRef.isPickup();
                    return repaired
                        && mc && mc.deviceRef && mc.deviceRef.getManualOverride() === false
                        && acb && acb.isClosed()
                        && selfLocked
                        && motor && motor.rpm > 30;
                },
            },
            {
                msg: '第 6 步：测试题——点动故障的判别', mode: 'quiz',
                quizConfig: {
                    question: '按下起动按钮电动机转动、松开按钮电动机停止（自锁失效），最可能的故障部位是？',
                    options: [
                        '自锁回路中并联的接触器常开辅助触头（COM-NO）接触不良，无法维持线圈通电',
                        '接触器线圈烧毁断路',
                        '起动按钮损坏，无法正常闭合',
                        '电源电压过低，接触器吸合后不能保持',
                    ],
                    answer: 0,
                    analysis: '按下按钮时线圈经起动按钮得电吸合、电机转动；松开按钮后，因自锁回路依赖并联的常开辅助触头维持线圈通电。若该触头接触不良（断路），松开按钮后线圈失电、接触器释放、电机停止。断电排查方法：让接触器处于吸合位置，用万用表 200Ω 档测量辅助常开触头 COM-NO 两端，正常应接近 0Ω，若超量程（O.L）即为断线点。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 80, y: 30, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 80, y: 140, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    { Class: MainContact, id: 'km1-mc', x: 70, y: 350, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 70, y: 540, height: 100, deviceid: 'FR1', ratedCurrent: 100, tripClass: 20, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 40, y: 700, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // 控制回路：熔断器 → 控制变压器 → 停止按钮 → 起动按钮 → 线圈 → 熔断器 → 回到变压器
    { Class: SinglePhaseFuse, id: 'fu4', x: 280, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 420, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 580, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 580, y: 200, visible: true ,label:'SB1'},
    { Class: DiagramStartButton, id: 'ss', x: 780, y: 200, visible: true ,label:'SB2'},
    { Class: AuxNOContact, id: 'km1-no1', x: 780, y: 350, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 980, y: 200, deviceid: 'KM1', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 950, y: 100, deviceid: 'FR1', visible: true },

    { Class: TsCurveDisplay, id: 'ts-curve', x: 1150, y: 100, visible: false, quadrants: 1 },
    { Class: Multimeter, id: 'multimeter', x: 880, y: 440, visible: false },    
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },

    // 电机起动控制箱（实物图片展示，用于考核点击识别设备）
    { Class: MotorStarterPanel, id: 'starter-panel', x: 1180, y: 20, visible: true },

];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：电源 → 断路器 → 接触器主触头 → 热继电器发热元件 → 电动机
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        { from: 'fr_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'fr_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'fr_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 控制回路：L3 → FU4 → 变压器一次侧 → 经接触器主触头 → L2
        { from: 'acb_wire_t3', to: 'fu4_wire_l', type: 'wire' },
        { from: 'fu4_wire_t', to: 'tc_wire_p1', type: 'wire' },
        { from: 'km1-mc_wire_l2', to: 'tc_wire_p2', type: 'wire' },
        // 控制回路：变压器副边下端(s2) → 停止按钮 → [起动按钮 ∥ 常开触点] → 线圈 → FU5 → 副边上端(s1)
        { from: 'tc_wire_s2',  to: 'sb_wire_nc3', type: 'wire' },
        // 停止按钮输出 → 并联支路
        { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
        { from: 'sb_wire_nc4', to: 'km1-no1_wire_com', type: 'wire' },
        // 并联支路汇合 → 线圈
        { from: 'ss_wire_no2', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
        // 线圈 → 热继电器常闭触点 → FU5 → 副边上端
        { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'fr-nc_wire_com', to: 'fu5_wire_t', type: 'wire' },
        { from: 'fu5_wire_l', to: 'tc_wire_s1', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

function _powerOn(sys) {
    //将空气断路器合上
    const acb = sys.comps['acb'];
    if (acb) {
        acb.close();
    }
}

/** 模拟按下按钮：按下 duration ms 后松开（SB2 起动按钮闭合、SB1 停止按钮断开） */
function _pressButton(sys, compId, duration) {
    const comp = sys.comps[compId];
    if (!comp) return;
    const isStart = comp.special === 'START-BTN';
    const closedAng = isStart ? -5 : 22.5;
    const openAng = isStart ? -22.5 : 5;
    comp._isPressed = true;
    comp._curBladeAng = closedAng;
    comp._bladeGroup?.rotation(closedAng);
    comp._updatePlunger?.();
    setTimeout(() => {
        comp._isPressed = false;
        comp._curBladeAng = openAng;
        comp._bladeGroup?.rotation(openAng);
        comp._updatePlunger?.();
    }, duration);
}

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys);
    _powerOn(sys);
}

export function fiveStep() { }
