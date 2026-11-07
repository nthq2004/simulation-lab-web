// 三相绕组接线盒仿真工程
// 项目1：测量三相绕组电阻（Y/Δ 接法）
// 项目2：通电感应法检测同名端
// 项目3：交流感应法
//
// 自动演示（show 模式）约定：'check' 步骤的 act() 负责动画演示，
// check() 仅用于 train/eval 模式的完成度检测。

import Konva from 'konva';
import { ACPower } from '../components/ACPower.js';
import { DCPower } from '../components/DCPower.js';
import { MotorTerminalBox } from '../components/MotorTerminalBox.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter, KNOB_ANGLES } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

/* ═══════════════════════════════════════════════════════════
   自动演示辅助函数（动画节奏：展示 → 延时 → 动作）
   ═══════════════════════════════════════════════════════════ */

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/* 组件世界坐标：优先 getClickablePartCenter，其次局部坐标回退 */
function _partCenter(wf, comp, partId, fbx, fby) {
    if (!comp) return null;
    if (comp.getClickablePartCenter) {
        const c = comp.getClickablePartCenter(partId);
        if (c) return c;
    }
    if (fbx !== undefined && fby !== undefined) {
        return { x: comp.group.x() + fbx, y: comp.group.y() + fby };
    }
    return null;
}

/* 在部件上闪烁箭头（找不到部件中心则不闪，避免报错） */
async function _flashToPart(wf, comp, partId, fbx, fby) {
    const c = _partCenter(wf, comp, partId, fbx, fby);
    if (c) await wf._flashArrow(c);
}

/* 清理接线盒内部跳线（两端均为接线盒端子的接线） */
function _clearMtbJumpers(wf, mtbId = 'mtb01') {
    const sys = wf.sys;
    const prefix = mtbId + '_wire_';
    sys.conns
        .filter(c => c.from.startsWith(prefix) && c.to.startsWith(prefix))
        .forEach(c => sys.connMgr.removeConn(c));
    sys.redrawAll();
}

/* 清空全部连线后，逐条动画接线（addConnectionAnimated 自带 ~3s 画线动画） */
async function _autoWireAnimated(wf, pairs) {
    const sys = wf.sys;
    sys.conns.length = 0;
    sys.redrawAll();
    for (const [from, to] of pairs) {
        sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
        await sleep(3300);
    }
}

/* 保留现有连线，仅追加动画接线（用于叠加测量/检测表笔，不清除电源回路） */
async function _appendWireAnimated(wf, pairs) {
    const sys = wf.sys;
    for (const [from, to] of pairs) {
        sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' });
        await sleep(3300);
    }
}

/* 连线淡出后移除（按 connKey 定位视觉线） */
function _fadeOutWire(sys, conn) {
    return new Promise(res => {
        const key = sys.connMgr.connKeyCanonical(conn);
        const nd = (sys.wireNodes || []).find(n => n.connKey === key);
        if (!nd) {
            sys.connMgr.removeConn(conn);
            sys.redrawAll();
            res();
            return;
        }
        nd.to({
            opacity: 0, duration: 0.35,
            onFinish: () => {
                sys.connMgr.removeConn(conn);
                sys.redrawAll();
                res();
            },
        });
    });
}

/* 连线脉冲流动（dash 滚动动画，不使用 shadow 三件套） */
function _flowWire(sys, conn, times = 2) {
    const key = sys.connMgr.connKeyCanonical(conn);
    const nd = (sys.wireNodes || []).find(n => n.connKey === key);
    if (!nd) return;
    const orig = { stroke: nd.stroke(), width: nd.strokeWidth(), dash: nd.dash() };
    nd.stroke('#00e676').strokeWidth(Math.max(3, orig.width + 1));
    let count = 0;
    const step = () => {
        count++;
        if (count > times) {
            nd.stroke(orig.stroke).strokeWidth(orig.width).dash(orig.dash);
            sys.requestRedraw();
            return;
        }
        nd.dash([10, 8]).dashOffset(0);
        sys.requestRedraw();
        nd.to({
            dashOffset: -36, duration: 0.5,
            onFinish: () => {
                nd.dash([]).dashOffset(0);
                sys.requestRedraw();
                setTimeout(step, 260);
            },
        });
    };
    step();
}

