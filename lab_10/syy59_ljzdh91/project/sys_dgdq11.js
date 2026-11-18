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
import { DiagramStartButton } from '../components/DiagramStartButton.js';

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
    // 1. 高压电的检测与操作规程
    //    ① 勾选单线图熟悉高压电力系统结构 → ② 单线图模拟送电操作
    //    ③ 切到高压配电柜熟悉结构 → ④ 配电柜遥控操作（1#供电→母联→2#手动准同步并车→解列1#并接地）
    // ══════════════════════════════════════════════════════════════
    'hv-detect-operate': {
        id: 'hv-detect-operate',
        name: '1.高压电的检测与操作规程',
        steps: [
            // ── 步骤 1：勾选单线图，熟悉高压电力系统结构 ──
            {
                msg: '第 1 步：勾选工具栏"单线图"复选框，显示并熟悉高压电力系统结构（DG1~DG4 主发电机、HBBA/HBBB 高压母线、母联、日用变压器 TR1/TR2、低压母线等）',
                mode: 'check',
                async act() {
                    await domBtnHighlight('btnOneLine', 3000);
                    const cb = document.getElementById('btnOneLine');
                    if (cb && !cb.checked) cb.click();
                    await _sleep(2000);
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.group && ol.group.visible());
                },
            },
            // ── 步骤 2：单线图上开启 1# 发电机 DG1 ──
            {
                msg: '第 2 步：在单线图上开启 1#发电机 DG1——点击发电机圆圈起动，运行时圆圈变绿',
                mode: 'check',
                async act() {
                    const ol = this.sys.comps['one_line'];
                    await arrowThen(this, 'DG1', 'down', 3000, 1800, () => {
                        if (ol && !ol.getGenState('DG1')) ol.toggleGen('DG1');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getGenState('DG1'));
                },
            },
            // ── 步骤 3：合隔离开关 01 + 真空断路器 HACB1 ──
            {
                msg: '第 3 步：合上隔离开关 01，再合上真空断路器 HACB1，使 DG1 向高压母线 HBBA 供电（母线/导线变红）',
                mode: 'check',
                async act() {
                    const ol = this.sys.comps['one_line'];
                    await arrowThen(this, '01', 'left', 3000, 1200, () => {
                        if (ol && !ol.getSwitchState('01')) ol.toggleSwitch('01');
                    });
                    await arrowThen(this, 'HACB1', 'left', 3000, 1800, () => {
                        if (ol && !ol.getSwitchState('HACB1')) ol.toggleSwitch('HACB1');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getSwitchState('01') && ol.getSwitchState('HACB1'));
                },
            },
            // ── 步骤 4：合母联两侧隔离开关 07/08 + 母联断路器 HBUSTIE ──
            {
                msg: '第 4 步：合上母联两侧隔离开关 07、08，再合上高压母线断路器 HBUSTIE，使 HBBA 与 HBBB 并联运行',
                mode: 'check',
                async act() {
                    const ol = this.sys.comps['one_line'];
                    await arrowThen(this, '07', 'up', 3000, 1200, () => {
                        if (ol && !ol.getSwitchState('07')) ol.toggleSwitch('07');
                    });
                    await arrowThen(this, '08', 'up', 3000, 1200, () => {
                        if (ol && !ol.getSwitchState('08')) ol.toggleSwitch('08');
                    });
                    await arrowThen(this, 'HBUSTIE', 'up', 3000, 1800, () => {
                        if (ol && !ol.getSwitchState('HBUSTIE')) ol.toggleSwitch('HBUSTIE');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getSwitchState('07') && ol.getSwitchState('08') && ol.getSwitchState('HBUSTIE'));
                },
            },
            // ── 步骤 5：合日用变压器原边高压断路器 VCB_TR1 + 低压出口断路器 ACB_TR1 ──
            {
                msg: '第 5 步：合上日用变压器 TR1 原边高压断路器 VCB_TR1，再合上低压出口断路器 ACB_TR1，经 TR1 降压给低压母线供电',
                mode: 'check',
                async act() {
                    const ol = this.sys.comps['one_line'];
                    await arrowThen(this, 'TR1', 'right', 3000, 1000, () => {});
                    await arrowThen(this, 'VCB_TR1', 'left', 3000, 1200, () => {
                        if (ol && !ol.getSwitchState('VCB_TR1')) ol.toggleSwitch('VCB_TR1');
                    });
                    await arrowThen(this, 'ACB_TR1', 'left', 3000, 1800, () => {
                        if (ol && !ol.getSwitchState('ACB_TR1')) ol.toggleSwitch('ACB_TR1');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getSwitchState('VCB_TR1') && ol.getSwitchState('ACB_TR1'));
                },
            },
            // ── 步骤 6：合低压母线母联断路器 MBUSTIE ──
            {
                msg: '第 6 步：合上低压母线母联断路器 MBUSTIE，使低压母线 MBBA 与 MBBB 并联供电',
                mode: 'check',
                async act() {
                    const ol = this.sys.comps['one_line'];
                    await arrowThen(this, 'MBUSTIE', 'down', 3000, 1800, () => {
                        if (ol && !ol.getSwitchState('MBUSTIE')) ol.toggleSwitch('MBUSTIE');
                    });
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    return !!(ol && ol.getSwitchState('MBUSTIE'));
                },
            },
            // ── 步骤 7：取消单线图，勾选高压配电柜，熟悉高压配电板结构 ──
            {
                msg: '第 7 步：取消勾选"单线图"隐藏单线图，再勾选"高压配电柜"显示高压主配电板，熟悉其结构（母线接地柜、变压器馈电柜、推进馈电柜、1#/2#发电机控制柜、并车柜、母联开关柜…）',
                mode: 'check',
                async act() {
                    await domBtnHighlight('btnOneLine', 2500);
                    const cbOl = document.getElementById('btnOneLine');
                    if (cbOl && cbOl.checked) cbOl.click();
                    await _sleep(1000);
                    await domBtnHighlight('btnSwitchPanel', 2500);
                    const cbSp = document.getElementById('btnSwitchPanel');
                    if (cbSp && !cbSp.checked) cbSp.click();
                    await _sleep(2000);
                },
                check() {
                    const ol = this.sys && this.sys.comps && this.sys.comps['one_line'];
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp.group && sp.group.visible() && ol && ol.group && !ol.group.visible());
                },
            },
            // ── 步骤 8：确认并车柜电站模式开关处于"手动" ──
            {
                msg: '第 8 步：在并车柜确认电站"模式"选择开关处于"手动"档（非半自动/自动），以便手动准同步并车',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps['switch_panel'];
                    await panelArrowThen(this, 'sync_mode', 'down', 3000, 1500, () => {
                        _setSyncKnob(sp, 'mode', 0);   // 0° = 手动
                        if (sp.sys) sp.sys.requestRedraw();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._syncMode && sp._syncMode() === 'manual');
                },
            },
            // ── 步骤 9：1# 发电机控制柜遥控起动 1# 机组并合闸供电 ──
            {
                msg: '第 9 步：在 1#发电机控制柜先按"起动"遥控起动 1#发电机组（运行灯亮），再按"合闸"合上其真空断路器，向电网供电',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps['switch_panel'];
                    await panelArrowThen(this, 'gen1_start', 'down', 3000, 1500, () => {
                        sp._cbRun.gen1 = true; sp._refreshTie();
                    });
                    await panelArrowThen(this, 'gen1_close', 'down', 3000, 1800, () => {
                        sp._cbState.gen1 = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbRun.gen1 && sp._cbState.gen1);
                },
            },
            // ── 步骤 10：母联开关柜按下合闸按钮，接通母联 ──
            {
                msg: '第 10 步：在母联开关柜按下"合闸"按钮，接通母联开关，使左、右母线并联供电',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps['switch_panel'];
                    await panelArrowThen(this, 'tie_close', 'down', 3000, 1800, () => {
                        sp._tieClosed = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._tieClosed);
                },
            },
            // ── 步骤 11：手动起动 2# 发电机组 ──
            {
                msg: '第 11 步：在 2#发电机控制柜按"起动"手动起动 2#发电机组（此时 2# 尚未合闸，等待准同步）',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps['switch_panel'];
                    await panelArrowThen(this, 'gen2_start', 'down', 3000, 1500, () => {
                        sp._cbRun.gen2 = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbRun.gen2 && !sp._cbState.gen2);
                },
            },
            // ── 步骤 12：同步表打 2#，待指针转到 11 点将 2# 机合闸 ──
            {
                msg: '第 12 步：将并车柜"同步表"选择开关打到 2#，观察同步表指针旋转，待指针转到 11 点（接近同相位）时按下 2#"合闸"按钮，将 2# 机并入电网',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps['switch_panel'];
                    // ① 同步表选择开关打到 2#（0° = 2#），指针开始旋转
                    await panelArrowThen(this, 'sync_sel', 'up', 2600, 800, () => {
                        _setSyncKnob(sp, 'sync', 0);
                        if (sp.sys) sp.sys.requestRedraw();
                    });
                    // ② 等待指针转到接近 11 点（约 180°~240°，再闪烁 1.5s 后正好落到 11 点附近）
                    await new Promise(resolve => {
                        const t0 = Date.now();
                        const timer = setInterval(() => {
                            const ang = sp._syncAngle || 0;
                            if (ang >= 170 && ang <= 240) { clearInterval(timer); resolve(); }
                            else if (Date.now() - t0 > 9000) { clearInterval(timer); resolve(); }
                        }, 30);
                    });
                    // ③ 指向 2# 合闸按钮并在指针到达 11 点附近时合闸
                    await panelArrowThen(this, 'gen2_close', 'down', 1500, 1800, () => {
                        const a = sp._syncAngle || 0;
                        if (!(a >= 270 || a === 0)) {          // 兜底：确保落在 9~12 点合闸窗口内
                            sp._syncAngle = 330;
                            if (sp._synNeedle) sp._synNeedle.rotation(330);
                        }
                        if (typeof sp._closeGenCB === 'function') sp._closeGenCB('gen2');
                        else { sp._cbState.gen2 = true; sp._refreshTie(); }
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && sp._cbRun.gen2 && sp._cbState.gen2);
                },
            },
            // ── 步骤 13：解列 1# 机组，并将 1# 发电机接地 ──
            {
                msg: '第 13 步：按下 1#发电机控制柜"分闸"按钮解列 1#机组，再合上 1#发电机柜的接地开关，将 1#发电机接地',
                mode: 'check',
                async act() {
                    const sp = this.sys.comps['switch_panel'];
                    await panelArrowThen(this, 'gen1_open', 'down', 3000, 1500, () => {
                        sp._cbState.gen1 = false; sp._refreshTie();
                    });
                    await panelArrowThen(this, 'gen1_ground', 'up', 3000, 1800, () => {
                        sp._cabGround.gen1 = true; sp._refreshTie();
                    });
                },
                check() {
                    const sp = this.sys && this.sys.comps && this.sys.comps['switch_panel'];
                    return !!(sp && !sp._cbState.gen1 && sp._cabGround.gen1);
                },
            },
            // ══════════════════════════════════════════════════════════
            // 以下在实物电路组件上操作：自动接线 → 起动系统（2#投入）→ 合母联/变压器/低压母联
            // → 遥控起动 1# 并准同步合闸 → 解列停机 → 真空断路器摇试验位并接地
            // ══════════════════════════════════════════════════════════
            // ── 步骤 14：取消配电柜 → 自动接线 → 起动系统（2#发电机投入电网）──
            {
                msg: '第 14 步：取消勾选"高压配电柜"隐藏配电板，点击工具栏"自动接线"完成实物接线，再点击"起动系统"（2#发电机 gen_s 自动投入电网运行）',
                mode: 'check',
                async act() {
                    // ① 取消勾选高压配电柜
                    await domBtnHighlight('btnSwitchPanel', 2000);
                    const cbSp = document.getElementById('btnSwitchPanel');
                    if (cbSp && cbSp.checked) cbSp.click();
                    await _sleep(1000);
                    // ② 自动接线
                    await domBtnHighlight('btnAutoWire', 2500);
                    const btnAW = document.getElementById('btnAutoWire');
                    if (btnAW) btnAW.click();
                    await _sleep(2200);
                    // ③ 起动系统（2#发电机投入电网）
                    await domBtnHighlight('btnStartSys', 2500);
                    const btnSS = document.getElementById('btnStartSys');
                    if (btnSS) btnSS.click();
                    await _sleep(3000);
                },
                check() {
                    const sys = this.sys;
                    const gen = sys && sys.comps && sys.comps.gen_s;
                    return !!(gen && gen.isOn && sys.conns && sys.conns.length > 40);
                },
            },
            // ── 步骤 15：合上母联断路器 vcbs2 ──
            {
                msg: '第 15 步：在实物上合上母联断路器 vcbs2（旋转 90°），使汇流排1（左）与汇流排2（右）并联运行',
                mode: 'check',
                async act() {
                    await compArrowThen(this, 'vcbs2', 'main', 'down', 3000, 1800, () => {
                        const v = this.sys.comps.vcbs2;
                        if (v && typeof v.tryClose === 'function') v.tryClose();
                        else if (v && typeof v.toggleMain === 'function' && !v.isClosed()) v.toggleMain();
                    });
                },
                check() {
                    const v = this.sys && this.sys.comps && this.sys.comps.vcbs2;
                    return !!(v && typeof v.isClosed === 'function' && v.isClosed());
                },
            },
            // ── 步骤 16：合 2#变压器高压断路器 vcbs4 → 低压负荷开关 aq2 → 低压母联 aq3 ──
            {
                msg: '第 16 步：合上 2#变压器高压真空断路器 vcbs4 → 合上 2#变压器低压负荷开关 aq2 → 合上低压母联断路器 aq3，恢复低压母线供电',
                mode: 'check',
                async act() {
                    await compArrowThen(this, 'vcbs4', 'main', 'left', 3000, 1500, () => {
                        const v = this.sys.comps.vcbs4;
                        if (v && typeof v.tryClose === 'function') v.tryClose();
                    });
                    await compArrowThen(this, 'aq2', 'main', 'left', 3000, 1500, () => {
                        const a = this.sys.comps.aq2;
                        if (a && typeof a.close === 'function') a.close();
                    });
                    await compArrowThen(this, 'aq3', 'main', 'up', 3000, 1800, () => {
                        const a = this.sys.comps.aq3;
                        if (a && typeof a.close === 'function') a.close();
                    });
                },
                check() {
                    const sys = this.sys;
                    const v4 = sys.comps.vcbs4, a2 = sys.comps.aq2, a3 = sys.comps.aq3;
                    return !!(v4 && v4.isClosed() && a2 && a2._state === 'on' && a3 && a3._state === 'on');
                },
            },
            // ── 步骤 17：遥控起动 1# 高压发电机组 ──
            {
                msg: '第 17 步：在高压发电机遥控面板上按【起·停】开关左半侧，遥控起动 1#高压发电机组 gen_hv',
                mode: 'check',
                async act() {
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 1500, () => {
                        const hp = this.sys.comps.hvgp;
                        if (hp) { hp._startCmd = true; setTimeout(() => { hp._startCmd = false; }, 600); }
                    });
                    await _sleep(3500);   // 等待发电机建立电压
                },
                check() {
                    const g = this.sys && this.sys.comps && this.sys.comps.gen_hv;
                    return !!(g && g.isOn);
                },
            },
            // ── 步骤 18：打开同步表 → 指针转到 11 点遥控合闸 → 关闭同步表 ──
            {
                msg: '第 18 步：打开遥控面板"同步表"开关 ON，观察同步表指针旋转，待指针转到 11 点（接近同相位）时按【合·分】开关左半侧遥控合闸，将 1#机并入电网，随后关闭同步表',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const hp = sys.comps.hvgp;
                    if (!hp) return;
                    // ① 打开同步表开关 ON
                    await compArrowThen(this, 'hvgp', 'sync', 'down', 3000, 800, () => { hp._syncOn = true; });
                    // ② 同步表指针由 12 点旋转到 11 点（330°），演示准同步过程
                    await new Promise(resolve => {
                        const target = 330;
                        const t0 = Date.now();
                        const timer = setInterval(() => {
                            let deg = ((hp._synPhase * 180 / Math.PI) % 360 + 360) % 360;
                            if (deg >= target - 1) { clearInterval(timer); resolve(); return; }
                            if (Date.now() - t0 > 6000) { hp._synPhase = target * Math.PI / 180; clearInterval(timer); resolve(); return; }
                            hp._synPhase += (2 * Math.PI / 360) * 6;   // 每 50ms 前进 6°（约 3s 一圈）
                        }, 50);
                    });
                    if (hp._synPtr) hp._synPtr.rotation(330);
                    if (sys.requestRedraw) sys.requestRedraw();
                    await _sleep(600);
                    // ③ 遥控合闸（指针在 11 点安全窗口内）
                    await compArrowThen(this, 'hvgp', 'close', 'down', 2500, 1500, () => {
                        hp._closeCmd = true; setTimeout(() => { hp._closeCmd = false; }, 900);
                    });
                    // ④ 关闭同步表
                    await compArrowThen(this, 'hvgp', 'sync', 'up', 2000, 1500, () => { hp._syncOn = false; });
                },
                check() {
                    const sys = this.sys;
                    const hp = sys && sys.comps && sys.comps.hvgp;
                    const qf = sys && sys.comps && sys.comps.qf1;
                    return !!(qf && qf.getState() === 'on' && hp && hp._syncOn === false);
                },
            },
            // ── 步骤 19：解列 1# 机组，并停机 ──
            {
                msg: '第 19 步：按遥控面板【合·分】开关右半侧分断 1#真空断路器，将 1#机组解列；再按【起·停】开关右半侧停机 1#发电机组',
                mode: 'check',
                async act() {
                    const hp = this.sys.comps.hvgp;
                    if (!hp) return;
                    // ① 分闸解列
                    await compArrowThen(this, 'hvgp', 'close', 'down', 3000, 1500, () => {
                        hp._openCmd = true; setTimeout(() => { hp._openCmd = false; }, 900);
                    });
                    // ② 停机
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 1800, () => {
                        hp._stopCmd = true; setTimeout(() => { hp._stopCmd = false; }, 900);
                    });
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const qf = sys && sys.comps && sys.comps.qf1;
                    const gen = sys && sys.comps && sys.comps.gen_hv;
                    return !!(qf && qf.getState() === 'off' && gen && !gen.isOn);
                },
            },
            // ── 步骤 20：1#真空断路器摇到试验位 → 解锁电磁锁 → 合上接地开关 ──
            {
                msg: '第 20 步：将 1#真空断路器 qf1 摇到试验位（断开一次隔离），解锁接地开关电磁锁，插入手柄顺时针摇 5 圈合上接地开关，使 1#发电机出线可靠接地',
                mode: 'check',
                async act() {
                    const qf1 = this.sys.comps.qf1;
                    if (!qf1) return;
                    // ① 摇到试验位（断开一次隔离）
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 1500, () => {
                        if (qf1._state === 'on') qf1.tryTrip();
                        qf1._workPos = 1; qf1._detent = 1;
                        qf1._dialAngle = 90; qf1._dialCur = 90;
                        qf1._syncMainCircuits();
                    });
                    // ② 解锁接地开关电磁锁
                    await compArrowThen(this, 'qf1', 'emlock', 'right', 3000, 1200, () => { qf1._emLockUnlocked = true; });
                    // ③ 插入手柄
                    await compArrowThen(this, 'qf1', 'crank', 'right', 2000, 800, () => { qf1._crankInserted = true; });
                    // ④ 顺时针摇 5 圈，合上接地开关
                    await compArrowThen(this, 'qf1', 'crankRight', 'up', 3000, 2000, () => {
                        for (let i = 0; i < 5; i++) { qf1._crankTurnCount++; qf1._crankRotation += 360; }
                        qf1._updateGroundSwitchState();
                    });
                },
                check() {
                    const q = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q._workPos === 1 && q.isGrounded());
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════
    // 2. 高压操作的五防措施
    //    通过 1#发电机遥控面板与真空断路器 qf1 的实际操作，逐条对应高压"五防"：
    //    ①防误分误合断路器 ②防带负荷拉合隔离开关 ③防带电挂（合）接地开关
    //    ④防带接地线（接地开关）合断路器 ⑤防误入带电间隔
    // ══════════════════════════════════════════════════════════════
    'hv-five-prevention': {
        id: 'hv-five-prevention',
        name: '2.高压操作的五防措施',
        steps: [
            // ── 步骤 1：自动接线，确认 1#发电机就绪、接地开关断开 ──
            {
                msg: '第 1 步：点击工具栏"自动接线"完成高压系统接线；在 1#发电机遥控面板上确认发电机"就绪"（READY 灯亮）、接地开关处于断开状态（接地开红灯亮）',
                mode: 'check',
                async act() {
                    await domBtnHighlight('btnAutoWire', 2500);
                    const btn = document.getElementById('btnAutoWire');
                    if (btn) btn.click();
                    await _sleep(2200);
                    await compArrowThen(this, 'hvgp', 'readyled', 'down', 2800, 1200, null);
                    await compArrowThen(this, 'hvgp', 'groundopen', 'down', 2800, 1800, null);
                },
                check() {
                    const sys = this.sys;
                    const hp = sys.comps.hvgp, gen = sys.comps.gen_hv, qf = sys.comps.qf1;
                    return !!(sys.conns && sys.conns.length > 40
                        && hp && hp.isPowered()
                        && gen && gen.mode === 'remote' && !gen.isOn
                        && qf && !qf.isGrounded());
                },
            },
            // ── 步骤 2：遥控起动 1# 机组并合闸供电 ──
            {
                msg: '第 2 步：在遥控面板按【起·停】左半侧遥控起动 1#发电机组，再按【合·分】左半侧合闸，向电网供电，确认发电机建压正常',
                mode: 'check',
                async act() {
                    const hp = this.sys.comps.hvgp;
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 1500, () => {
                        if (hp) { hp._startCmd = true; setTimeout(() => { hp._startCmd = false; }, 600); }
                    });
                    await _sleep(3500);   // 等待建压 / 储能
                    await compArrowThen(this, 'hvgp', 'close', 'down', 3000, 1800, () => {
                        if (hp) { hp._closeCmd = true; setTimeout(() => { hp._closeCmd = false; }, 900); }
                    });
                },
                check() {
                    const sys = this.sys;
                    const gen = sys.comps.gen_hv, qf = sys.comps.qf1;
                    return !!(gen && gen.isOn && qf && qf.getState() === 'on');
                },
            },
            // ── 步骤 3：测试题——合闸供电时断路器无法切换到试验位 ──
            {
                msg: '第 3 步：测试题——1#发电机合闸供电时，真空断路器无法切换到试验位，这属于"高压五防"中的哪一项？',
                mode: 'quiz',
                quizConfig: {
                    question: '1#发电机合闸供电时，真空断路器手车无法由工作位切换到试验位，这属于"高压五防"中的哪一项？',
                    options: [
                        '防止误分、误合断路器',
                        '防止带负荷拉、合隔离开关',
                        '防止带电挂（合）接地线（接地开关）',
                        '防止带接地线（接地开关）合断路器',
                      ],
                    answer: 1,
                    analysis: '断路器处于合闸（带负荷）状态时，手车被联锁，禁止由工作位摇到试验位，' +
                        '防止带负荷拉、合隔离开关（一次隔离触头），对应"五防"第②项。',
                },
            },
            // ── 步骤 4：遥控分断主开关并停机 ──
            {
                msg: '第 4 步：按遥控面板【合·分】右半侧分断 1#发电机主开关，再按【起·停】右半侧停止发电机组',
                mode: 'check',
                async act() {
                    const hp = this.sys.comps.hvgp;
                    await compArrowThen(this, 'hvgp', 'close', 'down', 3000, 1500, () => {
                        if (hp) { hp._openCmd = true; setTimeout(() => { hp._openCmd = false; }, 900); }
                    });
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 1800, () => {
                        if (hp) { hp._stopCmd = true; setTimeout(() => { hp._stopCmd = false; }, 900); }
                    });
                    await _sleep(1500);
                },
                check() {
                    const sys = this.sys;
                    const qf = sys.comps.qf1, gen = sys.comps.gen_hv;
                    return !!(qf && qf.getState() === 'off' && gen && !gen.isOn);
                },
            },
            // ── 步骤 5：转到本地位，关闭励磁 ──
            {
                msg: '第 5 步：将 1#发电机控制方式开关转到"本地"，并将励磁开关转到 OFF（关闭励磁、灭磁）',
                mode: 'check',
                async act() {
                    const gen = this.sys.comps.gen_hv;
                    await compArrowThen(this, 'gen_hv', 'mode', 'right', 3000, 1200, () => {
                        if (gen) {
                            gen.mode = 'local'; gen.config.mode = 'local';
                            if (gen._switchKnob) gen._switchKnob.rotation(-45);
                        }
                    });
                    await compArrowThen(this, 'gen_hv', 'exc', 'right', 3000, 1800, () => {
                        if (gen) {
                            if (typeof gen.setFieldOn === 'function') gen.setFieldOn(false);
                            else gen._fieldOn = false;
                        }
                    });
                },
                check() {
                    const gen = this.sys && this.sys.comps && this.sys.comps.gen_hv;
                    return !!(gen && gen.mode === 'local' && gen._fieldOn === false);
                },
            },
            // ── 步骤 6：测试题——工作位时接地开关电磁锁闭锁 ──
            {
                msg: '第 6 步：测试题——真空断路器处于工作位、接地开关电磁锁闭锁，这属于"高压五防"中的哪一项？',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器处于工作位（一次触头接通、线路可能带电）时，接地开关电磁锁闭锁、无法合上接地开关，这属于"高压五防"中的哪一项？',
                    options: [
                        '防止误分、误合断路器',
                        '防止带负荷拉、合隔离开关',
                        '防止带电挂（合）接地线（接地开关）',
                        '防止带接地线（接地开关）合断路器',
                    ],
                    answer: 2,
                    analysis: '手车在工作位时线路可能带电，此时电磁锁闭锁、禁止合上接地开关，' +
                        '防止带电挂（合）接地线（接地开关），对应"五防"第③项。',
                },
            },
            // ── 步骤 7：将真空断路器摇到试验位 ──
            {
                msg: '第 7 步：将 1#真空断路器（手车）由工作位摇到试验位，使一次隔离触头断开',
                mode: 'check',
                async act() {
                    const q = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 1800, () => {
                        if (q) {
                            if (q._state === 'on') q.tryTrip();
                            q._workPos = 1; q._detent = 1;
                            q._dialAngle = 90; q._dialCur = 90;
                            q._syncMainCircuits();
                        }
                    });
                },
                check() {
                    const q = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q._workPos === 1);
                },
            },
            // ── 步骤 8：测试题——未接地时柜门无法打开 ──
            {
                msg: '第 8 步：测试题——真空断路器在试验位、尚未可靠接地时，高压开关柜柜门无法打开，这属于"高压五防"中的哪一项？',
                mode: 'quiz',
                quizConfig: {
                    question: '真空断路器处于试验位、尚未可靠接地时，高压开关柜柜门被闭锁、无法打开，这属于"高压五防"中的哪一项？',
                    options: [
                        '防止带负荷拉、合隔离开关',
                        '防止带电挂（合）接地线（接地开关）',
                        '防止带接地线（接地开关）合断路器',
                        '防止误入带电间隔',
                    ],
                    answer: 3,
                    analysis: '接地开关未合上（未可靠接地）前，柜门闭锁，防止人员误入可能带电的间隔，' +
                        '对应"五防"第⑤项防止误入带电间隔。',
                },
            },
            // ── 步骤 9：解锁电磁锁，摇动手柄合上接地开关 ──
            {
                msg: '第 9 步：打开接地开关电磁锁，插入操作手柄，顺时针摇动 5 圈，将接地开关合上，使 1#发电机出线可靠接地',
                mode: 'check',
                async act() {
                    const q = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'emlock', 'right', 3000, 1200, () => {
                        if (q) q._emLockUnlocked = true;
                    });
                    await compArrowThen(this, 'qf1', 'crank', 'right', 2000, 800, () => {
                        if (q) q._crankInserted = true;
                    });
                    await compArrowThen(this, 'qf1', 'crankRight', 'up', 3000, 2000, () => {
                        if (q) {
                            for (let i = 0; i < 5; i++) { q._crankTurnCount++; q._crankRotation += 360; }
                            q._updateGroundSwitchState();
                        }
                    });
                },
                check() {
                    const q = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q.isGrounded());
                },
            },
            // ── 步骤 10：测试题——接地后断路器无法转回工作位 ──
            {
                msg: '第 10 步：测试题——接地开关合上后，真空断路器无法回转（摇）到工作位，这属于"高压五防"中的哪一项？',
                mode: 'quiz',
                quizConfig: {
                    question: '接地开关合上后，真空断路器手车无法由试验位回转（摇）到工作位，这属于"高压五防"中的哪一项？',
                    options: [
                        '防止误分、误合断路器',
                        '防止带负荷拉、合隔离开关',
                        '防止带电挂（合）接地线（接地开关）',
                        '防止带接地线（接地开关）合断路器',
                    ],
                    answer: 3,
                    analysis: '接地开关已合上（已挂接地线）时，联锁禁止手车摇到工作位，' +
                        '防止带接地线（接地开关）合断路器，对应"五防"第④项。',
                },
            },
            // ── 步骤 11：打开柜门进行维护 ──
            {
                msg: '第 11 步：接地开关合上（已可靠接地）后，打开高压开关柜柜门，进行维护',
                mode: 'check',
                async act() {
                    const q = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'door', 'down', 3000, 1800, () => {
                        if (q) q.toggleDoor();
                    });
                },
                check() {
                    const q = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q.isDoorOpen());
                },
            },
        ],
    },

    // ══════════════════════════════════════════════════════════════
    // 3. 高压配电装置的操作及管理
    //    自动接线→起动供电→试灯→接地测试（报警→确认→复位）→停机灭磁
    //    →摇试验位并接地→开柜门→摇脱开位
    // ══════════════════════════════════════════════════════════════
    'hv-switchgear-manage': {
        id: 'hv-switchgear-manage',
        name: '3.高压配电装置的操作及管理',
        steps: [
            // ── 步骤 1：自动接线，遥控起动 1# 并合闸供电 ──
            {
                msg: '第 1 步：点击工具栏"自动接线"完成系统接线，然后在遥控面板遥控起动 1#发电机组并合闸，向电网供电',
                mode: 'check',
                async act() {
                    await domBtnHighlight('btnAutoWire', 2500);
                    const btn = document.getElementById('btnAutoWire');
                    if (btn) btn.click();
                    await _sleep(2200);
                    const hp = this.sys.comps.hvgp;
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 1500, () => {
                        if (hp) { hp._startCmd = true; setTimeout(() => { hp._startCmd = false; }, 600); }
                    });
                    await _sleep(3500);
                    await compArrowThen(this, 'hvgp', 'close', 'down', 3000, 1800, () => {
                        if (hp) { hp._closeCmd = true; setTimeout(() => { hp._closeCmd = false; }, 900); }
                    });
                },
                check() {
                    const sys = this.sys;
                    const gen = sys.comps.gen_hv, qf = sys.comps.qf1;
                    return !!(sys.conns && sys.conns.length > 40 && gen && gen.isOn && qf && qf.getState() === 'on');
                },
            },
            // ── 步骤 2：按住试灯按钮，确认所有指示灯正常 ──
            {
                msg: '第 2 步：按住遥控面板带电显示器右侧的"试灯"按钮，确认面板所有指示灯（电源/自动/就绪/运行/接地合/接地开/故障）均正常点亮，松手熄灭',
                mode: 'check',
                async act() {
                    const hp = this.sys.comps.hvgp;
                    const node = hp && hp.getClickablePartNode ? hp.getClickablePartNode('lamptest') : null;
                    await compArrowThen(this, 'hvgp', 'lamptest', 'down', 3000, 600, () => {
                        if (node) node.fire('mousedown'); else if (hp) { hp._lampTestOn = true; hp._everLampTest = true; }
                    });
                    await _sleep(2600);   // 保持按住 → 全灯点亮
                    if (node) node.fire('mouseup'); else if (hp) hp._lampTestOn = false;
                    await _sleep(1000);
                },
                check() {
                    const hp = this.sys && this.sys.comps && this.sys.comps.hvgp;
                    return !!(hp && hp._everLampTest);
                },
            },
            // ── 步骤 3：接地测试 → 报警 → 确认 → 复位 ──
            {
                msg: '第 3 步：按下 10MΩ 绝缘电阻旁的"接地测试"按钮，确认接地监视仪正常声光报警；按"确认"消音消闪，松开按钮后按"复位"清除报警',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const btn = sys.comps.gndtest, mon = sys.comps.hv_ground_monitor;
                    // ① 按下接地测试按钮（常开闭合 → 模拟单相接地）
                    await compArrowThen(this, 'gndtest', 'btn', 'down', 3000, 800, () => {
                        if (btn && typeof btn.setManualOverride === 'function') btn.setManualOverride(true);
                    });
                    // ② 观察接地监视仪报警（报警灯闪 / 蜂鸣 / 显示低绝缘）
                    await compArrowThen(this, 'hv_ground_monitor', 'lcd', 'up', 3000, 1500, null);
                    await _sleep(1500);
                    // ③ 按"确认"消音消闪
                    await compArrowThen(this, 'hv_ground_monitor', 'ack', 'up', 2500, 1000, () => {
                        const n = mon && mon.getClickablePartNode ? mon.getClickablePartNode('ack') : null;
                        if (n) n.fire('click');
                    });
                    // ④ 松开测试按钮；等待接地电流衰减、报警故障消失（约需 4~5s）
                    if (btn && typeof btn.setManualOverride === 'function') btn.setManualOverride(false);
                    await new Promise(resolve => {
                        const t0 = Date.now();
                        const timer = setInterval(() => {
                            if (!mon._fault || Date.now() - t0 > 9000) { clearInterval(timer); resolve(); }
                        }, 200);
                    });
                    await _sleep(500);
                    // ⑤ 按"复位"清除报警
                    await compArrowThen(this, 'hv_ground_monitor', 'reset', 'up', 2500, 1500, () => {
                        const n = mon && mon.getClickablePartNode ? mon.getClickablePartNode('reset') : null;
                        if (n) n.fire('click');
                    });
                },
                check() {
                    const mon = this.sys && this.sys.comps && this.sys.comps.hv_ground_monitor;
                    return !!(mon && mon._everAlarmed && mon._everAcked && mon._everReset && !mon._latched);
                },
            },
            // ── 步骤 4：遥控分闸、停机，确认带电显示灯熄灭 ──
            {
                msg: '第 4 步：按遥控面板【合·分】右半侧分断 1#发电机主开关，再按【起·停】右半侧停止发电机组，确认带电显示灯熄灭',
                mode: 'check',
                async act() {
                    const hp = this.sys.comps.hvgp;
                    await compArrowThen(this, 'hvgp', 'close', 'down', 3000, 1500, () => {
                        if (hp) { hp._openCmd = true; setTimeout(() => { hp._openCmd = false; }, 900); }
                    });
                    await compArrowThen(this, 'hvgp', 'start', 'down', 3000, 1200, () => {
                        if (hp) { hp._stopCmd = true; setTimeout(() => { hp._stopCmd = false; }, 900); }
                    });
                    await compArrowThen(this, 'hvgp', 'live', 'up', 2800, 1800, null);
                },
                check() {
                    const sys = this.sys;
                    const qf = sys.comps.qf1, gen = sys.comps.gen_hv;
                    return !!(qf && qf.getState() === 'off' && gen && !gen.isOn);
                },
            },
            // ── 步骤 5：转本地位、关闭励磁 ──
            {
                msg: '第 5 步：将 1#发电机控制方式开关转到"本地"，并将励磁开关转到 OFF、灭磁',
                mode: 'check',
                async act() {
                    const gen = this.sys.comps.gen_hv;
                    await compArrowThen(this, 'gen_hv', 'mode', 'right', 3000, 1200, () => {
                        if (gen) {
                            gen.mode = 'local'; gen.config.mode = 'local';
                            if (gen._switchKnob) gen._switchKnob.rotation(-45);
                        }
                    });
                    await compArrowThen(this, 'gen_hv', 'exc', 'right', 3000, 1800, () => {
                        if (gen) {
                            if (typeof gen.setFieldOn === 'function') gen.setFieldOn(false);
                            else gen._fieldOn = false;
                        }
                    });
                },
                check() {
                    const gen = this.sys && this.sys.comps && this.sys.comps.gen_hv;
                    return !!(gen && gen.mode === 'local' && gen._fieldOn === false);
                },
            },
            // ── 步骤 6：摇到试验位，合上接地开关 ──
            {
                msg: '第 6 步：将真空断路器 qf1 摇到试验位，解锁接地开关电磁锁，插入手柄顺时针摇 5 圈合上接地开关',
                mode: 'check',
                async act() {
                    const q = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 1500, () => {
                        if (q) {
                            if (q._state === 'on') q.tryTrip();
                            q._workPos = 1; q._detent = 1;
                            q._dialAngle = 90; q._dialCur = 90;
                            q._syncMainCircuits();
                        }
                    });
                    await compArrowThen(this, 'qf1', 'emlock', 'right', 3000, 1200, () => { if (q) q._emLockUnlocked = true; });
                    await compArrowThen(this, 'qf1', 'crank', 'right', 2000, 800, () => { if (q) q._crankInserted = true; });
                    await compArrowThen(this, 'qf1', 'crankRight', 'up', 3000, 2000, () => {
                        if (q) {
                            for (let i = 0; i < 5; i++) { q._crankTurnCount++; q._crankRotation += 360; }
                            q._updateGroundSwitchState();
                        }
                    });
                },
                check() {
                    const q = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q._workPos === 1 && q.isGrounded());
                },
            },
            // ── 步骤 7：打开柜门（拔二次插头为说明）──
            {
                msg: '第 7 步：打开高压开关柜柜门（接地开关合上后方可开门）；检修前应拔掉真空断路器二次插头（航空插头），切断控制/信号回路',
                mode: 'check',
                async act() {
                    const q = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'door', 'down', 3000, 1800, () => { if (q) q.toggleDoor(); });
                    this._tipWorkflow('注意：拔掉真空断路器二次插头（航空插头）可切断控制/信号回路，避免检修时误动作', 5000);
                    await _sleep(3500);
                },
                check() {
                    const q = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q.isDoorOpen());
                },
            },
            // ── 步骤 8：摇到脱开位（拉出小车为说明）──
            {
                msg: '第 8 步：将真空断路器手车摇到"脱开位"（检修位），使一次、二次插头全部断开；随后可将断路器小车拉出检修',
                mode: 'check',
                async act() {
                    const q = this.sys.comps.qf1;
                    await compArrowThen(this, 'qf1', 'dial', 'down', 3000, 1500, () => {
                        if (q) {
                            q._workPos = 2; q._detent = 2;
                            q._dialAngle = 180; q._dialCur = 180;
                            q._syncMainCircuits();
                        }
                    });
                    this._tipWorkflow('手车已到"脱开位（检修位）"：一次、二次插头全部断开，可拉出断路器小车进行检修', 5000);
                    await _sleep(3500);
                },
                check() {
                    const q = this.sys && this.sys.comps && this.sys.comps.qf1;
                    return !!(q && q._workPos === 2);
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
    // ── 接地测试按钮：与 10MΩ 绝缘电阻并联的常开按钮（按下 → 模拟单相接地 → 接地监视仪报警）──
    { Class: DiagramStartButton, id: 'gndtest', x: 830, y: 170, width: 80, height: 80, color: '#c0392b', label: '接地测试', rotation: 90, visible: true },
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
    // 本地坐标 → 画布绝对坐标（计入组件旋转/缩放）
    const _p = ol.group.getAbsoluteTransform().point({ x: pos.x, y: pos.y });
    const absX = _p.x;
    const absY = _p.y;
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
    sync_sel:     { x: 5 * CAB_W + 138,    y: 140 },   // 同步表选择开关（OFF/1#/2#/3#/4#）
    // 发电机柜引线接地开关（各柜独立）
    gen1_ground:  { x: 3 * CAB_W + CAB_W / 2 + 25, y: UPPER_H + MID_H + 126 },
    gen2_ground:  { x: 4 * CAB_W + CAB_W / 2 + 25, y: UPPER_H + MID_H + 126 },
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
    // 本地坐标 → 画布绝对坐标（计入组件旋转/缩放）
    const _p = sp.group.getAbsoluteTransform().point({ x: def.x, y: def.y });
    const absX = _p.x;
    const absY = _p.y;
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
        sync:     { x: 266, y: 93 },   // 同步表开关（_row2.swSync）
        live:     { x: 126, y: 162 },  // 高压带电显示器（黄/绿/红三灯）
        selftest: { x: 228, y: 160 },  // 带电显示器自检按钮
        groundled:{ x: 294, y: 22 },   // 接地合(绿) / 接地开(红) 指示灯（两灯中间，兼容）
        groundclose:{ x: 266, y: 22 },  // 接地合（绿）指示灯
        groundopen:{ x: 322, y: 22 },   // 接地开（红）指示灯
        runled:   { x: 210, y: 22 },   // 运行指示灯
        autoled:  { x: 98,  y: 22 },   // 自动模式指示灯
        readyled: { x: 154, y: 22 },   // READY FOR START 就绪指示灯
        lamptest: { x: 283, y: 160 },  // 试灯按钮（带电显示器右侧）
    },
    // 微机综合保护装置：液晶显示屏
    prot1: {
        lcd: { x: 180, y: 120 },
    },
    // 高压接地监视仪：三相绝缘电阻显示屏 + 确认/复位按钮
    hv_ground_monitor: {
        lcd:   { x: 65,  y: 75 },
        ack:   { x: 77,  y: 135 },   // 确认按钮中心
        reset: { x: 109, y: 135 },   // 复位按钮中心
    },
    // 接地测试按钮（DiagramStartButton：按钮帽中心）
    gndtest: {
        btn: { x: 40, y: 60 },
    },
    // vcbs2: rotation=90°（组件整体旋转）→ 坐标表统一存【本地坐标】，由绝对变换计入旋转
    vcbs2: {
        main:   { x: 50,  y: 89 },   // 主触头（本地）
        top:    { x: 50,  y: 40 },   // 上隔离（本地）
        bot:    { x: 50,  y: 138 },  // 下隔离（本地）
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
    // aq3: rotation=90°（组件整体旋转）→ 坐标表存【本地坐标】，由绝对变换计入旋转
    aq3: {
        main:   { x: 75,  y: 55 },   // 断路器中心（本地）
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
    // 部件坐标以组件【本地坐标系】给出；用绝对变换换算到画布绝对坐标，
    // 自动计入组件的位移、旋转与缩放（旋转过的组件必须这样算，否则箭头指偏）。
    const _p = comp.group.getAbsoluteTransform().point({ x: part.x, y: part.y });
    const absX = _p.x;
    const absY = _p.y;
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
        // ── 接地测试按钮：与 10MΩ 绝缘电阻并联（常开）──
        { from: 'gndtest_wire_no1', to: 'r_insul_wire_l', type: 'wire' },
        { from: 'gndtest_wire_no2', to: 'r_insul_wire_r', type: 'wire' },
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

}

export function fiveStep() {
}
