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
    // ══════════════════════════════════════════════════════════════
    // 1. 高压配电板认识与操作（自动接线 → 识别部件 → 自检 → 遥控起动 → 切换自动）
    // ══════════════════════════════════════════════════════════════
    'hv-switchboard-intro': {
        id: 'hv-switchboard-intro',
        name: '1.高压配电板认识与操作',
        steps: [
            // ── 步骤 1：自动接线，认识高压电力系统结构 ──
            {
                msg: '第 1 步：点击工具栏"自动接线"，自动完成高压电力系统接线，认识系统结构',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // 高亮工具栏"自动接线"按钮，并直接调用自动接线接口
                    // （避免按钮 onclick 中未定义的 syncShowWires 抛错）
                    await domBtnHighlight('btnAutoWire', 2500);
                    if (typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
                    else if (typeof sys.workflowMgr !== 'undefined') sys.workflowMgr.applyAllPresets();
                    await _sleep(2200);
                    sys.showFloatingTip(
                        '高压电力系统结构：发电机 → 真空断路器 → 汇流排 → 变压器/负载；' +
                        '微机综合保护装置与遥控面板由 24V 控制回路供电', 5500);
                    await _sleep(3500);
                },
                check() {
                    const sys = this.sys;
                    return !!(sys && sys.conns && sys.conns.length > 40);
                },
            },
            // ── 步骤 2：点击识别 1#真空断路器（find：演示自动点击 / 演练须点击该组件）──
            {
                msg: '第 2 步：点击识别 1#真空断路器（10kV）——合闸/分闸与保护跳闸的执行元件',
                mode: 'find',
                target: 'qf1',
            },
            // ── 步骤 3：点击识别微机综合保护装置 ──
            {
                msg: '第 3 步：点击识别微机综合保护装置——差动/短路/过载/接地/欠压/逆功率保护',
                mode: 'find',
                target: 'prot1',
            },
            // ── 步骤 4：点击识别遥控面板上的高压带电显示器 ──
            {
                msg: '第 4 步：点击识别遥控面板上的高压带电显示器——显示断路器 T 侧三相是否带电',
                mode: 'find',
                target: 'hvgp',
                subTarget: '带电显示器',
            },
            // ── 步骤 5：点击识别与真空断路器配套的接地开关（点击断路器本体）──
            {
                msg: '第 5 步：点击识别与真空断路器配套的接地开关——检修时泄放残余电荷、确保安全',
                mode: 'find',
                target: 'qf1',
            },
            // ── 步骤 6：按下高压带电显示器的自检验电按钮，确认正常后松开 ──
            {
                msg: '第 6 步：按下高压带电显示器的【自检】按钮，三灯点亮确认正常后松开',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hvgp = sys.comps.hvgp;
                    sys.showFloatingTip('按住带电显示器【自检】按钮不放，校验三只指示灯能否正常点亮', 5000);
                    await compArrowThen(this, 'hvgp', 'selftest', 'down', 3000, 400, () => {
                        if (hvgp) hvgp._selfTestT = 3;   // 触发 3s 自检
                    });
                    await _sleep(3400);   // 三灯点亮 3 秒
                    sys.showFloatingTip('自检正常：黄(A)、绿(B)、红(C) 三灯同时点亮 3 秒后自动熄灭，随后松开按钮', 5000);
                    await _sleep(3000);
                },
                // 演练/评估模式：需实际按下【自检】按钮（自检计时期望 >0）方可通过
                check() {
                    const hvgp = this.sys && this.sys.comps && this.sys.comps.hvgp;
                    return !!(hvgp && hvgp._selfTestT > 0);
                },
            },
            // ── 步骤 7：遥控起动 1#高压发电机组，观察三处指示 ──
            {
                msg: '第 7 步：遥控起动 1#高压发电机组，观察带电显示器、电网绝缘参数与接地指示',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hvgp = sys.comps.hvgp;
                    // ① 遥控起动 1# 发电机组
                    sys.showFloatingTip('在遥控面板上按【起·停】开关左半侧，遥控起动 1#高压发电机组', 4500);
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 400, () => {
                        if (hvgp) {
                            hvgp._startCmd = true;
                            setTimeout(() => { hvgp._startCmd = false; }, 500);
                        }
                    });
                    await _sleep(4000);   // 等待发电机建立电压
                    // ② 观察高压带电显示器
                    await compArrowThen(this, 'hvgp', 'live', 'up', 3000, 1200, null);
                    sys.showFloatingTip('① 高压带电显示器：发电机建立电压后 T 侧带电，黄/绿/红三灯常亮', 5000);
                    await _sleep(3200);
                    // ③ 观察电网绝缘参数
                    await compArrowThen(this, 'hv_ground_monitor', 'lcd', 'down', 3000, 1200, null);
                    sys.showFloatingTip(
                        '② 电网绝缘参数：高压接地监视仪显示 A/B/C 三相对地绝缘电阻' +
                        '（正常 ≥1MΩ，低于报警阈值时发出声光报警）', 5500);
                    await _sleep(3200);
                    // ④ 观察遥控面板上的接地指示
                    await compArrowThen(this, 'hvgp', 'groundled', 'down', 3000, 1200, null);
                    sys.showFloatingTip('③ 遥控面板接地指示：接地合(绿) / 接地开(红)，反映断路器接地开关状态', 5000);
                    await _sleep(3200);
                },
                check() {
                    const gen = this.sys && this.sys.comps && this.sys.comps.gen_hv;
                    return !!(gen && gen.isOn);
                },
            },
            // ── 步骤 8：将电站切换为自动模式 ──
            {
                msg: '第 8 步：将遥控面板"手动·自动"转换开关打到【自动】档，电站切换为自动模式',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hvgp = sys.comps.hvgp;
                    sys.showFloatingTip('将遥控面板"手动·自动"转换开关打到【自动】档', 4500);
                    await compArrowThen(this, 'hvgp', 'mode', 'down', 3000, 800, () => {
                        if (hvgp) hvgp.mode = 'auto';
                    });
                    await _sleep(1500);
                    sys.showFloatingTip(
                        '电站已切换为自动模式：遥控面板根据电网与发电机状态自动完成起动、调频调压、' +
                        '合闸并网与保护复位', 5500);
                    await _sleep(3200);
                },
                check() {
                    const hvgp = this.sys && this.sys.comps && this.sys.comps.hvgp;
                    return !!(hvgp && hvgp.mode === 'auto');
                },
            },
            // ── 步骤 9：测试题——下列哪些不属于高压"五防" ──
            {
                msg: '第 9 步：测试题——下列哪些不属于高压"五防"？',
                mode: 'quiz',
                quizConfig: {
                    isMultiple: true,
                    question: '下列哪些内容不属于高压电气"五防"？',
                    options: [
                        '防止误分、误合断路器',
                        '防止带负荷拉、合隔离开关',
                        '防止设备长期过载、过热损坏',
                        '防止绝缘子表面积污闪络',
                    ],
                    answer: [2, 3],
                    analysis: '高压"五防"是：①防止误分、误合断路器；②防止带负荷拉、合隔离开关（刀闸）；' +
                        '③防止带电挂（合）接地线（接地开关）；④防止带接地线（接地开关）合断路器；' +
                        '⑤防止误入带电间隔。选项 C"防止设备长期过载、过热损坏"属于设备运行保护，' +
                        '选项 D"防止绝缘子表面积污闪络"属于绝缘维护，二者均不属于"五防"范畴。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════
    // 2. 高压发电机检修流程
    // ══════════════════════════════════════════════════════════════
    'hv-gen-maintenance': {
        id: 'hv-gen-maintenance',
        name: '2.高压发电机检修流程',
        steps: [
            // ── 步骤 1：自动接线 → 自动模式 → 观察自动起动 / 自动合闸 ──
            {
                msg: '第 1 步：自动接线→遥控面板切换到自动模式→观察 1#机组自动起动、真空断路器自动合闸',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hvgp = sys.comps.hvgp;
                    // ① 自动接线
                    await domBtnHighlight('btnAutoWire', 2500);
                    if (typeof sys.applyAllPresets === 'function') sys.applyAllPresets();
                    await _sleep(2200);
                    // ② 遥控面板切换到自动模式
                    await compArrowThen(this, 'hvgp', 'mode', 'down', 3000, 800, () => {
                        if (hvgp) hvgp.mode = 'auto';
                    });
                    sys.showFloatingTip(
                        '电站置于自动模式：电网无电 → 延时 3s 自动起动 1# 机组 → 延时 5s 自动合闸供电', 6500);
                    await _sleep(9000);   // 等待自动起动
                    // ③ 观察发电机自动起动
                    await compArrowThen(this, 'hvgp', 'runled', 'down', 2500, 600, null);
                    sys.showFloatingTip('1# 高压发电机组已自动起动并建立电压', 4500);
                    await _sleep(3000);
                    // ④ 观察真空断路器自动合闸
                    sys.showFloatingTip('发电机建压正常，延时 5s 后真空断路器自动合闸供电……', 6000);
                    await _sleep(12000);
                    await compArrowThen(this, 'qf1', 'indicator', 'up', 2800, 1200, null);
                    sys.showFloatingTip('合分闸指示牌显示"合闸 ON"：真空断路器已合闸，发电机向电网供电（带电显示器三灯常亮）', 5500);
                    await _sleep(3000);
                },
                check() {
                    const sys = this.sys;
                    const gen = sys.comps.gen_hv, qf = sys.comps.qf1;
                    return !!(gen && gen.isOn && qf && qf.getState() === 'on');
                },
            },
            // ── 步骤 2：遥控面板切换手动 → 分断真空断路器 ──
            {
                msg: '第 2 步：将高压发电机模式切换为手动，分断真空断路器',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hvgp = sys.comps.hvgp;
                    const qf1 = sys.comps.qf1;
                    // ① 遥控面板切换到手动模式
                    await compArrowThen(this, 'hvgp', 'mode', 'down', 3000, 800, () => {
                        if (hvgp) hvgp.mode = 'manual';
                    });
                    sys.showFloatingTip('遥控面板由"自动"切换为"手动"，取消自动控制', 4500);
                    await _sleep(2500);
                    // ② 按遥控面板"合·分"开关分断真空断路器
                    await compArrowThen(this, 'hvgp', 'close', 'down', 3000, 600, () => {
                        if (hvgp) {
                            hvgp._openCmd = true;
                            setTimeout(() => { hvgp._openCmd = false; }, 600);
                        }
                    });
                    await _sleep(2000);
                    if (qf1 && qf1.getState() === 'on' && typeof qf1.tryTrip === 'function') qf1.tryTrip();
                    sys.showFloatingTip('真空断路器已分闸，发电机与电网解列', 4500);
                    await _sleep(3000);
                },
                check() {
                    const sys = this.sys;
                    return !!(sys.comps.hvgp && sys.comps.hvgp.mode === 'manual'
                        && sys.comps.qf1 && sys.comps.qf1.getState() === 'off');
                },
            },
            // ── 步骤 3：切断励磁回路 → 本地控制 → 停机 ──
            {
                msg: '第 3 步：切断励磁回路→将高压发电机切换为本地控制→停掉发电机组',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const gen = sys.comps.gen_hv;
                    // ① 切换励磁回路（励磁开关拨到 OFF，平滑灭磁）
                    await compArrowThen(this, 'gen_hv', 'exc', 'right', 3000, 800, () => {
                        if (gen) {
                            if (typeof gen.setFieldOn === 'function') gen.setFieldOn(false);
                            else gen._fieldOn = false;
                        }
                    });
                    sys.showFloatingTip('切断励磁回路：励磁开关置 OFF，发电机灭磁、输出电压归零', 5000);
                    await _sleep(2500);
                    // ② 切换为本地控制
                    await compArrowThen(this, 'gen_hv', 'mode', 'right', 3000, 800, () => {
                        if (gen) {
                            gen.mode = 'local';
                            gen.config.mode = 'local';
                            if (gen._switchKnob) gen._switchKnob.rotation(-45);
                        }
                    });
                    sys.showFloatingTip('高压发电机由"遥控"切换为"本地"控制', 4500);
                    await _sleep(2500);
                    // ③ 本地停机
                    await compArrowThen(this, 'gen_hv', 'stop', 'down', 3000, 1000, () => {
                        if (gen) gen.isOn = false;
                    });
                    sys.showFloatingTip('按下本地"停止"按钮，1# 高压发电机组停机', 4500);
                    await _sleep(3500);
                },
                check() {
                    const gen = this.sys && this.sys.comps && this.sys.comps.gen_hv;
                    return !!(gen && gen.mode === 'local' && !gen.isOn);
                },
            },
            // ── 步骤 4：高压验电器验电（依次靠近发电机出线端口 U/V/W）──
            {
                msg: '第 4 步：使用高压验电器验电——验电端依次靠近发电机出线端口，确认线路无电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const tester = sys.comps.hv_tester;
                    const gen = sys.comps.gen_hv;
                    if (!tester || !gen) return;
                    // ① 取出验电器，清零测量计数
                    if (tester.group) { tester.group.visible(true); sys.requestRedraw(); }
                    tester._measureCount = 0;
                    tester._lastContactId = null;
                    tester._measurePrefixes = ['gen_hv_wire_'];   // 只统计发电机出线端口的验电接触
                    sys.showFloatingTip(
                        '取出高压验电器：将接地端可靠接地，验电端依次靠近发电机出线端口 U、V、W', 6000);
                    await _sleep(2500);
                    // ② 验电端依次与发电机三个出线端口重叠，每次移动间隔 3s
                    const inv = sys.layer.getAbsoluteTransform().copy().invert();
                    for (const ph of ['u', 'v', 'w']) {
                        const port = (gen.ports || []).find(p => p.id === `gen_hv_wire_${ph}`);
                        if (!port || !port.node) continue;
                        const target = inv.point(port.node.getAbsolutePosition());
                        if (tester.group && typeof tester.group.to === 'function') {
                            tester.group.to({ x: target.x, y: target.y, duration: 1.0 });
                        } else {
                            tester.group.position(target);
                        }
                        await _sleep(1000);   // 移动到位
                        const live = !!tester._live;
                        sys.showFloatingTip(
                            live ? `⚠ 验电 ${ph.toUpperCase()} 相：验电器声光报警，线路仍带电，禁止检修！`
                                 : `验电 ${ph.toUpperCase()} 相：无声光报警，确认该相无电`,
                            3000);
                        await _sleep(3000);   // 每次移动间隔 3s
                    }
                    sys.showFloatingTip('三相出线端口验电均无报警，确认线路无电，可以进行后续检修操作', 6000);
                    await _sleep(3000);
                },
                check() {
                    const sys = this.sys;
                    const tester = sys.comps && sys.comps.hv_tester;
                    if (!tester) return false;
                    // 进入本步先清零计数；演练时接触验电端口至少 3 次方可通过
                    if (!sys._wf2MeasArmed) {
                        tester._measureCount = 0;
                        tester._lastContactId = null;
                        tester._measurePrefixes = ['gen_hv_wire_'];
                        sys._wf2MeasArmed = true;
                    }
                    if (tester._measureCount >= 3) { sys._wf2MeasArmed = false; return true; }
                    return false;
                },
            },
            // ── 步骤 5：摇到试验位 → 打开接地开关电磁锁 → 手柄转动 5 次合上接地开关 ──
            {
                msg: '第 5 步：将真空断路器摇到试验位，打开接地开关电磁锁，用手柄转动 5 次，将接地开关合上',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const qf1 = sys.comps.qf1;
                    if (!qf1) return;
                    // ① 分闸后将手车摇到试验位
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 800, () => {
                        if (qf1._state === 'on') qf1.tryTrip();
                        qf1._workPos = 1; qf1._detent = 1;
                        qf1._dialAngle = 90; qf1._dialCur = 90;
                        qf1._syncMainCircuits();
                    });
                    sys.showFloatingTip('将真空断路器手车由"连接位"摇到"试验位"', 4500);
                    await _sleep(2500);
                    // ② 打开接地开关电磁锁
                    await compArrowThen(this, 'qf1', 'emlock', 'right', 3000, 800, () => {
                        qf1._emLockUnlocked = true;
                    });
                    sys.showFloatingTip('打开接地开关电磁锁（解锁后方可插入手柄操作）', 4500);
                    await _sleep(2500);
                    // ③ 插入手柄
                    await compArrowThen(this, 'qf1', 'crank', 'right', 2500, 800, () => {
                        qf1._crankInserted = true;
                    });
                    sys.showFloatingTip('将操作手柄插入接地开关摇动孔', 4000);
                    await _sleep(1500);
                    // ④ 顺时针转动 5 次，合上接地开关
                    await compArrowThen(this, 'qf1', 'crankRight', 'up', 3000, 800, () => {
                        for (let i = 0; i < 5; i++) {
                            qf1._crankTurnCount++;
                            qf1._crankRotation += 360;
                        }
                        qf1._updateGroundSwitchState();
                    });
                    sys.showFloatingTip('顺时针转动手柄 5 次，接地开关 GS1/GS2/GS3 全部合上，三相出线可靠接地', 6500);
                    await _sleep(4000);
                },
                check() {
                    const qf1 = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(qf1 && qf1._workPos === 1 && qf1.isGrounded());
                },
            },
            // ── 步骤 6：测试题——高压发电机检修注意事项 ──
            {
                msg: '第 6 步：测试题——高压发电机检修注意事项',
                mode: 'quiz',
                quizConfig: {
                    question: '对高压发电机进行检修时，下列做法正确的是？',
                    options: [
                        '断开断路器后即可直接接触发电机出线端进行检修',
                        '停电后必须验电、放电、装设接地线（合接地开关），并悬挂标示牌、装设遮栏',
                        '检修工作只需一人完成，无需专人监护',
                        '为节省时间，可带负荷拉合隔离开关进行隔离',
                    ],
                    answer: 1,
                    analysis: '高压设备检修必须严格执行停电、验电、放电、装设接地线（或合上接地开关）、' +
                        '悬挂标示牌、装设遮栏等安全措施，并由两人及以上进行、设专人监护。' +
                        '断开断路器后出线端可能仍带电或存有残余电荷，必须先验电、放电并可靠接地后才能作业；' +
                        '严禁带负荷拉合隔离开关。',
                },
            },
            // ── 步骤 7：测试题——高压验电器使用注意事项 ──
            {
                msg: '第 7 步：测试题——高压验电器使用注意事项',
                mode: 'quiz',
                quizConfig: {
                    question: '使用高压验电器验电时，下列做法正确的是？',
                    options: [
                        '验电前应先在有电设备上验证验电器是否良好',
                        '验电时只需验一相即可判断三相无电',
                        '验电时可以不戴绝缘手套、验电器接地端不接地',
                        '雨、雪、雾及雷雨天气可正常使用普通验电器进行室外验电',
                    ],
                    answer: 0,
                    analysis: '使用高压验电器应注意：①验电前先在确知有电的设备上试验，确认验电器指示正常；' +
                        '②验电时应戴绝缘手套，验电器的接地端必须可靠接地；③对三相线路应逐相验电，不能只验一相；' +
                        '④雨、雪、雾及雷雨天气禁止使用普通验电器进行室外验电，应采用专用防雨验电器。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════
    // 3. 真空断路器检修流程
    // ══════════════════════════════════════════════════════════════
    'vcb-maintenance': {
        id: 'vcb-maintenance',
        name: '3.真空断路器检修流程',
        steps: [
            // ── 步骤 1：摇到试验位 ──
            {
                msg: '第 1 步：将真空断路器（手车）摇到试验位',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 800, () => {
                        if (qf1._state === 'on') qf1.tryTrip();
                        qf1._workPos = 1; qf1._detent = 1;
                        qf1._dialAngle = 90; qf1._dialCur = 90;
                        qf1._syncMainCircuits();
                    });
                    this.sys.showFloatingTip('断路器分闸后，将手车由"连接位（工作位）"摇到"试验位"：一次插头断开', 5500);
                    await _sleep(3000);
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && q._workPos === 1 && q.getState() === 'off');
                },
            },
            // ── 步骤 2：解锁电磁锁 → 摇 5 次合接地开关 ──
            {
                msg: '第 2 步：解锁接地开关电磁锁，摇动手柄 5 次，将接地开关合上',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'emlock', 'right', 3000, 800, () => {
                        qf1._emLockUnlocked = true;
                    });
                    this.sys.showFloatingTip('打开接地开关电磁锁（手车在试验位才允许操作接地开关）', 4500);
                    await _sleep(2500);
                    await compArrowThen(this, 'qf1', 'crank', 'right', 2500, 800, () => {
                        qf1._crankInserted = true;
                    });
                    this.sys.showFloatingTip('将操作手柄插入接地开关摇动孔', 3500);
                    await _sleep(1500);
                    await compArrowThen(this, 'qf1', 'crankRight', 'up', 3000, 800, () => {
                        for (let i = 0; i < 5; i++) {
                            qf1._crankTurnCount++;
                            qf1._crankRotation += 360;
                        }
                        qf1._updateGroundSwitchState();
                    });
                    this.sys.showFloatingTip('顺时针转动手柄 5 次，接地开关 GS1/GS2/GS3 合上，三相出线可靠接地', 6000);
                    await _sleep(3500);
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && q.isGrounded());
                },
            },
            // ── 步骤 3：打开柜门 ──
            {
                msg: '第 3 步：打开柜门（接地开关合上后方可开门）',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'door', 'down', 3000, 800, () => {
                        if (qf1) qf1.toggleDoor();
                    });
                    this.sys.showFloatingTip('柜门已打开，可进行柜内检查与检修（开门前必须已可靠接地）', 5000);
                    await _sleep(3000);
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && q.isDoorOpen());
                },
            },
            // ── 步骤 4：拔掉二次插头（仅提示）→ 摇到检修位 ──
            {
                msg: '第 4 步：拔掉二次插头（本步只作提示），将断路器摇到检修位',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    this.sys.showFloatingTip('注意：先将二次插头（航空插头）拔出，切断控制/信号回路后再移动手车（本步仅提示）', 6500);
                    await _sleep(3500);
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 800, () => {
                        qf1._workPos = 2; qf1._detent = 2;
                        qf1._dialAngle = 180; qf1._dialCur = 180;
                        qf1._syncMainCircuits();   // 检修位：一、二次插头全断
                    });
                    this.sys.showFloatingTip('手车摇到"检修位"：一次、二次插头全部断开，断路器本体可移出检修', 6000);
                    await _sleep(3500);
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && q._workPos === 2);
                },
            },
            // ── 步骤 5：插入二次接头 → 摇到试验位 ──
            {
                msg: '第 5 步：插入二次接头，将断路器摇到试验位',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    this.sys.showFloatingTip('检修完毕，装回断路器本体并插入二次接头（航空插头），恢复控制与信号回路', 6000);
                    await _sleep(3500);
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 800, () => {
                        qf1._workPos = 1; qf1._detent = 1;
                        qf1._dialAngle = 90; qf1._dialCur = 90;
                        qf1._syncMainCircuits();   // 试验位：二次回路恢复接通
                    });
                    this.sys.showFloatingTip('手车摇到"试验位"：二次插头接通，可进行分合闸与保护试验', 6000);
                    await _sleep(3500);
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && q._workPos === 1);
                },
            },
            // ── 步骤 6：关闭柜门 → 断开接地开关 ──
            {
                msg: '第 6 步：关闭柜门，断开接地开关',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'door', 'down', 3000, 800, () => {
                        if (qf1) qf1.toggleDoor();
                    });
                    this.sys.showFloatingTip('关闭开关柜柜门', 4000);
                    await _sleep(3000);
                    await compArrowThen(this, 'qf1', 'crankLeft', 'up', 3000, 800, () => {
                        for (let i = 0; i < 5; i++) {
                            if (qf1._crankTurnCount > 0) qf1._crankTurnCount--;
                            qf1._crankRotation -= 360;
                        }
                        qf1._updateGroundSwitchState();
                        qf1._crankInserted = false;
                        qf1._emLockUnlocked = false;
                    });
                    this.sys.showFloatingTip('逆时针转动手柄 5 次，断开接地开关、拆除接地，恢复冷备用状态', 6000);
                    await _sleep(3500);
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && !q.isDoorOpen() && !q.isGrounded());
                },
            },
            // ── 步骤 7：摇到工作位 ──
            {
                msg: '第 7 步：将断路器摇到工作位（连接位）',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 800, () => {
                        qf1._workPos = 0; qf1._detent = 0;
                        qf1._dialAngle = 0; qf1._dialCur = 0;
                        qf1._syncMainCircuits();
                    });
                    this.sys.showFloatingTip('手车摇到"工作位（连接位）"：一次插头接通，断路器具备送电条件', 6000);
                    await _sleep(3000);
                },
                check() {
                    const q = this.sys.comps.qf1;
                    return !!(q && q._workPos === 0);
                },
            },
            // ── 步骤 8：测试题——哪些操作体现高压五防 ──
            {
                msg: '第 8 步：测试题——哪些操作体现了高压"五防"',
                mode: 'quiz',
                quizConfig: {
                    isMultiple: true,
                    question: '本检修流程中，下列哪些操作体现了高压电气"五防"要求？',
                    options: [
                        '分闸状态下先将手车摇到试验位，再操作接地开关',
                        '接地开关合上后才允许打开柜门；接地期间禁止将手车摇回工作位',
                        '为图省事，未合上接地开关就打开柜门进入柜内检修',
                        '带负荷拉合隔离开关进行隔离',
                    ],
                    answer: [0, 1],
                    analysis: '高压"五防"：①防止误分误合断路器；②防止带负荷拉合隔离开关；' +
                        '③防止带电挂（合）接地线（接地开关）；④防止带接地线（接地开关）合断路器；⑤防止误入带电间隔。' +
                        'A 体现②③（分闸后、试验位再操作接地开关，防带负荷、防带电接地）；' +
                        'B 体现④⑤（先接地后开门、接地期间不得摇回工作位，防误入带电间隔、防带地线合闸）；' +
                        'C、D 属于违反"五防"的典型误操作。',
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
    { Class: HvTester, id: 'hv_tester', x: 1290, y: 320, label: '高压验电器', visible: true },
    // ── 高压接地监视仪：液晶屏三行显示 A/B/C 相绝缘电阻，上端 3 端子接汇流排1 第 4 口 ──
    { Class: HvGroundMonitor, id: 'hv_ground_monitor', x: 580, y: 130, label: '高压接地监视仪', visible: true },
    // ── 绝缘电阻测试支路：汇流排1 第5口第3相 → 10MΩ 竖放电阻 → 接地（模拟绝缘下降）──
    { Class: Resistor, id: 'r_insul', x: 852, y: 190, value: 10000000, direction: 'vertical', label: '绝缘电阻10MΩ', visible: true },
    { Class: Ground, id: 'gnd_insul', x: 852, y: 280, label: '接地', visible: true },
    // ── 高压放电棒（手持放电工具：钩尖碰带电体 → 10MΩ 放电电阻 → 接地线 → 地）──
    // 3 个电气端口：l(钩尖) / r(连接处·接地引出) / gnd(接地线末端)；未自动接线，教师可按需接入
    { Class: HvDischargeRod, id: 'hv_rod', x: 1920, y: 950, label: '高压放电棒', value: 10000000, visible: true },
    // ── 高压接地线（三相短路接地线：三个相接线夹竖排 + 三根向下弯曲软线 + 接地夹；右侧绝缘杆与手柄）──
    // 4 个电气端口：p1/p2/p3(相接线夹) / gnd(接地夹)，内部三相短接接地；未自动接线，教师可按需接入
    { Class: HvGroundingCable, id: 'hv_ground_cable', x: 2160, y: 560, label: '高压接地线', visible: true },
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

// ── 单线图部件位置定义（与 HvPowerOneLine.js 保持一致）──
const _OL_GENS = [
    { id: 'DG1', x: 160, y: 70, r: 24 },
    { id: 'DG2', x: 390, y: 70, r: 24 },
    { id: 'DG3', x: 710, y: 70, r: 24 },
    { id: 'DG4', x: 940, y: 70, r: 24 },
    { id: 'DG5', x: 690, y: 660, r: 20 },
];
const _OL_SWS = [
    { id: 'HACB1', x: 160, y: 150, d: 'v' }, { id: '01', x: 160, y: 205, d: 'v' },
    { id: 'HACB2', x: 390, y: 150, d: 'v' }, { id: '02', x: 390, y: 205, d: 'v' },
    { id: 'HACB3', x: 710, y: 150, d: 'v' }, { id: '03', x: 710, y: 205, d: 'v' },
    { id: 'HACB4', x: 940, y: 150, d: 'v' }, { id: '04', x: 940, y: 205, d: 'v' },
    { id: '07', x: 495, y: 260, d: 'h' }, { id: 'HBUSTIE', x: 545, y: 260, d: 'h' },
    { id: '08', x: 595, y: 260, d: 'h' },
    { id: 'VCB_PTR1', x: 390, y: 310, d: 'v' }, { id: 'VCB_TR1', x: 275, y: 310, d: 'v' },
    { id: 'VCB_TR2', x: 825, y: 310, d: 'v' }, { id: 'VCB_PTR2', x: 710, y: 310, d: 'v' },
    { id: '05', x: 100, y: 320, d: 'v' }, { id: '06', x: 1000, y: 320, d: 'v' },
    { id: 'ACB_TR1', x: 275, y: 485, d: 'v' }, { id: 'ACB_TR2', x: 825, y: 485, d: 'v' },
    { id: 'ACB1', x: 690, y: 600, d: 'v' }, { id: 'MBUSTIE', x: 550, y: 560, d: 'h' },
];
const _OL_TRS = [
    { id: 'PTR1', x: 390, y: 370, r: 22 }, { id: 'TR1', x: 275, y: 400, r: 24 },
    { id: 'TR2', x: 825, y: 400, r: 24 }, { id: 'PTR2', x: 710, y: 370, r: 22 },
];
function _olPartXY(partId) {
    const g = _OL_GENS.find(p => p.id === partId);
    if (g) return { x: g.x, y: g.y };
    const s = _OL_SWS.find(p => p.id === partId);
    if (s) return { x: s.x, y: s.y };
    const t = _OL_TRS.find(p => p.id === partId);
    if (t) return { x: t.x, y: t.y };
    return null;
}

/**
 * 在单线图部件位置显示闪烁箭头 → 等待 duration → 移除箭头 → 执行操作 → 等待 gap
 * @param {object} ctx    - workflow 步骤上下文（this）
 * @param {string} partId - 部件 ID（如 'DG1'、'HACB1'）
 * @param {string} dir    - 箭头方向 'left'|'right'|'up'|'down'
 * @param {number} blinkMs - 闪烁时长（默认 3000）
 * @param {number} gapMs   - 操作后延时（默认 2000）
 * @param {Function} fn    - 操作回调
 */
async function arrowThen(ctx, partId, dir, blinkMs, gapMs, fn) {
    const sys = ctx.sys;
    const ol = sys && sys.comps && sys.comps['one_line'];
    if (!ol || !ol.group) { if (fn) fn(); return; }
    const pos = _olPartXY(partId);
    if (!pos) { if (fn) fn(); return; }
    const absX = ol.group.x() + pos.x;
    const absY = ol.group.y() + pos.y;
    const pad = 24, len = 30, w = 16;
    let points;
    if (dir === 'left')  points = [absX + pad + len, absY, absX + pad, absY];
    if (dir === 'right') points = [absX - pad - len, absY, absX - pad, absY];
    if (dir === 'up')    points = [absX, absY + pad + len, absX, absY + pad];
    if (dir === 'down')  points = [absX, absY - pad - len, absX, absY - pad];

    // ── 外层光晕（半透明大箭头，脉冲呼吸）──
    const glow = new Konva.Arrow({
        points, pointerLength: len + 4, pointerWidth: w + 6,
        fill: 'rgba(243,156,18,.25)', stroke: 'rgba(243,156,18,.25)',
        strokeWidth: 6, opacity: 1, listening: false,
    });
    sys.layer.add(glow);

    // ── 内层主箭头（实心橙色）──
    const arrow = new Konva.Arrow({
        points, pointerLength: len, pointerWidth: w,
        fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 2.5,
        shadowColor: 'rgba(231,76,60,.6)', shadowBlur: 8, shadowOpacity: .6,
        opacity: 1, listening: false,
    });
    sys.layer.add(arrow);

    // ── 被指部件画红色圆圈标记 ──
    const circle = new Konva.Circle({
        x: absX, y: absY, radius: 16,
        stroke: '#e74c1c', strokeWidth: 2.5,
        dash: [6, 3], opacity: 1, listening: false,
    });
    sys.layer.add(circle);

    // ── 闪烁动画 ──
    let vis = true;
    const timer = setInterval(() => {
        vis = !vis;
        const o = vis ? 1 : 0.15;
        arrow.opacity(o); glow.opacity(vis ? 0.6 : 0.05);
        circle.opacity(vis ? 1 : 0.2);
        sys.requestRedraw();
    }, 500);
    await _sleep(blinkMs || 3000);
    clearInterval(timer);
    arrow.remove(); glow.remove(); circle.remove();
    sys.requestRedraw();
    if (fn) fn();
    await _sleep(gapMs || 2000);
}

// ── 配电柜常量 & 按钮位置定义（与 HvSwitchPanel.js 保持一致）──
const CAB_W = 225;
const UPPER_H = 325, MID_H = 162;
const _SP_BTN = {
    // 发电机柜按钮（idx=3 gen1, idx=4 gen2）
    gen1_start:   { x: 3 * CAB_W + 52.5,  y: 208 },
    gen1_stop:    { x: 3 * CAB_W + 92.5,  y: 208 },
    gen1_close:   { x: 3 * CAB_W + 132.5, y: 208 },
    gen1_open:    { x: 3 * CAB_W + 172.5, y: 208 },
    gen1_autoSync: { x: 3 * CAB_W + 72.5, y: 265 },
    gen1_autoSplit:{ x: 3 * CAB_W + 152.5,y: 265 },
    gen2_start:   { x: 4 * CAB_W + 52.5,  y: 208 },
    gen2_stop:    { x: 4 * CAB_W + 92.5,  y: 208 },
    gen2_close:   { x: 4 * CAB_W + 132.5, y: 208 },
    gen2_open:    { x: 4 * CAB_W + 172.5, y: 208 },
    gen2_autoSync: { x: 4 * CAB_W + 72.5, y: 265 },
    gen2_autoSplit:{ x: 4 * CAB_W + 152.5,y: 265 },
    // 变压器/推进柜
    tr_close:     { x: 1 * CAB_W + 35,    y: 208 },
    tr_open:      { x: 1 * CAB_W + 85,    y: 208 },
    prop_close:   { x: 2 * CAB_W + 35,    y: 208 },
    prop_open:    { x: 2 * CAB_W + 85,    y: 208 },
    // 母联柜
    tie_close:    { x: 6 * CAB_W + 35,    y: 208 },
    tie_open:     { x: 6 * CAB_W + 85,    y: 208 },
    // 母线接地柜
    ground_test:  { x: 155,                y: 140 },
    ground_sw:    { x: 100,                y: UPPER_H + MID_H + 78 },
    // 并车柜开关
    sync_mode:    { x: 5 * CAB_W + 50,     y: 218 },
    sync_seq:     { x: 5 * CAB_W + 138,    y: 218 },
};

/**
 * 在配电柜按钮位置显示闪烁箭头 → 操作 → 移除
 * @param {object} ctx      - workflow 步骤上下文
 * @param {string} btnKey   - _SP_BTN 中的键名（如 'gen1_start'）
 * @param {string} dir      - 箭头方向
 * @param {number} blinkMs  - 闪烁时长
 * @param {number} gapMs    - 操作后延时
 * @param {Function} fn     - 操作回调
 */
async function panelArrowThen(ctx, btnKey, dir, blinkMs, gapMs, fn) {
    const sys = ctx.sys;
    const sp = sys && sys.comps && sys.comps['switch_panel'];
    if (!sp || !sp.group) { if (fn) fn(); return; }
    const def = _SP_BTN[btnKey];
    if (!def) { if (fn) fn(); return; }
    const absX = sp.group.x() + def.x;
    const absY = sp.group.y() + def.y;
    const pad = 24, len = 30, w = 16;
    let points;
    if (dir === 'left')  points = [absX + pad + len, absY, absX + pad, absY];
    if (dir === 'right') points = [absX - pad - len, absY, absX - pad, absY];
    if (dir === 'up')    points = [absX, absY + pad + len, absX, absY + pad];
    if (dir === 'down')  points = [absX, absY - pad - len, absX, absY - pad];

    const glow = new Konva.Arrow({
        points, pointerLength: len + 4, pointerWidth: w + 6,
        fill: 'rgba(243,156,18,.25)', stroke: 'rgba(243,156,18,.25)',
        strokeWidth: 6, opacity: 1, listening: false,
    });
    sys.layer.add(glow);
    const arrow = new Konva.Arrow({
        points, pointerLength: len, pointerWidth: w,
        fill: '#e74c3c', stroke: '#c0392b', strokeWidth: 2.5,
        shadowColor: 'rgba(231,76,60,.6)', shadowBlur: 8, shadowOpacity: .6,
        opacity: 1, listening: false,
    });
    sys.layer.add(arrow);
    const circle = new Konva.Circle({
        x: absX, y: absY, radius: 16,
        stroke: '#e74c3c', strokeWidth: 2.5,
        dash: [6, 3], opacity: 1, listening: false,
    });
    sys.layer.add(circle);

    let vis = true;
    const timer = setInterval(() => {
        vis = !vis;
        const o = vis ? 1 : 0.15;
        arrow.opacity(o); glow.opacity(vis ? 0.6 : 0.05);
        circle.opacity(vis ? 1 : 0.2);
        sys.requestRedraw();
    }, 500);
    await _sleep(blinkMs || 3000);
    clearInterval(timer);
    arrow.remove(); glow.remove(); circle.remove();
    sys.requestRedraw();
    if (fn) fn();
    await _sleep(gapMs || 2000);
}

/** 将并车柜旋转开关拨到指定角度（直接设置内部状态 + 刷新旋钮视觉） */
function _setSyncKnob(sp, key, targetAng) {
    const pos = sp._syncPos && sp._syncPos[key];
    if (!pos) return;
    const idx = pos.angs.indexOf(targetAng);
    if (idx < 0) return;
    pos.i = idx;
    if (sp._syncKnobs && sp._syncKnobs[key]) sp._syncKnobs[key].rotation(targetAng);
    sp._highlightSync(key);
}

// ── 电路组件子部件位置定义（相对于 component group 的精确坐标）──
// 格式：{ compId: { partId: { x, y } } }
// 注意：rotation=90° 的组件，local(x,y) → group(-y, x)
const _COMP_PARTS = {
    hvgp: {
        start:    { x: 98,  y: 90 },   // 起停自复位开关
        close:    { x: 154, y: 90 },   // 合分闸自复位开关
        mode:     { x: 42,  y: 90 },   // 手动/自动转换开关
        sync:     { x: 98,  y: 170 },  // 同步表开关
        live:     { x: 126, y: 162 },  // 高压带电显示器（黄/绿/红三灯）
        selftest: { x: 228, y: 160 },  // 带电显示器自检按钮
        groundled:{ x: 294, y: 22 },   // 接地合(绿) / 接地开(红) 指示灯
        runled:   { x: 210, y: 22 },   // 运行指示灯
        autoled:  { x: 98,  y: 22 },   // 自动模式指示灯
    },
    // 微机综合保护装置：液晶显示屏
    prot1: {
        lcd: { x: 180, y: 120 },
    },
    // 高压接地监视仪：三相绝缘电阻显示屏
    hv_ground_monitor: {
        lcd: { x: 65, y: 75 },
    },
    // vcbs2: rotation=90°，local(50,89) → group(-89,50)
    vcbs2: {
        main:   { x: -89, y: 50 },   // 主触头（旋转后）
        top:    { x: -40, y: 50 },   // 上隔离（旋转后）
        bot:    { x: -138,y: 50 },   // 下隔离（旋转后）
    },
    vcbs3: {
        main:   { x: 50,  y: 89 },   // 主触头
        top:    { x: 50,  y: 40 },   // 上隔离
        bot:    { x: 50,  y: 138 },  // 下隔离
    },
    vcbs4: {
        main:   { x: 50,  y: 89 },
        top:    { x: 50,  y: 40 },
        bot:    { x: 50,  y: 138 },
    },
    aq1: {
        main:   { x: 75,  y: 55 },   // 断路器中心
    },
    aq2: {
        main:   { x: 75,  y: 55 },
    },
    // aq3: rotation=90°，local(75,55) → group(-55,75)
    aq3: {
        main:   { x: -55, y: 75 },   // 断路器中心（旋转后）
    },
    gen_hv: {
        start:  { x: 45,  y: 140 },  // 起动按钮
        stop:   { x: 120, y: 140 },  // 停止按钮
        mode:   { x: 78,  y: 118 },  // 本地/遥控转换开关
        knob:   { x: 53,  y: 215 },  // 调速旋钮
        exc:    { x: 118, y: 215 },  // 励磁开关
        lcd:    { x: 79,  y: 49 },   // 液晶显示屏
    },
    // 高压验电器（手持工具）
    hv_tester: {
        tip:    { x: 0, y: 4 },      // 接触头
        body:   { x: 0, y: 42 },     // 声光报警体
        handle: { x: 0, y: 185 },    // 绝缘手柄
    },
    // 真空断路器 qf1（带接地开关栏）
    qf1: {
        main:      { x: 208, y: 141 },  // 真空灭弧室 / 主触头（本体）
        indicator: { x: 39,  y: 50 },   // 合/分闸指示牌（合闸 ON / 分闸 OFF）
        dial:      { x: 75,  y: 198 },  // 工作位圆盘
        emlock:    { x: 75,  y: 310 },  // 电磁锁
        crank:     { x: 75,  y: 330 },  // 摇柄插入孔
        crankRight:{ x: 95,  y: 330 },  // 插入孔右侧（顺时针）
        crankLeft: { x: 50,  y: 330 },  // 插入孔左侧（逆时针）
        close:     { x: 40,  y: 83 },   // 合闸按钮
        trip:      { x: 110, y: 83 },   // 分闸按钮
        ground:    { x: 280, y: 335 },  // 接地开关（GS1/GS2/GS3）
        door:      { x: 244, y: 208 },  // 开关柜柜门
    },
    // 手摇兆欧表
    megohm: {
        crank: { x: 100, y: 200 },  // 手摇手柄
    },
};

/**
 * 在电路组件的精确子部件位置显示闪烁箭头
 * @param {object} ctx      - workflow 步骤上下文
 * @param {string} compId   - 组件 ID（如 'hvgp', 'vcbs3'）
 * @param {string} partId   - 子部件 ID（如 'start', 'main', 'top'）
 * @param {string} dir      - 箭头方向
 * @param {number} blinkMs  - 闪烁时长
 * @param {number} gapMs    - 操作后延时
 * @param {Function} fn     - 操作回调
 */
async function compArrowThen(ctx, compId, partId, dir, blinkMs, gapMs, fn) {
    const sys = ctx.sys;
    const comp = sys && sys.comps && sys.comps[compId];
    if (!comp || !comp.group) { if (fn) fn(); return; }
    const parts = _COMP_PARTS[compId];
    const part = parts && parts[partId];
    if (!part) { if (fn) fn(); return; }
    const absX = comp.group.x() + part.x;
    const absY = comp.group.y() + part.y;
    const pad = 28, len = 36, w = 18;
    let points;
    if (dir === 'left')  points = [absX + pad + len, absY, absX + pad, absY];
    if (dir === 'right') points = [absX - pad - len, absY, absX - pad, absY];
    if (dir === 'up')    points = [absX, absY + pad + len, absX, absY + pad];
    if (dir === 'down')  points = [absX, absY - pad - len, absX, absY - pad];

    // ── 外层光晕 ──
    const glow = new Konva.Arrow({
        points, pointerLength: len + 6, pointerWidth: w + 8,
        fill: 'rgba(46,204,113,.25)', stroke: 'rgba(46,204,113,.25)',
        strokeWidth: 7, opacity: 1, listening: false,
    });
    sys.layer.add(glow);
    // ── 内层主箭头 ──
    const arrow = new Konva.Arrow({
        points, pointerLength: len, pointerWidth: w,
        fill: '#27ae60', stroke: '#1e8449', strokeWidth: 3,
        shadowColor: 'rgba(39,174,96,.6)', shadowBlur: 10, shadowOpacity: .6,
        opacity: 1, listening: false,
    });
    sys.layer.add(arrow);
    // ── 精确圆圈围住子部件 ──
    const circle = new Konva.Circle({
        x: absX, y: absY, radius: 20,
        stroke: '#e74c3c', strokeWidth: 3.5,
        dash: [7, 4], opacity: 1, listening: false,
    });
    sys.layer.add(circle);
    // ── 闪烁动画 ──
    let vis = true;
    const timer = setInterval(() => {
        vis = !vis;
        const o = vis ? 1 : 0.15;
        arrow.opacity(o); glow.opacity(vis ? 0.6 : 0.05);
        circle.opacity(vis ? 1 : 0.2);
        sys.requestRedraw();
    }, 500);
    await _sleep(blinkMs || 3000);
    clearInterval(timer);
    arrow.remove(); glow.remove(); circle.remove();
    sys.requestRedraw();
    if (fn) fn();
    await _sleep(gapMs || 2000);
}

/**
 * 在工具栏 DOM 按钮位置显示高亮闪烁框
 * @param {string} btnId    - 按钮 DOM ID
 * @param {number} blinkMs  - 闪烁时长
 */
async function domBtnHighlight(btnId, blinkMs) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // ── 注入闪烁动画（只注入一次）──
    if (!document.getElementById('dom-btn-style')) {
        const st = document.createElement('style');
        st.id = 'dom-btn-style';
        st.textContent = `
            @keyframes domPulse { 0%,100%{ transform:scale(1); opacity:1; } 50%{ transform:scale(1.12); opacity:.6; } }
            @keyframes domGlow  { 0%,100%{ box-shadow:0 0 8px 2px rgba(243,156,18,.5); } 50%{ box-shadow:0 0 22px 8px rgba(243,156,18,.9); } }
            @keyframes domBlink { 0%,100%{ opacity:1; } 50%{ opacity:.15; } }
            @keyframes domBob  { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-5px); } }
        `;
        document.head.appendChild(st);
    }

    // ── 外层光晕脉冲圈（闪烁）──
    const glow = document.createElement('div');
    Object.assign(glow.style, {
        position:'fixed', left:(cx-24)+'px', top:(cy-24)+'px',
        width:'48px', height:'48px', borderRadius:'50%',
        border:'3px solid #f39c12', background:'rgba(243,156,18,.15)',
        pointerEvents:'none', zIndex:'9998',
        animation:'domGlow .8s ease-in-out infinite',
    });
    document.body.appendChild(glow);

    // ── 内层高亮框（套住按钮，脉冲闪烁）──
    const box = document.createElement('div');
    Object.assign(box.style, {
        position:'fixed', left:(rect.left-6)+'px', top:(rect.top-6)+'px',
        width:(rect.width+12)+'px', height:(rect.height+12)+'px',
        border:'3px solid #e74c3c', borderRadius:'6px',
        background:'rgba(231,76,60,.08)',
        pointerEvents:'none', zIndex:'9999',
        animation:'domPulse .8s ease-in-out infinite',
    });
    document.body.appendChild(box);

    // ── 闪烁小圆点（模拟鼠标点击位置）──
    const dot = document.createElement('div');
    Object.assign(dot.style, {
        position:'fixed', left:(cx-7)+'px', top:(cy+rect.height/2+8)+'px',
        width:'14px', height:'14px', borderRadius:'50%',
        background:'#e74c3c', border:'2px solid #fff',
        pointerEvents:'none', zIndex:'9999',
        animation:'domBlink .6s ease-in-out infinite',
        boxShadow:'0 0 10px rgba(231,76,60,.8)',
    });
    document.body.appendChild(dot);

    // ── 下方提示文字 ──
    const tip = document.createElement('div');
    tip.textContent = '☝ 点击';
    Object.assign(tip.style, {
        position:'fixed', left:(cx-28)+'px', top:(rect.bottom+6)+'px',
        width:'56px', textAlign:'center',
        fontSize:'13px', fontWeight:'bold', color:'#e74c3c',
        textShadow:'0 0 4px rgba(231,76,60,.4)',
        pointerEvents:'none', zIndex:'9999',
        animation:'domBob .8s ease-in-out infinite',
    });
    document.body.appendChild(tip);

    await _sleep(blinkMs || 3000);
    [glow, box, dot, tip].forEach(el => el.remove());
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