/* 数字万用表档位动画：旋钮指针平滑转到目标角度，再落定档位 */
async function _demoMultimeterRange(wf, compId, targetMode, angle) {
    const sys = wf.sys;
    const mm = sys.comps[compId];
    if (!mm) return;
    mm.group.visible(true);
    sys.requestRedraw();
    await new Promise(res => {
        mm.pointer.to({
            rotation: angle, duration: 0.9,
            easing: Konva.Easings.EaseInOut,
            onUpdate: () => sys.requestRedraw(),
            onFinish: res,
        });
    });
    mm.mode = targetMode;
    if (mm._updateAngleByMode) mm._updateAngleByMode();
    sys.requestRedraw();
}

/* MF47 指针表档位动画：临时红线旋转到目标刻度，再落定档位 */
async function _demoMF47Range(wf, compId, targetRangeId) {
    const sys = wf.sys;
    const mf = sys.comps[compId];
    if (!mf) return;
    mf.group.visible(true);
    sys.requestRedraw();
    const kn = mf._knob;
    if (!kn || !mf._knobIndicator) return;
    const target = KNOB_ANGLES[targetRangeId] ?? 0;
    const pts = mf._knobIndicator.points();
    if (!pts || pts.length < 4) return;
    const cur = Math.round(Math.atan2(pts[2] - pts[0], -(pts[3] - pts[1])) * 180 / Math.PI);
    const d = ((target - cur + 540) % 360) - 180;   // 最短方向
    const kLen = kn.r * 0.75;
    const line = new Konva.Line({
        points: [kn.cx, kn.cy, kn.cx, kn.cy - kLen],
        stroke: '#e74c3c', strokeWidth: 3.5, lineCap: 'round', listening: false,
    });
    sys.layer.add(line);
    await new Promise(res => {
        line.to({
            rotation: cur + d, duration: 1.1,
            easing: Konva.Easings.EaseInOut,
            onUpdate: () => sys.requestRedraw(),
            onFinish: res,
        });
    });
    line.destroy();
    mf.setRange(targetRangeId);
    sys.requestRedraw();
}

/* ═══════════════════════════════════════════════════════════
   工作流
   ═══════════════════════════════════════════════════════════ */

