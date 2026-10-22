
// ══════════════════════════════════════════════════════════════════════════
//  三相异步电动机 星三角（Y-Δ）降压起动 —— PLC 控制实验
//
//  电路组成：
//    1) 主电路（AC 380V，原理图符号）：
//       三相电源 ac-3p → 总开关 QF → KM1 主触头 → 热继电器 FR 发热元件 → 电机 M(U1/V1/W1)
//       电机尾端 U2/V2/W2 由 KM2（星形，短接成中性点）/ KM3（三角形，U1↔W2、V1↔U2、W1↔V2）换接
//    2) 控制回路（DC 24V）：
//       24V 电位端子(pterm-24) 自上而下分三路：FR 常闭 → I0.2、停止按钮(常闭) → I0.1、起动按钮(常开) → I0.0
//    3) 输出回路：PLC Q0.0/Q0.1/Q0.2 → KM1/KM2/KM3 线圈（DC24V）→ 主电路 3 个主触头
//    4) 模拟量回路：转速变送器(4~20mA) → AI04 ch0 → PLC(AIW0→AQW0) → AQ04 ch0 → 数字转速表
//    5) PLC 本体：S7-200 SMART CPU ST20（12DI/8DO 晶体管源型），默认 STOP
//    6) 上位机：装有 STEP7 的 PC，网口 → PLC 以太网口
//
//  PLC 程序（I0.0 起动 / I0.1 停止常闭 / I0.2 FR 常闭）：
//    - 起动：M0.0 自锁，KM1、KM2 得电 → 星形降压起动；T37 延时 5s
//    - 5s 后：KM2 断电、KM3 得电 → 三角形全压运行
//    - 停止 / 过载：M0.0 复位，KM1、KM3 失电，电机停止
// ══════════════════════════════════════════════════════════════════════════

import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

// ── 本实验元件 ─────────────────────────────────────────────────────────
import { S7_200_SMART_ST20 } from '../components/S7_200_SMART_ST20.js'; // 西门子 S7-200 SMART CPU ST20
import { S7_200_EM_AI04 } from '../components/S7200_EM_AI04.js';       // 模拟量输入扩展模块 EM AI04
import { S7_200_EM_AQ04 } from '../components/S7200_EM_AQ04.js';       // 模拟量输出扩展模块 EM AQ04
import { STEP7PC } from '../components/STEP7PC.js';                    // 装有 STEP7 的上位机
import { PotentialTerminal } from '../components/PotentialTerminal.js'; // 24V 电位端子
import { DCPower } from '../components/DCPower.js';                     // 直流 24V 电源

// ── 主电路（原理图符号 + 组合设备）─────────────────────────────────────
import { DiagramACPower3P } from '../components/DiagramACPower3P.js';          // 三相电源（单线图符号）
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';  // 三相空气开关 QF
import { MainContact } from '../device/MainContact.js';                        // 接触器主触头 KM
import { ContactorCoil } from '../device/ContactorCoil.js';                    // 接触器线圈 KM
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';          // 热继电器 FR 发热元件
import { ThermalNCContact } from '../device/ThermalNCContact.js';              // 热继电器 FR 常闭触点
import { InductionMotor2 } from '../components/InductionMotor2.js';            // 三相异步电动机（六端子）

// ── 按钮 ───────────────────────────────────────────────────────────────
import { DiagramStopButton } from '../components/DiagramStopButton.js';        // 停止按钮（常闭）
import { DiagramStartButton } from '../components/DiagramStartButton.js';      // 起动按钮（常开）

// ── 模拟量回路 ─────────────────────────────────────────────────────────
import { SpeedTransmitter } from '../components/SpeedTransmitter.js';          // 转速变送器（4~20mA）
import { DigitalTachometer } from '../components/DigitalTachometer.js';        // 数字转速表

// ══════════════════════════════════════════════════════════════════════════
//  故障设置
//    · check()   —— 供故障面板同步勾选状态 / 演练评估
//    · trigger() —— 设置故障
//    · repair()  —— 修复故障（取消勾选）
// ══════════════════════════════════════════════════════════════════════════
export const FAULT_CONFIGS = {

    // ── 故障 1：FR 常闭触点接触不良 ─────────────────────────────────────
    // 在 FR 常闭触点接到 PLC 输入 I0.2 的端子上注入「接触不良」（该端子不参与
    // 拓扑 union，相当于开路），PLC 始终读不到 FR 反馈 → I0.2=0 → 无法起动/立即停机。
    fr_nc_poor: {
        id: 'fr_nc_poor',
        name: 'FR 常闭触点接触不良',
        system: '控制回路',
        check() {
            return !!(window.sys && window.sys._poorContactPorts
                && window.sys._poorContactPorts.has('fr-nc_wire_nc'));
        },
        trigger() {
            if (!window.sys) return;
            (window.sys._poorContactPorts ??= new Set()).add('fr-nc_wire_nc');
            window.sys.requestRedraw && window.sys.requestRedraw();
        },
        repair() {
            window.sys && window.sys._poorContactPorts && window.sys._poorContactPorts.delete('fr-nc_wire_nc');
            window.sys && window.sys.requestRedraw && window.sys.requestRedraw();
        },
    },

    // ── 故障 2：KM3（三角形接触器）线圈断线 ─────────────────────────────
    // 线圈断线后 KM3 永远无法吸合：星形起动正常，但 5s 后本应切换到三角形时
    // KM2 已释放、KM3 不吸合，电机断电停转。
    km3_coil_open: {
        id: 'km3_coil_open',
        name: 'KM3 三角形接触器线圈断线',
        system: '控制回路',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps['km3-coil'];
            return !!(c && c._faultCoilOpen);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps['km3-coil'];
            if (c) { c._faultCoilOpen = true; c.markDirty && c.markDirty(); }
            window.sys && window.sys.requestRedraw && window.sys.requestRedraw();
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps['km3-coil'];
            if (c) { c._faultCoilOpen = false; c.markDirty && c.markDirty(); }
            window.sys && window.sys.requestRedraw && window.sys.requestRedraw();
        },
    },

    // ── 故障 3：程序编写错误（KM2/KM3 的延时触点写反）───────────────────
    // 原程序：KM2(星) 用 T37 常闭、KM3(角) 用 T37 常开。
    // 错误程序：把两处写反 → KM2 用 T37 常开、KM3 用 T37 常闭。
    // 现象：一起动即 KM3 吸合（直接三角形全压起动），5s 后才切到星形。
    prog_t37_swap: {
        id: 'prog_t37_swap',
        name: 'PLC 程序错误',
        system: '程序',
        check() {
            const p = window.sys && window.sys.comps && window.sys.comps['plc-1'];
            if (!p) return false;
            // 错误程序中存在「AN T37 → = Q0.2」的组合（正确程序中该组合为 AN T37 → = Q0.1）
            return /AN\s+T37\s*[\r\n]+\s*=\s*Q0\.2/.test(p._programText || '');
        },
        trigger() {
            const p = window.sys && window.sys.comps && window.sys.comps['plc-1'];
            if (!p || typeof p.setProgram !== 'function') return;
            if (!p._faultProgBackup) p._faultProgBackup = p._programText;
            const bad = p._faultProgBackup
                .replace('LD     M0.0\nAN     T37\n=      Q0.1', 'LD     M0.0\nA      T37\n=      Q0.1')
                .replace('LD     M0.0\nA      T37\n=      Q0.2', 'LD     M0.0\nAN     T37\n=      Q0.2');
            p.setProgram(bad);
        },
        repair() {
            const p = window.sys && window.sys.comps && window.sys.comps['plc-1'];
            if (!p || typeof p.setProgram !== 'function') return;
            if (p._faultProgBackup) {
                p.setProgram(p._faultProgBackup);
                p._faultProgBackup = null;
            }
        },
    },
};

