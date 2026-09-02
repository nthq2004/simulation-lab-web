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
import { ControlTransformer } from '../device/ControlTransformer.js';
import { MainContact } from '../device/MainContact.js';
import { ContactorCoil } from '../device/ContactorCoil.js';
import { AuxNOContact } from '../device/AuxNOContact.js';
import { AuxNCContact } from '../device/AuxNCContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';

export const FAULT_CONFIGS = {
    km1coil_a1_poor: {
        id: 'km1coil_a1_poor',
        name: '接触器线圈 A1 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('km1-coil_wire_a1'); },
    },
    km1no1_com_poor: {
        id: 'km1no1_com_poor',
        name: '辅助常开 COM 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km1-no1_wire_com'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km1-no1_wire_com'); },
        repair() { window.sys._poorContactPorts?.delete('km1-no1_wire_com'); },
    },
};

/**
 * 清除组件的整体位图缓存，确保动态部件（按钮刀闸/开关触头）的
 * 外观能实时反映内部状态变化。若组件被 highlight(false) 等路径缓存了
 * 整个 group，旋转/位移刀闸会只改节点属性、渲染仍是旧位图。
 */
function _clearGroupCache(comp) {
    if (comp && comp.group && typeof comp.group.isCached === 'function' && comp.group.isCached()) {
        try { comp.group.clearCache(); } catch (e) { /* ignore */ }
    }
}

// 状态复位后的强制外观同步（清缓存 + 触发重绘）
function _flushAppearance(comp, sys) {
    if (!comp) return;
    if (comp.markDirty) comp.markDirty();
    if (comp._refreshIfDirty) comp._refreshIfDirty();
    if (sys && typeof sys.requestRedraw === 'function') sys.requestRedraw();
}

