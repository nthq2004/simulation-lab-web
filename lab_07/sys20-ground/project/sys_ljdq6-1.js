// 真空断路器功能仿真工程（断路器 + 汇流排 + 三相交流电源 + 24V 控制电源）

import { VacuumCircuitBreaker } from '../components/VacuumCircuitBreaker.js';
import { Busbar3P } from '../components/Busbar3P.js';
import { MarineHVGenerator } from '../components/MarineHVGenerator.js';
import { HvGenRemotePanel } from '../components/HvGenRemotePanel.js';
import { HvGenProtection } from '../components/HvGenProtection.js';
import { HvThreePhaseLoad } from '../components/HvThreePhaseLoad.js';
import { SimpleVCB } from '../components/SimpleVCB.js';
import { SimpleHVGenerator } from '../components/SimpleHVGenerator.js';
import { HvTransformer } from '../components/HvTransformer.js';
import { HvPowerOneLine } from '../components/HvPowerOneLine.js';
import { HvSwitchPanel } from '../components/HvSwitchPanel.js';
import { HvTester } from '../components/HvTester.js';
import { HvGroundMonitor } from '../components/HvGroundMonitor.js';
import { HvDischargeRod } from '../components/HvDischargeRod.js';
import { HvGroundingCable } from '../components/HvGroundingCable.js';
import { DiagramThreePhaseACB } from '../components/DiagramThreePhaseACB.js';
import { IncandescentLamp } from '../components/IncandescentLamp.js';
import { Resistor } from '../components/Resistor.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';

function _fcomp(id) {
    const s = window.sys;
    return s && s.comps && s.comps[id] ? s.comps[id] : null;
}

export const FAULT_CONFIGS = {
    // ── 1. 发电机出口相间短路：A/B 两相在发电机【出口】处强制短接。
    //      短路电流同时流经机端 CT 与中性点侧 CT（同一路径穿过整个绕组）→
    //      入口电流 ≈ 出口电流，差流 ≈ 0，差动保护不动作 → 由相间短路（速断）保护动作跳闸 ──
    gen_internal_short_ab: {
        id: 'gen_internal_short_ab', name: '1. 发电机出口两相短路', system: '发电机',
        check() {
            const s = window.sys;
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'gen_hv_wire_u' && g[1] === 'gen_hv_wire_v'));
        },
        trigger() {
            const s = window.sys;
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            this.repair();
            const g = ['gen_hv_wire_u', 'gen_hv_wire_v'];
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = window.sys;
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => !(x[0] === 'gen_hv_wire_u' && x[1] === 'gen_hv_wire_v'));
        },
    },
    // ── 1b. 发电机绕组中点相间短路：A 相绕组中点与 B 相绕组中点强制短接（内部短路）。
    //      两相中点短接形成的内部环流只流经绕组中性段（中性点侧 CT 回路），
    //      机端侧 CT（出口）几乎测不到电流 → 入口电流 >> 出口电流 → 差流大 → 差动保护动作跳闸 ──
    gen_winding_short_ab: {
        id: 'gen_winding_short_ab', name: '2. 发电机两相绕组中点短路', system: '发电机',
        check() {
            const s = window.sys;
            return !!(s && s._faultShortGroups && s._faultShortGroups.some(g => g[0] === 'gen_hv_wire_u_mid' && g[1] === 'gen_hv_wire_v_mid'));
        },
        trigger() {
            const s = window.sys;
            if (!s) return;
            if (!s._faultShortGroups) s._faultShortGroups = [];
            this.repair();
            const g = ['gen_hv_wire_u_mid', 'gen_hv_wire_v_mid'];
            s._faultShortGroups.push(g);
        },
        repair() {
            const s = window.sys;
            if (!s || !s._faultShortGroups) return;
            s._faultShortGroups = s._faultShortGroups.filter(x => !(x[0] === 'gen_hv_wire_u_mid' && x[1] === 'gen_hv_wire_v_mid'));
        },
    },
    // ── 2. 1号变压器严重散热不良：通电时温度线性上升（约 15s 到 130℃），
//      触发高温保护 3s 延时跳开上级断路器 vcbs3；跳闸断电后自动冷却到环境温度 ──
    tf1_cooling_fault: {
        id: 'tf1_cooling_fault', name: '3. 变压器严重散热不良', system: '变压器',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.tf1;
            return !!(c && c.isCoolingFault && c.isCoolingFault());
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.tf1;
            if (c && c.setCoolingFault) c.setCoolingFault(true);
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.tf1;
            if (c && c.setCoolingFault) c.setCoolingFault(false);
        },
    },
    // ── 3. 电网绝缘下降：绝缘测试支路电阻由 10MΩ 降为 10Ω → 接地电流剧增 ──
    insul_degraded: {
        id: 'insul_degraded', name: '3. 电网单相接地', system: '电网绝缘',
        check() {
            const c = window.sys && window.sys.comps && window.sys.comps.r_insul;
            return !!(c && c.currentResistance !== undefined && c.currentResistance < 1000);
        },
        trigger() {
            const c = window.sys && window.sys.comps && window.sys.comps.r_insul;
            if (c && typeof c.onConfigUpdate === 'function') c.onConfigUpdate({id: c.id, currentResistance: 10 });
        },
        repair() {
            const c = window.sys && window.sys.comps && window.sys.comps.r_insul;
            if (c && typeof c.onConfigUpdate === 'function') c.onConfigUpdate({id: c.id, currentResistance: 10000000 });
        },
    },
};