// ══════════════════════════════════════════════════════════════════════════
//  操作流程
//    1. 星三角降压起动（PLC 控制）—— 识别 / 接线 / 程序 / 运行 / 停止 / 过载
// ══════════════════════════════════════════════════════════════════════════
export const PROJECT_WORKFLOWS = {

    'yd-plc': {
        id: 'yd-plc',
        name: '1. 星三角降压起动（PLC 控制）',
        steps: [
            // ── 元件识别 ─────────────────────────────────────────────
            { mode: 'find', target: 'plc-1',
              msg: '1. 识别 PLC 主机（S7-200 SMART CPU ST20，12DI/8DO 晶体管输出）。' },
            { mode: 'find', target: 'ai04-1',
              msg: '2. 识别模拟量输入模块 EM AI04（转速变送器 4~20mA → 通道 0）。' },
            { mode: 'find', target: 'aq04-1',
              msg: '3. 识别模拟量输出模块 EM AQ04（通道 0 → 数字转速表）。' },
            { mode: 'find', target: 'ac-3p',
              msg: '4. 识别主电路三相电源（380V 三相交流）。' },
            { mode: 'find', target: 'qf',
              msg: '5. 识别主电路总开关 QF（三相空气开关，闭合后主电路得电）。' },
            { mode: 'find', target: 'km1-mc',
              msg: '6. 识别主接触器 KM1 的主触头（串接于电机主回路）。' },
            { mode: 'find', target: 'fr',
              msg: '7. 识别热继电器 FR 的发热元件（串接于主回路，过载时脱扣）。' },
            { mode: 'find', target: 'm2',
              msg: '8. 识别三相异步电动机 M（六端子：U1/V1/W1、U2/V2/W2）。' },
            { mode: 'find', target: 'km2-mc',
              msg: '9. 识别星形接触器 KM2 的主触头（将 U2/V2/W2 短接成中性点）。' },
            { mode: 'find', target: 'km3-mc',
              msg: '10. 识别三角形接触器 KM3 的主触头（将绕组换接成 Δ）。' },
            { mode: 'find', target: 'fr-nc',
              msg: '11. 识别 FR 常闭触点（过载反馈 → PLC 输入 I0.2）。' },
            { mode: 'find', target: 'sb-stop',
              msg: '12. 识别停止按钮 SB1（常闭触点 → 输入 I0.1）。' },
            { mode: 'find', target: 'sb-start',
              msg: '13. 识别起动按钮 SB2（常开触点 → 输入 I0.0）。' },

            // ── 14. 主电路接线 ──────────────────────────────────────
            {
                mode: 'check',
                msg: '14. 主电路接线：三相电源 → QF → KM1 主触头 → FR 发热元件 → 电动机 U1/V1/W1。',
                check() {
                    const s = this.sys, c = (a, b) => _hasConn(s, a, b);
                    return c('ac-3p_wire_u', 'qf_wire_l1') && c('ac-3p_wire_v', 'qf_wire_l2') && c('ac-3p_wire_w', 'qf_wire_l3')
                        && c('qf_wire_t1', 'km1-mc_wire_l1') && c('qf_wire_t2', 'km1-mc_wire_l2') && c('qf_wire_t3', 'km1-mc_wire_l3')
                        && c('km1-mc_wire_t1', 'fr_wire_l1') && c('km1-mc_wire_t2', 'fr_wire_l2') && c('km1-mc_wire_t3', 'fr_wire_l3')
                        && c('fr_wire_t1', 'm2_wire_u1') && c('fr_wire_t2', 'm2_wire_v1') && c('fr_wire_t3', 'm2_wire_w1');
                },
                op: [
                    { type: 'observe', target: 'ac-3p', msg: '三相电源 U/V/W → 总开关 QF 进线端',
                      async act() { await _wirePairs(this.sys, [['ac-3p_wire_u', 'qf_wire_l1'], ['ac-3p_wire_v', 'qf_wire_l2'], ['ac-3p_wire_w', 'qf_wire_l3']]); } },
                    { type: 'observe', target: 'qf', msg: 'QF 出线端 → KM1 主触头进线端',
                      async act() { await _wirePairs(this.sys, [['qf_wire_t1', 'km1-mc_wire_l1'], ['qf_wire_t2', 'km1-mc_wire_l2'], ['qf_wire_t3', 'km1-mc_wire_l3']]); } },
                    { type: 'observe', target: 'km1-mc', msg: 'KM1 主触头出线端 → 热继电器 FR 发热元件',
                      async act() { await _wirePairs(this.sys, [['km1-mc_wire_t1', 'fr_wire_l1'], ['km1-mc_wire_t2', 'fr_wire_l2'], ['km1-mc_wire_t3', 'fr_wire_l3']]); } },
                    { type: 'observe', target: 'fr', msg: 'FR 发热元件出线端 → 电动机首端 U1/V1/W1',
                      async act() { await _wirePairs(this.sys, [['fr_wire_t1', 'm2_wire_u1'], ['fr_wire_t2', 'm2_wire_v1'], ['fr_wire_t3', 'm2_wire_w1']]); } },
                ],
            },

            // ── 15. 星三角换接接线 ──────────────────────────────────
            {
                mode: 'check',
                msg: '15. 星三角换接接线：KM2 把 U2/V2/W2 短接成星点；KM3 把 U1↔W2、V1↔U2、W1↔V2 换接成三角形。',
                check() {
                    const s = this.sys, c = (a, b) => _hasConn(s, a, b);
                    return c('km2-mc_wire_l1', 'm2_wire_u2') && c('km2-mc_wire_l2', 'm2_wire_v2') && c('km2-mc_wire_l3', 'm2_wire_w2')
                        && c('km2-mc_wire_t1', 'km2-mc_wire_t2') && c('km2-mc_wire_t2', 'km2-mc_wire_t3')
                        && c('km3-mc_wire_l1', 'fr_wire_t1') && c('km3-mc_wire_l2', 'fr_wire_t2') && c('km3-mc_wire_l3', 'fr_wire_t3')
                        && c('km3-mc_wire_t1', 'm2_wire_w2') && c('km3-mc_wire_t2', 'm2_wire_u2') && c('km3-mc_wire_t3', 'm2_wire_v2');
                },
                op: [
                    { type: 'observe', target: 'km2-mc', msg: '星形 KM2：U2/V2/W2 接入 KM2，出线侧三相短接成中性点',
                      async act() { await _wirePairs(this.sys, [['km2-mc_wire_l1', 'm2_wire_u2'], ['km2-mc_wire_l2', 'm2_wire_v2'], ['km2-mc_wire_l3', 'm2_wire_w2'], ['km2-mc_wire_t1', 'km2-mc_wire_t2'], ['km2-mc_wire_t2', 'km2-mc_wire_t3']]); } },
                    { type: 'observe', target: 'km3-mc', msg: '三角形 KM3：U1↔W2、V1↔U2、W1↔V2 换接',
                      async act() { await _wirePairs(this.sys, [['km3-mc_wire_l1', 'fr_wire_t1'], ['km3-mc_wire_l2', 'fr_wire_t2'], ['km3-mc_wire_l3', 'fr_wire_t3'], ['km3-mc_wire_t1', 'm2_wire_w2'], ['km3-mc_wire_t2', 'm2_wire_u2'], ['km3-mc_wire_t3', 'm2_wire_v2']]); } },
                ],
            },

            // ── 16. 控制回路接线 ────────────────────────────────────
            {
                mode: 'check',
                msg: '16. 控制回路接线：24V 电位端子 → FR 常闭 → I0.2；→ 停止按钮（常闭）→ I0.1；→ 起动按钮（常开）→ I0.0。',
                check() {
                    const s = this.sys, c = (a, b) => _hasConn(s, a, b);
                    return c('pterm-24_wire_p', 'fr-nc_wire_com') && c('fr-nc_wire_nc', 'plc-1_wire_di02')
                        && c('pterm-24_wire_p', 'sb-stop_wire_nc3') && c('sb-stop_wire_nc4', 'plc-1_wire_di01')
                        && c('pterm-24_wire_p', 'sb-start_wire_no1') && c('sb-start_wire_no2', 'plc-1_wire_di00');
                },
                op: [
                    { type: 'observe', target: 'fr-nc', msg: '24V → FR 常闭（95-96）→ PLC 输入 I0.2',
                      async act() { await _wirePairs(this.sys, [['pterm-24_wire_p', 'fr-nc_wire_com'], ['fr-nc_wire_nc', 'plc-1_wire_di02']]); } },
                    { type: 'observe', target: 'sb-stop', part: 'btn', msg: '24V → 停止按钮（常闭）→ PLC 输入 I0.1',
                      async act() { await _wirePairs(this.sys, [['pterm-24_wire_p', 'sb-stop_wire_nc3'], ['sb-stop_wire_nc4', 'plc-1_wire_di01']]); } },
                    { type: 'observe', target: 'sb-start', part: 'btn', msg: '24V → 起动按钮（常开）→ PLC 输入 I0.0',
                      async act() { await _wirePairs(this.sys, [['pterm-24_wire_p', 'sb-start_wire_no1'], ['sb-start_wire_no2', 'plc-1_wire_di00']]); } },
                ],
            },

            // ── 17. 输出回路接线 + 扩展模块挂接 ─────────────────────
            {
                mode: 'check',
                msg: '17. 挂接扩展模块 AI04 → AQ04；连接电源和输入输出端子公共端；输出回路接线： KM1/KM2/KM3 线圈 。',
                check() {
                    const s = this.sys, c = (a, b) => _hasConn(s, a, b);
                    return c('dc24_wire_p', 'plc-1_wire_24v') && c('dc24_wire_n', 'plc-1_wire_v0')
                        && c('plc-1_wire_1m', 'plc-1_wire_v0') && c('plc-1_wire_1l', 'plc-1_wire_24v')
                        && c('plc-1_wire_dq00', 'km1-coil_wire_a1') && c('km1-coil_wire_a2', 'plc-1_wire_v0')
                        && c('plc-1_wire_dq01', 'km2-coil_wire_a1') && c('km2-coil_wire_a2', 'plc-1_wire_v0')
                        && c('plc-1_wire_dq02', 'km3-coil_wire_a1') && c('km3-coil_wire_a2', 'plc-1_wire_v0')
                        && ['ai04-1', 'aq04-1'].every(id => s.comps[id] && s.comps[id]._mounted);
                },
                op: [
                    { type: 'observe', target: 'ai04-1', msg: '扩展模块 AI04 → AQ04 依次挂接 CPU 右侧扩展总线',
                      async act() { _mountModules(this.sys); await _wait(700); } },
                    { type: 'observe', target: 'plc-1', part: 'term-24v', msg: '外部 24V 电源 → PLC 24V/0V；1M → 0V；1L+ → 24V',
                      async act() { await _wirePairs(this.sys, [['dc24_wire_p', 'plc-1_wire_24v'], ['dc24_wire_n', 'plc-1_wire_v0'], ['plc-1_wire_1m', 'plc-1_wire_v0'], ['plc-1_wire_1l', 'plc-1_wire_24v']]); } },
                    { type: 'observe', target: 'km1-coil', msg: 'Q0.0 → KM1 线圈 A1，A2 → 0V',
                      async act() { await _wirePairs(this.sys, [['plc-1_wire_dq00', 'km1-coil_wire_a1'], ['km1-coil_wire_a2', 'plc-1_wire_v0']]); } },
                    { type: 'observe', target: 'km2-coil', msg: 'Q0.1 → KM2 线圈 A1，A2 → 0V',
                      async act() { await _wirePairs(this.sys, [['plc-1_wire_dq01', 'km2-coil_wire_a1'], ['km2-coil_wire_a2', 'plc-1_wire_v0']]); } },
                    { type: 'observe', target: 'km3-coil', msg: 'Q0.2 → KM3 线圈 A1，A2 → 0V',
                      async act() { await _wirePairs(this.sys, [['plc-1_wire_dq02', 'km3-coil_wire_a1'], ['km3-coil_wire_a2', 'plc-1_wire_v0']]); } },
                ],
            },

            // ── 18. 模拟量回路接线 ──────────────────────────────────
            {
                mode: 'check',
                msg: '18. 模拟量回路：24V → 转速变送器 P，N → AI04 ch0+，ch0− → 0V；AQ04 ch0V → 数字转速表 sig，com → ch0M；上位机网口 → PLC。',
                check() {
                    const s = this.sys, c = (a, b) => _hasConn(s, a, b);
                    return c('plc-1_wire_24v', 'speed-tx_wire_p') && c('speed-tx_wire_n', 'ai04-1_wire_ai0p') && c('ai04-1_wire_ai0n', 'plc-1_wire_v0')
                        && c('aq04-1_wire_aq0v', 'digi-tach_wire_sig') && c('digi-tach_wire_com', 'aq04-1_wire_aq0m')
                        && c('step7pc-1_wire_lan', 'plc-1_wire_lan');
                },
                op: [
                    { type: 'observe', target: 'speed-tx', part: 'term-p', msg: '24V → 转速变送器 P（两线制回路正端）',
                      async act() { await _wirePairs(this.sys, [['plc-1_wire_24v', 'speed-tx_wire_p']]); } },
                    { type: 'observe', target: 'ai04-1', msg: '变送器 N → AI04 ch0+；ch0− → 0V（回路返回）',
                      async act() { await _wirePairs(this.sys, [['speed-tx_wire_n', 'ai04-1_wire_ai0p'], ['ai04-1_wire_ai0n', 'plc-1_wire_v0']]); } },
                    { type: 'observe', target: 'digi-tach', msg: 'AQ04 ch0V → 数字转速表 sig；com → ch0M',
                      async act() { await _wirePairs(this.sys, [['aq04-1_wire_aq0v', 'digi-tach_wire_sig'], ['digi-tach_wire_com', 'aq04-1_wire_aq0m']]); } },
                    { type: 'observe', target: 'step7pc-1', msg: 'STEP7 上位机网口 → PLC 以太网口',
                      async act() { await _wirePairs(this.sys, [['step7pc-1_wire_lan', 'plc-1_wire_lan']]); } },
                ],
            },

            // ── 19. 合闸 + RUN ──────────────────────────────────────
            {
                mode: 'check',
                msg: '19. 打开 24V 直流电源、合上总开关 QF，并将 PLC 由 STOP 拨到 RUN。',
                check() {
                    const s = this.sys, qf = s.comps['qf'], p = s.comps['plc-1'], dc = s.comps['dc24'];
                    return !!(dc && dc.isOn && qf && qf.isClosed() && p && p.mode === 'RUN');
                },
                op: [
                    { type: 'observe', target: 'fr', msg: '合闸前复位热继电器 FR（保证保护处于正常状态）',
                      async act() { const d = this.sys.comps['fr'].deviceRef; if (d && d.isTripped()) { d.setManualTrip(false); d.requestReset(); } await _wait(600); } },
                    { type: 'switch', target: 'dc24', part: 'power', msg: '点击电源键，打开 24V 直流电源（控制回路供电）',
                      async act() { const dc = this.sys.comps['dc24']; if (dc && !dc.isOn) { if (dc.powerBtnGroup) dc.powerBtnGroup.fire('mousedown'); if (!dc.isOn) dc.onConfigUpdate({ isOn: true }); } await _wait(600); } },
                    { type: 'switch', target: 'qf', msg: '合上总开关 QF，主电路接通三相电源',
                      async act() { const qf = this.sys.comps['qf']; if (qf && !qf.isClosed()) qf.close(); await _wait(900); } },
                    { type: 'switch', target: 'plc-1', part: 'mode-sw', msg: '将 PLC 的 RUN/STOP 开关拨到 RUN',
                      async act() { const p = this.sys.comps['plc-1']; if (p.mode !== 'RUN') p.toggleMode(); await _wait(700); } },
                ],
            },

            // ── 20. 星形起动 ────────────────────────────────────────
            {
                mode: 'check',
                msg: '20. 按下起动按钮 SB2：KM1、KM2 得电，电动机接成星形降压起动（绕组承受 220V），T37 开始 5s 计时，转速缓慢上升。',
                check() {
                    const s = this.sys, g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(g('km1-coil') && g('km1-coil').isPickup()
                        && g('km2-coil') && g('km2-coil').isPickup()
                        && g('km3-coil') && !g('km3-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '按下起动按钮 SB2（松开后由 PLC 程序自锁）→ KM1、KM2 得电，星形起动',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(2000); } },
                ],
            },

            // ── 21. 换接为三角形运行 ────────────────────────────────
            {
                mode: 'check',
                msg: '21. 等待 5s：T37 延时到，KM2 断电、KM3 得电，电动机换接为三角形全压运行，转速升至接近额定值。',
                check() {
                    const s = this.sys, g = id => s.comps[id] && s.comps[id].deviceRef, m = s.comps['m2'];
                    return !!(g('km1-coil').isPickup() && !g('km2-coil').isPickup() && g('km3-coil').isPickup()
                        && m && m.getSpeed() > 200);
                },
                op: [
                    { type: 'observe', target: 'km3-mc', msg: '延时 5s 到：KM2 释放、KM3 吸合，换接为三角形全压运行',
                      async act() { await _wait(9000); } },
                ],
            },


            // ── 22. 按下停止按钮 ────────────────────────────────────
            {
                mode: 'check',
                msg: '22. 按下停止按钮 SB1（常闭触点断开）：KM1、KM3 失电，电动机断电停机。',
                check() {
                    const s = this.sys, g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(g('km1-coil') && !g('km1-coil').isPickup()
                        && g('km2-coil') && !g('km2-coil').isPickup()
                        && g('km3-coil') && !g('km3-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-stop', part: 'btn', msg: '按下停止按钮 SB1（常闭断开）→ KM1、KM3 失电，电机停机',
                      async act() { const b = this.sys.comps['sb-stop']; b.setManualOverride(true); await _wait(600); b.setManualOverride(false); await _wait(2500); } },
                ],
            },

            // ── 23. 过载保护 ────────────────────────────────────────
            {
                mode: 'check',
                msg: '23. 重新起动电机。经参数配置界面加重电机负载，运行电流超过 FR 整定值，热继电器动作、FR 常闭断开 → KM1、KM3 失电，电机停止。',
                check() {
                    const s = this.sys, g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(s.comps['fr'] && s.comps['fr'].deviceRef && s.comps['fr'].deviceRef.isTripped()
                        && g('km1-coil') && !g('km1-coil').isPickup()
                        && g('km3-coil') && !g('km3-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '重新按下起动按钮，电机三角形全压运行',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(9000); } },
                    { type: 'observe', target: 'm2', msg: '经参数配置界面加重电机负载转矩（模拟过载/堵转工况）',
                      async act() { await _demoSetCfg(this, 'm2', 'loadTorque', 600, '加重负载转矩，使电机严重过载'); await _wait(12000); } },
                ],
            },


            // ── 24. 测验题 ──────────────────────────────────────────
            {
                mode: 'quiz',
                msg: '24. 测试题：星三角降压起动的电流与转矩。',
                quizConfig: {
                    question: '三相异步电动机采用星三角降压起动时，星形接法下的起动电流约为三角形直接起动时的多少倍？',
                    options: [
                        '1/3（约为直接起动的三分之一）',
                        '1/√3（约为 0.577 倍）',
                        '1/2',
                        '保持不变',
                    ],
                    answer: 0,
                    analysis: '星形接法时每相绕组电压为线电压的 1/√3（380V 线电压下绕组仅承受 220V）。起动电流与绕组电压成正比，故星形起动电流约为三角形直接起动的 1/3；起动转矩与电压平方成正比，也降为 1/3。因此星三角降压起动只适用于空载或轻载起动的场合。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 故障分析流程 1：FR 常闭触点接触不良
    //   起动系统 → 触发故障 → 起动电机观察 → 判断并测试 → 修复 → 再起动
    // ══════════════════════════════════════════════════════════════════
    'fault-fr-poor': {
        id: 'fault-fr-poor',
        name: '2. 故障分析：FR 常闭触点接触不良',
        steps: [
            // 1. 起动系统
            {
                mode: 'check',
                msg: '1. 点击「自动接线」完成全部接线，再点击「起动系统」上电并让 PLC 进入 RUN。',
                check() {
                    const s = this.sys;
                    return s.conns.length > 0 && s.comps['dc24'].isOn
                        && s.comps['qf'].isClosed() && s.comps['plc-1'].mode === 'RUN';
                },
                op: [
                    { type: 'wire', msg: '点击工具栏「自动接线」，完成全部接线（同时清除历史故障，使系统处于正常状态）',
                      async act() { const sys = this.sys; Object.values(sys.FAULT_CONFIG || {}).forEach(f => { try { f.repair(); } catch (e) { /* ignore */ } }); sys.applyAllPresets(); await _wait(700); } },
                    { type: 'wire', button: 'btnStartSys', msg: '点击「起动系统」：上电 + PLC 转 RUN',
                      async act() { await this.sys.applyStartSystem(); await _wait(900); } },
                ],
            },
            // 2. 触发故障
            {
                mode: 'check',
                msg: '2. 通过「故障设置」面板设置故障：FR 常闭触点接触不良。',
                check() { return this.sys.FAULT_CONFIG.fr_nc_poor.check(); },
                op: [
                    { type: 'fault', fault: 'fr_nc_poor', msg: '勾选「FR 常闭触点接触不良」并应用设置',
                      async act() { await _wait(400); } },
                ],
            },
            // 3. 起动电机 - 观察故障现象
            {
                mode: 'check',
                msg: '3. 按下起动按钮 SB2 观察现象：PLC 输入 I0.2（FR 反馈）丢失，KM1、KM2 均不吸合，电机无法起动。',
                check() {
                    const s = this.sys;
                    const btn = s.comps['sb-start'];
                    const flags = this._projFlag || (this._projFlag = {});
                    // 首次进入本步：清零"曾按下"标记，确保本步检测到的是重新按下按钮
                    if (!flags.frP3Checked) { flags.frP3Checked = true; if (btn) btn._everPressed = false; }
                    // ① 必须先检测到按下起动按钮的动作（_everPressed 在按钮被按下时置位）
                    const pressed = !!(btn && (btn._everPressed || btn._isPressed || btn._manualPressed));
                    if (!pressed) { flags.frP3T = null; return false; }
                    // ② 检测到按下动作后延迟 1s，供学员观察故障现象
                    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                    if (!flags.frP3T) flags.frP3T = now;
                    if (now - flags.frP3T < 1000) return false;
                    // ③ 再确认故障现象：I0.2=0、KM1 不吸合、电机未转
                    const ctx = s.s7200Solver && s.s7200Solver._plcs.get('plc-1');
                    const g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(ctx && !ctx.I[2]
                        && g('km1-coil') && !g('km1-coil').isPickup()
                        && Math.abs(s.comps['m2'].getSpeed()) < 20);
                },
                op: [
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '按下起动按钮 SB2，观察电机是否起动',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(1800); } },
                ],
            },
            // 4. 判断故障并测试
            {
                mode: 'quiz',
                msg: '4. 判断故障并测试：按下起动按钮电机毫无反应，PLC 输入 I0.2 始终为 0，最可能的原因是？',
                quizConfig: {
                    question: '按下起动按钮后电机完全无法起动，PLC 的输入 I0.2（接 FR 常闭触点）始终为 0。最可能的故障原因是？',
                    options: [
                        '主电路三相电源缺相',
                        'FR 常闭触点接触不良（过载反馈回路断开）',
                        'KM1 主触头熔焊',
                        '电机绕组断路',
                    ],
                    answer: 1,
                    analysis: '电机完全不动作、KM1 不吸合，说明 PLC 没有执行起动逻辑。I0.2 由 FR 常闭触点（95-96）经 +24V 提供，若 FR 触点接触不良则反馈回路断开、I0.2=0，起保停程序中串接的 I0.2 条件不满足，PLC 无法输出 Q0.0/Q0.1。可用万用表电压档测 FR 触点两端电压来判断。',
                },
            },
            // 5. 修复故障
            {
                mode: 'check',
                msg: '5. 通过「故障设置」面板取消勾选该故障并应用，修复 FR 触点接触不良。',
                check() { return !this.sys.FAULT_CONFIG.fr_nc_poor.check(); },
                op: [
                    { type: 'fault', fault: 'fr_nc_poor', repair: true, msg: '取消勾选「FR 常闭触点接触不良」并应用（修复）',
                      async act() { await _wait(400); } },
                ],
            },
            // 6. 起动电机
            {
                mode: 'check',
                msg: '6. 重新按下起动按钮：I0.2 恢复正常，KM1、KM2 得电作星形起动，5s 后切换为三角形运行。',
                check() {
                    const s = this.sys;
                    const ctx = s.s7200Solver && s.s7200Solver._plcs.get('plc-1');
                    const g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(ctx && ctx.I[2] && g('km1-coil') && g('km1-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '再次按下起动按钮，电机恢复正常起动',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(1800); } },
                ],
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 故障分析流程 2：KM3 三角形接触器线圈断线
    // ══════════════════════════════════════════════════════════════════
    'fault-km3-open': {
        id: 'fault-km3-open',
        name: '3. 故障分析：KM3 三角形接触器线圈断线',
        steps: [
            // 1. 起动系统
            {
                mode: 'check',
                msg: '1. 点击「自动接线」完成全部接线，再点击「起动系统」上电并让 PLC 进入 RUN。',
                check() {
                    const s = this.sys;
                    return s.conns.length > 0 && s.comps['dc24'].isOn
                        && s.comps['qf'].isClosed() && s.comps['plc-1'].mode === 'RUN';
                },
                op: [
                    { type: 'wire', msg: '点击工具栏「自动接线」，完成全部接线（同时清除历史故障，使系统处于正常状态）',
                      async act() { const sys = this.sys; Object.values(sys.FAULT_CONFIG || {}).forEach(f => { try { f.repair(); } catch (e) { /* ignore */ } }); sys.applyAllPresets(); await _wait(700); } },
                    { type: 'wire', button: 'btnStartSys', msg: '点击「起动系统」：上电 + PLC 转 RUN',
                      async act() { await this.sys.applyStartSystem(); await _wait(900); } },
                ],
            },
            // 2. 触发故障
            {
                mode: 'check',
                msg: '2. 通过「故障设置」面板设置故障：KM3 三角形接触器线圈断线。',
                check() { return this.sys.FAULT_CONFIG.km3_coil_open.check(); },
                op: [
                    { type: 'fault', fault: 'km3_coil_open', msg: '勾选「KM3 三角形接触器线圈断线」并应用设置',
                      async act() { await _wait(400); } },
                ],
            },
            // 3. 起动电机 - 观察故障现象
            {
                mode: 'check',
                msg: '3. 按下起动按钮观察：星形起动正常（KM1、KM2 吸合）；5s 后 PLC 输出 Q0.2 已置 1，但 KM3 线圈断线无法吸合、KM2 又已释放，电机失去角形回路而停转。',
                check() {
                    const s = this.sys;
                    const ctx = s.s7200Solver && s.s7200Solver._plcs.get('plc-1');
                    const g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(ctx && ctx.Q[2]
                        && g('km1-coil') && g('km1-coil').isPickup()
                        && g('km2-coil') && !g('km2-coil').isPickup()
                        && g('km3-coil') && !g('km3-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '按下起动按钮 SB2，先作星形起动',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(2500); } },
                    { type: 'observe', target: 'km3-coil', msg: '等待 5s 换接：KM2 释放、KM3 应吸合，观察 KM3 线圈不动作',
                      async act() { await _wait(10000); } },
                ],
            },
            // 4. 判断故障并测试
            {
                mode: 'quiz',
                msg: '4. 判断故障并测试：星形起动正常，5s 后无法切换到三角形、KM3 不吸合。原因是？',
                quizConfig: {
                    question: '电动机星形起动正常，延时 5s 后 PLC 的 Q0.2 已输出为 1，但 KM3 接触器不吸合、电机停转。最可能的故障是？',
                    options: [
                        'PLC 程序错误',
                        'KM3 接触器线圈断线（或线圈回路断路）',
                        'KM1 主触头接触不良',
                        '主电路电源缺相',
                    ],
                    answer: 1,
                    analysis: 'PLC 输出 Q0.2=1，说明程序逻辑正常；若 KM3 线圈断线（或线圈回路断路），线圈两端无法建立电压，接触器不能吸合。此时 KM2 已释放、KM3 未吸合，电机尾端悬空、失去回路而停转。可用万用表测 KM3 线圈 A1-A2 两端的电压与电阻来判断。',
                },
            },
            // 5. 修复故障
            {
                mode: 'check',
                msg: '5. 通过「故障设置」面板取消勾选该故障并应用，修复 KM3 线圈断线。',
                check() { return !this.sys.FAULT_CONFIG.km3_coil_open.check(); },
                op: [
                    { type: 'fault', fault: 'km3_coil_open', repair: true, msg: '取消勾选「KM3 三角形接触器线圈断线」并应用（修复）',
                      async act() { await _wait(400); } },
                ],
            },
            // 6. 起动电机
            {
                mode: 'check',
                msg: '6. 停止后重新起动电机：KM1、KM2 星形起动，5s 后 KM3 吸合切换为三角形运行，转速正常。',
                check() {
                    const s = this.sys;
                    const g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(g('km1-coil') && g('km1-coil').isPickup()
                        && g('km2-coil') && !g('km2-coil').isPickup()
                        && g('km3-coil') && g('km3-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-stop', part: 'btn', msg: '先按停止按钮复位（故障时电机已失控停转）',
                      async act() { const b = this.sys.comps['sb-stop']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(600); } },
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '重新按下起动按钮，恢复正常星三角起动',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(10000); } },
                ],
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════════
    // 故障分析流程 3：PLC 程序错误（KM2/KM3 延时触点写反）
    // ══════════════════════════════════════════════════════════════════
    'fault-prog-swap': {
        id: 'fault-prog-swap',
        name: '4. 故障分析：PLC 程序错误（KM2/KM3 延时触点写反）',
        steps: [
            // 1. 起动系统
            {
                mode: 'check',
                msg: '1. 点击「自动接线」完成全部接线，再点击「起动系统」上电并让 PLC 进入 RUN。',
                check() {
                    const s = this.sys;
                    return s.conns.length > 0 && s.comps['dc24'].isOn
                        && s.comps['qf'].isClosed() && s.comps['plc-1'].mode === 'RUN';
                },
                op: [
                    { type: 'wire', msg: '点击工具栏「自动接线」，完成全部接线（同时清除历史故障，使系统处于正常状态）',
                      async act() { const sys = this.sys; Object.values(sys.FAULT_CONFIG || {}).forEach(f => { try { f.repair(); } catch (e) { /* ignore */ } }); sys.applyAllPresets(); await _wait(700); } },
                    { type: 'wire', button: 'btnStartSys', msg: '点击「起动系统」：上电 + PLC 转 RUN',
                      async act() { await this.sys.applyStartSystem(); await _wait(900); } },
                ],
            },
            // 2. 触发故障
            {
                mode: 'check',
                msg: '2. 通过「故障设置」面板设置故障：PLC 程序编写错误（Q0.1 前用 T37 常开、Q0.2 前用 T37 常闭）。',
                check() { return this.sys.FAULT_CONFIG.prog_t37_swap.check(); },
                op: [
                    { type: 'fault', fault: 'prog_t37_swap', msg: '勾选「PLC 程序错误：KM2/KM3 延时触点写反」并应用设置',
                      async act() { await _wait(400); } },
                ],
            },
            // 3. 起动电机 - 观察故障现象
            {
                mode: 'check',
                msg: '3. 按下起动按钮观察：KM1、KM3 立即得电，电机直接以三角形全压起动（起动电流大），5s 后才切到星形——起停时序与正常相反。',
                check() {
                    const s = this.sys;
                    const ctx = s.s7200Solver && s.s7200Solver._plcs.get('plc-1');
                    const g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(ctx && ctx.Q[2] && !ctx.Q[1]
                        && g('km1-coil') && g('km1-coil').isPickup()
                        && g('km3-coil') && g('km3-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '按下起动按钮，观察起动时序（应一上电就出现 KM3 角形吸合）',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(2000); } },
                ],
            },
            // 4. 判断故障并测试
            {
                mode: 'quiz',
                msg: '4. 判断故障并测试：起动瞬间即为角形（KM3 先吸合），5s 后才切星形。原因是？',
                quizConfig: {
                    question: '按下起动按钮的瞬间 KM3（三角形）就先吸合、5s 后才切换到 KM2（星形），说明 PLC 程序中？',
                    options: [
                        '停止按钮接线错误',
                        'KM2/KM3 两个输出前面的时间继电器触点写反（Q0.1 前用 T37 常开、Q0.2 前用 T37 常闭）',
                        '模拟量模块地址错误',
                        '热继电器整定值太小',
                    ],
                    answer: 1,
                    analysis: '正常程序：Q0.1(KM2 星) 用 T37 常闭、Q0.2(KM3 角) 用 T37 常开——上电先星形、5s 后角形。若两处写反（Q0.1 前用 T37 常开、Q0.2 前用 T37 常闭），则上电即角形、5s 后星形，电机直接全压起动，失去降压起动的意义并产生很大的起动电流。应核对并重新下载正确程序。',
                },
            },
            // 5. 修复故障
            {
                mode: 'check',
                msg: '5. 通过「故障设置」面板取消勾选该故障并应用，恢复正确的 PLC 程序。',
                check() { return !this.sys.FAULT_CONFIG.prog_t37_swap.check(); },
                op: [
                    { type: 'fault', fault: 'prog_t37_swap', repair: true, msg: '取消勾选「PLC 程序错误」并应用（修复，恢复正确程序）',
                      async act() { await _wait(400); } },
                ],
            },
            // 6. 起动电机
            {
                mode: 'check',
                msg: '6. 停止后重新起动电机：KM1、KM2 先星形起动，5s 后 KM3 吸合切换为三角形运行，时序恢复正常。',
                check() {
                    const s = this.sys;
                    const g = id => s.comps[id] && s.comps[id].deviceRef;
                    return !!(g('km1-coil') && g('km1-coil').isPickup()
                        && g('km2-coil') && !g('km2-coil').isPickup()
                        && g('km3-coil') && g('km3-coil').isPickup());
                },
                op: [
                    { type: 'btn', target: 'sb-stop', part: 'btn', msg: '先按停止按钮，电机停机',
                      async act() { const b = this.sys.comps['sb-stop']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(600); } },
                    { type: 'btn', target: 'sb-start', part: 'btn', msg: '重新起动，恢复正常星三角时序',
                      async act() { const b = this.sys.comps['sb-start']; b.setManualOverride(true); await _wait(500); b.setManualOverride(false); await _wait(10000); } },
                ],
            },
        ],
    },
};

// ── ST20 用户程序：星三角降压起动 + 模拟量直通 ──────────────────────────
const PLC_PROGRAM = [
    '// ══ 三相异步电动机星三角降压起动（PLC 控制）══',
    '// I0.0 起动按钮(常开)  I0.1 停止按钮(常闭)  I0.2 热继电器 FR(常闭)',
    '// Q0.0 → KM1 主接触器   Q0.1 → KM2 星形接触器   Q0.2 → KM3 三角形接触器',
    '// 转速变送器 4~20mA → AI04 ch0(AIW0) → AQ04 ch0(AQW0) → 数字转速表',
    '',
    '// ── 1) 起保停运行位 M0.0：起动自锁，停止/过载复位 ──',
    'LD     I0.0',
    'O      M0.0',
    'A      I0.1          // 停止按钮常闭（未按=1）',
    'A      I0.2          // FR 常闭（未过载=1）',
    '=      M0.0',
    '',
    '// ── 2) 星→角换接延时 5s（T37 时基 1ms，5000×1ms = 5s）──',
    'LD     M0.0',
    'TON    T37, 5000',
    '',
    '// ── 3) KM1 主接触器：运行即吸合 ──',
    'LD     M0.0',
    '=      Q0.0',
    '',
    '// ── 4) KM2 星形接触器：运行且未到 5s ──',
    'LD     M0.0',
    'AN     T37',
    '=      Q0.1',
    '',
    '// ── 5) KM3 三角形接触器：运行且延时到达 ──',
    'LD     M0.0',
    'A      T37',
    '=      Q0.2',
    '',
    '// ── 6) 模拟量直通：AI04 ch0（转速）→ AQ04 ch0（数字转速表）──',
    'LD     SM0.0',
    'MOV_W  AIW0, AQW0',
    'END',
].join('\n');

export const componentConfigs = [
    // ══════════════ PLC 本体与扩展模块（中央区域）══════════════
    // CPU：西门子 S7-200 SMART CPU ST20（12DI/8DO/2AI/1AO，晶体管源型输出），默认 STOP
    { Class: S7_200_SMART_ST20, id: 'plc-1', x: 820, y: 200, scale: 1.0, label: 'ST20',
      mode: 'STOP',
      hostname: 'PLC-ST20', ip: '192.168.0.1', mask: '255.255.255.0',
      program: PLC_PROGRAM },

    // 扩展模块（串联 AI04 → AQ04，由「自动接线」自动挂接并对齐）
    { Class: S7_200_EM_AI04, id: 'ai04-1', x: 1280, y: 200, width: 115, height: 470, label: 'EM AI04', ch0mode: 'I4-20' },
    { Class: S7_200_EM_AQ04, id: 'aq04-1', x: 1425, y: 200, width: 115, height: 470, label: 'EM AQ04', ch0mode: 'I4-20' },

    // ══════════════ 主电路（原理图符号，画布左侧）══════════════
    // 三相电源 → QF → KM1 主触头 → FR 发热元件 → 电动机 U1/V1/W1
    { Class: DiagramACPower3P, id: 'ac-3p', x: 40, y: 20, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos' },
    { Class: DiagramThreePhaseACB, id: 'qf', x: 40, y: 100, width: 150, height: 115,
      initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 60 },
    { Class: MainContact, id: 'km1-mc', x: 20, y: 270, width: 220, height: 110, deviceid: 'KM1' },
    { Class: ThermalHeatElement, id: 'fr', x: 20, y: 430, width: 220, height: 110,
      deviceid: 'FR1', ratedCurrent: 25, noTripRatio: 8, tripClass: 10, minTripTime: 1 },
    { Class: InductionMotor2, id: 'm2', x: 20, y: 590, width: 200, height: 240, label: 'M1',
      R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
      R2: 0.46, Lsigma2: 0.00334,
      J: 1.0, B: 0.02, polePairs: 2,
      ratedPower: 11, ratedSpeed: 1440, loadTorque: 0 },

    // 星形 / 三角形接触器主触头（换接电机尾端 U2/V2/W2）
    { Class: MainContact, id: 'km2-mc', x: 20, y: 870, width: 200, height: 110, deviceid: 'KM2' },
    { Class: MainContact, id: 'km3-mc', x: 260, y: 660, width: 200, height: 110, deviceid: 'KM3' },

    // ══════════════ 控制回路电源与 24V 电位端子 ══════════════
    { Class: DCPower, id: 'dc24', x: 560, y: 560, voltage: 24, isOn: false },
    { Class: PotentialTerminal, id: 'pterm-24', x: 460, y: 160, potential: 24, scale: 1.2 },

    // ══════════════ 控制元件（pterm-24 后自上而下：FR 常闭 → 停止 → 起动）══════════════
    { Class: ThermalNCContact, id: 'fr-nc', x: 560, y: 230, width: 100, height: 80, deviceid: 'FR1', label: 'FR' },
    { Class: DiagramStopButton, id: 'sb-stop', x: 560, y: 320, label: 'SB1 停止' },
    { Class: DiagramStartButton, id: 'sb-start', x: 560, y: 410, label: 'SB2 起动', color: '#20a030' },

    // ══════════════ 接触器线圈（PLC 正下方，DC24V，由 Q0.0~Q0.2 驱动）══════════════
    { Class: ContactorCoil, id: 'km1-coil', x: 850, y: 800, width: 70, height: 50,
      deviceid: 'KM1', ratedCoilVoltage: 24, coilResistance: 240 },
    { Class: ContactorCoil, id: 'km2-coil', x: 990, y: 800, width: 70, height: 50,
      deviceid: 'KM2', ratedCoilVoltage: 24, coilResistance: 240 },
    { Class: ContactorCoil, id: 'km3-coil', x: 1130, y: 800, width: 70, height: 50,
      deviceid: 'KM3', ratedCoilVoltage: 24, coilResistance: 240 },

    // ══════════════ 上位机（装有 STEP7 编程软件）══════════════
    { Class: STEP7PC, id: 'step7pc-1', x: 900, y: 120,
      hostname: 'STEP7-PC', ip: '192.168.0.2', mask: '255.255.255.0' },

    // ══════════════ 模拟量 4~20mA 回路演示件 ══════════════
    // 转速变送器：取自电机 m2 实际转速，两线制输出 4~20mA（0~2000 r/min）
    { Class: SpeedTransmitter, id: 'speed-tx', x: 1580, y: 260,
      label: '转速变送器', sourceMotor: 'm2', rpmMin: 0, rpmMax: 2000 },
    // 数字转速表：接收 4~20mA 显示转速（0~2000 r/min）
    { Class: DigitalTachometer, id: 'digi-tach', x: 1580, y: 600,
      label: '数字转速表', rpmMin: 0, rpmMax: 2000, inputMode: 'I4-20' },

    // ══════════════ 7 种必备仪表（默认隐藏）══════════════
    { Class: Multimeter, id: 'multimeter', x: 620, y: 500, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1150, y: 250, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    { Class: RealMegohmMeter, id: 'megohm', x: 50, y: 50, visible: false },
];

// ── 电路连线 ────────────────────────────────────────────────────────────
function _wire(sys) {
    const conns = [
        // ══════════ 主电路：电源 → QF → KM1 → FR → 电机 U1/V1/W1 ══════════
        { from: 'ac-3p_wire_u', to: 'qf_wire_l1', type: 'wire' },
        { from: 'ac-3p_wire_v', to: 'qf_wire_l2', type: 'wire' },
        { from: 'ac-3p_wire_w', to: 'qf_wire_l3', type: 'wire' },
        { from: 'qf_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'qf_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'qf_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        { from: 'fr_wire_t1', to: 'm2_wire_u1', type: 'wire' },
        { from: 'fr_wire_t2', to: 'm2_wire_v1', type: 'wire' },
        { from: 'fr_wire_t3', to: 'm2_wire_w1', type: 'wire' },

        // ══════════ 三角形 KM3：U1↔W2、V1↔U2、W1↔V2 ══════════
        { from: 'km3-mc_wire_l1', to: 'fr_wire_t1', type: 'wire' },
        { from: 'km3-mc_wire_l2', to: 'fr_wire_t2', type: 'wire' },
        { from: 'km3-mc_wire_l3', to: 'fr_wire_t3', type: 'wire' },
        { from: 'km3-mc_wire_t1', to: 'm2_wire_w2', type: 'wire' },
        { from: 'km3-mc_wire_t2', to: 'm2_wire_u2', type: 'wire' },
        { from: 'km3-mc_wire_t3', to: 'm2_wire_v2', type: 'wire' },

        // ══════════ 星形 KM2：U2/V2/W2 短接成中性点 ══════════
        { from: 'km2-mc_wire_l1', to: 'm2_wire_u2', type: 'wire' },
        { from: 'km2-mc_wire_l2', to: 'm2_wire_v2', type: 'wire' },
        { from: 'km2-mc_wire_l3', to: 'm2_wire_w2', type: 'wire' },
        { from: 'km2-mc_wire_t1', to: 'km2-mc_wire_t2', type: 'wire' },
        { from: 'km2-mc_wire_t2', to: 'km2-mc_wire_t3', type: 'wire' },

        // ══════════ 控制回路输入：24V → FR 常闭 / 停止(NC) / 起动(NO) → DI ══════════
        { from: 'pterm-24_wire_p', to: 'fr-nc_wire_com', type: 'wire' },
        { from: 'fr-nc_wire_nc', to: 'plc-1_wire_di02', type: 'wire' },       // FR → I0.2
        { from: 'pterm-24_wire_p', to: 'sb-stop_wire_nc3', type: 'wire' },
        { from: 'sb-stop_wire_nc4', to: 'plc-1_wire_di01', type: 'wire' },    // 停止 → I0.1
        { from: 'pterm-24_wire_p', to: 'sb-start_wire_no1', type: 'wire' },
        { from: 'sb-start_wire_no2', to: 'plc-1_wire_di00', type: 'wire' },   // 起动 → I0.0

        // ══════════ PLC 供电与输出回路 ══════════
        { from: 'dc24_wire_p', to: 'plc-1_wire_24v', type: 'wire' },
        { from: 'dc24_wire_n', to: 'plc-1_wire_v0', type: 'wire' },
        { from: 'plc-1_wire_1m', to: 'plc-1_wire_v0', type: 'wire' },         // 输入公共端 1M → 0V
        { from: 'plc-1_wire_1l', to: 'plc-1_wire_24v', type: 'wire' },        // 输出负载电源 1L+ → 24V
        { from: 'plc-1_wire_dq00', to: 'km1-coil_wire_a1', type: 'wire' },
        { from: 'km1-coil_wire_a2', to: 'plc-1_wire_v0', type: 'wire' },
        { from: 'plc-1_wire_dq01', to: 'km2-coil_wire_a1', type: 'wire' },
        { from: 'km2-coil_wire_a2', to: 'plc-1_wire_v0', type: 'wire' },
        { from: 'plc-1_wire_dq02', to: 'km3-coil_wire_a1', type: 'wire' },
        { from: 'km3-coil_wire_a2', to: 'plc-1_wire_v0', type: 'wire' },

        // ══════════ 模拟量 4~20mA 回路 ══════════
        // 采集：24V → 转速变送器 P；N → AI04 ch0+；ch0− → 0V
        { from: 'plc-1_wire_24v', to: 'speed-tx_wire_p', type: 'wire' },
        { from: 'speed-tx_wire_n', to: 'ai04-1_wire_ai0p', type: 'wire' },
        { from: 'ai04-1_wire_ai0n', to: 'plc-1_wire_v0', type: 'wire' },
        // 输出：AQ04 ch0V → 数字转速表 sig；com → ch0M
        { from: 'aq04-1_wire_aq0v', to: 'digi-tach_wire_sig', type: 'wire' },
        { from: 'digi-tach_wire_com', to: 'aq04-1_wire_aq0m', type: 'wire' },

        // ══════════ 上位机网络 ══════════
        { from: 'step7pc-1_wire_lan', to: 'plc-1_wire_lan', type: 'wire' },
    ];
    conns.forEach(c => {
        const dup = sys.conns.some(e => sys.connMgr.connEqual(e, c));
        if (!dup) sys.connMgr.addConn(c);
    });
    sys.redrawAll();
}

export function initSlider(_sys) {
    // 自动演示时只保留箭头指示，不闪亮整个组件
    _sys._noBlinkHighlight = true;
}

/** 将两个扩展模块（AI04 → AQ04）顺次串联挂接到 CPU 扩展总线（无动画） */
function _mountModules(sys) {
    // 串联父子关系：plc-1 → ai04-1 → aq04-1（扩展链按单子节点顺次排列）
    const rels = [['ai04-1', 'plc-1'], ['aq04-1', 'ai04-1']];
    rels.forEach(([modId, parentId]) => {
        const mod = sys.comps[modId];
        if (mod && mod._parentExp !== parentId) mod._parentExp = parentId;
    });
    if (typeof sys._recomputeAllChains === 'function') sys._recomputeAllChains();
    if (typeof sys._layoutAttachedModules === 'function') sys._layoutAttachedModules();
}

// ══════════════════════════════════════════════════════════════════════
//  工作流辅助函数
// ══════════════════════════════════════════════════════════════════════

/** 判断两端口之间是否已连线 */
function _hasConn(sys, a, b) {
    return sys.conns.some(c => (c.from === a && c.to === b) || (c.from === b && c.to === a));
}

function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 动画接线（约 3s/根）；已连接的跳过，保证演示可重复运行 */
async function _wireAnim(sys, from, to) {
    if (_hasConn(sys, from, to)) return;
    await sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
}

/** 逐对动画接线后重绘 */
async function _wirePairs(sys, pairs) {
    for (const [from, to] of pairs) await _wireAnim(sys, from, to);
    sys.redrawAll();
}

/**
 * 经参数配置界面修改组件参数：弹出配置框 → 高亮并填入新值 → 高亮并点击「保存」。
 * （遵循「参数调整一律走配置界面」规范）
 */
async function _demoSetCfg(wf, compId, key, value, tip) {
    const comp = wf.sys.comps[compId];
    if (!comp) return;
    // 弹框前把实时属性同步进 config 副本，避免「保存」回写旧值
    if (typeof comp.getConfigFields === 'function') {
        comp.getConfigFields().forEach(f => {
            if (!f.get && comp[f.key] !== undefined && comp.config) comp.config[f.key] = comp[f.key];
        });
    }
    comp.showConfigDialog();
    await _wait(700);
    const input = document.getElementById('diag_' + key);
    if (input) {
        await wf._flashDomElement(input, tip, 2400);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await _wait(300);
    const btns = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === '保存');
    const btn = btns[btns.length - 1];
    if (btn) {
        await wf._flashDomElement(btn, '点击「保存」确认参数修改', 1800);
        btn.click();
    }
    await _wait(500);
    // 兜底：若对话框未关闭则关闭
    if (document.getElementById('diag_' + key)) {
        const closeBtn = [...document.querySelectorAll('button')].find(b => ['取消', '关闭'].includes(b.textContent.trim()));
        if (closeBtn) closeBtn.click();
    }
    // 生效兜底
    if (comp[key] === undefined || String(comp[key]) !== String(value)) {
        comp.onConfigUpdate({ [key]: value });
    }
}

export function applyAllPresets() {
    // 初始化（ControlSystem.init 调用，this 无 sys 引用）时不接线；
    // 仅当点击工具栏「自动接线」（WorkflowManager 调用，this.sys 存在）时才接好全部线。
    if (!(this && this.sys && this.sys.connMgr)) return;
    _mountModules(this.sys);
    _wire(this.sys);
}

export async function applyStartSystem() {
    if (!(this && this.sys && this.sys.connMgr)) return;
    _mountModules(this.sys);
    _wire(this.sys);
    // 打开 24V 直流电源（控制回路供电；初始为关闭，由「启动系统」上电）
    const dc = this.sys.comps['dc24'];
    if (dc && !dc.isOn && typeof dc.onConfigUpdate === 'function') dc.onConfigUpdate({ isOn: true });
    // 合上总开关 QF，主电路得电
    const qf = this.sys.comps['qf'];
    if (qf && typeof qf.close === 'function' && !qf.isClosed()) qf.close();
    // 「启动系统」同时将 PLC 转入 RUN，程序随即执行
    const plc = this.sys.comps['plc-1'];
    if (plc && plc.mode !== 'RUN' && typeof plc.toggleMode === 'function') plc.toggleMode();
}

export function fiveStep() { }
