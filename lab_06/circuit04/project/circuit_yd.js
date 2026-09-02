// 三相异步电动机星三角（Y-Δ）降压起动控制仿真工程（渐进式改装版）
//
// 教学流程：先搭建基础星形起动电路并观察起动过程，随后逐步改进电路：
//   ① 基础电路：主回路（电源→QF→KM1→FR→电机首端 U1/V1/W1）+ 星形短接（KM3），
//                控制回路（含 Δ 控制支路，KT1 延时到后 KM2 闭合），但未接入三角形主触头。
//   ② 改进 1：在 KT1 线圈前串联 KM2 常闭辅助触点（km2-nc2），KM2 吸合后切断 KT1 电源。
//   ③ 改进 2：在 KT1 常开延时触头两端并联 KM2 常开辅助触点（km2-no1），实现自锁，
//              保证 KT1 失电后 KM2 仍保持吸合。
//   最终完整电路实现"星形降压起动 → 延时切换 → 三角形全压运行 → 停止"。
//
// 主回路：AC(380V) → QF → KM1 主接触器 → FR 热继电器发热元件 → 电机 U1/V1/W1
//        电机尾端 U2/V2/W2 由 KM3（星形）短接或 KM2（三角形）换接：
//        星形：U2/V2/W2 短接，绕组承受 220V（相电压）
//        三角形：U2↔V1、V2↔W1、W2↔U1 换接，绕组承受 380V（线电压）
//
// 控制回路：TC 副边 220V → SB1（停止） → 起动节点
//        ├─ 主线圈支路：SB2 ∥ KM1-NO 自锁 → KM1 线圈
//        ├─ 星形支路：  KM2-NC 互锁 → KT1-NC 延时断开 → KM3 线圈
//        ├─ 三角形支路：KT1-NO 延时闭合 → KM3-NC 互锁 → KM2 线圈
//        ├─ KT1 线圈支路：由起动节点供电（改进后经 KM2-NC 串联）
//        └─ 四线圈返回 → FR-NC → FU5 → TC 副边上端
//
// 时间继电器 KT1（通电延时型，JSZ3）：
//   idle →(线圈电压>160V)→ timing →(计时≥delayTime)→ output →(电压<40V)→ idle
//   output 后 KT1-NC 立即断开（KM3 释放），KT1-NO 延时 closeGap 后再闭合（KM2 吸合）。

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
import { AuxNCContact } from '../device/AuxNCContact.js';
import { ThermalHeatElement } from '../device/ThermalHeatElement.js';
import { ThermalNCContact } from '../device/ThermalNCContact.js';
import { TimeRelayCoil } from '../device/TimeRelayCoil.js';
import { TimeDelayNOContact } from '../device/TimeDelayNOContact.js';
import { TimeDelayNCContact } from '../device/TimeDelayNCContact.js';