export const PROJECT_WORKFLOWS = {
    'forward-reverse-analysis': {
        id: 'forward-reverse-analysis', name: '1. 反接制动控制电路实验',
        steps: [
            {
                msg: '第 1 步：点击自动接线（主电路反转的六根线不接，控制线路接好）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await new Promise(r => setTimeout(r, 300));

                    // 闪烁箭头指向"自动接线"工具栏按钮：
                    // 工具栏位于画布上方，因此把指示动画画在画布顶部内侧，箭头朝上指向按钮
                    const btnEl = document.getElementById('btnAutoWire');
                    if (btnEl) {
                        const rect = btnEl.getBoundingClientRect();
                        const stageRect = sys.stage.container().getBoundingClientRect();
                        // 按钮中心在画布坐标系下的 x（按钮位于画布上方，故 y 为负/越界）
                        const bx = rect.left - stageRect.left + rect.width / 2;
                        const topSafe = 30; // 画布顶部安全距离
                        const cy = topSafe;

                        // 从画布内侧向上指向按钮的箭头
                        const arrow = new Konva.Arrow({
                            points: [bx, topSafe + 40, bx, topSafe + 4],
                            pointerLength: 12, pointerWidth: 10,
                            fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 3,
                            opacity: 1, listening: false
                        });
                        // 圆圈标记（位于画布顶部，紧贴按钮下方）
                        const circle = new Konva.Circle({
                            x: bx, y: topSafe + 20, radius: 18,
                            stroke: '#e74c3c', strokeWidth: 2.5, dash: [6, 3],
                            opacity: 1, listening: false
                        });
                        sys.layer.add(arrow);
                        sys.layer.add(circle);

                        // 闪烁3次
                        for (let i = 0; i < 3; i++) {
                            arrow.opacity(1); circle.opacity(1);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                            arrow.opacity(0.15); circle.opacity(0.15);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                        }
                        // 停留1秒
                        arrow.opacity(1); circle.opacity(1);
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                        await new Promise(r => setTimeout(r, 1000));

                        // 清理箭头和圆圈
                        arrow.destroy(); circle.destroy();
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();

                        // 模拟点击自动接线按钮
                        btnEl.click();
                    } else {
                        // 降级：直接调用
                        _autoWire(sys);
                    }
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const forwardPath = c('ac_wire_u', 'acb_wire_l1')
                        && c('acb_wire_t1', 'km1-mc_wire_l1')
                        && c('km1-mc_wire_t1', 'fr_wire_l1')
                        && c('fr_wire_t1', 'im01_wire_u1');
                    const km2NotWired = !c('acb_wire_t1', 'km2-mc_wire_l1');
                    return forwardPath && km2NotWired;
                },
            },
            {
                msg: '第 2 步：手动接反转接触器主触头 KM2 的六根线（交换 U/W 两相）',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await new Promise(r => setTimeout(r, 300));

                    // KM2 的六根线，逐根动画连接
                    const km2Wires = [
                        { from: 'acb_wire_t1', to: 'km2-mc_wire_l1', type: 'wire' },
                        { from: 'acb_wire_t2', to: 'km2-mc_wire_l2', type: 'wire' },
                        { from: 'acb_wire_t3', to: 'km2-mc_wire_l3', type: 'wire' },
                        { from: 'km2-mc_wire_t1', to: 'fr_wire_l3', type: 'wire' },
                        { from: 'km2-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
                        { from: 'km2-mc_wire_t3', to: 'fr_wire_l1', type: 'wire' },
                    ];
                    const wireLabels = [
                        'L1 → KM2-L1', 'L2 → KM2-L2', 'L3 → KM2-L3',
                        'KM2-T1 → FR-L3（换相）', 'KM2-T2 → FR-L2', 'KM2-T3 → FR-L1（换相）'
                    ];

                    for (let i = 0; i < km2Wires.length; i++) {
                        // 显示当前正在接的线的提示
                        sys.showFloatingTip(`🔌 正在接线：${wireLabels[i]}（第 ${i + 1}/6 根）`, 2500);

                        // 闪烁箭头指示起始端口
                        const fromComp = km2Wires[i].from.split('_wire_')[0];
                        if (sys.comps[fromComp]) {
                            _clearGroupCache(sys.comps[fromComp]);
                        }

                        // 使用动画接线（3秒完成一根线）
                        await sys.connMgr.addConnectionAnimated(km2Wires[i]);

                        // 每根线之间停顿500ms
                        await new Promise(r => setTimeout(r, 500));
                    }

                    sys.showFloatingTip('✅ KM2 六根线全部接好', 1500);
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('acb_wire_t1', 'km2-mc_wire_l1')
                        && c('acb_wire_t2', 'km2-mc_wire_l2')
                        && c('acb_wire_t3', 'km2-mc_wire_l3')
                        && c('km2-mc_wire_t1', 'fr_wire_l3')
                        && c('km2-mc_wire_t2', 'fr_wire_l2')
                        && c('km2-mc_wire_t3', 'fr_wire_l1');
                },
            },
            {
                msg: '第 3 步：合上电源开关，按下正转起动按钮 SB2，直到接触器得电松开，电机开始起动',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await new Promise(r => setTimeout(r, 300));

                    // ── 闪烁箭头+圆圈指向电源开关（空气断路器 ACB），然后合上 ──
                    const acb = sys.comps['acb'];
                    if (acb && acb.group) {
                        const box = acb.group.getClientRect({ relativeTo: sys.stage });
                        const cx = box.x + box.width / 2;
                        const cy = box.y + box.height / 2;

                        const arrow = new Konva.Arrow({
                            points: [cx, cy - 60, cx, cy - 12],
                            pointerLength: 14, pointerWidth: 12,
                            fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 3,
                            opacity: 1, listening: false
                        });
                        const circle = new Konva.Circle({
                            x: cx, y: cy, radius: Math.max(box.width, box.height) / 2 + 10,
                            stroke: '#e74c3c', strokeWidth: 2.5, dash: [8, 4],
                            opacity: 1, listening: false
                        });
                        sys.layer.add(arrow);
                        sys.layer.add(circle);
                        _clearGroupCache(acb);

                        // 闪烁3次
                        for (let i = 0; i < 3; i++) {
                            arrow.opacity(1); circle.opacity(1);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                            arrow.opacity(0.15); circle.opacity(0.15);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                        }
                        arrow.opacity(1); circle.opacity(1);
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                        await new Promise(r => setTimeout(r, 600));

                        sys.showFloatingTip('⬆ 合上电源开关 QF', 1200);

                        // 启动合闸动画（刀闸外观由 tick 动画机制驱动）
                        _clearGroupCache(acb);
                        acb.close();
                        // 清理指示效果
                        arrow.destroy(); circle.destroy();
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();

                        // 等待合闸动画真实完成（外观刀闸转到闭合位置）
                        const acbClosed = await (() => {
                            return new Promise(resolve => {
                                let tries = 0;
                                const iv = setInterval(() => {
                                    tries++;
                                    if (!acb._animating && acb._state === 'on') {
                                        clearInterval(iv);
                                        resolve(true);
                                    } else if (tries > 30) { // 最多3秒
                                        clearInterval(iv);
                                        resolve(false);
                                    }
                                }, 100);
                            });
                        })();
                        await new Promise(r => setTimeout(r, 500));
                    }

                    // ── 闪烁箭头+圆圈指向正转起动按钮 SB2 ──
                    const sb2 = sys.comps['ss'];
                    if (sb2 && sb2.group) {
                        const box = sb2.group.getClientRect({ relativeTo: sys.stage });
                        const cx = box.x + box.width / 2;
                        const cy = box.y + box.height / 2;

                        const arrow = new Konva.Arrow({
                            points: [cx + 60, cy, cx + 10, cy],
                            pointerLength: 14, pointerWidth: 12,
                            fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 3,
                            opacity: 1, listening: false
                        });
                        const circle = new Konva.Circle({
                            x: cx, y: cy, radius: Math.max(box.width, box.height) / 2 + 8,
                            stroke: '#e74c3c', strokeWidth: 2.5, dash: [8, 4],
                            opacity: 1, listening: false
                        });
                        sys.layer.add(arrow);
                        sys.layer.add(circle);
                        _clearGroupCache(sb2);

                        // 闪烁3次
                        for (let i = 0; i < 3; i++) {
                            arrow.opacity(1); circle.opacity(1);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                            arrow.opacity(0.15); circle.opacity(0.15);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                        }
                        arrow.opacity(1); circle.opacity(1);
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                        await new Promise(r => setTimeout(r, 800));

                        // 清理指示效果
                        arrow.destroy(); circle.destroy();
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                    }

                    // 按下 SB2（保持3秒）
                    sys.showFloatingTip('▶ 按下正转起动按钮 SB2（保持3秒）', 3000);
                    if (sb2) {
                        _clearGroupCache(sb2);
                        sb2._isPressed = true;
                        sb2._curBladeAng = -5;
                        if (sb2._bladeGroup) sb2._bladeGroup.rotation(-5);
                        if (sb2._updatePlunger) sb2._updatePlunger();
                    }
                    await new Promise(r => setTimeout(r, 3000));

                    // 松开 SB2（自锁保持）
                    sys.showFloatingTip('松开 SB2（KM1 自锁保持）', 1200);
                    if (sb2) {
                        sb2._isPressed = false;
                        sb2._curBladeAng = -22.5;
                        if (sb2._bladeGroup) sb2._bladeGroup.rotation(-22.5);
                        if (sb2._updatePlunger) sb2._updatePlunger();
                        _flushAppearance(sb2, sys);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > 1000;
                },
            },
            {
                msg: '第 4 步：按下停止按钮 SB1，直到 KM1 失电，等待电机减速到小于 300',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await new Promise(r => setTimeout(r, 300));

                    // 闪烁箭头指向 SB1
                    const sb1 = sys.comps['sb'];
                    if (sb1 && sb1.group) {
                        const box = sb1.group.getClientRect({ relativeTo: sys.stage });
                        const cx = box.x + box.width / 2;
                        const cy = box.y + box.height / 2;

                        const arrow = new Konva.Arrow({
                            points: [cx + 60, cy, cx + 10, cy],
                            pointerLength: 14, pointerWidth: 12,
                            fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 3,
                            opacity: 1, listening: false
                        });
                        const circle = new Konva.Circle({
                            x: cx, y: cy, radius: Math.max(box.width, box.height) / 2 + 8,
                            stroke: '#e74c3c', strokeWidth: 2.5, dash: [8, 4],
                            opacity: 1, listening: false
                        });
                        sys.layer.add(arrow);
                        sys.layer.add(circle);
                        _clearGroupCache(sb1);

                        for (let i = 0; i < 3; i++) {
                            arrow.opacity(1); circle.opacity(1);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                            arrow.opacity(0.15); circle.opacity(0.15);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                        }
                        arrow.opacity(1); circle.opacity(1);
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                        await new Promise(r => setTimeout(r, 800));

                        arrow.destroy(); circle.destroy();
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                    }

                    // 按下 SB1 停止（保持3秒）
                    sys.showFloatingTip('⏹ 按下停止按钮 SB1（保持3秒）', 3000);
                    if (sb1) {
                        _clearGroupCache(sb1);
                        sb1._isPressed = true;
                        sb1._curBladeAng = 22.5;
                        if (sb1._bladeGroup) sb1._bladeGroup.rotation(22.5);
                        if (sb1._updatePlunger) sb1._updatePlunger();
                    }
                    await new Promise(r => setTimeout(r, 3000));

                    // 松开 SB1（复位为常闭闭合状态）
                    sys.showFloatingTip('松开 SB1（KM1 已失电）', 1200);
                    if (sb1) {
                        sb1._isPressed = false;
                        sb1._curBladeAng = 5;
                        if (sb1._bladeGroup) sb1._bladeGroup.rotation(5);
                        if (sb1._updatePlunger) sb1._updatePlunger();
                        _flushAppearance(sb1, sys);
                    }

                    // 等待电机减速到接近停止
                    sys.showFloatingTip('⏳ 等待电机减速…', 1200);
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm > -300 && motor.rpm < 300;
                },
            },
            {
                msg: '第 5 步：按下反转起动按钮 SB3，直到反转接触器 KM2 线圈得电，观察反接制动现象和反向起动',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await new Promise(r => setTimeout(r, 300));

                    // 闪烁箭头指向 SB3
                    const sb3 = sys.comps['sb3'];
                    if (sb3 && sb3.group) {
                        const box = sb3.group.getClientRect({ relativeTo: sys.stage });
                        const cx = box.x + box.width / 2;
                        const cy = box.y + box.height / 2;

                        const arrow = new Konva.Arrow({
                            points: [cx + 60, cy, cx + 10, cy],
                            pointerLength: 14, pointerWidth: 12,
                            fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 3,
                            opacity: 1, listening: false
                        });
                        const circle = new Konva.Circle({
                            x: cx, y: cy, radius: Math.max(box.width, box.height) / 2 + 8,
                            stroke: '#e74c3c', strokeWidth: 2.5, dash: [8, 4],
                            opacity: 1, listening: false
                        });
                        sys.layer.add(arrow);
                        sys.layer.add(circle);
                        _clearGroupCache(sb3);

                        for (let i = 0; i < 3; i++) {
                            arrow.opacity(1); circle.opacity(1);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                            arrow.opacity(0.15); circle.opacity(0.15);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                        }
                        arrow.opacity(1); circle.opacity(1);
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                        await new Promise(r => setTimeout(r, 800));

                        arrow.destroy(); circle.destroy();
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                    }

                    // 按下 SB3 反转起动（保持3秒）
                    sys.showFloatingTip('🔄 按下反转起动按钮 SB3（保持3秒）', 3000);
                    if (sb3) {
                        _clearGroupCache(sb3);
                        sb3._isPressed = true;
                        sb3._curBladeAng = -5;
                        if (sb3._bladeGroup) sb3._bladeGroup.rotation(-5);
                        if (sb3._updatePlunger) sb3._updatePlunger();
                    }
                    await new Promise(r => setTimeout(r, 3000));

                    // 松开 SB3（自锁保持）
                    sys.showFloatingTip('松开 SB3（KM2 自锁保持）', 1000);
                    if (sb3) {
                        sb3._isPressed = false;
                        sb3._curBladeAng = -22.5;
                        if (sb3._bladeGroup) sb3._bladeGroup.rotation(-22.5);
                        if (sb3._updatePlunger) sb3._updatePlunger();
                        _flushAppearance(sb3, sys);
                    }

                    sys.showFloatingTip('⚡ 观察反接制动和反向起动过程…', 2000);
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    return motor && motor.rpm < -1000;
                },
            },
            {
                msg: '第 6 步：互锁验证——在反转过程中，按下正转起动按钮 SB2 并保持 5s，观察现象',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    await new Promise(r => setTimeout(r, 300));

                    // 闪烁箭头指向 SB2（在反转运行时尝试正转）
                    const sb2 = sys.comps['ss'];
                    if (sb2 && sb2.group) {
                        const box = sb2.group.getClientRect({ relativeTo: sys.stage });
                        const cx = box.x + box.width / 2;
                        const cy = box.y + box.height / 2;

                        const arrow = new Konva.Arrow({
                            points: [cx + 60, cy, cx + 10, cy],
                            pointerLength: 14, pointerWidth: 12,
                            fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 3,
                            opacity: 1, listening: false
                        });
                        const circle = new Konva.Circle({
                            x: cx, y: cy, radius: Math.max(box.width, box.height) / 2 + 8,
                            stroke: '#e74c3c', strokeWidth: 2.5, dash: [8, 4],
                            opacity: 1, listening: false
                        });
                        sys.layer.add(arrow);
                        sys.layer.add(circle);
                        _clearGroupCache(sb2);

                        for (let i = 0; i < 3; i++) {
                            arrow.opacity(1); circle.opacity(1);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                            arrow.opacity(0.15); circle.opacity(0.15);
                            if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                            await new Promise(r => setTimeout(r, 500));
                        }
                        arrow.opacity(1); circle.opacity(1);
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                        await new Promise(r => setTimeout(r, 800));

                        arrow.destroy(); circle.destroy();
                        if (sys.requestRedraw) sys.requestRedraw(); else sys.layer.draw();
                    }

                    // 按下 SB2 并保持5秒（观察互锁是否阻止 KM1 吸合）
                    sys.showFloatingTip('🔒 按住 SB2 并保持5秒，观察互锁效果', 1000);
                    if (sb2) {
                        _clearGroupCache(sb2);
                        sb2._isPressed = true;
                        sb2._curBladeAng = -5;
                        if (sb2._bladeGroup) sb2._bladeGroup.rotation(-5);
                        if (sb2._updatePlunger) sb2._updatePlunger();
                    }

                    // 每秒显示倒计时
                    for (let t = 5; t >= 1; t--) {
                        sys.showFloatingTip(`🔒 按住 SB2 中… ${t}s（互锁使 KM1 无法吸合）`, 1000);
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    // 松开 SB2
                    if (sb2) {
                        sb2._isPressed = false;
                        sb2._curBladeAng = -22.5;
                        if (sb2._bladeGroup) sb2._bladeGroup.rotation(-22.5);
                        if (sb2._updatePlunger) sb2._updatePlunger();
                        _flushAppearance(sb2, sys);
                    }

                    sys.showFloatingTip('✅ 互锁验证完成：KM1 未吸合，电机继续反转', 1500);
                    await new Promise(r => setTimeout(r, 500));
                },
                check() {
                    const motor = this.sys.comps['im01'];
                    const sb2 = this.sys.comps['ss'];
                    return motor && motor.rpm < -1000 && sb2 && sb2._isPressed;
                },
            },
            {
                msg: '第 7 步：测试题——互锁的作用',
                mode: 'quiz',
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
};