export const PROJECT_WORKFLOWS = {
    'winding-resistance': {
        id: 'winding-resistance',
        name: '项目1：测量三相绕组电阻,实现Y型和Δ型接法',
        steps: [
            {
                msg: '1. 将数字万用表切换到电阻档（RES200），依次测量 U 相（U1-U2）、V 相（V1-V2）、W 相（W1-W2）的绕组电阻值。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    sys.conns.length = 0;
                    sys.redrawAll();
                    _clearMtbJumpers(this, 'mtb01');

                    // ── 档位切换动画 ──
                    sys.showFloatingTip('数字万用表切换到电阻档（RES200）…', 2500);
                    await _demoMultimeterRange(this, 'multimeter', 'RES200', 60);
                    await this._flashArrow(_partCenter(this, mm, 'knob', 120, 252));
                    sys.showFloatingTip('现在开始逐相测量绕组电阻', 2200);
                    await sleep(1000);

                    // ── 依次测量 U / V / W 三相 ──
                    const phases = [['u1', 'u2'], ['v1', 'v2'], ['w1', 'w2']];
                    for (const [a, b] of phases) {
                        sys.showFloatingTip(
                            `红色表笔（V）→ ${a.toUpperCase()}，黑色表笔（COM）→ ${b.toUpperCase()}，测量该相绕组电阻`,
                            3000);
                        await sleep(800);
                        await _autoWireAnimated(this, [
                            ['multimeter_wire_v', `mtb01_wire_${a}`],
                            ['multimeter_wire_com', `mtb01_wire_${b}`],
                        ]);
                        await sleep(1200);          // 等待求解器稳定读数
                        _flowWire(sys, sys.conns[0]);   // 测量回路脉冲
                        _flowWire(sys, sys.conns[1]);
                        await sleep(1500);
                        await this._flashArrow(_partCenter(this, mm, 'lcd', 120, 85));  // 结果箭头
                        sys.showFloatingTip(`📟 ${a.toUpperCase()}-${b.toUpperCase()} 相电阻 ≈ 2.5Ω（三相绕组电阻平衡）`, 2600);
                        await sleep(1600);
                        for (const c of [...sys.conns]) await _fadeOutWire(sys, c); // 拆除表笔
                        await sleep(600);
                    }
                    sys.showFloatingTip('✅ 三相绕组电阻测量完成：各相均约 2.5Ω', 3000);
                    await sleep(1200);
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm.mode !== 'RES200') return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('multimeter_wire_v', 'mtb01_wire_u1')
                        && c('multimeter_wire_com', 'mtb01_wire_u2');
                },
            },
            {
                msg: '2. 手动进行 Y 型连接：将 U2-V2-W2 三个尾端短接在一起（或点击"Y 接法"按钮演示）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mtb = sys.comps['mtb01'];
                    sys.conns.length = 0;
                    sys.redrawAll();

                    sys.showFloatingTip('Y 型接法：将 U2、V2、W2 三个尾端短接在一起（星点）', 2800);
                    await sleep(700);
                    await _autoWireAnimated(this, [
                        ['mtb01_wire_u2', 'mtb01_wire_v2'],
                        ['mtb01_wire_w2', 'mtb01_wire_u2'],
                    ]);
                    await sleep(800);
                    if (mtb._readConnections) { mtb._readConnections(); sys.requestRedraw(); }
                    await sleep(600);
                    for (const t of ['u2', 'v2', 'w2']) {
                        await _flashToPart(this, mtb, t);
                        await sleep(350);
                    }
                    sys.showFloatingTip('✅ Y 型接法完成：U2、V2、W2 短接为星点，首端 U1、V1、W1 引出', 3000);
                    await sleep(1400);
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mtb01_wire_u2', 'mtb01_wire_v2')
                        && c('mtb01_wire_v2', 'mtb01_wire_w2');
                },
            },
            {
                msg: '3. 手动进行 Δ 型连接：将 U1-W2、V1-U2、W1-V2 首尾相接（或点击"Δ 接法"按钮演示）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mtb = sys.comps['mtb01'];
                    _clearMtbJumpers(this, 'mtb01');

                    sys.showFloatingTip('Δ 型接法：首尾相接 U1-W2、V1-U2、W1-V2，形成三角形闭环', 2800);
                    await sleep(700);
                    await _autoWireAnimated(this, [
                        ['mtb01_wire_u1', 'mtb01_wire_w2'],
                        ['mtb01_wire_v1', 'mtb01_wire_u2'],
                        ['mtb01_wire_w1', 'mtb01_wire_v2'],
                    ]);
                    await sleep(800);
                    if (mtb._readConnections) { mtb._readConnections(); sys.requestRedraw(); }
                    await sleep(600);
                    await this._flashArrow(_partCenter(this, mtb, 'box', 300, 220));
                    sys.showFloatingTip('✅ Δ 型接法完成：三相绕组首尾相接成三角形', 3000);
                    await sleep(1400);
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mtb01_wire_u1', 'mtb01_wire_w2')
                        && c('mtb01_wire_v1', 'mtb01_wire_u2')
                        && c('mtb01_wire_w1', 'mtb01_wire_v2');
                },
            },
            {
                msg: '4. 测试题：三相绕组星形接法',
                mode: 'quiz',
                quizConfig: {
                    question: '三相异步电动机绕组采用星形（Y）接法时，线电压与相电压的关系是：',
                    options: [
                        '线电压 = 相电压',
                        '线电压 = √3 × 相电压',
                        '相电压 = √3 × 线电压',
                        '线电压 = 2 × 相电压',
                    ],
                    answer: 1,
                    analysis: '星形接法时，线电压等于√3倍相电压（UL = √3 × UP），线电流等于相电流。',
                },
            },
        ],
    },
    'winding-dc-test': {
        id: 'winding-dc-test',
        name: '项目2：通电感应法检测同名端',
        steps: [
            {
                msg: '1. 将直流 12V 电源连接到 U 相绕组（正极→U1，负极→U2）.',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const dc = sys.comps['dc'];
                    dc.isOn = false;
                    if (dc.update) dc.update();
                    sys.conns.length = 0;
                    sys.redrawAll();

                    sys.showFloatingTip('直流 12V 电源接线：正极 → U1，负极 → U2，接入 U 相绕组', 2800);
                    await sleep(700);
                    await _autoWireAnimated(this, [
                        ['dc_wire_p', 'mtb01_wire_u1'],
                        ['dc_wire_n', 'mtb01_wire_u2'],
                    ]);
                    await sleep(800);
                    _flowWire(sys, sys.conns[0]);
                    _flowWire(sys, sys.conns[1]);
                    await sleep(1500);
                    sys.showFloatingTip('✅ 直流电源已连接 U 相绕组（U1 接正、U2 接负）', 2600);
                    await sleep(1000);
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('dc_wire_p', 'mtb01_wire_u1')
                        && c('dc_wire_n', 'mtb01_wire_u2');
                },
            },
            {
                msg: '2. 将指针式万用表切换到直流电压档（DCV10），红表笔接 V1、黑表笔接 V2，检测 V 相感应电压。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mf = sys.comps['mf47-panel'];

                    // ── 档位切换动画 ──
                    sys.showFloatingTip('MF47 万用表切换到直流电压 10V 档（DCV10）…', 2400);
                    await _demoMF47Range(this, 'mf47-panel', 'DCV10');
                    await _flashToPart(this, mf, 'range-DCV10');
                    await sleep(900);

                    // ── 接线动画（保留第 1 步的直流电源回路）──
                    sys.showFloatingTip('红表笔（V-Ω）→ V1，黑表笔（COM）→ V2，检测 V 相感应电压', 2800);
                    await sleep(600);
                    await _appendWireAnimated(this, [
                        ['mf47-panel_wire_v', 'mtb01_wire_v1'],
                        ['mf47-panel_wire_COM', 'mtb01_wire_v2'],
                    ]);
                    await sleep(900);
                    await _flashToPart(this, mf, 'dial', 160, 168);
                    sys.showFloatingTip('✅ 已接好：V-Ω→V1、COM→V2，接下来观察通电瞬间的指针', 2600);
                    await sleep(1000);
                },
                check() {
                    const mf = this.sys.comps['mf47-panel'];
                    if (!mf || !mf.group || !mf.group.visible()) return false;
                    if (mf._rangeId !== 'DCV10') return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mf47-panel_wire_v', 'mtb01_wire_v1')
                        && c('mf47-panel_wire_COM', 'mtb01_wire_v2');
                },
            },
            {
                msg: '3. 观察：在直流电源接通瞬间，指针式万用表指针反向偏转；断开瞬间，指针正向偏转。请观察该现象。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const dc = sys.comps['dc'];
                    const mf = sys.comps['mf47-panel'];

                    sys.showFloatingTip('接通电源：观察 MF47 指针动作', 2400);
                    await sleep(700);

                    // ── 接通瞬间（反偏）──
                    await _flashToPart(this, dc, 'power');          // 指向电源开关
                    dc.isOn = true;
                    if (dc.update) dc.update();
                    await sleep(900);
                    _flowWire(sys, sys.conns[0]);
                    _flowWire(sys, sys.conns[1]);
                    await sleep(1400);
                    await _flashToPart(this, mf, 'dial', 160, 168); // 指向表盘指针
                    sys.showFloatingTip('⚡ 接通瞬间 U 相电流增大 → V 相感应反向电压 → 指针反向偏转', 3200);
                    await sleep(1600);

                    // ── 断开瞬间（正偏）──
                    sys.showFloatingTip('现在断开电源，再次观察指针…', 2200);
                    await sleep(600);
                    await _flashToPart(this, dc, 'power');
                    dc.isOn = false;
                    if (dc.update) dc.update();
                    await sleep(900);
                    _flowWire(sys, sys.conns[0]);
                    _flowWire(sys, sys.conns[1]);
                    await sleep(1200);
                    await _flashToPart(this, mf, 'dial', 160, 168);
                    sys.showFloatingTip('⚡ 断开瞬间 U 相电流减小 → V 相感应正向电压 → 指针正向偏转（U1 与 V1 为同名端）', 3400);
                    await sleep(1600);

                    // 恢复通电状态（与检查逻辑一致，便于后续讲解）
                    dc.isOn = true;
                    if (dc.update) dc.update();
                    await sleep(900);
                },
                check() {
                    const dc = this.sys.comps['dc'];
                    return dc && dc.isOn === true;
                },
            },
            {
                msg: '4. 测试题：同名端判断',
                mode: 'quiz',
                quizConfig: {
                    question: '通电感应法中，当 U 相绕组接通直流电源（U1 接正、U2 接负）的瞬间，若指针式万用表（红表笔接 V1、黑表笔接 V2）指针反向偏转，则说明：',
                    options: [
                        'U1 与 V1 为同名端',
                        'U1 与 V2 为同名端',
                        'U2 与 V1 为同名端',
                        '无法判断同名端',
                    ],
                    answer: 0,
                    analysis: '接通瞬间 U 相电流增大（di/dt > 0），若 V 相感应电压使红表笔为负（指针反向偏转），因为U、V相位差120°，则 U1 与 V1 为同名端（极性相同）。',
                },
            },
        ],
    },
    'winding-ac-test': {
        id: 'winding-ac-test',
        name: '项目3：交流感应法测量同名端',
        steps: [
            {
                msg: '1. 系统自动将交流 12V 电源连接到 U 相绕组（U1-U2），并接通电源。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const ac = sys.comps['ac'];
                    ac.isOn = false;
                    if (ac.update) ac.update();
                    sys.conns.length = 0;
                    sys.redrawAll();

                    sys.showFloatingTip('交流 12V 电源接线：L → U1，N → U2，接入 U 相绕组', 2800);
                    await sleep(700);
                    await _autoWireAnimated(this, [
                        ['ac_wire_p', 'mtb01_wire_u1'],
                        ['ac_wire_n', 'mtb01_wire_u2'],
                    ]);
                    await sleep(700);

                    // ── 接通电源动画 ──
                    sys.showFloatingTip('按下电源开关接通交流电源…', 2200);
                    await _flashToPart(this, ac, 'power');
                    ac.isOn = true;
                    if (ac.update) ac.update();
                    await sleep(900);
                    _flowWire(sys, sys.conns[0]);
                    _flowWire(sys, sys.conns[1]);
                    await sleep(1500);
                    sys.showFloatingTip('✅ 交流 50Hz/12V 已施加于 U 相绕组（U1-U2）', 2600);
                    await sleep(1000);
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('ac_wire_p', 'mtb01_wire_u1')
                        && c('ac_wire_n', 'mtb01_wire_u2');
                },
            },
            {
                msg: '2. 连接连接 V1 和 W1（V-W 两相绕组反向串联）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mtb = sys.comps['mtb01'];
                    sys.showFloatingTip('连接 V1-W1：V、W 两相绕组反向串联（尾首相接）', 2800);
                    await sleep(700);
                    await _appendWireAnimated(this, [
                        ['mtb01_wire_v1', 'mtb01_wire_w1'],
                    ]);
                    await sleep(800);
                    await _flashToPart(this, mtb, 'v1');
                    await sleep(400);
                    await _flashToPart(this, mtb, 'w1');
                    await sleep(900);
                    sys.showFloatingTip('✅ V1-W1 已短接，V2、W2 为开口端', 2600);
                    await sleep(900);
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('mtb01_wire_v1', 'mtb01_wire_w1');
                },
            },
            {
                msg: '3. 将数字万用表切换到交流电压档（ACV200），依次测量 V 相、W 相绕组电压及开口电压（第 3 次红表笔接 V2、黑表笔接 W2）。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];

                    // ── 档位切换动画 ──
                    sys.showFloatingTip('数字万用表切换到交流电压档（ACV200）…', 2400);
                    await _demoMultimeterRange(this, 'multimeter', 'ACV200', -120);
                    await _flashToPart(this, mm, 'knob', 120, 252);
                    await sleep(900);

                    // ── 三次测量（保留交流电源回路与 V1-W1 连接）──
                    const meas = [
                        {
                            tip: '第 1 次：红表笔（V）→ V1，黑表笔（COM）→ V2，测量 V 相绕组电压',
                            pairs: [
                                ['multimeter_wire_v', 'mtb01_wire_v1'],
                                ['multimeter_wire_com', 'mtb01_wire_v2'],
                            ],
                            result: 'V 相绕组感应电压 ≈ 5.6V（互感耦合产生的感应电动势）',
                        },
                        {
                            tip: '第 2 次：红表笔（V）→ W1，黑表笔（COM）→ W2，测量 W 相绕组电压',
                            pairs: [
                                ['multimeter_wire_v', 'mtb01_wire_w1'],
                                ['multimeter_wire_com', 'mtb01_wire_w2'],
                            ],
                            result: 'W 相绕组感应电压 ≈ 5.6V（与 V 相对称）',
                        },
                        {
                            tip: '第 3 次：红表笔（V）→ V2，黑表笔（COM）→ W2，测量两相开口电压',
                            pairs: [
                                ['multimeter_wire_v', 'mtb01_wire_v2'],
                                ['multimeter_wire_com', 'mtb01_wire_w2'],
                            ],
                            result: 'V2-W2 开口电压 ≈ 0V：V、W 两相感应电压相互抵消（反向串联）',
                        },
                    ];
                    for (let i = 0; i < meas.length; i++) {
                        const m = meas[i];
                        sys.showFloatingTip(m.tip, 2800);
                        await sleep(700);
                        // 拆除上一组表笔（第 3 次测量后保留接线）
                        if (i > 0) {
                            const probes = sys.conns
                                .filter(c => c.from.startsWith('multimeter_wire_'));
                            for (const c of [...probes]) await _fadeOutWire(sys, c);
                        }
                        await _appendWireAnimated(this, m.pairs);
                        await sleep(2200);          // 等待读数稳定
                        const curProbes = sys.conns
                            .filter(c => c.from.startsWith('multimeter_wire_'));
                        curProbes.forEach(c => _flowWire(sys, c));   // 测量回路脉冲
                        await sleep(2200);
                        await this._flashArrow(_partCenter(this, mm, 'lcd', 120, 85));  // 结果箭头
                        sys.showFloatingTip(`📟 ${m.result}`, 3200);
                        await sleep(1800);
                    }
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    if (!mm || !mm.group || !mm.group.visible()) return false;
                    if (mm.mode !== 'ACV200') return false;
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return c('multimeter_wire_v', 'mtb01_wire_v2')
                        && c('multimeter_wire_com', 'mtb01_wire_w2');
                },
            },
            {
                msg: '4. 测试题：感应电压分析',
                mode: 'quiz',
                quizConfig: {
                    question: '在 U 相施加交流 12V 电压，V-W 两相绕组反向串联（V1-W1 连接），测量 V2-W2 之间的电压，其值约为：',
                    options: [
                        '0V（感应电压相互抵消）',
                        '12V（与 U 相同）',
                        '20.8V（√3 × 12V）',
                        '24V（2 × 12V）',
                    ],
                    answer: 0,
                    analysis: 'V-W 两相绕组反向串联时，感应电压相位相反、相互抵消，因此 V2-W2 之间的电压接近 0V。若改为同名端串联则互感增强，电压约为 1 倍相电压。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // ── 电源（左→右） ──
    { Class: ACPower, id: 'ac', x: 130, y: 80, vRms: 12, freq: 50, isOn: false, visible: true },
    { Class: DCPower, id: 'dc', x: 150, y: 360, voltage: 12, isOn: false, visible: true },

    // ── 三相绕组接线盒 ──
    { Class: MotorTerminalBox, id: 'mtb01', x: 420, y: 20, visible: true },

    // ── 6 种仪表（必须保留） ──
    { Class: Multimeter, id: 'multimeter', x: 780, y: 540, visible: true },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1180, y: 40, visible: true },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

function _autoWire(sys, wfId) {
    sys.conns.length = 0;
    const cons = [];
    if (wfId === 'winding-resistance') {
        cons.push(
            { from: 'multimeter_wire_v', to: 'mtb01_wire_u1', type: 'wire' },
            { from: 'multimeter_wire_com', to: 'mtb01_wire_u2', type: 'wire' },
        );
    } else if (wfId === 'winding-dc-test') {
        cons.push(
            { from: 'dc_wire_p', to: 'mtb01_wire_u1', type: 'wire' },
            { from: 'dc_wire_n', to: 'mtb01_wire_u2', type: 'wire' },
        );
    } else if (wfId === 'winding-ac-test') {
        cons.push(
            { from: 'ac_wire_p', to: 'mtb01_wire_u1', type: 'wire' },
            { from: 'ac_wire_n', to: 'mtb01_wire_u2', type: 'wire' },
            { from: 'mtb01_wire_v2', to: 'mtb01_wire_w2', type: 'wire' },
        );
    }
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

export function initSlider(_sys) { }

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const wfId = sys.currentWorkflowId;
    if (wfId) _autoWire(sys, wfId);
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    const wfId = sys.currentWorkflowId;
    if (wfId) _autoWire(sys, wfId);
}

export function fiveStep() { }