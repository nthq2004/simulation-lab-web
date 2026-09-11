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
    // 认识高压电力系统单线图（全部在 HvPowerOneLine 组件上操作）
    // ══════════════════════════════════════════════════════════════
    'hv-oneline-intro': {
        id: 'hv-oneline-intro',
        name: '1.认识高压电力系统单线图',
        steps: [
            // ── 步骤 1：勾选单线图，显示高压电力系统单线图 ──
            {
                msg: '第 1 步：勾选工具栏"单线图"复选框，显示高压电力系统单线图',
                mode: 'check',
                async act() {
                    const cb = document.getElementById('btnOneLine');
                    if (!cb) return;
                    const rect = cb.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;

                    // ── 注入动画样式（只注入一次）──
                    if (!document.getElementById('ol-arrow-style')) {
                        const st = document.createElement('style');
                        st.id = 'ol-arrow-style';
                        st.textContent = `
                            @keyframes olPulse { 0%,100%{ transform:scale(1); opacity:1; } 50%{ transform:scale(1.15); opacity:.7; } }
                            @keyframes olGlow  { 0%,100%{ box-shadow:0 0 8px 2px rgba(243,156,18,.6); } 50%{ box-shadow:0 0 20px 6px rgba(243,156,18,.9); } }
                            @keyframes olBlink { 0%,100%{ opacity:1; } 50%{ opacity:.2; } }
                            @keyframes olArrowBob { 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-5px); } }
                        `;
                        document.head.appendChild(st);
                    }

                    // ── 外层光晕脉冲圈 ──
                    const glow = document.createElement('div');
                    Object.assign(glow.style, {
                        position:'fixed', left:(cx-22)+'px', top:(cy-22)+'px',
                        width:'44px', height:'44px', borderRadius:'50%',
                        border:'3px solid #f39c12', background:'rgba(243,156,18,.12)',
                        pointerEvents:'none', zIndex:'9998',
                        animation:'olGlow 1s ease-in-out infinite',
                    });
                    document.body.appendChild(glow);

                    // ── 内层高亮框（套住复选框）──
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        position:'fixed', left:(rect.left-5)+'px', top:(rect.top-5)+'px',
                        width:(rect.width+10)+'px', height:(rect.height+10)+'px',
                        border:'2.5px solid #e74c3c', borderRadius:'4px',
                        background:'rgba(231,76,60,.08)',
                        pointerEvents:'none', zIndex:'9999',
                        animation:'olPulse 1s ease-in-out infinite',
                    });
                    document.body.appendChild(box);

                    // ── 闪烁小圆点（模拟鼠标点击位置）──
                    const dot = document.createElement('div');
                    Object.assign(dot.style, {
                        position:'fixed', left:(cx-6)+'px', top:(cy+16)+'px',
                        width:'12px', height:'12px', borderRadius:'50%',
                        background:'#e74c3c', border:'2px solid #fff',
                        pointerEvents:'none', zIndex:'9999',
                        animation:'olBlink .6s ease-in-out infinite',
                        boxShadow:'0 0 8px rgba(231,76,60,.8)',
                    });
                    document.body.appendChild(dot);

                    // ── 下方提示文字 ──
                    const tip = document.createElement('div');
                    tip.textContent = '☝ 点击勾选';
                    Object.assign(tip.style, {
                        position:'fixed', left:(cx-36)+'px', top:(cy+30)+'px',
                        width:'72px', textAlign:'center',
                        fontSize:'13px', fontWeight:'bold', color:'#e74c3c',
                        textShadow:'0 0 4px rgba(231,76,60,.4)',
                        pointerEvents:'none', zIndex:'9999',
                        animation:'olArrowBob 1s ease-in-out infinite',
                    });
                    document.body.appendChild(tip);

                    // ── 闪烁 3 秒后清除 ──
                    await _sleep(3000);
                    [glow, box, dot, tip].forEach(el => el.remove());

                    // ── 勾选复选框 ──
                    if (!cb.checked) cb.click();
                    await _sleep(2000);
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.group && ol.group.visible());
                },
            },
            // ── 步骤 2：认识高压发电机，起动 1# 发电机组 ──
            {
                msg: '第 2 步：在单线图中认识高压发电机——起动 1# 发电机组 DG1（运行时圆圈变绿）',
                mode: 'check',
                async act() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    await arrowThen(this, 'DG1', 'down', 3000, 2000, () => {
                        if (ol && !ol.getGenState('DG1')) ol.toggleGen('DG1');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getGenState('DG1'));
                },
            },
            // ── 步骤 3：认识隔离开关和真空断路器，合上隔离开关 01，合上真空断路器 HACB1 ──
            {
                msg: '第 3 步：认识隔离开关和真空断路器——先合上隔离开关 01，再合上真空断路器 HACB1，使 DG1 向高压母线 HBBA 供电',
                mode: 'check',
                async act() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    await arrowThen(this, '01', 'left', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('01')) ol.toggleSwitch('01');
                    });
                    await arrowThen(this, 'HACB1', 'left', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('HACB1')) ol.toggleSwitch('HACB1');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getGenState('DG1') && ol.getSwitchState('01') && ol.getSwitchState('HACB1'));
                },
            },
            // ── 步骤 4：认识高压母联开关，合上隔离开关 07 和 08，合上高压母联开关 HBUSTIE ──
            {
                msg: '第 4 步：认识高压母联开关——合上隔离开关 07、08，再合上母联断路器 HBUSTIE，使 HBBA 与 HBBB 并联运行',
                mode: 'check',
                async act() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    await arrowThen(this, '07', 'up', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('07')) ol.toggleSwitch('07');
                    });
                    await arrowThen(this, '08', 'up', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('08')) ol.toggleSwitch('08');
                    });
                    await arrowThen(this, 'HBUSTIE', 'up', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('HBUSTIE')) ol.toggleSwitch('HBUSTIE');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getSwitchState('07') && ol.getSwitchState('08') && ol.getSwitchState('HBUSTIE'));
                },
            },
            // ── 步骤 5：认识日用变压器 TR1，合上高压真空断路器 VCB_TR1 和低压负荷开关 ACB_TR1，给低压配电板供电 ──
            {
                msg: '第 5 步：认识日用变压器 TR1——合上高压侧真空断路器 VCB_TR1 与低压侧负荷开关 ACB_TR1，将 6600V 变为 400V 给低压配电板供电',
                mode: 'check',
                async act() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    await arrowThen(this, 'TR1', 'right', 3000, 2000, () => {});
                    await arrowThen(this, 'VCB_TR1', 'left', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('VCB_TR1')) ol.toggleSwitch('VCB_TR1');
                    });
                    await arrowThen(this, 'ACB_TR1', 'left', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('ACB_TR1')) ol.toggleSwitch('ACB_TR1');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getSwitchState('VCB_TR1') && ol.getSwitchState('ACB_TR1'));
                },
            },
            // ── 步骤 6：认识低压配电板，合上低压母联开关 MBUSTIE ──
            {
                msg: '第 6 步：认识低压配电板——合上低压母联开关 MBUSTIE，使 MBBA 与 MBBB 并联供电',
                mode: 'check',
                async act() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    await arrowThen(this, 'MBUSTIE', 'down', 3000, 2000, () => {
                        if (ol && !ol.getSwitchState('MBUSTIE')) ol.toggleSwitch('MBUSTIE');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getSwitchState('MBUSTIE'));
                },
            },
            // ── 步骤 7：测试题——高压配电板采用分段的目的 ──
            {
                msg: '第 7 步：测试题——高压配电板采用分段的目的',
                mode: 'quiz',
                quizConfig: {
                    question: '高压配电板采用分段（HBBA / HBBB 母联分段）的主要目的是什么？',
                    options: [
                        '增加母线截面积，提高载流能力',
                        '提高供电可靠性：一段母线故障或检修时，另一段仍可独立运行；正常时可通过母联并联供电，故障时自动隔离',
                        '降低母线电压等级，方便接入低压设备',
                        '减小母线短路电流，无需任何保护装置',
                    ],
                    answer: 1,
                    analysis: '高压配电板采用 HBBA/HBBB 分段母线结构，正常运行时母联断路器（HBUSTIE）合闸，两段母线并联供电，提高系统容量和供电灵活性；当一段母线发生故障（如接地、短路）或需要检修时，断开母联即可将故障段隔离，另一段母线上的发电机和负载仍可继续运行，从而大幅提高船舶电力系统的供电可靠性和生存能力。这也符合 SOLAS 公约对船舶电站冗余性的要求。',
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════
    // 高压主配电板的认识和操作（全部在 HvSwitchPanel 组件上操作）
    // ══════════════════════════════════════════════════════════════
    'hv-switch-panel-intro': {
        id: 'hv-switch-panel-intro',
        name: '2.高压主配电板的认识和操作',
        steps: [
            // ── 步骤 1：勾选高压配电柜，显示高压主配电板 ──
            {
                msg: '第 1 步：勾选工具栏"高压配电柜"复选框，显示高压主配电板',
                mode: 'check',
                async act() {
                    const cb = document.getElementById('btnSwitchPanel');
                    if (!cb) return;
                    const rect = cb.getBoundingClientRect();
                    const cx = rect.left + rect.width / 2;
                    const cy = rect.top + rect.height / 2;
                    // ── 外层光晕脉冲圈 ──
                    const glow = document.createElement('div');
                    Object.assign(glow.style, {
                        position:'fixed', left:(cx-22)+'px', top:(cy-22)+'px',
                        width:'44px', height:'44px', borderRadius:'50%',
                        border:'3px solid #f39c12', background:'rgba(243,156,18,.12)',
                        pointerEvents:'none', zIndex:'9998',
                        animation:'olGlow 1s ease-in-out infinite',
                    });
                    document.body.appendChild(glow);
                    // ── 内层高亮框 ──
                    const box = document.createElement('div');
                    Object.assign(box.style, {
                        position:'fixed', left:(rect.left-5)+'px', top:(rect.top-5)+'px',
                        width:(rect.width+10)+'px', height:(rect.height+10)+'px',
                        border:'2.5px solid #e74c3c', borderRadius:'4px',
                        background:'rgba(231,76,60,.08)',
                        pointerEvents:'none', zIndex:'9999',
                        animation:'olPulse 1s ease-in-out infinite',
                    });
                    document.body.appendChild(box);
                    // ── 闪烁小圆点 ──
                    const dot = document.createElement('div');
                    Object.assign(dot.style, {
                        position:'fixed', left:(cx-6)+'px', top:(cy+16)+'px',
                        width:'12px', height:'12px', borderRadius:'50%',
                        background:'#e74c3c', border:'2px solid #fff',
                        pointerEvents:'none', zIndex:'9999',
                        animation:'olBlink .6s ease-in-out infinite',
                        boxShadow:'0 0 8px rgba(231,76,60,.8)',
                    });
                    document.body.appendChild(dot);
                    // ── 下方提示文字 ──
                    const tip = document.createElement('div');
                    tip.textContent = '☝ 点击勾选';
                    Object.assign(tip.style, {
                        position:'fixed', left:(cx-36)+'px', top:(cy+30)+'px',
                        width:'72px', textAlign:'center',
                        fontSize:'13px', fontWeight:'bold', color:'#e74c3c',
                        textShadow:'0 0 4px rgba(231,76,60,.4)',
                        pointerEvents:'none', zIndex:'9999',
                        animation:'olArrowBob 1s ease-in-out infinite',
                    });
                    document.body.appendChild(tip);
                    await _sleep(3000);
                    [glow, box, dot, tip].forEach(el => el.remove());
                    if (!cb.checked) cb.click();
                    await _sleep(2000);
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp.group && sp.group.visible());
                },
            },
            // ── 步骤 2：认识发电机控制屏，起动 1# 发电机，合上真空断路器 ──
            {
                msg: '第 2 步：认识 1#发电机控制屏——起动 1# 发电机机组，合上真空断路器，向电网供电',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    // 先认识发电机控制屏（指向柜体上部仪表区域）
                    await panelArrowThen(this, 'gen1_start', 'down', 3000, 1000, null);
                    // 起动 1# 发电机
                    await panelArrowThen(this, 'gen1_start', 'down', 2000, 1500, () => {
                        sp._cbRun.gen1 = true; sp._refreshTie();
                    });
                    // 合上真空断路器
                    await panelArrowThen(this, 'gen1_close', 'down', 3000, 2000, () => {
                        sp._cbState.gen1 = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbRun.gen1 && sp._cbState.gen1);
                },
            },
            // ── 步骤 3：认识变压器馈电柜，合上真空断路器，给日用变压器供电 ──
            {
                msg: '第 3 步：认识变压器馈电柜——合上真空断路器，给日用变压器供电',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    await panelArrowThen(this, 'tr_close', 'down', 3000, 2000, () => {
                        sp._cbState.tr = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbState.tr);
                },
            },
            // ── 步骤 4：认识母联开关柜，合上母联开关，给右母线供电 ──
            {
                msg: '第 4 步：认识母联开关柜——合上母联开关，使左、右母线并联供电',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    await panelArrowThen(this, 'tie_close', 'down', 3000, 2000, () => {
                        sp._tieClosed = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._tieClosed);
                },
            },
            // ── 步骤 5：认识并车柜，半自动模式，起动 2#，自动并车 ──
            {
                msg: '第 5 步：认识并车柜——将模式开关打到"半自动"，手动起动 2#发电机，按下自动并车按钮，观察半自动并车过程',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    // 模式开关打到半自动（-90°）
                    await panelArrowThen(this, 'sync_mode', 'down', 3000, 1500, () => {
                        _setSyncKnob(sp, 'mode', -90);
                        if (sp.sys) sp.sys.requestRedraw();
                    });
                    // 手动起动 2# 发电机
                    await panelArrowThen(this, 'gen2_start', 'down', 3000, 1500, () => {
                        sp._cbRun.gen2 = true; sp._refreshTie();
                    });
                    // 按下自动并车按钮（半自动模式：本机已起动，电网有电 → 3s 后自动合闸）
                    await panelArrowThen(this, 'gen2_autoSync', 'down', 3000, 5000, () => {
                        sp._onAutoSync('gen2');
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbRun.gen2 && sp._cbState.gen2);
                },
            },
            // ── 步骤 6：手动模式，分断 2# 断路器停机，分断 1# 断路器停机 ──
            {
                msg: '第 6 步：将模式开关打到"手动"——分断 2#真空断路器、停 2#机组；分断 1#真空断路器、停 1#机组',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    // 模式开关打到手动（0°）
                    await panelArrowThen(this, 'sync_mode', 'down', 2000, 1000, () => {
                        _setSyncKnob(sp, 'mode', 0);
                        if (sp.sys) sp.sys.requestRedraw();
                    });
                    // 分断 2# 真空断路器
                    await panelArrowThen(this, 'gen2_open', 'down', 2000, 1500, () => {
                        sp._cbState.gen2 = false; sp._refreshTie();
                    });
                    // 停 2# 机组
                    await panelArrowThen(this, 'gen2_stop', 'down', 2000, 1500, () => {
                        sp._cbRun.gen2 = false; sp._refreshTie();
                    });
                    // 分断 1# 真空断路器
                    await panelArrowThen(this, 'gen1_open', 'down', 2000, 1500, () => {
                        sp._cbState.gen1 = false; sp._refreshTie();
                    });
                    // 停 1# 机组
                    await panelArrowThen(this, 'gen1_stop', 'down', 2000, 2000, () => {
                        sp._cbRun.gen1 = false; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && !sp._cbRun.gen1 && !sp._cbRun.gen2
                        && !sp._cbState.gen1 && !sp._cbState.gen2);
                },
            },
            // ── 步骤 7：认识母线接地柜，测试按钮，观察带电显示器，合上接地开关 ──
            {
                msg: '第 7 步：认识母线接地柜——按下测试按钮观察带电显示器（3 灯亮 3s），合上接地开关',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    // 按下测试按钮
                    await panelArrowThen(this, 'ground_test', 'down', 3000, 3500, () => {
                        sp._ledTestT = 3; sp._refreshTie();
                    });
                    // 合上接地开关
                    await panelArrowThen(this, 'ground_sw', 'up', 3000, 2000, () => {
                        sp._cabGround.ground = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cabGround.ground);
                },
            },
            // ── 步骤 8：分断接地开关，备用顺序 2-1-4-3，自动模式 → 2# 自动起动 ──
            {
                msg: '第 8 步：分断接地开关→将备用顺序开关打到"2-1-4-3"→模式开关打到"自动"，观察 2# 机组自动起动、自动合闸过程',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    // 分断接地开关
                    await panelArrowThen(this, 'ground_sw', 'up', 2000, 1500, () => {
                        sp._cabGround.ground = false; sp._refreshTie();
                    });
                    // 备用顺序开关打到 2-1-4-3（seq: angs=[-90,0,90]，0° 即 2-1-4-3）
                    await panelArrowThen(this, 'sync_seq', 'down', 3000, 1500, () => {
                        _setSyncKnob(sp, 'seq', 0);
                        if (sp.sys) sp.sys.requestRedraw();
                    });
                    // 模式开关打到自动（90°）
                    await panelArrowThen(this, 'sync_mode', 'down', 3000, 6000, () => {
                        _setSyncKnob(sp, 'mode', 90);
                        if (sp.sys) sp.sys.requestRedraw();
                    });
                    // 等待自动流程：5s 起动 → 3s 合闸
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbRun.gen2 && sp._cbState.gen2);
                },
            },
            // ── 步骤 9：合上推进馈电柜断路器，观察 1# 机组自动起动、自动并车 ──
            {
                msg: '第 9 步：合上推进馈电柜断路器——观察 1# 机组自动起动、自动并车过程',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps.switch_panel;
                    // 合上推进馈电柜断路器
                    await panelArrowThen(this, 'prop_close', 'down', 3000, 6000, () => {
                        sp._cbState.prop = true; sp._refreshTie();
                    });
                    // 等待自动流程：自动检测到单机运行+负载全通 → 5s 起动备用 → 3s 合闸
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbRun.gen1 && sp._cbState.gen1
                        && sp._cbRun.gen2 && sp._cbState.gen2);
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════
    // 日用变压器的转换（操作实际电路组件）
    // ══════════════════════════════════════════════════════════════
    'hv-transformer-switch': {
        id: 'hv-transformer-switch',
        name: '3.日用变压器的转换',
        steps: [
            // ── 步骤 1：自动接线，起动 1# 机组，合闸供电，合上母联 ──
            {
                msg: '第 1 步：自动接线→遥控面板起动 1# 机组→合闸供电→合上母联开关，给右母线供电',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // ① 高亮"自动接线"按钮
                    await domBtnHighlight('btnAutoWire', 2500);
                    const btnAW = document.getElementById('btnAutoWire');
                    if (btnAW) btnAW.click();
                    await _sleep(1500);
                    // ② 箭头指向遥控面板【起停开关】→ 起动 1# 机组
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 1500, () => {
                        const hvgp = sys.comps.hvgp;
                        if (hvgp) { hvgp._startCmd = true; setTimeout(() => { hvgp._startCmd = false; }, 500); }
                    });
                    await _sleep(3000);
                    // ③ 箭头指向遥控面板【合分闸开关】→ 合闸
                    await compArrowThen(this, 'hvgp', 'close', 'down', 3000, 2000, () => {
                        const hvgp = sys.comps.hvgp;
                        if (hvgp) { hvgp._closeCmd = true; setTimeout(() => { hvgp._closeCmd = false; }, 500); }
                    });
                    // ④ 箭头指向母联断路器 vcbs2【主触头】→ 合上母联
                    await compArrowThen(this, 'vcbs2', 'main', 'down', 3000, 2000, () => {
                        const vcbs2 = sys.comps.vcbs2;
                        if (vcbs2 && typeof vcbs2.toggleMain === 'function') vcbs2.toggleMain();
                    });
                },
                check() {
                    const sys = this.sys;
                    const gen = sys.comps.gen_hv;
                    const qf = sys.comps.qf1;
                    return !!(gen && gen.isOn && qf && qf.getState() === 'on');
                },
            },
            // ── 步骤 2：合上 1# 变压器高压断路器、低压负荷开关、低压母联 ──
            {
                msg: '第 2 步：合上 1#变压器高压断路器 vcbs3→合上低压负荷开关 aq1→合上低压母联 aq3',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // ① 箭头指向 1#变高压断路器 vcbs3【主触头】→ 合闸
                    await compArrowThen(this, 'vcbs3', 'main', 'left', 3000, 2000, () => {
                        const vcbs3 = sys.comps.vcbs3;
                        if (vcbs3 && typeof vcbs3.toggleMain === 'function') vcbs3.toggleMain();
                    });
                    // ② 箭头指向 1#变低压负荷开关 aq1【主触头】→ 合闸
                    await compArrowThen(this, 'aq1', 'main', 'left', 3000, 2000, () => {
                        const aq1 = sys.comps.aq1;
                        if (aq1 && typeof aq1.close === 'function') aq1.close();
                    });
                    // ③ 箭头指向低压母联 aq3【主触头】→ 合闸
                    await compArrowThen(this, 'aq3', 'main', 'up', 3000, 2000, () => {
                        const aq3 = sys.comps.aq3;
                        if (aq3 && typeof aq3.close === 'function') aq3.close();
                    });
                },
                check() {
                    const sys = this.sys;
                    const vcbs3 = sys.comps.vcbs3;
                    const aq1 = sys.comps.aq1;
                    const aq3 = sys.comps.aq3;
                    return !!(vcbs3 && vcbs3.isClosed() && aq1 && aq1._state === 'on' && aq3 && aq3._state === 'on');
                },
            },
            // ── 步骤 3：合上 2# 变压器高压断路器、低压负荷开关，两台变压器并联运行 ──
            {
                msg: '第 3 步：合上 2#变压器高压断路器 vcbs4→合上低压负荷开关 aq2，两台变压器短时并联运行',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // ① 箭头指向 2#变高压断路器 vcbs4【主触头】→ 合闸
                    await compArrowThen(this, 'vcbs4', 'main', 'left', 3000, 2000, () => {
                        const vcbs4 = sys.comps.vcbs4;
                        if (vcbs4 && typeof vcbs4.toggleMain === 'function') vcbs4.toggleMain();
                    });
                    // ② 箭头指向 2#变低压负荷开关 aq2【主触头】→ 合闸
                    await compArrowThen(this, 'aq2', 'main', 'left', 3000, 2000, () => {
                        const aq2 = sys.comps.aq2;
                        if (aq2 && typeof aq2.close === 'function') aq2.close();
                    });
                },
                check() {
                    const sys = this.sys;
                    const vcbs4 = sys.comps.vcbs4;
                    const aq2 = sys.comps.aq2;
                    return !!(vcbs4 && vcbs4.isClosed() && aq2 && aq2._state === 'on');
                },
            },
            // ── 步骤 4：测试题——日用变压器并联运行的条件 ──
            {
                msg: '第 4 步：测试题——日用变压器并联运行的条件',
                mode: 'quiz',
                quizConfig: {
                    question: '日用变压器并联运行必须满足哪些条件？',
                    options: [
                        '只要容量相同即可并联',
                        '变比相等、联结组别相同、短路阻抗（百分比）相等、相位一致',
                        '只要电压等级相同即可并联',
                        '只要在同一母线上就可以并联',
                    ],
                    answer: 1,
                    analysis: '日用变压器并联运行必须满足四个条件：①变比相等（空载电压相等，避免环流）；②联结组别相同（保证二次侧电压相位一致）；③短路阻抗百分比相等（使负载按容量比例分配）；④相位一致（并联瞬间无冲击电流）。实际操作中还需注意两台变压器容量比不宜超过 3:1，且并联前应确认二次侧电压幅值和相位基本一致。',
                },
            },
            // ── 步骤 5：断开 1# 变压器低压负荷开关、高压断路器，1# 变压器退出运行 ──
            {
                msg: '第 5 步：断开 1#变压器低压负荷开关 aq1→断开高压断路器 vcbs3，1#变压器退出运行',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    // ① 箭头指向 1#变低压负荷开关 aq1【主触头】→ 分闸
                    await compArrowThen(this, 'aq1', 'main', 'left', 3000, 2000, () => {
                        const aq1 = sys.comps.aq1;
                        if (aq1 && typeof aq1.open === 'function') aq1.open();
                    });
                    // ② 箭头指向 1#变高压断路器 vcbs3【主触头】→ 分闸
                    await compArrowThen(this, 'vcbs3', 'main', 'left', 3000, 2000, () => {
                        const vcbs3 = sys.comps.vcbs3;
                        if (vcbs3 && typeof vcbs3.toggleMain === 'function') vcbs3.toggleMain();
                    });
                },
                check() {
                    const sys = this.sys;
                    const aq1 = sys.comps.aq1;
                    const vcbs3 = sys.comps.vcbs3;
                    return !!(aq1 && aq1._state === 'off' && vcbs3 && !vcbs3.isClosed());
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════
    // 高压发电机绝缘电阻的测量（操作实际电路组件）
    // ══════════════════════════════════════════════════════════════
    'hv-insulation-test': {
        id: 'hv-insulation-test',
        name: '4.高压发电机绝缘电阻的测量',
        steps: [
            // ── 步骤 1：将主开关摇到试验位，解锁，顺时针摇5圈，合上接地开关 ──
            {
                msg: '第 1 步：将主开关摇到试验位→解锁电磁锁→插入摇柄→顺时针摇5圈→合上接地开关',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const qf1 = sys.comps.qf1;
                    if (!qf1) return;
                    // ① 箭头指向工作位圆盘→摇到试验位
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 1500, () => {
                        if (qf1._state === 'on') qf1.tryTrip();
                        qf1._workPos = 1; qf1._detent = 1;
                        qf1._dialAngle = 90; qf1._dialCur = 90;
                        qf1._syncMainCircuits();
                    });
                    // ② 箭头指向电磁锁→解锁
                    await compArrowThen(this, 'qf1', 'emlock', 'down', 3000, 1500, () => {
                        qf1._emLockUnlocked = true;
                    });
                    // ③ 箭头指向摇柄插入孔→插入摇柄
                    await compArrowThen(this, 'qf1', 'crank', 'down', 2500, 1000, () => {
                        qf1._crankInserted = true;
                    });
                    // ④ 箭头指向插入孔右侧→顺时针摇5圈
                    await compArrowThen(this, 'qf1', 'crankRight', 'down', 3000, 5000, () => {
                        for (let i = 0; i < 5; i++) {
                            qf1._crankTurnCount++;
                            qf1._crankRotation += 360;
                        }
                        qf1._updateGroundSwitchState();
                    });
                },
                check() {
                    const qf1 = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(qf1 && qf1.isGrounded());
                },
            },
            // ── 步骤 2：逆时针摇5圈，脱扣接地开关，断开接地电阻 ──
            {
                msg: '第 2 步：逆时针摇5圈→脱扣接地开关→断开接地电阻',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const qf1 = sys.comps.qf1;
                    // ① 箭头指向插入孔左侧→逆时针摇5圈
                    await compArrowThen(this, 'qf1', 'crankLeft', 'down', 3000, 5000, () => {
                        for (let i = 0; i < 5; i++) {
                            if (qf1._crankTurnCount > 0) qf1._crankTurnCount--;
                            qf1._crankRotation -= 360;
                        }
                        qf1._updateGroundSwitchState();
                    });
                },
                check() {
                    const qf1 = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(qf1 && !qf1.isGrounded() && qf1._crankTurnCount === 0);
                },
            },
            // ── 步骤 3：调出兆欧表，L接U端、E接地，摇动手柄，观察读数 ──
            {
                msg: '第 3 步：调出手摇兆欧表→L端接发电机U相→E端接地→摇动手柄→观察绝缘电阻读数',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const meg = sys.comps.megohm;
                    // ① 显示兆欧表
                    if (meg && meg.group) { meg.group.visible(true); sys.requestRedraw(); }
                    await _sleep(1000);
                    // ② 动画接线：L端 → 发电机U相
                    await sys.connMgr.addConnectionAnimated({
                        from: 'gen_hv_wire_u', to: 'megohm_wire_l', type: 'wire'
                    });
                    // ③ 动画接线：E端 → 接地
                    await sys.connMgr.addConnectionAnimated({
                        from: 'megohm_wire_e', to: 'gnd_coil2_wire_gnd', type: 'wire'
                    });
                    await _sleep(1000);
                    // ④ 箭头指向兆欧表手柄→开始摇动
                    await compArrowThen(this, 'megohm', 'crank', 'down', 3000, 5000, () => {
                        if (meg && typeof meg.setCranking === 'function') meg.setCranking(true);
                    });
                    // ⑤ 停止摇动
                    if (meg && typeof meg.setCranking === 'function') meg.setCranking(false);
                    await _sleep(1000);
                },
                check() {
                    const sys = this.sys;
                    const meg = sys && sys.comps && sys.comps.megohm;
                    // 检测兆欧表可见
                    const visible = !!(meg && meg.group && meg.group.visible());
                    // 检测连线：L端接U相 + E端接地
                    const conns = sys.conns || [];
                    const hasLWire = conns.some(c =>
                        (c.from === 'gen_hv_wire_u' && c.to === 'megohm_wire_l') ||
                        (c.from === 'megohm_wire_l' && c.to === 'gen_hv_wire_u')
                    );
                    const hasEGround = conns.some(c =>
                        (c.from === 'megohm_wire_e' && c.to === 'gnd_coil2_wire_gnd') ||
                        (c.from === 'gnd_coil2_wire_gnd' && c.to === 'megohm_wire_e')
                    );
                    return visible && hasLWire && hasEGround;
                },
            },
            // ── 步骤 4：测试题──高压发电机测量绝缘的完整流程 ──
            {
                msg: '第 4 步：测试题——高压发电机测量绝缘的完整流程',
                mode: 'quiz',
                quizConfig: {
                    question: '高压发电机测量绝缘电阻的完整操作流程是什么？',
                    options: [
                        '直接摇表测量即可',
                        '断电→验电→摇到试验位→合接地开关→断开接地→接线→摇表测量→记录→恢复',
                        '只需断开断路器即可测量',
                        '合上接地开关后直接测量',
                    ],
                    answer: 1,
                    analysis: '正确流程：①断开断路器（停电）→②验电器验电确认无电→③放电棒放电→④主开关摇到试验位→⑤解锁电磁锁→⑥合上接地开关（确保安全）→⑦逆时针摇5圈脱扣接地→⑧兆欧表L接发电机出线、E接地→⑨摇动手柄读取绝缘电阻→⑩记录数据→⑪恢复接地开关→⑫摇回连接位→⑬恢复送电。',
                },
            },
            // ── 步骤 5：测试题──高压接地监视仪的作用 ──
            {
                msg: '第 5 步：测试题——高压接地监视仪的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '高压接地监视仪（绝缘监视仪）的主要作用是什么？',
                    options: [
                        '测量发电机输出电流',
                        '实时监测高压电网对地绝缘电阻，当绝缘下降到报警阈值时发出声光报警',
                        '控制断路器合闸/分闸',
                        '测量高压母线电压',
                    ],
                    answer: 1,
                    analysis: '高压接地监视仪实时监测三相电网对地的绝缘电阻。当任一相的绝缘电阻低于设定的报警阈值时，监视仪会发出声光报警，提醒值班人员及时排查接地故障，防止发展为金属性单相接地短路。',
                },
            },
            // ── 步骤 6：测试题──高压绝缘棒的用途 ──
            {
                msg: '第 6 步：测试题——高压绝缘棒的用途',
                mode: 'quiz',
                quizConfig: {
                    question: '高压绝缘棒（绝缘操作杆）的主要用途是什么？',
                    options: [
                        '测量高压设备的绝缘电阻',
                        '用于操作高压隔离开关、接地开关等设备，使操作人员与高压设备保持安全距离',
                        '用于给高压设备充电',
                        '用于连接高压电缆',
                    ],
                    answer: 1,
                    analysis: '高压绝缘棒主要用于：①操作高压隔离开关；②操作接地开关；③挂拆接地线；④安装或拆除熔断器。使用时操作人员与高压设备保持安全距离，绝缘棒应定期进行耐压试验。',
                },
            },
            // ── 步骤 7：测试题──高压验电器的作用 ──
            {
                msg: '第 7 步：测试题——高压验电器的作用',
                mode: 'quiz',
                quizConfig: {
                    question: '高压验电器的主要作用是什么？',
                    options: [
                        '测量高压设备的接地电阻',
                        '检验高压设备或线路是否带电，是停电操作前确认无电的安全操作步骤',
                        '用于给高压设备放电',
                        '用于测量高压母线电流',
                    ],
                    answer: 1,
                    analysis: '高压验电器用于检验高压电气设备或线路是否带电。停电操作前必须先验电确认设备无电，验电时先在有电设备上验证验电器正常，再逐相验电。验电器是高压操作"五防"中的重要环节。',
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
    { Class: HvTester, id: 'hv_tester', x: 2000, y: 820, label: '高压验电器', visible: true },
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
        start:  { x: 98,  y: 90 },   // 起停自复位开关
        close:  { x: 154, y: 90 },   // 合分闸自复位开关
        mode:   { x: 42,  y: 90 },   // 手动/自动转换开关
        sync:   { x: 98,  y: 170 },  // 同步表开关
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
    },
    // 真空断路器 qf1（带接地开关栏）
    qf1: {
        dial:      { x: 75,  y: 198 },  // 工作位圆盘
        emlock:    { x: 75,  y: 310 },  // 电磁锁
        crank:     { x: 75,  y: 330 },  // 摇柄插入孔
        crankRight:{ x: 95,  y: 330 },  // 插入孔右侧（顺时针）
        crankLeft: { x: 50,  y: 330 },  // 插入孔左侧（逆时针）
        close:     { x: 40,  y: 83 },   // 合闸按钮
        trip:      { x: 110, y: 83 },   // 分闸按钮
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