export const componentConfigs = [
    { Class: DiagramACPower3P, id: 'ac', x: 280, y: 30, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 280, y: 140, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 10, visible: true },
    // 主回路：KM2（反转）主触头在左，KM1（正转）主触头在右
    { Class: MainContact, id: 'km2-mc', x: 10, y: 350, height: 105, deviceid: 'KM2', visible: true },
    { Class: MainContact, id: 'km1-mc', x: 270, y: 350, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 270, y: 540, height: 100, deviceid: 'FR1', ratedCurrent: 100, tripClass: 20, visible: true },
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
        // 主回路：电源 → 断路器 → KM1 正转主触头 → 热继电器 → 电动机
        { from: 'ac_wire_u', to: 'acb_wire_l1', type: 'wire' },
        { from: 'ac_wire_v', to: 'acb_wire_l2', type: 'wire' },
        { from: 'ac_wire_w', to: 'acb_wire_l3', type: 'wire' },
        { from: 'acb_wire_t1', to: 'km1-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km1-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km1-mc_wire_l3', type: 'wire' },
        // KM1 正转：正常相序 U-V-W
        { from: 'km1-mc_wire_t1', to: 'fr_wire_l1', type: 'wire' },
        { from: 'km1-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km1-mc_wire_t3', to: 'fr_wire_l3', type: 'wire' },
        // KM2 反转的六根线不接（由第2步手动接线）
        // FR → 电动机
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

/** 手动接 KM2 反转主触头的六根线（交换 U/W 两相） */
function _wireKM2(sys) {
    const km2Wires = [
        // KM2 输入：ACB → KM2 L1/L2/L3
        { from: 'acb_wire_t1', to: 'km2-mc_wire_l1', type: 'wire' },
        { from: 'acb_wire_t2', to: 'km2-mc_wire_l2', type: 'wire' },
        { from: 'acb_wire_t3', to: 'km2-mc_wire_l3', type: 'wire' },
        // KM2 输出：交换 U/W 两相 → FR
        { from: 'km2-mc_wire_t1', to: 'fr_wire_l3', type: 'wire' },
        { from: 'km2-mc_wire_t2', to: 'fr_wire_l2', type: 'wire' },
        { from: 'km2-mc_wire_t3', to: 'fr_wire_l1', type: 'wire' },
    ];
    km2Wires.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
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