export const FAULT_CONFIGS = {
    tkt_coil_a1_poor: {
        id: 'tkt_coil_a1_poor',
        name: '时间继电器 KT 线圈 A1 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('tkt-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('tkt-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('tkt-coil_wire_a1'); },
    },
    km3_coil_a1_poor: {
        id: 'km3_coil_a1_poor',
        name: '星形接触器 KM3 线圈 A1 端子接触不良',
        system: '控制回路',
        check()  { return window.sys?._poorContactPorts?.has('km3-coil_wire_a1'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km3-coil_wire_a1'); },
        repair() { window.sys._poorContactPorts?.delete('km3-coil_wire_a1'); },
    },
    km2_nc2_open: {
        id: 'km2_nc2_open',
        name: 'KM2 常闭辅助触点（km2-nc2）开路',
        system: '控制回路',
        // 描述：改进电路上加装的 KM2 常闭触点（串联在 KT1 线圈前）触点开路，
        //      导致 KT1 线圈无法经此支路得电，三角形切换后 KT1 断电、KM2 无法按预期自锁启动。
        check()  { return window.sys?._poorContactPorts?.has('km2-nc2_wire_nc'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km2-nc2_wire_nc'); },
        repair() { window.sys._poorContactPorts?.delete('km2-nc2_wire_nc'); },
    },
    km2_no1_poor: {
        id: 'km2_no1_poor',
        name: 'KM2 常开辅助触点（km2-no1）接触不良',
        system: '控制回路',
        // 描述：改进电路上加装的 KM2 常开触点（并联在 KT1 常开延时触头两端，用于自锁）
        //      接触不良，KM2 吸合后无法保持自锁，KT1 失电时 KM2 也随之释放。
        check()  { return window.sys?._poorContactPorts?.has('km2-no1_wire_no'); },
        trigger() { (window.sys._poorContactPorts ??= new Set()).add('km2-no1_wire_no'); },
        repair() { window.sys._poorContactPorts?.delete('km2-no1_wire_no'); },
    },
};

// ─── 连线辅助（按阶段拆分） ───────────────────────────────

/** 基础电路接线：主回路星形 + 控制回路（不含三角形主触头、不含 KM2 辅助改进触点） */
const WIRES_BASE = [
    // 主回路：电源 → 断路器 → KM1 主触头 → 热继电器发热元件 → 电动机首端 U1/V1/W1
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
    // 星形接触器 KM3：U2/V2/W2 经出线侧短接成中性点
    { from: 'km3-mc_wire_l1', to: 'im01_wire_u2', type: 'wire' },
    { from: 'km3-mc_wire_l2', to: 'im01_wire_v2', type: 'wire' },
    { from: 'km3-mc_wire_l3', to: 'im01_wire_w2', type: 'wire' },
    { from: 'km3-mc_wire_t1', to: 'km3-mc_wire_t2', type: 'wire' },
    { from: 'km3-mc_wire_t2', to: 'km3-mc_wire_t3', type: 'wire' },
    // 控制回路电源：L3 → FU4 → 变压器一次侧 → L2
    { from: 'acb_wire_t3', to: 'fu4_wire_l', type: 'wire' },
    { from: 'fu4_wire_t', to: 'tc_wire_p1', type: 'wire' },
    { from: 'km1-mc_wire_l2', to: 'tc_wire_p2', type: 'wire' },
    // 变压器副边下端(s2) → 停止按钮 SB1 → 起动节点
    { from: 'tc_wire_s2', to: 'sb_wire_nc3', type: 'wire' },
    { from: 'sb_wire_nc4', to: 'ss_wire_no1', type: 'wire' },
    // 主线圈支路：SB2 ∥ KM1-NO 自锁 → KM1 线圈
    { from: 'ss_wire_no1', to: 'km1-no1_wire_com', type: 'wire' },
    { from: 'km1-no1_wire_no', to: 'ss_wire_no2', type: 'wire' },
    { from: 'ss_wire_no2', to: 'km1-coil_wire_a1', type: 'wire' },
    // 星形支路：KM2-NC 互锁 → KT1-NC 延时断开 → KM3 线圈
    { from: 'km1-no1_wire_no', to: 'tkt-nc_wire_com', type: 'wire' },
    { from: 'tkt-nc_wire_nc', to: 'km2-nc_wire_com', type: 'wire' },
    { from: 'km2-nc_wire_nc', to: 'km3-coil_wire_a1', type: 'wire' },
    // 三角形控制支路：KT1-NO 延时闭合 → KM3-NC 互锁 → KM2 线圈
    { from: 'tkt-nc_wire_com', to: 'tkt-no_wire_com', type: 'wire' },
    { from: 'tkt-no_wire_no', to: 'km3-nc_wire_com', type: 'wire' },
    { from: 'km3-nc_wire_nc', to: 'km2-coil_wire_a1', type: 'wire' },
    // KT1 线圈支路
    { from: 'km1-no1_wire_no', to: 'tkt-coil_wire_a1', type: 'wire' },
    // 四线圈汇合 → 热继电器常闭 → FU5 → 变压器副边上端(s1)
    { from: 'km1-coil_wire_a2', to: 'fr-nc_wire_nc', type: 'wire' },
    { from: 'km3-coil_wire_a2', to: 'tkt-coil_wire_a2', type: 'wire' },
    { from: 'km2-coil_wire_a2', to: 'km3-coil_wire_a2', type: 'wire' },
    { from: 'tkt-coil_wire_a2', to: 'km1-coil_wire_a2', type: 'wire' },
    { from: 'fr-nc_wire_com', to: 'fu5_wire_t', type: 'wire' },
    { from: 'fu5_wire_l', to: 'tc_wire_s1', type: 'wire' },
];

/** 三角形主触头接线（手动逐根接入）：KM2 换接 首端↔尾端（与第 4 步 check 顺序一致） */
const WIRES_DELTA = [
    { from: 'im01_wire_u2', to: 'km2-mc_wire_t1', type: 'wire' },
    { from: 'im01_wire_v2', to: 'km2-mc_wire_t2', type: 'wire' },
    { from: 'im01_wire_w2', to: 'km2-mc_wire_t3', type: 'wire' }, 
    { from: 'km2-mc_wire_l1', to: 'fr_wire_t2', type: 'wire' },
    { from: 'km2-mc_wire_l2', to: 'fr_wire_t3', type: 'wire' },
    { from: 'km2-mc_wire_l3', to: 'fr_wire_t1', type: 'wire' },       
];

function _addWires(sys, wires) {
    wires.forEach(c => sys.connMgr.addConn(c));
}

function _autoWire(sys, mode = 'base') {
    sys.conns.length = 0;
    _addWires(sys, WIRES_BASE);
    if (mode === 'full') {
        _addWires(sys, WIRES_DELTA);
        // 完整电路：集成为改进后（KM2-NC 串 KT1、KM2-NO 并 tkt-no）
        _addWires(sys, [
            { from: 'km1-no1_wire_no', to: 'km2-nc2_wire_com', type: 'wire' },
            { from: 'km2-nc2_wire_nc', to: 'tkt-coil_wire_a1', type: 'wire' },
            { from: 'tkt-no_wire_com', to: 'km2-no1_wire_com', type: 'wire' },
            { from: 'km2-no1_wire_no', to: 'tkt-no_wire_no', type: 'wire' },
        ]);
        // 移除被 KM2-NC 串联替代的直连线
        sys.connMgr.removeConn({ from: 'km1-no1_wire_no', to: 'tkt-coil_wire_a1', type: 'wire' });
    }
    sys.redrawAll();
    return sys.conns.length;
}

function _powerOn(sys) {
    const acb = sys.comps['acb'];
    if (acb) acb.close();
}

/** 模拟按下按钮：按下 duration ms 后松开（SB2 起动按钮闭合、SB1 停止按钮断开） */

/** 设置时间继电器的延时时间（同步 deviceRef） */
function _setDelay(sys, seconds) {
    const tkt = sys.comps['tkt-coil'];
    if (!tkt) return;
    tkt._delayTime = seconds;
    if (tkt.deviceRef) tkt.deviceRef.setDelayTime(seconds);
}

// ─── 自动演示辅助（闪烁箭头 / 参数设置浮层 / 动画断线） ────────

/** 让 HTML 按钮闪烁两次（演示"点击 xxx"），每次亮起约 600ms */
function _blinkDOMButton(btnId, tip) {
    const btn = document.getElementById(btnId);
    if (tip) window.sys.showFloatingTip(tip, 3200);
    return new Promise(async (resolve) => {
        if (!btn) return resolve();
        const origBg = btn.style.background || getComputedStyle(btn).background;
        const origBox = btn.style.boxShadow;
        const highlight = (on) => {
            if (on) {
                btn.style.background = '#e74c3c';
                btn.style.boxShadow = '0 0 0 3px #e74c3c66';
            } else {
                btn.style.background = origBg;
                btn.style.boxShadow = origBox;
            }
        };
        for (let i = 0; i < 2; i++) {
            highlight(true);
            await new Promise(r => setTimeout(r, 600));
            highlight(false);
            await new Promise(r => setTimeout(r, 400));
        }
        resolve();
    });
}

/** 大红箭头 + 虚线圆，提示目标组件，闪烁约 duration ms 后移除；附浮动文字提示 */
function _showClickArrow(sys, compId, direction = 'up', tip, duration = 3000) {
    if (tip) sys.showFloatingTip(tip, duration + 600);
    const comp = sys.comps[compId];
    const stage = sys.stage;
    return new Promise((resolve) => {
        if (!comp || !comp.group || !compositionOk()) { resolve(); return; }

        const group = new Konva.Group();
        const box = comp.group.getClientRect({ relativeTo: stage });
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const r = Math.max(box.width, box.height) / 2 + 20;

        // ① 虚线圆包裹操作对象中心
        group.add(new Konva.Circle({
            x: cx, y: cy, radius: r,
            stroke: '#e74c3c', strokeWidth: 2.5, dash: [7, 5],
            fill: 'rgba(231,76,60,0.06)', listening: false,
        }));

        // ② 大红箭头带尾部（外层半透明光晕 + 内层实心），从侧方指向中心
        const pad = r + 30;
        let p0, p1;
        if (direction === 'right')    { p0 = { x: cx + pad, y: cy }; p1 = { x: cx, y: cy }; }
        else if (direction === 'left') { p0 = { x: cx - pad, y: cy }; p1 = { x: cx, y: cy }; }
        else if (direction === 'down') { p0 = { x: cx, y: cy + pad }; p1 = { x: cx, y: cy }; }
        else                          { p0 = { x: cx, y: cy - pad }; p1 = { x: cx, y: cy }; }

        group.add(new Konva.Arrow({
            points: [p0.x, p0.y, p1.x, p1.y],
            pointerLength: 30, pointerWidth: 22,
            fill: 'rgba(231,76,60,0.35)', stroke: 'rgba(231,76,60,0.35)', strokeWidth: 14,
            lineCap: 'round', listening: false,
        }));
        group.add(new Konva.Arrow({
            points: [p0.x, p0.y, p1.x, p1.y],
            pointerLength: 26, pointerWidth: 18,
            fill: '#e74c3c', stroke: '#e74c3c', strokeWidth: 5,
            lineCap: 'round', listening: false,
        }));

        sys.layer.add(group);

        // ③ 闪烁：约 500ms 切换显隐
        let visible = true;
        const blink = setInterval(() => {
            visible = !visible;
            group.visible(visible);
            sys.requestRedraw ? sys.requestRedraw() : sys.layer.draw();
        }, 500);

        setTimeout(() => {
            clearInterval(blink);
            group.destroy();
            sys.requestRedraw ? sys.requestRedraw() : sys.layer.draw();
            resolve();
        }, duration);
    });

    function compositionOk() {
        return typeof Konva !== 'undefined' && Konva.Group && Konva.Circle && Konva.Arrow && stage && sys.layer;
    }
}

/** 高亮一根连线，持续 duration ms（演示用） */
function _highlightConn(sys, conn, duration = 2500, color = '#e74c3c') {
    sys.showComp.highlightLine(conn, { color, pulse: true, pulseWidth: 3 });
    return new Promise((resolve) => {
        setTimeout(() => {
            sys.showComp.unhighlightLine(conn);
            resolve();
        }, duration);
    });
}

/** 动画方式断开一根连线：逆动画收缩并淡出后移除 */
function _removeWireAnimated(sys, conn) {
    return new Promise((resolve) => {
        const getPos = (portId) => {
            const did = portId.split('_wire_')[0] || portId.split('_')[0];
            return sys.comps[did]?.getAbsPortPos ? sys.comps[did].getAbsPortPos(portId) : sys.comps[did]?.group.getPosition();
        };
        const fromPos = getPos(conn.from);
        const toPos = getPos(conn.to);
        if (!fromPos || !toPos) {
            sys.connMgr.removeConn(conn);
            return resolve();
        }

        const animLine = new Konva.Line({
            points: [fromPos.x, fromPos.y, toPos.x, toPos.y],
            stroke: '#e41c1c',
            strokeWidth: 6,
            lineCap: 'round',
            lineJoin: 'round',
            opacity: 1,
            listening: false,
        });
        sys.lineLayer.add(animLine);

        // 把真实的连线先隐藏（由动画线接管视觉）
        // 找到对应 wireNode 隐藏，动画结束再重绘显示余下接线
        const duration = 1200;
        const start = performance.now();
        const animate = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const easeIn = t * t;
            // 两端从外向内收缩到中点
            const mx = (fromPos.x + toPos.x) / 2;
            const my = (fromPos.y + toPos.y) / 2;
            const x1 = fromPos.x + (mx - fromPos.x) * easeIn;
            const y1 = fromPos.y + (my - fromPos.y) * easeIn;
            const x2 = toPos.x + (mx - toPos.x) * easeIn;
            const y2 = toPos.y + (my - toPos.y) * easeIn;
            animLine.points([x1, y1, x2, y2]);
            animLine.opacity(1 - t);
            sys.lineLayer.batchDraw();

            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                animLine.destroy();
                sys.connMgr.removeConn(conn);
                sys.redrawAll();
                resolve();
            }
        };
        requestAnimationFrame(animate);
    });
}

/**
 * 演示"调出参数设置界面"修改延时：弹出原生配置框 → 提示 → 修改输入框 → 保存返回
 */
function _setDelayViaDialog(sys, seconds, label = '延时时间') {
    const tkt = sys.comps['tkt-coil'];
    if (!tkt) return Promise.resolve();
    return new Promise(async (resolve) => {
        // 先用箭头提示指向 KT1
        await _showClickArrow(sys, 'tkt-coil', 'up', `【演示】双击 ${label}，调出参数设置界面`, 2200);

        tkt.showConfigDialog(); // 弹出真实配置对话框
        await new Promise(r => setTimeout(r, 1200));

        const input = document.getElementById('diag_delayTime');
        if (input) {
            // 高亮输入框提示学员正在修改
            input.style.border = '2px solid #e74c3c';
            input.style.background = '#fffbe6';
            sys.showFloatingTip(`【演示】正在修改${label}：由 ${tkt._delayTime}s 改为 ${seconds}s`, 2200);
            await new Promise(r => setTimeout(r, 1500));
            input.value = seconds;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 800));
        }

        // 点击"保存"按钮关闭并应用（按按钮文字定位，避免内联背景色被浏览器规范化）
        const modal = input ? input.closest('div[style*="position: fixed"]') : null;
        if (modal) {
            const saveBtn = [...modal.querySelectorAll('button')].find(b => b.innerText.trim() === '保存');
            if (saveBtn) {
                saveBtn.click();
                await new Promise(r => setTimeout(r, 500));
            }
        }
        // 兜底：确保延时已生效
        _setDelay(sys, seconds);
        resolve();
    });
}

/** 按住按钮直到 doneFn() 为真后松开（用于演示：等接触器得电/失电后再松手） */
function _pressAndHoldUntil(sys, compId, doneFn, timeoutMs = 15000) {
    return new Promise((resolve) => {
        const comp = sys.comps[compId];
        if (!comp) return resolve();
        const isStart = comp.special === 'START-BTN';
        const closedAng = isStart ? -5 : 22.5;
        const openAng = isStart ? -22.5 : 5;
        comp._isPressed = true;
        comp._curBladeAng = closedAng;
        comp._bladeGroup?.rotation(closedAng);
        comp._updatePlunger?.();

        const deadline = Date.now() + timeoutMs;
        const poll = () => {
            let done = false;
            try { done = !!doneFn(); } catch (_) { done = false; }
            if (done || Date.now() > deadline) {
                comp._isPressed = false;
                comp._curBladeAng = openAng;
                comp._bladeGroup?.rotation(openAng);
                comp._updatePlunger?.();
                resolve();
            } else {
                setTimeout(poll, 100);
            }
        };
        poll();
    });
}

/** 按住按钮直到 KM1 得电吸合后再松开（起动按钮 SB2） */
function _pressAndReleaseOnPickup(sys, compId, timeoutMs = 15000) {
    const km1 = sys.comps['km1-coil'];
    return _pressAndHoldUntil(sys, compId, () => km1?.deviceRef?.isPickup?.(), timeoutMs);
}

/** 按住按钮直到 KM1 完全失电释放后再松开（停止按钮 SB1） */
function _pressAndReleaseOnDropout(sys, compId, timeoutMs = 15000) {
    const km1 = sys.comps['km1-coil'];
    return _pressAndHoldUntil(sys, compId, () => !(km1?.deviceRef?.isPickup?.()), timeoutMs);
}

export const PROJECT_WORKFLOWS = {
    'yd-start': {
        id: 'yd-start', name: '1. 星三角降压起动控制电路',
        steps: [
            {
                msg: '第 1 步：点击自动接线。接好QF→KM1→FR→电机首端与星形短接,控制回路；三角形主触头暂不接。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 300));
                    // 让"自动接线"按钮闪烁两次，突出提示后再实施自动接线
                    await _blinkDOMButton('btnAutoWire', '【演示】点击"自动接线"按钮，自动完成基础接线');
                    await new Promise(r => setTimeout(r, 500));
                    _autoWire(this.sys, 'base');
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    return c('ac_wire_u', 'acb_wire_l1')
                        && c('km1-mc_wire_t1', 'fr_wire_l1')
                        && c('fr_wire_t1', 'im01_wire_u1')
                        && c('km3-mc_wire_l1', 'im01_wire_u2')
                        && !c('km2-mc_wire_l1', 'fr_wire_t1');
                },
            },
            {
                msg: '第 2 步：将时间继电器 KT1 的延时调整为 20s，以便观察星形起动过程。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    // 箭头提示 + 调出参数设置界面修改延时
                    await _setDelayViaDialog(this.sys, 20, 'KT1 延时时间');
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const tkt = this.sys.comps['tkt-coil'];
                    return tkt && Math.abs(tkt._delayTime - 20) < 1;
                },
            },
            {
                msg: '第 3 步：接通电源开关，按下起动按钮 SB2。KM1、KM3吸合，KT1 开始延时，电机以星形接法降压起动。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    // 闪烁箭头提示合上断路器 QF
                    await _showClickArrow(this.sys, 'acb', 'down', '【演示】请合上电源断路器 QF', 2600);
                    _powerOn(this.sys);
                    await new Promise(r => setTimeout(r, 800));
                    // 闪烁箭头提示按下起动按钮 SB2
                    await _showClickArrow(this.sys, 'ss', 'down', '【演示】按下起动按钮 SB2', 2600);
                    // 按住 SB2，等待 KM1 接触器得电吸合后再松开
                    await _pressAndReleaseOnPickup(this.sys, 'ss', 15000);
                    await new Promise(r => setTimeout(r, 2500));
                },
                check() {
                    const sys = this.sys;
                    const km1 = sys.comps['km1-coil'];
                    const km3 = sys.comps['km3-coil'];
                    const tkt = sys.comps['tkt-coil'];
                    return km1.deviceRef?.isPickup()
                        && km3.deviceRef?.isPickup()
                        && tkt.deviceRef?.getState() === 'timing';
                },
            },
            {
                msg: '第 4 步：等待 KT1 的 20s 延时到达，KT1-NC 断开使 KM3释放、KT1-NO 闭合使 KM2 吸合。此时手动接入三角形主触头连线（KM2：首端↔尾端换接），电机由星形切换为三角形。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    const tkt = this.sys.comps['tkt-coil'];
                    // 轮询等待 KT1 延时到 output（仿真速率可能慢于实时，固定睡眠不可靠）
                    const deadline = Date.now() + 300000; // 最长等待 5 分钟真实时间
                    while (Date.now() < deadline) {
                        if (tkt && tkt.deviceRef && tkt.deviceRef.getState() === 'output') break;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    // 再等待换接完成（KM3 释放、KM2 吸合）
                    await new Promise(r => setTimeout(r, 2500));
                    // 手动逐根接入三角形主触头（动画连接，每根约 3s）
                    for (const w of WIRES_DELTA) {
                        await this.sys.addConnectionAnimated(w);
                        await new Promise(r => setTimeout(r, 400));
                    }
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    const km2 = sys.comps['km2-coil'];
                    const km3 = sys.comps['km3-coil'];
                    const motor = sys.comps['im01'];
                    // 簇检查：各段通过 KM2 主触头闭合后应处于同一电气簇
                    const clusterOK = c('km2-mc_wire_l1', 'fr_wire_t2')
                        && c('km2-mc_wire_l2', 'fr_wire_t3')
                        && c('km2-mc_wire_l3', 'fr_wire_t1')
                        && c('im01_wire_w2', 'km2-mc_wire_t3')
                        && c('im01_wire_u2', 'km2-mc_wire_t1')
                        && c('im01_wire_v2', 'km2-mc_wire_t2');
                    return km2.deviceRef?.isPickup()
                        && !km3.deviceRef?.isPickup()
                        && clusterOK
                        && motor && motor.rpm > 50;
                },
            },
            {
                msg: '第 5 步：按下停止按钮 SB1，各接触器失电释放，电动机断电滑行停止。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    // 闪烁箭头提示按下停止按钮 SB1
                    await _showClickArrow(this.sys, 'sb', 'down', '【演示】按下停止按钮 SB1 停机', 2600);
                    // 按住 SB1，等待 KM1 完全失电释放后再松开
                    await _pressAndReleaseOnDropout(this.sys, 'sb', 15000);
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const sys = this.sys;
                    const km1 = sys.comps['km1-coil'];
                    const km2 = sys.comps['km2-coil'];
                    const km3 = sys.comps['km3-coil'];
                    const tkt = sys.comps['tkt-coil'];
                    return !km1.deviceRef?.isPickup()
                        && !km2.deviceRef?.isPickup()
                        && !km3.deviceRef?.isPickup()
                        && tkt.deviceRef?.getState() === 'idle';
                },
            },
            {
                msg: '第 6 步：改进电路——在 KT1 线圈前串联 KM2 常闭辅助触点（km2-nc2）。KM2 吸合后其常闭触点断开，切断 KT1 线圈电源。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    // 闪烁箭头提示目标触点
                    await _showClickArrow(this.sys, 'km2-nc2', 'up', '【演示】在 KT1 线圈前串联 KM2 常闭触点 km2-nc2', 2600);
                    // 动画断开 KT1 线圈与起动节点的直连
                    const straight = { from: 'km1-no1_wire_no', to: 'tkt-coil_wire_a1', type: 'wire' };
                    const exists = this.sys.conns.some(c =>
                        this.sys.connMgr.connKeyCanonical(c) === this.sys.connMgr.connKeyCanonical(straight));
                    if (exists) {
                        await _highlightConn(this.sys, straight, 1800, '#e74c3c');
                        await _removeWireAnimated(this.sys, straight);
                    }
                    await new Promise(r => setTimeout(r, 600));
                    // 动画接入经 KM2-NC 串联的新支路
                    const newWires = [
                        { from: 'km1-no1_wire_no', to: 'km2-nc2_wire_com', type: 'wire' },
                        { from: 'km2-nc2_wire_nc', to: 'tkt-coil_wire_a1', type: 'wire' },
                    ];
                    for (const w of newWires) {
                        await this.sys.addConnectionAnimated(w);
                        await new Promise(r => setTimeout(r, 400));
                    }
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    // 改造后：起动节点与 KT1 线圈不再直连，但经 KM2-NC 通过后应同簇
                    const straightGone = !c('km1-no1_wire_no', 'tkt-coil_wire_a1');
                    const viaNC = c('km1-no1_wire_no', 'km2-nc2_wire_com')
                        && c('km2-nc2_wire_nc', 'tkt-coil_wire_a1');
                    return straightGone && viaNC;
                },
            },
            {
                msg: '第 7 步：改进电路——在 KT1 常开延时触头端并联 KM2 常开辅助触点（km2-no1），实现自锁。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    // 闪烁箭头提示目标触点
                    await _showClickArrow(this.sys, 'km2-no1', 'up', '【演示】在 KT1 常开延时触头端并联 KM2 常开触点 km2-no1 实现自锁', 2600);
                    // 动画接入并联自锁支路
                    const newWires = [
                        { from: 'tkt-no_wire_com', to: 'km2-no1_wire_com', type: 'wire' },
                        { from: 'km2-no1_wire_no', to: 'tkt-no_wire_no', type: 'wire' },
                    ];
                    for (const w of newWires) {
                        await this.sys.addConnectionAnimated(w);
                        await new Promise(r => setTimeout(r, 400));
                    }
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const sys = this.sys;
                    const c = (a, b) => sys.isPortConnected(a, b);
                    // 改进后：km2-no1 与 tkt-no 两端分别同簇（并联自锁）
                    const parallelOK = c('tkt-no_wire_com', 'km2-no1_wire_com')
                        && c('km2-no1_wire_no', 'tkt-no_wire_no');
                    // KM2 线圈支路（KT1-NO 常开端 → KM3-NC → KM2 线圈）保持完整
                    const km2CtrlOK = c('tkt-no_wire_no', 'km3-nc_wire_com')
                        && c('km3-nc_wire_nc', 'km2-coil_wire_a1');
                    return parallelOK && km2CtrlOK;
                },
            },
            {
                msg: '第 8 步：将 KT1 延时调回 5s，按下起动按钮 SB2，完整观察星三角降压起动全过程。', mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 200));
                    // 箭头提示 + 调出参数设置界面把延时调回 5s
                    await _setDelayViaDialog(this.sys, 5, 'KT1 延时时间');
                    await new Promise(r => setTimeout(r, 400));
                    // 闪烁箭头提示按下起动按钮 SB2
                    await _showClickArrow(this.sys, 'ss', 'down', '【演示】按下起动按钮 SB2，开始完整星三角降压起动', 2600);
                    await _pressAndReleaseOnPickup(this.sys, 'ss', 15000);
                    await new Promise(r => setTimeout(r, 12000));
                },
                check() {
                    const sys = this.sys;
                    const km2 = sys.comps['km2-coil'];
                    const km3 = sys.comps['km3-coil'];
                    const motor = sys.comps['im01'];
                    return km2.deviceRef?.isPickup()
                        && !km3.deviceRef?.isPickup()
                        && motor && motor.rpm > 200;
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 主回路：AC 380V → QF → KM1 → FR → 电动机 ──
    { Class: DiagramACPower3P, id: 'ac', x: 300, y: 20, vRms: 220, freq: 50, isOn: true, phaseSeq: 'pos', visible: true },
    { Class: DiagramThreePhaseACB, id: 'acb', x: 300, y: 100, height: 105, initState: 'off', label: 'QF', ratedVoltage: 380, ratedCurrent: 100, tripCurrent: 60, visible: true },
    { Class: MainContact, id: 'km1-mc', x: 300, y: 270, height: 105, deviceid: 'KM1', visible: true },
    { Class: ThermalHeatElement, id: 'fr', x: 300, y: 430, height: 100, deviceid: 'FR1', ratedCurrent: 300, tripClass: 20, visible: true },
    { Class: InductionMotor2, id: 'im01', x: 270, y: 550, visible: true,
        R1: 0.50, Lsigma1: 0.00334, Rc: 300, Lm: 0.0796,
        R2: 0.46, Lsigma2: 0.00334,
        J: 1.0, B: 0.02, polePairs: 2,
        ratedPower: 10, ratedSpeed: 1440,
        simpleModel: true, loadTorque: 20 },

    // ── 星形 / 三角形接触器（尾端 U2/V2/W2 换接）──
    { Class: MainContact, id: 'km3-mc', x: 300, y: 860, height: 105, deviceid: 'KM3', visible: true },
    { Class: MainContact, id: 'km2-mc', x: 600, y: 630, height: 105, deviceid: 'KM2', visible: true },

    // ── 控制回路：FU4 → TC → SB1 → [KM1 自锁 | 星形支路 | 三角形支路 | KT1] → FR-NC → FU5 → TC ──
    { Class: SinglePhaseFuse, id: 'fu4', x: 480, y: 150, label: 'FU4', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: ControlTransformer, id: 'tc', x: 620, y: 110, primaryVoltage: 380, secondaryVoltage: 220, visible: true },
    { Class: SinglePhaseFuse, id: 'fu5', x: 800, y: 160, label: 'FU5', ratedCurrent: 5, rotation: -90, visible: true },
    { Class: DiagramStopButton, id: 'sb', x: 800, y: 200, visible: true, label: 'SB1' },
    // ── 主线圈自锁支路 ──
    { Class: DiagramStartButton, id: 'ss', x: 1000, y: 190, visible: true, label: 'SB2' },
    { Class: AuxNOContact, id: 'km1-no1', x: 1030, y: 260, deviceid: 'KM1', visible: true, rotation: 90 },
    { Class: ContactorCoil, id: 'km1-coil', x: 1380, y: 200, deviceid: 'KM1', visible: true },
    // ── 时间继电器 KT1 线圈 ──
    { Class: TimeRelayCoil, id: 'tkt-coil', x: 1380, y: 330, deviceid: 'KT1', delayTime: 5, visible: true },
    // ── 改进 1 用（第 7 步接入）：KM2 常闭辅助触点（KT1 线圈前）──
    { Class: AuxNCContact, id: 'km2-nc2', x: 1180, y: 310, deviceid: 'KM2', visible: true },
    // ── 星形支路：KM2-NC 互锁 → KT1-NC 延时断开 → KM3 线圈 ──
    { Class: AuxNCContact, id: 'km2-nc', x: 1180, y: 450, deviceid: 'KM2', visible: true },
    { Class: TimeDelayNCContact, id: 'tkt-nc', x: 1000, y: 450, deviceid: 'KT1', visible: true },
    { Class: ContactorCoil, id: 'km3-coil', x: 1380, y: 450, deviceid: 'KM3', visible: true },
    // ── 三角形支路：KT1-NO 延时闭合 → KM3-NC 互锁 → KM2 线圈 ──
    { Class: TimeDelayNOContact, id: 'tkt-no', x: 1000, y: 560, deviceid: 'KT1', visible: true },
    // ── 改进 2 用（第 8 步接入）：KM2 常开辅助触点（tkt-no 两端）──
    { Class: AuxNOContact, id: 'km2-no1', x: 1000, y: 660, deviceid: 'KM2', visible: true },
    { Class: AuxNCContact, id: 'km3-nc', x: 1180, y: 560, deviceid: 'KM3', visible: true },
    { Class: ContactorCoil, id: 'km2-coil', x: 1380, y: 560, deviceid: 'KM2', visible: true },
    { Class: ThermalNCContact, id: 'fr-nc', x: 1350, y: 100, deviceid: 'FR1', visible: true },

    { Class: TsCurveDisplay, id: 'ts-curve', x: 1350, y: 100, visible: false, quadrants: 1 },
    { Class: Multimeter, id: 'multimeter', x: 1080, y: 440, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1250, y: 180, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'base');
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _autoWire(sys, 'base');
    _powerOn(sys);
}

export function fiveStep() { }
