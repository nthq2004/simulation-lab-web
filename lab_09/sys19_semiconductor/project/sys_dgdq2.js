// 三相异步电动机正反转控制仿真工程

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
import { Switch } from '../components/Switch.js';
import { SmallLamp } from '../components/SmallLamp.js';
import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { AuxNCContact } from '../device/AuxNCContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';

export const FAULT_CONFIGS = {
    // ── 主回路故障：电动机 U1、V1 端子相间短路。
    //      注入时把 U1、V1 两个端口强制并入同一簇（_faultShortGroups），
    //      相当于在电动机进线端 U、V 两相之间搭接一根零阻抗导线 → 相间短路。 ──
    motor_uv_short: {
        id: 'motor_uv_short',
        name: '主回路短路',
        system: '主回路',
        check() {
            const s = window.sys;
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(
                g => g[0] === 'im01_wire_u1' && g[1] === 'im01_wire_v1'));
        },
        trigger() {
            const s = window.sys;
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            this.repair();
            s._faultShortGroups.push(['im01_wire_u1', 'im01_wire_v1']);
        },
        repair() {
            const s = window.sys;
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(
                g => !(g[0] === 'im01_wire_u1' && g[1] === 'im01_wire_v1'));
        },
    },
    // ── 主回路故障：主回路缺相（KM1 主触头三相中随机一相接触不良 → 电机缺相运行）──
    //      通过给 km1-mc 的 _faultOpenPoles 随机置一相为 true，使该极主触头等效开路
    //      （DeviceStamps.stampMainContacts / CircuitUtils 均按此标志处理）。 ──
    phase_loss: {
        id: 'phase_loss',
        name: '主回路缺相',
        system: '主回路',
        check() {
            const mc = window.sys?.comps['km1-mc'];
            return !!(mc && mc._faultOpenPoles &&
                (mc._faultOpenPoles.l1 || mc._faultOpenPoles.l2 || mc._faultOpenPoles.l3));
        },
        trigger(fixedPole) {
            const mc = window.sys?.comps['km1-mc'];
            if (!mc) return;
            this.repair();
            const poles = ['l1', 'l2', 'l3'];
            const pole = (typeof fixedPole === 'string' && poles.includes(fixedPole))
                ? fixedPole
                : poles[Math.floor(Math.random() * poles.length)];
            mc._faultOpenPoles = { [pole]: true };
        },
        repair() {
            const mc = window.sys?.comps['km1-mc'];
            if (mc) mc._faultOpenPoles = {};
        },
    },
    km1coil_a1_poor: {
        id: 'km1coil_a1_poor',
        name: '控制回路开路（1号开路点）',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('km1-coil_wire_a1'); },
    },
    km1no1_com_poor: {
        id: 'km1no1_com_poor',
        name: '控制回路开路（2号开路点）',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-no1_wire_com'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-no1_wire_com'); },
        repair() { window.sys._poorContactPorts?.delete('km1-no1_wire_com'); },
    },
    // ── 控制回路开路：变压器副边熔断器 FU5 开路（把熔断器电阻注入为 10e9Ω）──
    ctrl_fuse_open: {
        id: 'ctrl_fuse_open',
        name: '控制回路开路（3号开路点）',
        system: '控制回路',
        check() {
            const f = window.sys?.comps['fu5'];
            return !!(f && f.isBlown && f.isBlown());
        },
        trigger() {
            const f = window.sys?.comps['fu5'];
            if (f && f.blow) f.blow(0);
        },
        repair() {
            const f = window.sys?.comps['fu5'];
            if (f && f.replace) f.replace(0);
        },
    },
    // ── 控制回路短路：KM1 线圈短路（把线圈电阻注入为 0.001Ω）──
    //    线圈回路接通时电流极大，控制回路熔断器 FU5 随即熔断切断回路。 ──
    km1_coil_short: {
        id: 'km1_coil_short',
        name: '控制回路短路',
        system: '控制回路',
        check() {
            const c = window.sys?.comps['km1-coil'];
            return !!(c && c._coilResistance <= 0.0011);
        },
        trigger() {
            const c = window.sys?.comps['km1-coil'];
            if (!c) return;
            if (c._origCoilR === undefined) c._origCoilR = c._coilResistance;
            c._coilResistance = 0.001;
            c.currentResistance = 0.001;
        },
        repair() {
            const c = window.sys?.comps['km1-coil'];
            if (!c) return;
            // 仅当线圈确实处于短路状态时才视为"修复"，并顺带更换因短路熔断的 FU5。
            // 否则（本故障本就未设置，只是"应用设置"时被逐个 repair）不应触碰 FU5，
            // 以免把其他故障（如"控制回路开路"把 FU5 熔断）一并撤销。
            const wasShorted = (c._origCoilR !== undefined) || (c._coilResistance < 0.01);
            if (c._origCoilR !== undefined) {
                c._coilResistance = c._origCoilR;
                c.currentResistance = c._origCoilR;
                c._origCoilR = undefined;
            } else {
                c._coilResistance = 1000;
                c.currentResistance = 1000;
            }
            if (wasShorted) {
                const fu5 = window.sys?.comps['fu5'];
                if (fu5 && fu5.isBlown && fu5.isBlown()) fu5.replace(0);
            }
        },
    },    
};