export const PROJECT_WORKFLOWS = {
    // ──────────────────────────────────────────────
    // 高压发电机差动电流超过阈值
    // 流程：自动接线 → 起动/合闸供电 → 设置绕组中点相间短路 →
    //       F1 观察入口/出口电流 → 修复故障+遥控面板复位+重新合闸 → 测试题
    // ──────────────────────────────────────────────
    'hv-gen-diff-overcurrent': {
        id: 'hv-gen-diff-overcurrent',
        name: '1.高压发电机差动电流超过阈值',
        steps: [
            // ── 步骤 1：自动接线，起动高压发电机并合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动发电机，待电压、频率稳定后，"合闸"供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // 初始化设备状态：发电机停机、断路器分闸、清除历史保护故障
                    const g = sys.comps.gen_hv, q = sys.comps.qf1, p = sys.comps.prot1;
                    const rep = id => { const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG[id]; if (f) f.repair(); };
                    rep('gen_winding_short_ab'); rep('gen_internal_short_ab');
                    if (q && q.getState() === 'on' && q.tryTrip) q.tryTrip();
                    if (g) { g.isOn = false; g.freq = 50; g._rmsI = 0; g._rmsV = 0; }
                    if (p) { p._tripped = false; p._active = 'normal'; p._phase = 'idle'; }
                    await _sleep(600);
                    // 断路器储能：24V 储能电机充电（直接置满，避免等待）
                    if (q) { q._chargeProg = 5; q._charged = true; }
                    // 遥控面板起动发电机（起停自复位开关：按下左半=起动，松手复位）
                    const hp = sys.comps.hvgp;
                    if (hp) { hp._startCmd = true; }
                    await _sleep(600);
                    if (hp) { hp._startCmd = false; }
                    await _sleep(2800);   // 等待马达起动、建压稳定（起动后 3s 稳定期不判故障）
                    // 遥控面板合闸（合分闸自复位开关：按下左半=合闸，松手复位）
                    if (hp) { hp._closeCmd = true; }
                    await _sleep(800);
                    if (hp) { hp._closeCmd = false; }
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const g = sys.comps.gen_hv, q = sys.comps.qf1;
                    return !!(g && g.isOn && q && q.isClosed());
                },
            },
            // ── 步骤 2：设置绕组中点相间短路，观察差动保护动作跳闸 ──
            {
                msg: '第 2 步：触发“发电机两相绕组中点短路"故障，观察微机综合保护装置差动保护动作：报警屏显示"差动跳闸"，真空断路器自动分闸',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_winding_short_ab'];
                    if (fault) fault.trigger();
                    // 等待差动保护动作（0.2s 确认后跳闸）与断路器分闸
                    const p = sys.comps.prot1, q = sys.comps.qf1;
                    for (let i = 0; i < 300; i++) {
                        if (p && p._tripped && q && q.getState() === 'off') break;
                        await _sleep(100);
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_winding_short_ab'];
                    const p = sys.comps.prot1, q = sys.comps.qf1;
                    return !!(fault && fault.check() && p && p._tripped && q && q.getState() === 'off');
                },
            },
            // ── 步骤 3：按 F1 观察入口（中性点侧）/出口（机端侧）电流 ──
            {
                msg: '第 3 步：在微机综合保护装置上按下 F1 键，观察入口（中性点侧）与出口（机端侧）三相电流：跳闸当刻 A/B 相入口电流远大于出口电流',
                mode: 'find',
                target: 'prot1',
                subTarget: 'f1',
                act() {
                    // 自动演示：模拟按下 F1，切换至电流屏
                    const p = this.sys && this.sys.comps && this.sys.comps.prot1;
                    if (p) { p._screen = 1; p._screenT = 0; }
                },
            },
            // ── 步骤 4：修复故障，遥控面板复位，重新合闸供电 ──
            {
                msg: '第 4 步：修复绕组中点短路，按遥控面板"复位"按钮解除保护闭锁，待断路器储能后重新合闸恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // 1) 修复故障：取消绕组中点短接
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_winding_short_ab'];
                    if (fault) fault.repair();
                    // 2) 等待电流滑窗衰减，故障源完全消失（否则保护装置拒复位）
                    await _sleep(2600);
                    // 3) 遥控面板复位：置复位请求，保护装置故障消失后解除跳闸闭锁
                    const p = sys.comps.prot1, hp = sys.comps.hvgp;
                    if (hp) hp._resetReq = true;
                    for (let i = 0; i < 100; i++) {
                        if (p && !p._tripped) break;
                        await _sleep(100);
                    }
                    if (hp) hp._resetReq = false;
                    // 4) 断路器储能并重新合闸
                    const q = sys.comps.qf1;
                    if (q) { q._chargeProg = 5; q._charged = true; }
                    if (q && q.tryClose) q.tryClose();
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['gen_winding_short_ab'];
                    const p = sys.comps.prot1, q = sys.comps.qf1;
                    return !!(fault && !fault.check() && p && !p._tripped && q && q.isClosed());
                },
            },
            // ── 步骤 5：测试题——高压发电机差动电流保护的作用 ──
            {
                msg: '第 5 步：测试题——高压发电机差动电流保护的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '高压发电机差动电流保护的主要作用是什么？',
                    options: [
                        '防止高压电网过载，正常运行时限制发电机输出电流',
                        '比较发电机机端（出口）与中性点（入口）两侧电流，当绕组内部发生相间短路等故障、差流超过整定值时瞬时跳闸，快速切除发电机内部故障',
                        '仅作为后备保护，故障时延时数秒后才动作',
                        '在发电机起动过程中屏蔽全部保护，防止误动作',
                    ],
                    answer: 1,
                    analysis: '差动电流保护是按基尔霍夫电流定律构成的发电机主保护：正常或外部故障时，机端（出口）与中性点（入口）两侧电流近似相等，差流≈0，保护不动作；当绕组内部发生相间短路（如本流程的绕组中点短路）时，流入与流出电流不一致产生差流，超过整定阈值即瞬时（约0.2s确认）跳闸，将故障发电机从电网切除，防止绕组烧毁。它只在发电机内部故障时动作，不做外部过载保护，也非延时后备保护——本流程 F1 电流屏实测 A/B 相入口 745.8A、出口≈0，差流超过阈值而动作。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 日用变压器高温导致跳闸保护
    // 流程：自动接线 → 1#发电机起动合闸 → 合高压母联 + 1#变压器高低压开关 + 低压母联 →
    //       白炽灯通电 → 触发变压器1严重散热不良 → 约 18s 后高温保护跳开断路器3 →
    //       切 2#变压器供电 → 修复散热故障
    // ──────────────────────────────────────────────
    'hv-tf1-overheat-trip': {
        id: 'hv-tf1-overheat-trip',
        name: '2.日用变压器高温导致跳闸保护',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 高压发电机并合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 高压发电机，待电压、频率稳定后"合闸"供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // ── 全系统复位：清除故障、断开断路器/开关、停发电机、解除保护 ──
                    const rep = id => { const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG[id]; if (f) f.repair(); };
                    rep('tf1_cooling_fault'); rep('gen_winding_short_ab'); rep('gen_internal_short_ab'); rep('insul_degraded');
                    ['qf1', 'vcbs', 'vcbs2', 'vcbs3', 'vcbs4'].forEach(id => {
                        const b = sys.comps[id];
                        if (b && b.getState && b.getState() === 'on' && b.tryTrip) b.tryTrip();
                    });
                    ['aq1', 'aq2', 'aq3'].forEach(id => {
                        const a = sys.comps[id];
                        if (a && a.isClosed && a.isClosed() && a.open) a.open();
                    });
                    const g = sys.comps.gen_hv;
                    if (g) { g.isOn = false; g.freq = 50; g._rmsI = 0; g._rmsV = 0; }
                    if (sys.comps.gen_s) { sys.comps.gen_s.isOn = false; }
                    const p = sys.comps.prot1;
                    if (p) { p._tripped = false; p._active = 'normal'; p._phase = 'idle'; }
                    await _sleep(500);
                    // 断路器储能
                    const q = sys.comps.qf1;
                    if (q) { q._chargeProg = 5; q._charged = true; }
                    // 遥控面板起动 1# 发电机（起停自复位开关：按下左半=起动，松手复位）
                    const hp = sys.comps.hvgp;
                    if (hp) { hp._startCmd = true; }
                    await _sleep(600);
                    if (hp) { hp._startCmd = false; }
                    await _sleep(2800);   // 马达起动、建压稳定
                    // 遥控面板合闸（合分闸自复位开关：按下左半=合闸，松手复位）
                    if (hp) { hp._closeCmd = true; }
                    await _sleep(800);
                    if (hp) { hp._closeCmd = false; }
                    await _sleep(1200);
                },
                check() {
                    const sys = this.sys;
                    const g = sys.comps.gen_hv, q = sys.comps.qf1;
                    return !!(g && g.isOn && q && q.isClosed());
                },
            },
            // ── 步骤 2：合高压母联、1#变压器高低压开关、低压母联，白炽灯通电 ──
            {
                msg: '第 2 步：合上高压母联断路器（vcbs2）；合上 1# 变压器高压供电断路器（vcbs3）与低压负荷开关（aq1）；合上低压母联开关（aq3），观察 440V 低压母线上白炽灯通电点亮',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const closeVCB = id => {
                        const b = sys.comps[id];
                        if (b) { b._isoClosed = true; if (b._syncWorkPos) b._syncWorkPos(); if (b.tryClose) b.tryClose(); }
                    };
                    const closeACB = id => {
                        const a = sys.comps[id];
                        if (a && a.close) a.close();
                    };
                    closeVCB('vcbs2');   // 高压母联
                    closeVCB('vcbs3');   // 1# 变压器高压供电开关
                    closeACB('aq1');     // 1# 变压器低压负荷开关
                    closeACB('aq3');     // 低压母联开关
                    await _sleep(2500);  // 变压器励磁、低压带载、白炽灯点亮
                },
                check() {
                    const sys = this.sys;
                    const closed = id => { const c = sys.comps[id]; return !!(c && c.isClosed && c.isClosed()); };
                    return closed('vcbs2') && closed('vcbs3') && closed('aq1') && closed('aq3') && _lampLit(sys);
                },
            },
            // ── 步骤 3：触发变压器1严重散热不良，约 18s 后高温保护跳闸 ──
            {
                msg: '第 3 步：触发 1# 变压器"严重散热不良"故障：变压器通电持续温升，约 15 秒升至 130℃；高温保护 3s 延时到期，自动分闸其高压供电断路器（vcbs3），变压器断电冷却，白炽灯熄灭',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['tf1_cooling_fault'];
                    if (fault) fault.trigger();
                    // 阶段一：等变压器温度升至动作阈值（40→130℃ 约 15s，帧率低时相应变慢）
                    const tf1 = sys.comps.tf1;
                    for (let i = 0; i < 900; i++) {
                        if (tf1 && tf1.getTemp && tf1.getTemp() >= 130) break;
                        await _sleep(100);
                    }
                    // 阶段二：高温保护 3s 延时到期，跳开 1# 变压器高压供电断路器（vcbs3）
                    const b3 = sys.comps.vcbs3;
                    for (let i = 0; i < 300; i++) {
                        if (b3 && !b3.isClosed()) break;
                        await _sleep(100);
                    }
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['tf1_cooling_fault'];
                    const b3 = sys.comps.vcbs3;
                    return !!(fault && fault.check() && b3 && !b3.isClosed());
                },
            },
            // ── 步骤 4：断开 aq1，切换 2# 变压器供电，白炽灯重新通电 ──
            {
                msg: '第 4 步：断开 1# 变压器低压负荷开关（aq1）隔离其低压侧；合上 2# 变压器高压供电断路器（vcbs4）与低压负荷开关（aq2），观察白炽灯重新通电点亮',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const a1 = sys.comps.aq1;
                    if (a1 && a1.open) a1.open();                          // 断开 1# 变压器低压负荷
                    const b4 = sys.comps.vcbs4;
                    if (b4) { b4._isoClosed = true; if (b4._syncWorkPos) b4._syncWorkPos(); if (b4.tryClose) b4.tryClose(); }  // 2# 变压器高压供电
                    const a2 = sys.comps.aq2;
                    if (a2 && a2.close) a2.close();                        // 2# 变压器低压负荷
                    await _sleep(2500);  // 2# 变压器励磁、白炽灯重新点亮
                },
                check() {
                    const sys = this.sys;
                    const closed = id => { const c = sys.comps[id]; return !!(c && c.isClosed && c.isClosed()); };
                    const openedAq1 = sys.comps.aq1 && !sys.comps.aq1.isClosed();
                    return openedAq1 && closed('vcbs4') && closed('aq2') && _lampLit(sys);
                },
            },
            // ── 步骤 5：修复变压器1通风不良故障，观察温度回落、高温保护解除 ──
            {
                msg: '第 5 步：修复 1# 变压器通风不良故障（取消故障勾选），观察温度回落，降至动作阈值回差（120℃）以下后高温保护解除',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['tf1_cooling_fault'];
                    if (fault) fault.repair();
                    // 等待变压器断电冷却，温度降至高温保护回差阈值以下（约 15s，帧率低时相应变慢）
                    const tf1 = sys.comps.tf1;
                    for (let i = 0; i < 600; i++) {
                        if (tf1 && tf1.getTemp && tf1.getTemp() < 120) break;
                        await _sleep(100);
                    }
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['tf1_cooling_fault'];
                    const tf1 = sys.comps.tf1;
                    return !!(fault && !fault.check() && tf1 && tf1.getTemp && tf1.getTemp() < 120);
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 左汇流排接地故障判断
    // 流程：自动接线起动供电 → 将 C 相绝缘电阻调为 10Ω 触发接地报警并消音消闪 →
    //       断开高压母联、报警仍保持（确认故障在左汇流排）→ 1# 机分闸停机 →
    //       调出手摇兆欧表逐相对地测量，找出故障接地相 → 测试题
    // ──────────────────────────────────────────────
    'hv-bus1-ground-fault': {
        id: 'hv-bus1-ground-fault',
        name: '3.左汇流排接地故障判断',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 高压发电机并合闸供电 ──
            {
                msg: '第 1 步：自动接线，起动 1# 高压发电机，待电压、频率稳定后"合闸"供电；再合上高压母联断路器（vcbs2），使左、右汇流排同时带电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    // ── 全系统复位：清除故障、断开断路器/开关、停发电机、解除保护 ──
                    const rep = id => { const f = sys.FAULT_CONFIG && sys.FAULT_CONFIG[id]; if (f) f.repair(); };
                    rep('insul_degraded'); rep('tf1_cooling_fault'); rep('gen_winding_short_ab'); rep('gen_internal_short_ab');
                    ['qf1', 'vcbs', 'vcbs2', 'vcbs3', 'vcbs4'].forEach(id => {
                        const b = sys.comps[id];
                        if (b && b.getState && b.getState() === 'on' && b.tryTrip) b.tryTrip();
                    });
                    ['aq1', 'aq2', 'aq3'].forEach(id => {
                        const a = sys.comps[id];
                        if (a && a.isClosed && a.isClosed() && a.open) a.open();
                    });
                    const g = sys.comps.gen_hv;
                    if (g) { g.isOn = false; g.freq = 50; g._rmsI = 0; g._rmsV = 0; }
                    if (sys.comps.gen_s) { sys.comps.gen_s.isOn = false; }
                    const p = sys.comps.prot1;
                    if (p) { p._tripped = false; p._active = 'normal'; p._phase = 'idle'; }
                    // 高压接地监视仪复位（清报警锁存与蜂鸣）
                    const mon = sys.comps.hv_ground_monitor;
                    if (mon) {
                        mon._latched = false; mon._ack = false; mon._fault = false;
                        mon._igFilt = 0; if (mon._beepStop) mon._beepStop();
                    }
                    // 兆欧表复位：断开测量接线、停止摇动、收回
                    const meg = sys.comps.megohm;
                    if (meg) {
                        for (const c of [...sys.conns]) {
                            if (c.from.startsWith('megohm_wire') || c.to.startsWith('megohm_wire')) sys.removeConn(c);
                        }
                        meg.setCranking(false); meg._demoMeasured = false;
                        if (meg.hide) meg.hide();
                    }
                    await _sleep(500);
                    // 断路器储能
                    const q = sys.comps.qf1;
                    if (q) { q._chargeProg = 5; q._charged = true; }
                    // 遥控面板起动 1# 发电机（起停自复位开关：按下左半=起动，松手复位）
                    const hp = sys.comps.hvgp;
                    if (hp) { hp._startCmd = true; }
                    await _sleep(600);
                    if (hp) { hp._startCmd = false; }
                    await _sleep(2800);   // 马达起动、建压稳定
                    // 遥控面板合闸（合分闸自复位开关：按下左半=合闸，松手复位）
                    if (hp) { hp._closeCmd = true; }
                    await _sleep(800);
                    if (hp) { hp._closeCmd = false; }
                    await _sleep(1200);
                    // 合上高压母联断路器（vcbs2）：左、右汇流排同时带电
                    const v2 = sys.comps.vcbs2;
                    if (v2) {
                        v2._isoClosed = true;
                        if (v2._syncWorkPos) v2._syncWorkPos();
                        if (v2.tryClose) v2.tryClose();
                    }
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const g = sys.comps.gen_hv, q = sys.comps.qf1, v2 = sys.comps.vcbs2;
                    return !!(g && g.isOn && q && q.isClosed() && v2 && v2.isClosed());
                },
            },
            // ── 步骤 2：C 相绝缘电阻降为 10Ω，触发接地报警，消音消闪 ──
            {
                msg: '第 2 步：将 C 相绝缘电阻降至 10Ω（设置"电网单相接地"故障）：绝缘监视仪检测到接地故障，报警灯红色闪烁、蜂鸣器鸣叫，观察后按"确认"按钮消音消闪（报警灯转为常亮）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['insul_degraded'];
                    if (fault) fault.trigger();
                    sys.showFloatingTip('C 相绝缘电阻已降为 10Ω：接地电流剧增，高压接地监视仪报警（红灯闪烁+鸣笛）');
                    // 等待监视仪检测到故障并锁存报警
                    const mon = sys.comps.hv_ground_monitor;
                    for (let i = 0; i < 150; i++) {
                        if (mon && mon._latched) break;
                        await _sleep(100);
                    }
                    await _sleep(800);
                    // 演示按下"确认"按钮：消音消闪，报警灯转为常亮
                    if (mon && mon._onAck) mon._onAck();
                    sys.showFloatingTip('已按"确认"按钮：蜂鸣停止、红灯转为常亮（故障未消除，报警保持）');
                    await _sleep(1200);
                },
                check() {
                    const sys = this.sys;
                    const fault = sys.FAULT_CONFIG && sys.FAULT_CONFIG['insul_degraded'];
                    const mon = sys.comps.hv_ground_monitor;
                    return !!(fault && fault.check() && mon && mon._fault && mon._latched && mon._ack && !mon._buzzOn);
                },
            },
            // ── 步骤 3：断开高压母联，报警未消除 → 确认左汇流排接地 ──
            {
                msg: '第 3 步：断开高压母联断路器（vcbs2）：右汇流排随之失电。报警灯仍保持常亮（故障在左汇流排 1# 发电机供电侧），由此确认故障点在左汇流排',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const b = sys.comps.vcbs2;
                    if (b && b.isClosed && b.isClosed() && b.tryTrip) b.tryTrip();
                    sys.showFloatingTip('高压母联已断开：右汇流排失电，但左汇流排 C 相接地故障仍在供电侧，监视仪报警保持 → 判断故障在左汇流排');
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    const b = sys.comps.vcbs2;
                    const mon = sys.comps.hv_ground_monitor;
                    return !!(b && !b.isClosed() && mon && mon._latched && mon._fault);
                },
            },
            // ── 步骤 4：1# 机分闸、停机（母线断电，才能安全测量） ──
            {
                msg: '第 4 步：将 1# 高压发电机分闸并停机：左汇流排完全失电（故障电流消失、泄漏消失），为手摇兆欧表测量绝缘创造条件',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const q = sys.comps.qf1;
                    if (q && q.isClosed && q.isClosed() && q.tryTrip) q.tryTrip();   // 分闸
                    await _sleep(600);
                    const g = sys.comps.gen_hv;
                    if (g) { g.isOn = false; g._rmsV = 0; g._rmsI = 0; }            // 停机
                    await _sleep(1500);
                    sys.showFloatingTip('1# 发电机已分闸并停机：母线失电，监视仪故障消失（报警记忆保持常亮，待复位）');
                    await _sleep(1000);
                },
                check() {
                    const sys = this.sys;
                    const q = sys.comps.qf1, g = sys.comps.gen_hv;
                    const mon = sys.comps.hv_ground_monitor;
                    return !!(q && !q.isClosed() && g && !g.isOn && mon && mon._latched && !mon._fault);
                },
            },
            // ── 步骤 5：调出手摇兆欧表，逐相对地测量，找到故障接地相 ──
            {
                msg: '第 5 步：调出手摇式兆欧表（2500V）：L 端依次接左汇流排 A/B/C 三相、E 端接地，摇动测量各相对地绝缘电阻，直到找到故障接地相',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const meg = sys.comps.megohm;
                    if (!meg) return;
                    if (meg.show) meg.show();
                    sys.showFloatingTip('调出手摇兆欧表（2500V）：E 端接地，L 端逐相测量左汇流排各相对地绝缘电阻');
                    await _sleep(900);
                    // E 端接地（接绝缘支路接地端）
                    sys.connMgr.addConn({ from: 'megohm_wire_e', to: 'gnd_insul_wire_gnd', type: 'wire' });
                    await _sleep(500);
                    const phases = [
                        ['bus1_wire_l1_5', 'A 相'],
                        ['bus1_wire_l2_5', 'B 相'],
                        ['bus1_wire_l3_5', 'C 相'],
                    ];
                    const results = [];
                    for (const [port, label] of phases) {
                        // 更换 L 端接线（先移除旧线）
                        for (const c of [...sys.conns]) {
                            if (c.from === 'megohm_wire_l' || c.to === 'megohm_wire_l') sys.removeConn(c);
                        }
                        sys.connMgr.addConn({ from: port, to: 'megohm_wire_l', type: 'wire' });
                        await _sleep(350);
                        meg.setCranking(true);           // 摇动手柄
                        await _sleep(2200);              // 指针稳定（实际读数直接取求解器等效电阻）
                        const rOhm = sys.voltageSolver._getEquivalentResistanceFromPorts('megohm', 'l', 'e');
                        const rM = (isFinite(rOhm) && rOhm >= 0) ? rOhm / 1e6 : Infinity;
                        results.push([label, rM]);
                        meg.setCranking(false);
                        await _sleep(600);
                    }
                    // 断开测量接线
                    for (const c of [...sys.conns]) {
                        if (c.from.startsWith('megohm_wire') || c.to.startsWith('megohm_wire')) sys.removeConn(c);
                    }
                    const fmt = r => (!isFinite(r) || r >= 20) ? '良好(绝缘正常)' : r.toFixed(2) + ' MΩ';
                    const bad = results.find(([, r]) => isFinite(r) && r < 1);
                    const summary = results.map(([l, r]) => `${l}: ${fmt(r)}`).join('，');
                    sys.showFloatingTip(
                        bad
                            ? `兆欧表逐相测量：${summary} → ${bad[0]}绝缘电阻仅 ${bad[1].toFixed(2)}MΩ（<1MΩ），判定左汇流排${bad[0]}接地！`
                            : `兆欧表逐相测量：${summary}`
                    );
                    await _sleep(2500);
                    meg._demoMeasured = true;            // 演示路径完成标记（供 check 双路径判定）
                    // 故障相已确认，复位监视仪报警记忆（故障已消失，可复位）
                    const mon = sys.comps.hv_ground_monitor;
                    if (mon && mon._onReset) mon._onReset();
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const meg = sys.comps.megohm;
                    if (!meg) return false;
                    // 演示路径（show/step 自动演示）已完成
                    if (meg._demoMeasured) return true;
                    // 学员实际操作路径：调出兆欧表、接好故障相并摇动，读数 <0.5MΩ 即找到接地相
                    if (meg.isCranking && meg.isCranking() && meg.getResistance() < 0.5) return true;
                    return false;
                },
            },
            // ── 步骤 6：测试题：高压电网测量绝缘的要求 ──
            {
                msg: '第 6 步：测试题——在高压电网上测量绝缘电阻的安全要求',
                mode: 'quiz',
                quizConfig: {
                    question: '在 6600V 船舶高压电网上测量各相对地绝缘电阻时，下列做法正确的是？',
                    options: [
                        '测量前不必停电，可带电直接摇测，方便实时监测绝缘',
                        '停电、验电、人工放电后，用 2500V 兆欧表逐相对地测量，测毕再次充分放电',
                        '用 500V 电压等级的摇表即可，电压等级越高反而越危险',
                        '测完一相对地绝缘后不必放电，可直接换接下一相继续测量',
                    ],
                    answer: 1,
                    analysis: '高压电网测量绝缘必须严格执行：① 断开电源并验电、人工放电，必要时挂接地线；② 使用 2500V 及以上电压等级的兆欧表逐相对地测量；③ 测量过程及测毕均应对被测相充分放电，防止剩余电荷伤人。本流程中 1# 发电机分闸停机、母线断电后，才安全地用兆欧表找出左汇流排 C 相接地（0.01MΩ）。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 真空断路器（VCB）隔离切换操作（五防教学）
    // 流程：合闸工作状态 → 五防题① → 分闸停机摇至试验位 → 五防题②③ →
    //       闭合接地开关 → 五防题④ → 开柜门检修 → 检修安全题 →
    //       关门断接地 → 摇回工作位重新供电 → 五防题⑤
    // ──────────────────────────────────────────────
    'hv-vcb-isolation': {
        id: 'hv-vcb-isolation',
        name: '4.真空断路器隔离切换操作',
        steps: [
            // ── 步骤 1：自动接线、起动发电机、合闸，建立工作状态 ──
            {
                msg: '第 1 步：自动接线，起动 1# 高压发电机，合上断路器向汇流排供电。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    _autoWire(sys);
                    await _sleep(400);
                    const g = sys.comps.gen_hv, q = sys.comps.qf1;
                    // 复位 VCB 到初始状态：连接位、分闸、柜门关、接地开关断开
                    if (q) {
                        q._animating = false;
                        q._state = 'off';
                        q._workPos = 0; q._detent = 0; q._isoT = 0; q._dialAngle = 0; q._clickAcc = 0;
                        q._doorOpen = false; q._doorSlide = 0;
                        q._gsSwitches = [false, false, false];
                        q._emLockUnlocked = false; q._crankInserted = false;
                        q._crankTurnCount = 0; q._crankRotation = 0; q._crankCur = 0;
                        q._chargeProg = 5; q._charged = true;
                    }
                    if (g) { g.isOn = false; g.freq = 0; g._rmsI = 0; g._rmsV = 0; }
                    await _sleep(500);
                    // 起动 1# 发电机并建压
                    if (g) { g.isOn = true; g.freq = 50; g._rmsV = 3810; }
                    await _sleep(1500);
                    // 储能后合闸
                    if (q) { q._chargeProg = 5; q._charged = true; q.tryClose(); }
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    const g = sys.comps.gen_hv, q = sys.comps.qf1;
                    return !!(g && g.isOn && q && q.isClosed() && q.getWorkPos() === 0);
                },
            },
            // ── 步骤 2：测试题①——合闸状态摇柄无法转动 ──
            {
                msg: '第 2 步：测试题——真空断路器合闸状态插入摇柄无法转动',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器处于合闸（连接位投入运行）状态时，插入摇柄试图摇动工作位转换机构，摇柄无法转动，这属于电气"五防"中的（　）。',
                    options: [
                        '防止误分、误合断路器',
                        '防止带负荷拉合隔离开关（防止带负荷摇动隔离手车）',
                        '防止带接地线合闸',
                        '防止误入带电间隔',
                    ],
                    answer: 1,
                    analysis: '断路器合闸即带负荷运行，此时工作位转换机构被机械闭锁，禁止摇动隔离手车——否则将造成带负荷拉、合隔离开关（隔离断口拉弧）的严重事故。这就是"五防"第二防：防止带负荷拉合隔离开关。本流程第 1 步合闸后，工作位锁定指示即为红色。',
                },
            },
            // ── 步骤 3：分闸、停机、摇至试验位 ──
            {
                msg: '第 3 步：断开真空断路器，停止发电机，将断路器由"连接位"摇至"试验位"',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const q = sys.comps.qf1, g = sys.comps.gen_hv;
                    // 分闸
                    if (q && q.isClosed() && q.tryTrip) q.tryTrip();
                    await _sleep(1400);
                    // 停机
                    if (g) { g.isOn = false; g.freq = 0; g._rmsI = 0; g._rmsV = 0; }
                    await _sleep(500);
                    // 工作位旋钮从"连接"转到"试验"（顺时针 3 次点动 = 1 档）
                    if (q) for (let i = 0; i < 3; i++) q._dialTurn(+1);
                    await _sleep(500);
                },
                check() {
                    const sys = this.sys;
                    const g = sys.comps.gen_hv, q = sys.comps.qf1;
                    return !!(q && !q.isClosed() && q.getWorkPos() === 1 && g && !g.isOn);
                },
            },
            // ── 步骤 4a：测试题②——合分闸按钮防护盖 ──
            {
                msg: '第 4 步（之一）：测试题——真空断路器合、分闸按钮的防护盖',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器的合、分闸按钮均设有防护玻璃盖，需先翻开防护盖才能操作按钮，这属于电气"五防"中的（　）。',
                    options: [
                        '防止带负荷拉合隔离开关',
                        '防止带接地线合闸',
                        '防止误分、误合断路器',
                        '防止带电合接地开关',
                    ],
                    answer: 2,
                    analysis: '合、分闸按钮加装防护盖，防止运行/检修中误碰、误触导致断路器误合闸或误跳闸——这是"五防"第一防：防止误分、误合断路器。操作时必须先开盖再按按钮，操作后随手关盖。',
                },
            },
            // ── 步骤 4b：测试题③——接地开关未合柜门无法打开 ──
            {
                msg: '第 4 步（之二）：测试题——接地开关未合上时柜门无法打开',
                mode: 'quiz',
                quizConfig: {
                    question: '断路器柜在接地开关尚未合上（负荷侧未可靠接地）时，柜门无法打开，这属于电气"五防"中的（　）。',
                    options: [
                        '防止误入带电间隔（未可靠接地前禁止开门进入柜内）',
                        '防止带负荷拉合隔离开关',
                        '防止误分、误合断路器',
                        '防止带接地线合闸',
                    ],
                    answer: 0,
                    analysis: '柜门与接地开关互为联锁：接地开关未合上、负荷侧未可靠接地，柜门被机械闭锁——只有在确认无电并可靠接地后才能开门检修，防止检修人员误入带电间隔，这就是"五防"第五防：防止误入带电间隔。',
                },
            },
            // ── 步骤 5：插入摇柄，闭合接地开关 ──
            {
                msg: '第 5 步：在试验位确认分闸且两侧无压后，插入摇柄，将三相接地开关闭合。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const q = sys.comps.qf1;
                    if (!q) return;
                    // 试验位、分闸、柜门关闭、两侧无压 → 电磁锁可解锁
                    q._emLockUnlocked = true;
                    q._crankInserted = true;
                    q._crankTurnCount = q._crankTargetTurns;
                    q._crankRotation = q._crankTargetTurns * 360;
                    q._updateGroundSwitchState();
                    await _sleep(700);
                },
                check() {
                    const sys = this.sys;
                    const q = sys.comps.qf1;
                    return !!(q && q.isGrounded());
                },
            },
            // ── 步骤 6：测试题④——接地开关闭合时合闸被闭锁 ──
            {
                msg: '第 6 步：测试题——接地开关闭合时断路器合闸被闭锁',
                mode: 'quiz',
                quizConfig: {
                    question: '接地开关处于闭合状态（负荷侧已接地）时，真空断路器的合闸被可靠闭锁、无法合闸，这属于电气"五防"中的（　）。',
                    options: [
                        '防止带电挂接地线',
                        '防止误分、误合断路器',
                        '防止带负荷拉合隔离开关',
                        '防止带接地线合闸',
                    ],
                    answer: 3,
                    analysis: '接地开关闭合说明线路已可靠接地，此时若再合闸送电将造成"带接地线（接地开关）合闸"——直接对地短路、动静触头严重烧毁。合闸回路在接地开关闭合时被机械+电气双重闭锁（合闸按钮盖也被锁死），这就是"五防"第四防：防止带接地线合闸。',
                },
            },
            // ── 步骤 7：打开柜门进行检修 ──
            {
                msg: '第 7 步：负荷侧已可靠接地，此时柜门解锁，打开柜门，进行检修',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const q = sys.comps.qf1;
                    if (q && q.isGrounded() && !q.isDoorOpen()) q.toggleDoor();
                    await _sleep(800);
                },
                check() {
                    const sys = this.sys;
                    const q = sys.comps.qf1;
                    return !!(q && q.isDoorOpen() && q.isGrounded());
                },
            },
            // ── 步骤 8：测试题⑤——检修过程中对人员的要求 ──
            {
                msg: '第 8 步：测试题——检修过程中对检修人员的要求',
                mode: 'quiz',
                quizConfig: {
                    question: '打开柜门对真空断路器进行检修时，对检修人员的要求是（　）。',
                    options: [
                        '检修时间紧，可一人独立作业，带电操作也没关系',
                        '检修人员应经安全培训并持证上岗；作业前先停电、验电、放电并挂接地线，悬挂"有人工作、禁止合闸"标示牌；至少两人配合，使用合格的绝缘安全工器具',
                        '只需戴普通棉纱手套即可保证安全',
                        '检修中可随意短接闭锁装置以简化操作',
                    ],
                    answer: 1,
                    analysis: '高压开关柜检修必须落实保证安全的组织措施和技术措施：持证上岗、工作票制度、至少两人作业；停电→验电→放电→挂接地线→悬挂警示牌、装设遮栏；使用合格绝缘工器具；严禁擅自解除闭锁，确需解锁须经批准并采取防误措施。',
                },
            },
            // ── 步骤 9：关闭柜门，断开接地开关 ──
            {
                msg: '第 9 步：检修完毕，关闭柜门；将三相接地开关断开',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const q = sys.comps.qf1;
                    if (!q) return;
                    // 关闭柜门
                    if (q.isDoorOpen()) q.toggleDoor();
                    await _sleep(600);
                    // 逆摇断开接地开关
                    q._emLockUnlocked = true;
                    q._crankInserted = true;
                    q._crankTurnCount = 0;
                    q._crankRotation = 0;
                    q._updateGroundSwitchState();
                    await _sleep(600);
                },
                check() {
                    const sys = this.sys;
                    const q = sys.comps.qf1;
                    return !!(q && !q.isDoorOpen() && !q.isGrounded());
                },
            },
            // ── 步骤 10：摇回工作位，起动发电机，合闸供电 ──
            {
                msg: '第 10 步：将断路器由"试验位"摇回"连接位"，重新起动 1# 机，合闸恢复供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const q = sys.comps.qf1, g = sys.comps.gen_hv;
                    if (!q) return;
                    // 接地已断开、分闸状态 → 工作位旋钮转回"连接"（逆时针 3 次点动 = 1 档）
                    for (let i = 0; i < 3; i++) q._dialTurn(-1);
                    await _sleep(500);
                    if (q._workPos === 0) q._syncMainCircuits();
                    // 重新起动发电机建压
                    if (g) { g.isOn = true; g.freq = 50; g._rmsV = 3810; }
                    await _sleep(1500);
                    // 储能后合闸
                    if (q) { q._chargeProg = 5; q._charged = true; q.tryClose(); }
                    await _sleep(1800);
                },
                check() {
                    const sys = this.sys;
                    const g = sys.comps.gen_hv, q = sys.comps.qf1;
                    return !!(q && q.getWorkPos() === 0 && q.isClosed() && g && g.isOn);
                },
            },
            // ── 步骤 11：测试题⑥——断路器合闸时接地开关被闭锁 ──
            {
                msg: '第 11 步：测试题——断路器合闸状态下接地开关被闭锁',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器处于合闸（带电运行）状态时，接地开关被闭锁、无法合上，这属于电气"五防"中的（　）。',
                    options: [
                        '防止带接地线合闸',
                        '防止带电合接地开关（防止带电挂接地线）',
                        '防止误分、误合断路器',
                        '防止带负荷拉合隔离开关',
                    ],
                    answer: 1,
                    analysis: '断路器合闸即负荷侧带电，此时接地开关（电磁锁/机械联锁）被可靠闭锁，摇柄无法插入、接地开关无法合上——防止带电挂接地线（合接地开关）导致人身与设备事故，这就是"五防"第三防的另一面：防止带电合接地开关。与本流程步骤 6 的"防带接地线合闸"构成接地开关与断路器的双向互锁。',
                },
            },
        ],
    },
    // ──────────────────────────────────────────────
    // 微机综合保护装置说明
    // 识装置 → CT/PT 采样（填空）→ 信号传递关系（选择）→ 高压特有保护 → 相间短路差动跳闸
    // ──────────────────────────────────────────────
    'hv-prot-intro': {
        id: 'hv-prot-intro',
        name: '5.微机综合保护装置说明',
        steps: [
            // ── 步骤 1：识别微机综合保护装置 ──
            {
                msg: '第 1 步：在画面上找到并点击 1# 高压发电机的微机综合保护装置。',
                mode: 'find',
                target: 'prot1',
            },
            // ── 步骤 2：填空题——采样互感器 ──
            {
                msg: '第 2 步：填空题——微机保护装置采集输入信号所用的互感器',
                mode: 'fill',
                target: 'prot1',
                fields: [
                    { label: '电流', answer: ['电流互感器', 'ct'], placeholder: '如：电流互感器 或 CT' },
                    { label: '电压', answer: ['电压互感器', 'pt'], placeholder: '如：电压互感器 或 PT' },
                ],
            },
            // ── 步骤 3：测试题——信号传递关系 ──
            {
                msg: '第 3 步：测试题——数字式综合保护装置的信号传递关系',
                mode: 'quiz',
                quizConfig: {
                    question: '在数字式综合保护装置（微机保护装置）中，正确的信号传递关系是（　）。',
                    options: [
                        '跳闸回路 → 微机保护装置 → CT/PT → VCB',
                        'CT/PT → 微机保护装置 → 跳闸回路 → VCB',
                        'VCB → 跳闸回路 → 微机保护装置 → CT/PT',
                        '微机保护装置 → CT/PT → VCB → 跳闸回路',
                    ],
                    answer: 1,
                    analysis: '电流、电压信号先经 CT（电流互感器）降压降流、PT（电压互感器）降压隔离采样，送入微机保护装置进行运算判断；故障时装置出口接通跳闸回路，驱动真空断路器（VCB）分闸切除故障。即：CT/PT → 微机保护装置 → 跳闸回路 → VCB。本装置 F1 页即显示差动/短路/过载等保护跳闸出口状态。',
                },
            },
            // ── 步骤 4：测试题——高压发电机特有的保护 ──
            {
                msg: '第 4 步：测试题——相对于低压发电机，高压发电机特有的保护有',
                mode: 'quiz',
                quizConfig: {
                    question: '与低压船舶发电机相比，下列属于高压发电机（如 6.6kV）特有的保护是（　）。',
                    options: [
                        '失压保护',
                        '纵联差动保护',
                        '逆功率保护',
                        '过载保护',
                    ],
                    answer: 1,
                    analysis: '低压发电机依靠失压、过载、短路（过电流）、逆功率等保护即可满足运行要求；高压发电机额定电流小、绕组相间/匝间短路危害大，必须增设纵联差动保护（定子绕组相间短路主保护）以及定子单相接地（100% 定子接地）保护等高压发电机组特有的保护。',
                },
            },
            // ── 步骤 5：测试题——内部相间短路差动跳闸 ──
            {
                msg: '第 5 步：测试题——高压发电机内部绕组相间短路由何种保护跳闸',
                mode: 'quiz',
                quizConfig: {
                    question: '某高压发电机内部绕组发生相间短路时，依靠（　）实现快速可靠跳闸？',
                    options: [
                        '逆功率保护',
                        '过载保护（长延时）',
                        '差动保护',
                        '绝缘监测（接地显示）',
                    ],
                    answer: 2,
                    analysis: '绕组内部相间短路主要由纵联差动保护承担：比较机端与中性点两侧 CT 电流，内部短路时两侧电流失衡、差流大增（本工程实测 A/B 相入口 745.8A、出口≈0、差流 671A，远超 0.09In 差动定值），保护瞬时出口跳闸切除故障。这正是操作流程 1「高压发电机差动电流超过阈值」所演示的内容。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：三相交流电源 → 真空断路器(T端进) → L端出 → 汇流排 ──
    {
        Class: VacuumCircuitBreaker,
        id: 'qf1',
        x: -100,
        y: 160,
        ratedCtrlVoltage: 24,
        label: '10kV真空断路器',
        genId: '',
        revPowerKw: 300,
        revTime: 5,
        faultSimpleProtect: true,
        visible: true
    },
    { Class: Busbar3P, id: 'bus1', x: -100, y: 10, portsPerBar: 6, label: '汇流排', visible: true },
    // ── 船舶高压发电机：6600V / 50Hz / 2000kW，初始停机（T端无压，满足接地五防前提）──
    {
        Class: MarineHVGenerator, id: 'gen_hv', x: -100, y: 680,
        freq: 50, vRms: 3810, ratedPower: 2000, ratedVoltage: 6600, ratedCosPhi: 0.8,
        isOn: false, mode: 'remote', label: '船舶高压发电机', visible: true
    },

    // ── 控制回路：DC 24V 电源（正极 → 储能电机 m1 / 失压线圈 uv1；负极接地）──
    { Class: DCPower, id: 'dc24', x: 280, y: 0, voltage: 24, isOn: true, label: '24V控制电源', visible: true },
    // 24V 电源负极接地（接地一）
    { Class: Ground, id: 'gnd_dc', x: 520, y: 270, label: '电源负极接地', visible: true },
    // 四个线圈负端公共接地（接地二）：m2 / c2 / uv2 / flb
    { Class: Ground, id: 'gnd_coil', x: 400, y: 280, label: '线圈负端接地', visible: true },
    // 发电机中性点接地
    { Class: Ground, id: 'gnd_coil2', x: 450, y: 990, label: '发电机中性点接地', visible: true },    
    // 遥控面板3个线圈负端公共接地（接地三）：m2 / c2 / uv2 / flb
    { Class: Ground, id: 'gnd_hv', x: 750, y: 620, label: '高压负端接地', visible: true },
    // 遥控面板3个线圈负端公共接地（接地三）：m2 / c2 / uv2 / flb
    { Class: Ground, id: 'gnd_prot', x: 1000, y: 880, label: '保护负端接地', visible: true },    
    // ── 高压发电机遥控面板：监控/遥控高压发电机与真空断路器 ──
    {
        Class: HvGenRemotePanel, id: 'hvgp', x: 420, y: 320,
        genId: 'gen_hv', qfId: 'qf1', protId: 'prot1', busId: 'bus1',
        label: '高压发电机遥控面板', visible: true
    },

    // ── 微机综合保护装置：差动/短路/过载/接地/欠压/逆功率（直接读发电机量）──
    {
        Class: HvGenProtection, id: 'prot1', x: 500, y: 660,
        genId: 'gen_hv', qfId: 'qf1', In: 218.7, label: '微机综合保护装置', visible: true
    },

    // ── 中性点接地电阻：500Ω，发电机中性点经此电阻接地 ──
    { Class: Resistor, id: 'rn', x: 310, y: 980, value: 500, direction: 'vertical', label: '中性点接地电阻', rotation: -90, visible: true },

    // ── 高压三相可调负载：三角联接（无中性点，对地绝缘），接汇流排第 5 口 ──
    {
        Class: HvThreePhaseLoad, id: 'hvload', x: 1560, y: 150,
        powerKw: 500, cosPhi: 0.8, reactive: 'ind', loaded: false, label: '高压三相可调负载', visible: true
    },

    // ── 船舶高压电力系统单线图（交互组件）──
    { Class: HvPowerOneLine, id: 'one_line', x: 2200, y: 40, label: '电力系统单线图', visible: false },

    // ── 高压三相变压器：6600V 原边（接汇流排2），440V 副边输出 ──
    // ── 左侧高压变压器 tf1：bus1 第5口 → vcbs3 → tf1 原边；副边 → aq1 → 低压汇流排1 ──
    {
        Class: HvTransformer, id: 'tf1', x: 1050, y: 420,
        vPrimary: 6600, vSecondary: 440, label: '高压三相变压器',
        protBk: 'vcbs3', hTripTemp: 130, hTripDelay: 3, visible: true
    },
    // ── 右侧高压变压器 tf2：bus_s2 第2口 → vcbs4 → tf2 原边；副边 → aq2 → 低压汇流排2 ──
    { Class: HvTransformer, id: 'tf2', x: 1400, y: 420, vPrimary: 6600, vSecondary: 440, label: '高压三相变压器2', protBk: 'vcbs4', hTripTemp: 130, hTripDelay: 3, visible: true },
    { Class: SimpleVCB, id: 'vcbs3', x: 1030, y: 160, initState: 'off', initIso: 'on', label: '断路器3', visible: true },
    // ── 右侧高压变压器回路：bus_s2 第2口 → vcbs4 → tf1 原边 ──
    { Class: SimpleVCB, id: 'vcbs4', x: 1400, y: 160, initState: 'off', initIso: 'on', label: '断路器4', visible: true },
    // ── 空气开关（三相图式）：aq1 左侧副边 / aq2 右侧副边 / aq3 低压互联 ──
    { Class: DiagramThreePhaseACB, id: 'aq1', x: 1050, y: 690, initState: 'off', label: '空气开关1', ratedVoltage: 440, ratedCurrent: 100, tripCurrent: 100, visible: true },
    { Class: DiagramThreePhaseACB, id: 'aq2', x: 1400, y: 690, initState: 'off', label: '空气开关2', ratedVoltage: 440, ratedCurrent: 100, tripCurrent: 100, visible: true },

    // ── 低压 440V 汇流排（2 端口）──
    { Class: Busbar3P, id: 'bus_lv1', x: 950, y: 900, portsPerBar: 2, label: '低压汇流排1', visible: true },
    { Class: Busbar3P, id: 'bus_lv2', x: 1420, y: 900, portsPerBar: 2, label: '低压汇流排2', visible: true },
    // ── 低压母线2 上方的 3 盏白炽灯：每盏 10kW（R = 254²/10kW ≈ 6.45Ω），星型连接（中点浮动不接地）──
    { Class: IncandescentLamp, id: 'lamp_a', x: 1620, y: 780, coldResistance: 6.45, rotation: 90, label: '白炽灯A' },
    { Class: IncandescentLamp, id: 'lamp_b', x: 1680, y: 780, coldResistance: 6.45, rotation: 90, label: '白炽灯B' },
    { Class: IncandescentLamp, id: 'lamp_c', x: 1740, y: 780, coldResistance: 6.45, rotation: 90, label: '白炽灯C' },
    { Class: DiagramThreePhaseACB, id: 'aq3', x: 1420, y: 880, rotation: 90, initState: 'off', label: '空气开关3', ratedVoltage: 440, ratedCurrent: 100, tripCurrent: 100, visible: true },

    // ── 简化版高压发电机：只保留操作界面，顶部三相输出 + 底部中性点 ──
    {
        Class: SimpleHVGenerator, id: 'gen_s', x: 1800, y: 460,
        isOn: false, mode: 'local', label: '简化高压发电机', visible: true
    },
    // ── 2号发电机中性点接地：500Ω 电阻 + 地 ──
    { Class: Resistor, id: 'rn_s', x: 1960, y: 750, value: 500, direction: 'vertical', label: '中性点接地电阻', rotation: -90, visible: true },
    { Class: Ground, id: 'gnd_gen_s', x: 2030, y: 800, label: '发电机2中性点接地', visible: true },

    // ── 简化版真空断路器（带上下隔离）：发电机 → 汇流排2 输送 ──
    {
        Class: SimpleVCB, id: 'vcbs', x: 1920, y: 180,
        initState: 'off', initIso: 'on', label: '真空断路器(带隔离)', visible: true
    },
    // ── 汇流排2（第二汇流排）：接简化发电机/断路器 ──
    { Class: Busbar3P, id: 'bus_s2', x: 1350, y: 10, portsPerBar: 4, label: '汇流排2', visible: true },
    // ── 简化版真空断路器2：旋转 90°，连接 汇流排1 ↔ 汇流排2 ──
    {
        Class: SimpleVCB, id: 'vcbs2', x: 1300, y: 10, rotation: 90,
        initState: 'off', initIso: 'on', label: '断路器(旋转90°)', visible: true
    },
    // ── 高压配电柜组件图（展示组件）──
    { Class: HvSwitchPanel, id: 'switch_panel', x: 20, y: 40, label: '高压配电柜', visible: false },
    // ── 高压验电器（手持验电工具）──
    { Class: HvTester, id: 'hv_tester', x: 2050, y: 700, label: '高压验电器', visible: false },
    // ── 高压接地监视仪：液晶屏三行显示 A/B/C 相绝缘电阻，上端 3 端子接汇流排1 第 4 口 ──
    { Class: HvGroundMonitor, id: 'hv_ground_monitor', x: 580, y: 130, label: '高压接地监视仪', visible: true },
    // ── 绝缘电阻测试支路：汇流排1 第5口第3相 → 10MΩ 竖放电阻 → 接地（模拟绝缘下降）──
    { Class: Resistor, id: 'r_insul', x: 852, y: 190, value: 10000000, direction: 'vertical', label: '绝缘电阻10MΩ', visible: true },
    { Class: Ground, id: 'gnd_insul', x: 852, y: 280, label: '接地', visible: true },
    // ── 高压放电棒（手持放电工具：钩尖碰带电体 → 10MΩ 放电电阻 → 接地线 → 地）──
    // 3 个电气端口：l(钩尖) / r(连接处·接地引出) / gnd(接地线末端)；未自动接线，教师可按需接入
    { Class: HvDischargeRod, id: 'hv_rod', x: 1980, y: 920, label: '高压放电棒', value: 10000000, visible: false },
    // ── 高压接地线（三相短路接地线：三个相接线夹竖排 + 三根向下弯曲软线 + 接地夹；右侧绝缘杆与手柄）──
    // 4 个电气端口：p1/p2/p3(相接线夹) / gnd(接地夹)，内部三相短接接地；未自动接线，教师可按需接入
    { Class: HvGroundingCable, id: 'hv_ground_cable', x: 1960, y: 960, label: '高压接地线', visible: false },
    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    // ── 手摇式兆欧表（摇表，2500V 型；隐藏，测试绝缘时按需调出）──
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));

// 白炽灯是否通电点亮：低压母线2 线电压 > 300V（440V 系统），或灯丝亮度上升（双保险）
function _lampLit(sys) {
    let byBus = false;
    if (sys.getVoltageBetween) {
        const v = Math.abs(sys.getVoltageBetween('bus_lv2_wire_l1_1', 'bus_lv2_wire_l3_1') || 0);
        byBus = v > 300;
    }
    const byBright = ['lamp_a', 'lamp_b', 'lamp_c'].some(id => {
        const l = sys.comps[id];
        return l && l._brightness > 0.4;
    });
    return byBus || byBright;
}

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // ── 主回路：高压发电机 → 断路器 T1-T3（U/V/W 直连）──
        { from: 'gen_hv_wire_u', to: 'qf1_wire_t1', type: 'wire' },
        { from: 'gen_hv_wire_v', to: 'qf1_wire_t2', type: 'wire' },
        { from: 'gen_hv_wire_w', to: 'qf1_wire_t3', type: 'wire' },
        // ── 中性点 N → 500Ω 接地电阻 → 接地（绕组中点经电阻接地）──
        { from: 'gen_hv_wire_n', to: 'rn_wire_l', type: 'wire' },
        { from: 'rn_wire_r', to: 'gnd_coil2_wire_gnd', type: 'wire' },        
        // ── 高压三相可调负载：汇流排第 5 口 → 负载 L1/L2/L3（三角联接，无中性点）──
        { from: 'bus_s2_wire_l1_3', to: 'hvload_wire_l1', type: 'wire' },
        { from: 'bus_s2_wire_l2_3', to: 'hvload_wire_l2', type: 'wire' },
        { from: 'bus_s2_wire_l3_3', to: 'hvload_wire_l3', type: 'wire' },
        // ── 主回路：断路器 L1-L3 → 汇流排第 1 号接口 ──
        { from: 'qf1_wire_l1', to: 'bus1_wire_l1_1', type: 'wire' },
        { from: 'qf1_wire_l2', to: 'bus1_wire_l2_1', type: 'wire' },
        { from: 'qf1_wire_l3', to: 'bus1_wire_l3_1', type: 'wire' },
        // ── 控制回路：24V 正极 → 储能电机正端 m1 / 失压线圈正端 uv1 ──
        { from: 'dc24_wire_p', to: 'qf1_wire_m1', type: 'wire' },
        { from: 'dc24_wire_p', to: 'qf1_wire_uv1', type: 'wire' },
        // ── 24V 负极 → 接地一 ──
        { from: 'dc24_wire_n', to: 'gnd_dc_wire_gnd', type: 'wire' },
        // ── 四个线圈负端（m2/c2/uv2/flb）→ 接地二 ──
        { from: 'qf1_wire_m2',  to: 'gnd_coil_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_c2',  to: 'gnd_coil_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_uv2', to: 'gnd_coil_wire_gnd', type: 'wire' },
        { from: 'qf1_wire_flb', to: 'gnd_coil_wire_gnd', type: 'wire' },
        // ── 高压发电机遥控面板 ──
        // 左侧：发电机组起动/停止/调速（接发电机遥控端口）
        { from: 'hvgp_wire_start_a', to: 'gen_hv_wire_rm_start_a', type: 'wire' },
        { from: 'hvgp_wire_start_b', to: 'gen_hv_wire_rm_start_b', type: 'wire' },
        { from: 'hvgp_wire_stop_a',  to: 'gen_hv_wire_rm_stop_a',  type: 'wire' },
        { from: 'hvgp_wire_stop_b',  to: 'gen_hv_wire_rm_stop_b',  type: 'wire' },
        { from: 'hvgp_wire_spd_p',   to: 'gen_hv_wire_freq_in_p',  type: 'wire' },
        { from: 'hvgp_wire_spd_n',   to: 'gen_hv_wire_freq_in_n',  type: 'wire' },
        // 下方：合闸 / 分闸 / 灭磁输出
        { from: 'hvgp_wire_close_a', to: 'qf1_wire_c1',          type: 'wire' },
        { from: 'hvgp_wire_close_b', to: 'gnd_hv_wire_gnd',    type: 'wire' },
        { from: 'hvgp_wire_open_a',  to: 'qf1_wire_fla',         type: 'wire' },
        { from: 'hvgp_wire_open_b',  to: 'gnd_hv_wire_gnd',    type: 'wire' },
        { from: 'hvgp_wire_demag_a', to: 'gen_hv_wire_mc_a',     type: 'wire' },
        { from: 'hvgp_wire_demag_b', to: 'gen_hv_wire_mc_b',     type: 'wire' },
        // 右侧：24V 电源接口
        { from: 'dc24_wire_p', to: 'hvgp_wire_p24_p', type: 'wire' },
        { from: 'gnd_hv_wire_gnd', to: 'hvgp_wire_p24_n', type: 'wire' },
        // ── 微机综合保护装置：左边 4 对接线（表面演示，不参与电路求解）──
        //   3 对电流信号（出口/入口/中性点 CT）+ PT 电压
        { from: 'gen_hv_wire_cta_out_s1', to: 'prot1_wire_cta_out_s1', type: 'wire' },
        { from: 'gen_hv_wire_cta_out_s2', to: 'prot1_wire_cta_out_s2', type: 'wire' },
        { from: 'gen_hv_wire_cta_in_s1',  to: 'prot1_wire_cta_in_s1',  type: 'wire' },
        { from: 'gen_hv_wire_cta_in_s2',  to: 'prot1_wire_cta_in_s2',  type: 'wire' },
        { from: 'gen_hv_wire_ctn_s1',     to: 'prot1_wire_ctn_s1',     type: 'wire' },
        { from: 'gen_hv_wire_ctn_s2',     to: 'prot1_wire_ctn_s2',     type: 'wire' },
        { from: 'gen_hv_wire_pt_a',       to: 'prot1_wire_pt_a',       type: 'wire' },
        { from: 'gen_hv_wire_pt_b',       to: 'prot1_wire_pt_b',       type: 'wire' },
        // 24V 电源 + 保护通信（右侧）
        { from: 'dc24_wire_p',   to: 'prot1_wire_p24_p', type: 'wire' },
        { from: 'gnd_prot_wire_gnd',   to: 'prot1_wire_p24_n', type: 'wire' },
        { from: 'hvgp_wire_prot_a', to: 'prot1_wire_prot_a', type: 'wire' },
        { from: 'hvgp_wire_prot_b', to: 'prot1_wire_prot_b', type: 'wire' },
        // ── 简化高压发电机：三相输出 → 简化断路器 T 端；中性点 → 接地 ──
        { from: 'gen_s_wire_u', to: 'vcbs_wire_t1', type: 'wire' },
        { from: 'gen_s_wire_v', to: 'vcbs_wire_t2', type: 'wire' },
        { from: 'gen_s_wire_w', to: 'vcbs_wire_t3', type: 'wire' },
        { from: 'gen_s_wire_n', to: 'rn_s_wire_l', type: 'wire' },
        { from: 'rn_s_wire_r', to: 'gnd_gen_s_wire_gnd', type: 'wire' },

        // ═══════════════════════════════════════════════════════════
        // 双变压器供配电网络
        // ═══════════════════════════════════════════════════════════
        // ── 左侧：bus1 第5口 → vcbs3 L 端 → tf1 原边（T 端）──
        { from: 'bus1_wire_l1_5', to: 'vcbs3_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_5', to: 'vcbs3_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_5', to: 'vcbs3_wire_l3', type: 'wire' },
        { from: 'vcbs3_wire_t1', to: 'tf1_wire_h1', type: 'wire' },
        { from: 'vcbs3_wire_t2', to: 'tf1_wire_h2', type: 'wire' },
        { from: 'vcbs3_wire_t3', to: 'tf1_wire_h3', type: 'wire' },
        // ── tf1 副边 → aq1 → 低压汇流排1 ──
        { from: 'tf1_wire_x1', to: 'aq1_wire_l1', type: 'wire' },
        { from: 'tf1_wire_x2', to: 'aq1_wire_l2', type: 'wire' },
        { from: 'tf1_wire_x3', to: 'aq1_wire_l3', type: 'wire' },
        { from: 'aq1_wire_t1', to: 'bus_lv1_wire_l1_1', type: 'wire' },
        { from: 'aq1_wire_t2', to: 'bus_lv1_wire_l2_1', type: 'wire' },
        { from: 'aq1_wire_t3', to: 'bus_lv1_wire_l3_1', type: 'wire' },
        // ── 右侧：bus_s2 第2口 → vcbs4 L 端 → tf2 原边（T 端）──
        { from: 'bus_s2_wire_l1_2', to: 'vcbs4_wire_l1', type: 'wire' },
        { from: 'bus_s2_wire_l2_2', to: 'vcbs4_wire_l2', type: 'wire' },
        { from: 'bus_s2_wire_l3_2', to: 'vcbs4_wire_l3', type: 'wire' },
        { from: 'vcbs4_wire_t1', to: 'tf2_wire_h1', type: 'wire' },
        { from: 'vcbs4_wire_t2', to: 'tf2_wire_h2', type: 'wire' },
        { from: 'vcbs4_wire_t3', to: 'tf2_wire_h3', type: 'wire' },
        // ── tf2 副边 → aq2 → 低压汇流排2 ──
        { from: 'tf2_wire_x1', to: 'aq2_wire_l1', type: 'wire' },
        { from: 'tf2_wire_x2', to: 'aq2_wire_l2', type: 'wire' },
        { from: 'tf2_wire_x3', to: 'aq2_wire_l3', type: 'wire' },
        { from: 'aq2_wire_t1', to: 'bus_lv2_wire_l1_1', type: 'wire' },
        // ── 白炽灯星型连接（母线2 第1口取电，中点浮动不接地）──
        { from: 'bus_lv2_wire_l1_2', to: 'lamp_a_wire_r', type: 'wire' },
        { from: 'bus_lv2_wire_l2_2', to: 'lamp_b_wire_r', type: 'wire' },
        { from: 'bus_lv2_wire_l3_2', to: 'lamp_c_wire_r', type: 'wire' },
        { from: 'lamp_a_wire_l', to: 'lamp_b_wire_l', type: 'wire' },
        { from: 'lamp_b_wire_l', to: 'lamp_c_wire_l', type: 'wire' },
        { from: 'aq2_wire_t2', to: 'bus_lv2_wire_l2_1', type: 'wire' },
        { from: 'aq2_wire_t3', to: 'bus_lv2_wire_l3_1', type: 'wire' },
        // ── 两个低压汇流排通过 aq3 连接（L 端接低压汇流排1，T 端接低压汇流排2）──
        { from: 'bus_lv1_wire_l1_2', to: 'aq3_wire_t1', type: 'wire' },
        { from: 'bus_lv1_wire_l2_2', to: 'aq3_wire_t2', type: 'wire' },
        { from: 'bus_lv1_wire_l3_2', to: 'aq3_wire_t3', type: 'wire' },
        { from: 'aq3_wire_l1', to: 'bus_lv2_wire_l1_1', type: 'wire' },
        { from: 'aq3_wire_l2', to: 'bus_lv2_wire_l2_1', type: 'wire' },
        { from: 'aq3_wire_l3', to: 'bus_lv2_wire_l3_1', type: 'wire' },
        // ── 低压负载（星形接地）──

        // ── 断路器1（发电机路径）→ 汇流排2（第 4 口）──
        { from: 'vcbs_wire_l1', to: 'bus_s2_wire_l1_4', type: 'wire' },
        { from: 'vcbs_wire_l2', to: 'bus_s2_wire_l2_4', type: 'wire' },
        { from: 'vcbs_wire_l3', to: 'bus_s2_wire_l3_4', type: 'wire' },
        // ── 母联断路器2（旋转90°）：汇流排1 第 6 口 → T 端；L 端 → 汇流排2 第 1 口 ──
        { from: 'bus1_wire_l1_6', to: 'vcbs2_wire_t1', type: 'wire' },
        { from: 'bus1_wire_l2_6', to: 'vcbs2_wire_t2', type: 'wire' },
        { from: 'bus1_wire_l3_6', to: 'vcbs2_wire_t3', type: 'wire' },
        { from: 'vcbs2_wire_l1', to: 'bus_s2_wire_l1_1', type: 'wire' },
        { from: 'vcbs2_wire_l2', to: 'bus_s2_wire_l2_1', type: 'wire' },
        { from: 'vcbs2_wire_l3', to: 'bus_s2_wire_l3_1', type: 'wire' },
        // ── 高压接地监视仪：汇流排1 第 4 口 → 监视仪上端 3 端子 ──
        { from: 'bus1_wire_l1_4', to: 'hv_ground_monitor_wire_l1', type: 'wire' },
        { from: 'bus1_wire_l2_4', to: 'hv_ground_monitor_wire_l2', type: 'wire' },
        { from: 'bus1_wire_l3_4', to: 'hv_ground_monitor_wire_l3', type: 'wire' },
        // ── 绝缘电阻测试支路：汇流排1 第5口第3相 → 10MΩ 竖放电阻 → 接地 ──
        { from: 'bus1_wire_l3_5', to: 'r_insul_wire_l', type: 'wire' },
        { from: 'r_insul_wire_r', to: 'gnd_insul_wire_gnd', type: 'wire' },
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

    // 真空断路器复位
    const q1 = sys.comps.qf1;
    if (q1) {
        if (q1.getState() === 'on' && q1.tryTrip) {
            q1.tryTrip();
        }
        if (q1._chargeProg !== undefined) {
            q1._chargeProg = 5;
            q1._charged = true;
        }
    }

    // ── 起动 2 号发电机（gen_s）──
    const gs = sys.comps.gen_s;
    if (gs) {
        gs.isOn = true;
        gs.mode = 'local';
    }
    // ── 合上 2 号真空断路器（vcbs，发电机路径）──
    const v1 = sys.comps.vcbs;
    if (v1) {
        v1._isoClosed = true;
        if (typeof v1._syncWorkPos === 'function') v1._syncWorkPos();
        v1.tryClose();
    }
    // ── 合上母联真空断路器（vcbs2）──
    const v2 = sys.comps.vcbs2;
    if (v2) {
        v2._isoClosed = true;
        if (typeof v2._syncWorkPos === 'function') v2._syncWorkPos();
        v2.tryClose();
    }
    // ── 合上变压器2 真空断路器（vcbs4）──
    const v4 = sys.comps.vcbs4;
    if (v4) {
        v4._isoClosed = true;
        if (typeof v4._syncWorkPos === 'function') v4._syncWorkPos();
        v4.tryClose();
    }
    // ── 合上变压器1 输出空气开关（aq2）：close() 同步刀闸动画与显示 ──
    const a2 = sys.comps.aq2;
    if (a2) {
        if (typeof a2.close === 'function') a2.close();
        else a2._state = 'on';
    }
}

export function fiveStep() {
}