export const PROJECT_WORKFLOWS = {
    'forward-reverse-analysis': {
        id: 'forward-reverse-analysis', name: '1. 正反转控制电路分析',
        steps: [
            {
                msg: '第 1 步：自动接线并合上电源开关 QF，观察电动机是否自行起动',
                mode: 'check',
                op: [
                    {
                        type: 'wire', target: 'acb',
                        msg: '点击工具栏「自动接线」，完成主回路与控制回路的接线',
                        async act() {
                            const sys = this.sys;
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'switch', target: 'acb', part: 'breaker',
                        msg: '合上电源开关 QF（点击断路器触头区域）',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (acb && acb.close) acb.close();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机：控制回路未起动，电动机应保持静止（不自起动）',
                        async act() { await new Promise(r => setTimeout(r, 800)); },
                    },
                ],
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const motor = this.sys.comps['im01'];
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t1', 'im01_wire_u1')
                        && motor && Math.abs(motor.rpm) < 50;
                },
            },
            {
                msg: '第 2 步：按下正转起动按钮 SB2，观察 KM1 吸合、电动机正转运行',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按下正转起动按钮 SB2（KM1 线圈得电并自锁）',
                        async act() {
                            const ss = this.sys.comps['ss'];
                            const km1 = this.sys.comps['km1-mc'].deviceRef;
                            ss.setManualOverride(true);                 // 按下（显示按钮动作）
                            for (let i = 0; i < 120; i++) {
                                await new Promise(r => setTimeout(r, 30));
                                if (km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 2000)); // 保持按下 2s，待自锁触头闭合
                            ss.setManualOverride(false);                 // 松开，靠自锁保持
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机正转运行（转速约 1480 r/min，转动方向为正）',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > 1000;
                },
            },
            {
                msg: '第 3 步：按下停止按钮 SB1，观察 KM1 释放、电动机停止',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'sb', part: 'btn',
                        msg: '按下停止按钮 SB1（KM1 线圈失电，自锁解除）',
                        async act() {
                            const sb = this.sys.comps['sb'];
                            const km1 = this.sys.comps['km1-mc'].deviceRef;
                            sb.setManualOverride(true);                 // 按下（显示按钮动作）
                            // 保持按下，直到接触器确实失电（最多 3s）
                            for (let i = 0; i < 150; i++) {
                                await new Promise(r => setTimeout(r, 20));
                                if (!km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 1500)); // 保持按下可见
                            sb.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机停止（转速降至 0）',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > -500 && motor.rpm < 500;
                },
            },
            {
                msg: '第 4 步：按下反转起动按钮 SB3，观察 KM2 吸合、电动机反转运行',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'sb3', part: 'btn',
                        msg: '按下反转起动按钮 SB3（KM2 线圈得电并自锁，主触头交换两相）',
                        async act() {
                            const sb3 = this.sys.comps['sb3'];
                            const km2 = this.sys.comps['km2-mc'].deviceRef;
                            sb3.setManualOverride(true);                // 按下（显示按钮动作）
                            for (let i = 0; i < 120; i++) {
                                await new Promise(r => setTimeout(r, 30));
                                if (km2.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 2000)); // 保持按下 2s
                            sb3.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机反转运行（转速约 -1480 r/min，转动方向为反）',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm < -1000;
                },
            },
            {
                msg: '第 5 步：再次按下停止按钮 SB1，观察电动机停止',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'sb', part: 'btn',
                        msg: '按下停止按钮 SB1（KM2 线圈失电，电动机停止）',
                        async act() {
                            const sb = this.sys.comps['sb'];
                            const km2 = this.sys.comps['km2-mc'].deviceRef;
                            sb.setManualOverride(true);                 // 按下（显示按钮动作）
                            // 保持按下，直到接触器确实失电（最多 3s）
                            for (let i = 0; i < 150; i++) {
                                await new Promise(r => setTimeout(r, 20));
                                if (!km2.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 1500)); // 保持按下可见
                            sb.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机停止',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > -500 && motor.rpm < 500;
                },
            },
            {
                msg: '第 6 步：互锁验证——正转运行中按住反转按钮 SB3，观察电动机仍保持正转',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '先按下 SB2，使电动机正转运行',
                        async act() {
                            const ss = this.sys.comps['ss'];
                            const km1 = this.sys.comps['km1-mc'].deviceRef;
                            ss.setManualOverride(true);                 // 按下（显示按钮动作）
                            for (let i = 0; i < 120; i++) {
                                await new Promise(r => setTimeout(r, 30));
                                if (km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 2000)); // 保持按下 2s
                            ss.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 600));
                        },
                    },
                    {
                        type: 'btn', target: 'sb3', part: 'btn',
                        msg: '按住反转按钮 SB3：KM1 的常闭触头断开 KM2 线圈回路（互锁），KM2 无法吸合',
                        async act() {
                            const sb3 = this.sys.comps['sb3'];
                            sb3.setManualOverride(true);                // 按住不放（显示按钮动作）
                            await new Promise(r => setTimeout(r, 2000));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机仍保持正转（互锁起作用，SB3 无效）',
                        async act() { await new Promise(r => setTimeout(r, 800)); },
                    },
                    {
                        type: 'btn', target: 'sb3', part: 'btn',
                        msg: '松开反转按钮 SB3',
                        async act() {
                            this.sys.comps['sb3'].setManualOverride(false);
                            await new Promise(r => setTimeout(r, 600));
                        },
                    },
                ],
                check() {
                    const motor = this.sys.comps['im01'];
                    const sb3 = this.sys.comps['sb3'];
                    const km2 = this.sys.comps['km2-mc'].deviceRef;
                    return motor && motor.rpm > 1000 && sb3 && (sb3._manualPressed || sb3._isPressed) && !km2.isPickup();
                },
            },
            {
                msg: '第 7 步：测试题——互锁的作用', mode: 'quiz',
                quizConfig: {
                    question: '在正反转控制电路中，在 KM1、KM2 线圈回路中分别串入对方接触器的常闭触头（互锁）的主要目的是什么？',
                    options: [
                        '防止两个接触器同时吸合造成电源相间短路',
                        '提高电动机的起动转矩',
                        '实现电动机的调速',
                        '防止电动机过载',
                    ],
                    answer: 0,
                    analysis: '互锁（电气联锁）通过在 KM1 线圈回路中串入 KM2 的常闭触头、在 KM2 线圈回路中串入 KM1 的常闭触头实现。当 KM1 吸合后，其常闭触头断开 KM2 线圈回路使 KM2 无法吸合，反之亦然，从而保证任意时刻只有一个接触器吸合。若两个接触器同时吸合，其主触头会使电源两相短路。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 流程 2：主回路短路故障排除（断电测阻法）
    // ══════════════════════════════════════════════════════════════════
    'main-short-troubleshoot': {
        id: 'main-short-troubleshoot', name: '2. 主回路短路故障排除',
        steps: [
            {
                msg: '第 1 步：自动接线，合上电源开关 QF',
                mode: 'check',
                op: [
                    {
                        type: 'wire', target: 'acb',
                        msg: '点击工具栏「自动接线」，完成主回路与控制回路的接线',
                        async act() {
                            const sys = this.sys;
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'switch', target: 'acb',
                        msg: '合上电源开关 QF（点击断路器触头区域）',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (acb && acb.close) acb.close();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const acb = sys.comps['acb'];
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && acb && acb.isClosed();
                },
            },
            {
                msg: '第 2 步：触发主回路短路故障',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'motor_uv_short', target: 'im01',
                        msg: '打开「故障设置」界面，勾选「主回路短路」，点击「应用设置」',
                        // 故障设置由演示引擎 _introFault 走完整界面流程（指向按钮→打开→
                        // 指向复选框→勾选→指向"应用设置"→点击），此处不再重复注入。
                        async act() { await new Promise(r => setTimeout(r, 300)); },
                    },
                ],
                check() {
                    return this.sys.FAULT_CONFIG['motor_uv_short'].check();
                },
            },
            {
                msg: '第 3 步：按下正转起动按钮 SB2 起动电机，观察因短路空气开关 QF 立即脱扣',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按下起动按钮 SB2：KM1 吸合、电机得电，主回路短路 → 空气开关 QF 过流瞬时脱扣',
                        async act() {
                            const sys = this.sys;
                            const ss = sys.comps['ss'];
                            const acb = sys.comps['acb'];
                            ss.setManualOverride(true);            // 按下（显示按钮动作）
                            for (let i = 0; i < 150; i++) {
                                await new Promise(r => setTimeout(r, 20));
                                if (acb && acb.getState && acb.getState() === 'trip') break;
                            }
                            await new Promise(r => setTimeout(r, 1500));
                            ss.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'acb',
                        msg: '观察空气开关 QF 脱扣（触头处于 mid 位），主回路失电',
                        async act() { await new Promise(r => setTimeout(r, 600)); },
                    },
                ],
                check() {
                    const acb = this.sys.comps['acb'];
                    return acb && acb.getState && acb.getState() === 'trip';
                },
            },
            {
                msg: '第 4 步：按下 KM1 的动衔铁，模拟主触头闭合（便于断电测阻）',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'km1-mc',
                        msg: '将 QF 复位到分闸位；右键 KM1 主触头选择「模拟闭合」，使三极主触头强制闭合',
                        async act() {
                            const sys = this.sys;
                            const mc = sys.comps['km1-mc'];
                            if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(true);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const mc = this.sys.comps['km1-mc'];
                    return mc && mc.deviceRef && mc.deviceRef.getManualOverride() === true;
                },
            },
            {
                msg: '第 5 步：调出数字万用表，打到 200Ω 档，测量 L1、L2、L3 任意两相之间的电阻。阻值较小（几欧）说明无短路；接近 0Ω 说明这两相短路',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '点击工具栏「选择仪表」，勾选「数字万用表」并关闭界面（完整演示：指向按钮→打开→勾选→保存）',
                        // 仪表选择由演示引擎 _introInstrument 走完整界面流程（指向"选择仪表"按钮→
                        // 打开界面→指向并勾选"数字万用表"→指向"关闭"保存），此处仅做占位延时，
                        // 并负责把万用表切到 200Ω 电阻档。
                        async act() {
                            const sys = this.sys;
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.mode = 'RES200';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                                if (mm.group) {
                                    mm.group.visible(true);
                                }
                                if (mm.update) mm.update(0);
                            }
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '红、黑表笔分别接 KM1 主触头「进线端」L1、L3 两相端子（测 QF 以下整条通路的相间电阻）',
                        async act() {
                            // 表笔接主触头进线端 L1/L3（入口侧），可一并测到触头以下（含电机绕组）的通路
                            await _probeAnimated(this.sys, 'km1-mc_wire_l1', 'km1-mc_wire_l3');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '再测 L2、L3 两相：读数同样为十几欧（正常）',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l2', 'km1-mc_wire_l3');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '最后测 L1、L2 两相（U1、V1 短路所在相）：读数接近 0Ω → 判定这两相发生了短路',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l1', 'km1-mc_wire_l2');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测量完毕：拆除万用表表笔接线，收起万用表',
                        async act() {
                            const sys = this.sys;
                            sys.conns = sys.conns.filter(c => !(c.from.startsWith('multimeter') || c.to.startsWith('multimeter')));
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.group.visible(false);
                                mm.mode = 'OFF';
                            }
                            sys.redrawAll();
                            await new Promise(r => setTimeout(r, 900));
                        },
                    },
                ],
                check() {
                    const sys = this.sys;
                    // 判定依据：曾在 200Ω 档下测过主触头进线端两相之间的电阻
                    const mm = sys.comps['multimeter'];
                    const hasWire = (a, b) => sys.conns.some(c =>
                        c.type === 'wire' && ((c.from === a && c.to === b) || (c.from === b && c.to === a)));
                    const probedInlet = hasWire('multimeter_wire_v', 'km1-mc_wire_l1')
                        || hasWire('multimeter_wire_v', 'km1-mc_wire_l2')
                        || hasWire('multimeter_wire_v', 'km1-mc_wire_l3');
                    return probedInlet || (mm && mm.mode === 'RES200');
                },
            },
            {
                msg: '第 6 步：排除主电路短路故障，恢复供电，重新起动电机应正常运行',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'motor_uv_short', repair: true, target: 'im01',
                        msg: '打开「故障设置」界面，取消勾选「电动机 U1、V1 端子相间短路」，点击「应用设置」',
                        // 修复由演示引擎 _introFault 走完整界面流程（指向按钮→打开→
                        // 指向复选框→取消勾选→指向"应用设置"→点击），此处不再重复修复。
                        async act() { await new Promise(r => setTimeout(r, 300)); },
                    },
                    {
                        type: 'switch', target: 'km1-mc',
                        msg: '右键 KM1 主触头选择「模拟分闸」，解除强制闭合',
                        async act() {
                            const mc = this.sys.comps['km1-mc'];
                            if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 600));
                        },
                    },
                    {
                        type: 'switch', target: 'acb',
                        msg: '合上空气开关 QF，恢复主回路供电',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (!acb) return;
                            // QF 脱扣后需先复位到分闸位，再合闸
                            if (acb.getState && acb.getState() === 'trip' && acb._resetToOff) {
                                acb._resetToOff();
                                await new Promise(r => setTimeout(r, 600));
                            }
                            if (acb.close) acb.close();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按下起动按钮 SB2，电动机正常起动运行',
                        async act() {
                            const sys = this.sys;
                            const ss = sys.comps['ss'];
                            const km1 = sys.comps['km1-mc'].deviceRef;
                            ss.setManualOverride(true);
                            for (let i = 0; i < 150; i++) {
                                await new Promise(r => setTimeout(r, 20));
                                if (km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 2000));
                            ss.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const motor = sys.comps['im01'];
                    const acb = sys.comps['acb'];
                    return !sys.FAULT_CONFIG['motor_uv_short'].check()
                        && acb && acb.isClosed()
                        && motor && motor.rpm > 1000;
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 流程 3：主回路缺相故障排除（带电测压 + 断电测阻）
    // 说明：缺相为 KM1 主触头某一极接触不良（本演示固定为 L3-T3，W 相）
    // ══════════════════════════════════════════════════════════════════
    'phase-loss-troubleshoot': {
        id: 'phase-loss-troubleshoot', name: '3. 主回路缺相故障排除',
        steps: [
            {
                msg: '第 1 步：自动接线，合上电源开关 QF',
                mode: 'check',
                op: [
                    {
                        type: 'wire', target: 'acb',
                        msg: '点击工具栏「自动接线」，完成主回路与控制回路的接线',
                        async act() {
                            const sys = this.sys;
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'switch', target: 'acb',
                        msg: '合上电源开关 QF（点击断路器触头区域）',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (acb && acb.getState && acb.getState() === 'trip' && acb._resetToOff) {
                                acb._resetToOff();
                                await new Promise(r => setTimeout(r, 500));
                            }
                            if (acb && acb.close) acb.close();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const acb = sys.comps['acb'];
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && acb && acb.isClosed();
                },
            },
            {
                msg: '第 2 步：触发主回路缺相故障（KM1 主触头某一极接触不良）',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'phase_loss', target: 'km1-mc',
                        msg: '打开「故障设置」界面，勾选「主回路缺相」，点击「应用设置」',
                        // 由演示引擎 _introFault 走完整界面流程；此处固定缺相为 L3-T3（W 相）演示
                        async act() {
                            // 界面流程会随机选相，这里在应用后再固定为 L3，保证演示确定
                            const sys = this.sys;
                            sys.comps['km1-mc']._faultOpenPoles = { l3: true };
                            await new Promise(r => setTimeout(r, 300));
                        },
                    },
                ],
                check() {
                    const mc = this.sys.comps['km1-mc'];
                    return !!(mc && mc._faultOpenPoles && (mc._faultOpenPoles.l1 || mc._faultOpenPoles.l2 || mc._faultOpenPoles.l3));
                },
            },
            {
                msg: '第 3 步：按下正转起动按钮 SB2 起动电机。现象：电机有声音但不能起动 → 判定为主回路缺相',
                mode: 'check',
                op: [
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按住起动按钮 SB2：KM1 吸合，但电机因缺相无法建立旋转磁场（有声音、不转）',
                        async act() {
                            const sys = this.sys;
                            const ss = sys.comps['ss'];
                            const km1 = sys.comps['km1-mc'].deviceRef;
                            ss.setManualOverride(true);          // 按下（显示按钮动作）
                            for (let i = 0; i < 120; i++) {
                                await new Promise(r => setTimeout(r, 30));
                                if (km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 2500));  // 保持按住，观察电机不转
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机：缺相时电机发出异常声音但转速为零（无法起动）',
                        async act() { await new Promise(r => setTimeout(r, 1200)); },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '松开起动按钮 SB2',
                        async act() {
                            this.sys.comps['ss'].setManualOverride(false);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const motor = this.sys.comps['im01'];
                    const mc = this.sys.comps['km1-mc'];
                    const ss = this.sys.comps['ss'];
                    // 检测：起动按钮 SB2 已被按下（模拟按下或实际按下）
                    const pressed = !!(ss && (ss._manualPressed || ss._isPressed));
                    const faultOn = mc && mc._faultOpenPoles
                        && (mc._faultOpenPoles.l1 || mc._faultOpenPoles.l2 || mc._faultOpenPoles.l3);
                    return pressed && faultOn && motor && Math.abs(motor.rpm) < 50;
                },
            },
            {
                msg: '第 4 步：调出数字万用表，打到交流 500V 档，测量 KM1 主触头 3 个入口之间的电压，可判断电源（进线）是否缺相。测完撤销万用表接线',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '点击工具栏「选择仪表」，勾选「数字万用表」并关闭界面（完整演示：指向按钮→打开→勾选→保存）',
                        async act() {
                            const sys = this.sys;
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.mode = 'ACV500';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                                if (mm.group) {
                                    mm.group.visible(true);
                                }
                                if (mm.update) mm.update(0);
                            }
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '红、黑表笔接 KM1 主触头入口 L1、L2 两相：读数约 380V（电源正常）',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l1', 'km1-mc_wire_l2');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '再测入口 L2、L3 两相：读数约 380V（电源正常）',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l2', 'km1-mc_wire_l3');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '再测入口 L1、L3 两相：读数同样约 380V → 电源三相电压均正常，缺相不在电源侧',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l1', 'km1-mc_wire_l3');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测量完毕：拆除万用表表笔接线',
                        async act() {
                            const sys = this.sys;
                            sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
                            sys.redrawAll();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.group.visible() && mm.mode === 'ACV500';
                },
            },
            {
                msg: '第 5 步：断开电源开关 QF，模拟 KM1 主触头闭合（便于断电测阻）',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'acb',
                        msg: '断开电源开关 QF（分闸），主回路失电',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (acb && acb.open) acb.open();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'switch', target: 'km1-mc',
                        msg: '右键 KM1 主触头选择「模拟闭合」，使三极主触头强制闭合',
                        async act() {
                            const mc = this.sys.comps['km1-mc'];
                            if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(true);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const acb = this.sys.comps['acb'];
                    const mc = this.sys.comps['km1-mc'];
                    return acb && !acb.isClosed()
                        && mc && mc.deviceRef && mc.deviceRef.getManualOverride() === true;
                },
            },
            {
                msg: '第 6 步：万用表打到 R×200 档，测量接触器每相主触头「入口—出口」之间的电阻。若为 O.L（超量程）则表示该相触头接触不良。测完撤销接线、收起万用表',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '万用表旋到 R×200 电阻档',
                        async act() {
                            const sys = this.sys;
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.mode = 'RES200';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                                if (mm.update) mm.update(0);
                            }
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测 KM1 主触头 L1-T1 相：读数接近 0Ω（触头导通，正常）',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l1', 'km1-mc_wire_t1');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测 KM1 主触头 L2-T2 相：读数接近 0Ω（触头导通，正常）',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l2', 'km1-mc_wire_t2');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测 KM1 主触头 L3-T3 相（W 相）：读数为 O.L（超量程）→ 该相触头接触不良，即缺相所在',
                        async act() {
                            await _probeAnimated(this.sys, 'km1-mc_wire_l3', 'km1-mc_wire_t3');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测量完毕：拆除万用表表笔接线，收起万用表',
                        async act() {
                            const sys = this.sys;
                            sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.group.visible(false);
                                mm.mode = 'OFF';
                            }
                            sys.redrawAll();
                            await new Promise(r => setTimeout(r, 900));
                        },
                    },
                ],
                check() {
                    const mc = this.sys.comps['km1-mc'];
                    const mm = this.sys.comps['multimeter'];
                    return mc && mc.deviceRef && mc.deviceRef.getManualOverride() === true
                        && mm && mm.mode === 'RES200';
                },
            },
            {
                msg: '第 7 步：KM1 模拟闭合复位，修复主回路缺相故障',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'km1-mc',
                        msg: '右键 KM1 主触头选择「模拟分闸」，解除强制闭合',
                        async act() {
                            const mc = this.sys.comps['km1-mc'];
                            if (mc && mc.deviceRef) mc.deviceRef.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 600));
                        },
                    },
                    {
                        type: 'fault', fault: 'phase_loss', repair: true, target: 'km1-mc',
                        msg: '打开「故障设置」界面，取消勾选「主回路缺相」，点击「应用设置」，修复故障',
                        async act() { await new Promise(r => setTimeout(r, 300)); },
                    },
                ],
                check() {
                    const mc = this.sys.comps['km1-mc'];
                    return !(mc && mc._faultOpenPoles && (mc._faultOpenPoles.l1 || mc._faultOpenPoles.l2 || mc._faultOpenPoles.l3));
                },
            },
            {
                msg: '第 8 步：合上电源开关 QF，起动电机应正常运行',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'acb',
                        msg: '合上电源开关 QF，恢复供电',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (!acb) return;
                            if (acb.getState && acb.getState() === 'trip' && acb._resetToOff) {
                                acb._resetToOff();
                                await new Promise(r => setTimeout(r, 500));
                            }
                            if (acb.close) acb.close();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按下起动按钮 SB2，电动机正常起动运行',
                        async act() {
                            const sys = this.sys;
                            const ss = sys.comps['ss'];
                            const km1 = sys.comps['km1-mc'].deviceRef;
                            ss.setManualOverride(true);
                            for (let i = 0; i < 150; i++) {
                                await new Promise(r => setTimeout(r, 20));
                                if (km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 2000));
                            ss.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机正常正转运行（转速约 1480 r/min）',
                        async act() { await new Promise(r => setTimeout(r, 800)); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const motor = sys.comps['im01'];
                    const acb = sys.comps['acb'];
                    const mc = sys.comps['km1-mc'];
                    const noFault = !(mc && mc._faultOpenPoles && (mc._faultOpenPoles.l1 || mc._faultOpenPoles.l2 || mc._faultOpenPoles.l3));
                    return noFault && acb && acb.isClosed() && motor && motor.rpm > 1000;
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 流程 4：控制回路断路故障排除（3 号开路点 = 变压器副边熔断器 FU5 开路）
    // 说明：先用交流 500V 档判断控制变压器出口电源是否正常，再用 R×200 档
    //      测量熔断器 FU5 与热继电器辅助触点 FR 的电阻，定位 O.L 断点。
    // ══════════════════════════════════════════════════════════════════
    'ctrl-open-troubleshoot': {
        id: 'ctrl-open-troubleshoot', name: '4. 控制回路断路故障排除',
        steps: [
            {
                msg: '第 1 步：自动接线，合上电源开关 QF',
                mode: 'check',
                op: [
                    {
                        type: 'wire', target: 'acb',
                        msg: '点击工具栏「自动接线」，完成主回路与控制回路的接线',
                        async act() {
                            const sys = this.sys;
                            sys.conns.length = 0;
                            _autoWire(sys);
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'switch', target: 'acb',
                        msg: '合上电源开关 QF（点击断路器触头区域）',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (!acb) return;
                            if (acb.getState && acb.getState() === 'trip' && acb._resetToOff) {
                                acb._resetToOff();
                                await new Promise(r => setTimeout(r, 500));
                            }
                            if (acb.close) acb.close();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const acb = sys.comps['acb'];
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && acb && acb.isClosed();
                },
            },
            {
                msg: '第 2 步：触发控制回路 3 号开路故障（变压器副边熔断器 FU5 开路）',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'ctrl_fuse_open', target: 'fu5',
                        msg: '打开「故障设置」界面，勾选「控制回路开路（3号开路点）」，点击「应用设置」',
                        async act() { await new Promise(r => setTimeout(r, 300)); },
                    },
                ],
                check() {
                    return this.sys.FAULT_CONFIG['ctrl_fuse_open'].check();
                },
            },
            {
                msg: '第 3 步：观察现象——电源指示灯不亮；按下起动按钮 SB2 没有任何反应（KM1 不吸合）',
                mode: 'check',
                op: [
                    {
                        type: 'observe', target: 'hl-power',
                        msg: '观察白色（电源）指示灯：控制回路开路，电源指示灯不亮',
                        async act() { await new Promise(r => setTimeout(r, 1200)); },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按下起动按钮 SB2：KM1 线圈不得电，没有任何反应',
                        async act() {
                            const sys = this.sys;
                            const ss = sys.comps['ss'];
                            const km1 = sys.comps['km1-mc'].deviceRef;
                            ss.setManualOverride(true);            // 按下（显示按钮动作）
                            for (let i = 0; i < 120; i++) {
                                await new Promise(r => setTimeout(r, 25));
                                if (km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 1800)); // 保持按住，确认无反应
                            ss.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'km1-coil',
                        msg: '观察 KM1 线圈：无电压、不吸合（控制回路断路）',
                        async act() { await new Promise(r => setTimeout(r, 800)); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const km1 = sys.comps['km1-mc'].deviceRef;
                    const ss = sys.comps['ss'];
                    const fuseBlown = sys.FAULT_CONFIG['ctrl_fuse_open'].check();
                    // 检测：起动按钮 SB2 已被按下（模拟按下或实际按下），且 KM1 不吸合
                    const pressed = !!(ss && (ss._manualPressed || ss._isPressed));
                    return fuseBlown && pressed && !km1.isPickup();
                },
            },
            {
                msg: '第 4 步：调出数字万用表，打到交流 500V 档，测量控制变压器出口电源，确认电源正常。测完撤销万用表接线',
                mode: 'check',
                op: [
                    {
                        type: 'instrument', instrument: 'multimeter', target: 'multimeter',
                        msg: '点击工具栏「选择仪表」，勾选「数字万用表」并关闭界面（完整演示：指向按钮→打开→勾选→保存）',
                        async act() {
                            const sys = this.sys;
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.mode = 'ACV500';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                                if (mm.group) {
                                    mm.group.visible(true);
                                }
                                if (mm.update) mm.update(0);
                            }
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '红、黑表笔接控制变压器副边出口 s1、s2：读数约 220V → 变压器出口电源正常',
                        async act() {
                            await _probeAnimated(this.sys, 'tc_wire_s1', 'tc_wire_s2');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测量完毕：拆除万用表表笔接线',
                        async act() {
                            const sys = this.sys;
                            sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
                            sys.redrawAll();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                ],
                check() {
                    const mm = this.sys.comps['multimeter'];
                    return mm && mm.group.visible() && mm.mode === 'ACV500';
                },
            },
            {
                msg: '第 5 步：断开电源开关 QF，万用表打到 R×200 档，测量熔断器 FU5 和热继电器辅助触点 FR 的电阻。若为 O.L 表示该元件接触不良。测完撤销接线、收起万用表',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'acb',
                        msg: '断开电源开关 QF（分闸），切断控制回路电源，便于断电测阻',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (acb && acb.open) acb.open();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '万用表旋到 R×200 电阻档',
                        async act() {
                            const sys = this.sys;
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.mode = 'RES200';
                                if (mm._updateAngleByMode) mm._updateAngleByMode();
                                if (mm.update) mm.update(0);
                            }
                            await new Promise(r => setTimeout(r, 400));
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测变压器副边熔断器 FU5 的电阻（两端）：读数为 O.L（超量程）→ 该熔断器已熔断（断路）',
                        async act() {
                            await _probeAnimated(this.sys, 'fu5_wire_l', 'fu5_wire_t');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '测热继电器辅助触点 FR（常闭触点 com-nc）：读数接近 0Ω（触点正常，导通）',
                        async act() {
                            await _probeAnimated(this.sys, 'fr-nc_wire_com', 'fr-nc_wire_nc');
                        },
                    },
                    {
                        type: 'observe', target: 'multimeter',
                        msg: '对照判断：FU5 为 O.L（断点）、FR 触点导通 → 断点在熔断器 FU5。测完拆除表笔接线、收起万用表',
                        async act() {
                            const sys = this.sys;
                            sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
                            const mm = sys.comps['multimeter'];
                            if (mm) {
                                mm.group.visible(false);
                                mm.mode = 'OFF';
                            }
                            sys.redrawAll();
                            await new Promise(r => setTimeout(r, 900));
                        },
                    },
                ],
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const acb = this.sys.comps['acb'];
                    return acb && !acb.isClosed() && mm && mm.mode === 'RES200';
                },
            },
            {
                msg: '第 6 步：修复控制回路开路故障（更换熔断器 FU5）',
                mode: 'check',
                op: [
                    {
                        type: 'fault', fault: 'ctrl_fuse_open', repair: true, target: 'fu5',
                        msg: '打开「故障设置」界面，取消勾选「控制回路开路（3号开路点）」，点击「应用设置」，修复故障',
                        async act() { await new Promise(r => setTimeout(r, 300)); },
                    },
                ],
                check() {
                    return !this.sys.FAULT_CONFIG['ctrl_fuse_open'].check();
                },
            },
            {
                msg: '第 7 步：合上电源开关 QF，起动电机应正常运行',
                mode: 'check',
                op: [
                    {
                        type: 'switch', target: 'acb',
                        msg: '合上电源开关 QF，恢复供电',
                        async act() {
                            const acb = this.sys.comps['acb'];
                            if (!acb) return;
                            if (acb.getState && acb.getState() === 'trip' && acb._resetToOff) {
                                acb._resetToOff();
                                await new Promise(r => setTimeout(r, 500));
                            }
                            if (acb.close) acb.close();
                            await new Promise(r => setTimeout(r, 800));
                        },
                    },
                    {
                        type: 'btn', target: 'ss', part: 'btn',
                        msg: '按下起动按钮 SB2，电动机正常起动运行',
                        async act() {
                            const sys = this.sys;
                            const ss = sys.comps['ss'];
                            const km1 = sys.comps['km1-mc'].deviceRef;
                            ss.setManualOverride(true);
                            for (let i = 0; i < 150; i++) {
                                await new Promise(r => setTimeout(r, 20));
                                if (km1.isPickup()) break;
                            }
                            await new Promise(r => setTimeout(r, 2000));
                            ss.setManualOverride(false);
                            await new Promise(r => setTimeout(r, 1500));
                        },
                    },
                    {
                        type: 'observe', target: 'im01',
                        msg: '观察电动机正常正转运行（转速约 1480 r/min）',
                        async act() { await new Promise(r => setTimeout(r, 800)); },
                    },
                ],
                check() {
                    const sys = this.sys;
                    const motor = sys.comps['im01'];
                    const acb = sys.comps['acb'];
                    return !sys.FAULT_CONFIG['ctrl_fuse_open'].check()
                        && acb && acb.isClosed()
                        && motor && motor.rpm > 1000;
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 280, y: 30, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 280, y: 140, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    // 主回路：KM2（反转）主触头在左，KM1（正转）主触头在右
    { Class: MainContact, id: 'km2-mc', x: 10, y: 350, height: 105, deviceid: 'KM2', visible: true },
    { Class: MainContact, id: 'km1-mc', x: 270, y: 350, height: 105, deviceid: 'KM1', visible: true },
    // 热继电器整定值 = 电动机额定电流（由电机参数算得 ≈22A）。
    // 缺相运行时健康两相电流升至 ~1.7~2.3 倍（过载），热继电器按过载反时限动作；
    // 最小动作时间取 4s（叠加电流波动后实际约 5~7s），保证起动/运行缺相均不早于 ~5s 脱扣。
    { Class: ThermalHeatElement, id: 'fr', x: 270, y: 540, height: 100, deviceid: 'FR1', ratedCurrent: 22, tripClass: 20, minTripTime: 4, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 240, y: 700, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 0.12, B: 0.01, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // 控制回路：熔断器 → 控制变压器 → 停止按钮 → [正转支路|反转支路] → 热继电器常闭 → 熔断器 → 回到变压器
    { Class: SinglePhaseFuse, id: 'fu4', x: 480, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 620, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 780, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 780, y: 200, visible: true, label: 'SB1' },
    // ── 正转（KM1）自锁电路 ──
    { Class: DiagramStartButton, id: 'ss', x: 980, y: 190, visible: true, label: 'SB2' },
    { Class: AuxNOContact, id: 'km1-no1', x: 980, y: 300, deviceid: 'KM1', visible: true },
    { Class: AuxNCContact, id: 'km2-nc', x: 1190, y: 180, deviceid: 'KM2', visible: true },
    { Class: ContactorCoil, id: 'km1-coil', x: 1380, y: 200, deviceid: 'KM1', visible: true },
    // ── 反转（KM2）自锁电路（位于 KM1 自锁电路下方）──
    { Class: DiagramStartButton, id: 'sb3', x: 980, y: 400, visible: true, label: 'SB3' },
    { Class: AuxNOContact, id: 'km2-no1', x: 980, y: 500, deviceid: 'KM2', visible: true },
    { Class: AuxNCContact, id: 'km1-nc', x: 1190, y: 400, deviceid: 'KM1', visible: true },
    { Class: ContactorCoil, id: 'km2-coil', x: 1380, y: 400, deviceid: 'KM2', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 1350, y: 100, deviceid: 'FR1', visible: true },

    // ── 指示灯支路（三条支路并联，接在 KM2 线圈下方）──
    //    第一行：KM1-NO + 正转绿灯；第二行：KM2-NO + 反转红灯；第三行：电源黄灯（白色灯芯，点亮呈亮黄）。
    //    供电取自控制变压器副边下接线柱(s2)，回零接 KM2 线圈 a2（线圈公共回零线）。
    { Class: AuxNOContact, id: 'km1-lamp-no', x: 698, y: 530, deviceid: 'KM1', visible: true },
    { Class: SmallLamp, id: 'hl-green', x: 1390, y: 560, lampColor: 'green', ratedVoltage: 220, resistance: 20000, visible: true },
    { Class: AuxNOContact, id: 'km2-lamp-no', x: 848, y: 630, deviceid: 'KM2', visible: true },
    { Class: SmallLamp, id: 'hl-red', x: 1290, y: 660, lampColor: 'red', ratedVoltage: 220, resistance: 20000, visible: true },
    { Class: SmallLamp, id: 'hl-power', x: 1180, y: 760, lampColor: 'white', ratedVoltage: 220, resistance: 20000, visible: true },

    { Class: TsCurveDisplay, id: 'ts-curve', x: 1350, y: 100, visible: false, quadrants: 1 },
    { Class: Multimeter, id: 'multimeter', x: 1080, y: 440, visible: false },    
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1250, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：电源 → 断路器 → (KM2 ∥ KM1) 主触头 → 热继电器发热元件 → 电动机
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km2-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km2-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km2-mc_wire_l3', type: 'wire' },
        // KM1 正转：正常相序 U-V-W
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        // KM2 反转：交换 U/W 两相
        { from: 'km2-mc_wire_t1', to: 'fr_wire_l3', type: 'wire' },
        { from: 'km2-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km2-mc_wire_t3', to: 'fr_wire_l1', type: 'wire' },
        { from: 'fr_wire_t1', to: 'im01_wire_u1', type: 'wire' },
        { from: 'fr_wire_t2', to: 'im01_wire_v1', type: 'wire' },
        { from: 'fr_wire_t3', to: 'im01_wire_w1', type: 'wire' },
        { from: 'im01_wire_u2', to: 'im01_wire_v2', type: 'wire' },
        { from: 'im01_wire_v2', to: 'im01_wire_w2', type: 'wire' },
        // 控制回路电源：L3 → FU4 → 变压器一次侧 → L2
        { from: 'acb_wire_t3', to: 'fu4_wire_l', type: 'wire' },
        { from: 'fu4_wire_t', to: 'tc_wire_p1', type: 'wire' },
        { from: 'km1-mc_wire_l2', to: 'tc_wire_p2', type: 'wire' },
        // 控制回路：变压器副边下端(s2) → 停止按钮 SB1
        { from: 'tc_wire_s2', to: 'sb_wire_nc3', type: 'wire' },
        // SB1 输出 → 正转支路 / 反转支路
        { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
        { from: 'sb_wire_nc4', to: 'sb3_wire_no1', type: 'wire' },
        // 正转支路：SB2 ∥ KM1-NO 自锁 → KM2-NC 互锁 → KM1 线圈
        { from: 'ss_wire_no1', to: 'km1-no1_wire_com', type: 'wire' },
        { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
        { from: 'ss_wire_no2', to: 'km2-nc_wire_com', type: 'wire' },
        { from: 'km2-nc_wire_nc', to: 'km1-coil_wire_a1', type: 'wire' },
        // 反转支路：SB3 ∥ KM2-NO 自锁 → KM1-NC 互锁 → KM2 线圈
        { from: 'sb3_wire_no1', to: 'km2-no1_wire_com', type: 'wire' },
        { from: 'km2-no1_wire_no', to: 'sb3_wire_no2', type: 'wire' },
        { from: 'sb3_wire_no2', to: 'km1-nc_wire_com', type: 'wire' },
        { from: 'km1-nc_wire_nc', to: 'km2-coil_wire_a1', type: 'wire' },
        // 线圈汇合 → 热继电器常闭 → FU5 → 变压器副边上端(s1)
        { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'km2-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
        { from: 'fr-nc_wire_com', to: 'fu5_wire_t', type: 'wire' },
        { from: 'fu5_wire_l', to: 'tc_wire_s1', type: 'wire' },
        // ── 指示灯支路（三条并联，接在 KM2 线圈下方）──
        // 供电侧：控制变压器副边下接线柱(s2) → 绿灯开关(KM1-NO)左边 → 指示灯公共供电母线
        { from: 'tc_wire_s2', to: 'km1-lamp-no_wire_com', type: 'wire' },
        { from: 'km1-lamp-no_wire_com', to: 'km2-lamp-no_wire_com', type: 'wire' },
        { from: 'km2-lamp-no_wire_com', to: 'hl-power_wire_l', type: 'wire' },
        // 支路内部：KM1-NO → 正转绿灯；KM2-NO → 反转红灯（黄灯直通）
        { from: 'km1-lamp-no_wire_no', to: 'hl-green_wire_l', type: 'wire' },
        { from: 'km2-lamp-no_wire_no', to: 'hl-red_wire_l', type: 'wire' },
        // 回零侧：指示灯公共回零母线 → KM2 线圈 a2（线圈公共回零线）
        { from: 'hl-green_wire_r', to: 'hl-red_wire_r', type: 'wire' },
        { from: 'hl-red_wire_r', to: 'hl-power_wire_r', type: 'wire' },
        { from: 'km2-coil_wire_a2', to: 'hl-green_wire_r', type: 'wire' },
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

/**
 * 用动画方式接万用表表笔（两根，逐根 ~3s）。
 * 先清除万用表已有的表笔接线，再逐根动画接上。
 * @param {object} sys ControlSystem 实例
 * @param {string} redPort   红表笔接的端口
 * @param {string} blackPort 黑表笔接的端口
 */
async function _probeAnimated(sys, redPort, blackPort) {
    // 清除万用表旧连线（瞬时，不影响动画演示的观感）
    sys.conns = sys.conns.filter(c => !(String(c.from).startsWith('multimeter') || String(c.to).startsWith('multimeter')));
    sys.redrawAll();
    // 逐根动画接线（万用表表笔各 1 根，共 2 根，符合 ≤8 根用动画的要求）
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_v', to: redPort, type: 'wire' });
    await sys.connMgr.addConnectionAnimated({ from: 'multimeter_wire_com', to: blackPort, type: 'wire' });
    await new Promise(r => setTimeout(r, 1200));
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
