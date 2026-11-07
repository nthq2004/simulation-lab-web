// 逆功率继电器仿真工程（双交流源 + 同步电抗，功率角 δ 调节逆功率）

import { ACPower } from '../components/ACPower.js';
import { ReversePowerRelay } from '../components/ReversePowerRelay.js';
import { Inductor } from '../components/Inductor.js';
import { Resistor } from '../components/Resistor.js';
import { LED } from '../components/LED.js';
import { DCPower } from '../components/DCPower.js';
import { Ground } from '../components/Gnd.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';

export const FAULT_CONFIGS = {};

export const PROJECT_WORKFLOWS = {
    'revpower-basic': {
        id: 'revpower-basic',
        name: '1. 逆功率继电器的功能测试',
        steps: [
            {
                msg: '第 1 步：接线。母线通过同步电抗 xs 连接发电机电源 。逆功率继电器电流线圈串联于发电机输出回路，电压线圈并联于母线。逆功率继电器输出常闭触点控制信号灯回路。观察继电器当前状态：发电机超前母线（δ>0）时应显示"正"。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    sys.showFloatingTip('第 1 步：开始接线，每一根线逐一连接', 4000);
                    await sleep(1500);
                    // ① 逐条动画接线（按回路分组）
                    await _autoWireAnimated(this);
                    // ② 确保两电源开启并保持 δ=+12°（超前）
                    const ac1 = sys.comps['ac1'];
                    const ac2 = sys.comps['ac2'];
                    if (ac1) ac1.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 0, isOn: true });
                    if (ac2) ac2.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 12, isOn: true });
                    await sleep(3000);   // 等待功率稳定
                    // ③ 闪烁箭头指示常闭触点 NC 状态
                    const rp = sys.comps['rp'];
                    const nc = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('nc') : null;
                    if (nc) { await this._flashArrow(nc); }
                    sys.showFloatingTip('👉 常闭触点 NC 闭合：触点回路接通，信号灯点亮', 4500);
                    await sleep(2000);
                    // ④ 闪烁箭头指出"方向"指示
                    const dir = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('dir') : null;
                    if (dir) { await this._flashArrow(dir); }
                    sys.showFloatingTip('👉 "方向"指示：发电机超前母线（δ>0），显示"正"——输出正功率', 4500);
                    await sleep(2000);
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return rp
                        && c('ac1_wire_p', 'xs_wire_l')
                        && c('xs_wire_r', 'rp_wire_ip')
                        && c('rp_wire_in', 'ac2_wire_p')
                        && c('ac1_wire_n', 'gnd1_wire_gnd')
                        && c('ac2_wire_n', 'gnd2_wire_gnd')
                        && c('rp_wire_un', 'gnd3_wire_gnd')
                        && c('ac1_wire_p', 'rp_wire_up')
                        && c('rp_wire_NC', 'lamp1_wire_l')
                        && rp.getState() === 'normal'
                        && rp.getPower() > 0;
                },
            },
            {
                msg: '第 2 步：将发电机电源 相位调为负值-18°（发电机滞后母线，出现逆功率）。当逆功率超过 32kW（动作值）时，继电器进入定时限计时（固定 10s），延时结束即跳闸（NO 闭合、NC 断开），信号灯由常亮转为熄灭，TRIP 指示灯亮。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const rp = sys.comps['rp'];
                    sys.showFloatingTip('第 2 步：设置发电机相位为负值，制造逆功率', 4000);
                    await sleep(1200);
                    // ① 弹出参数设置界面，逐步演示设置初相位 -18°
                    await _demoSetPhase(this, 'ac2', -18);
                    await sleep(500);
                    // ② 箭头指示延时过程（定时限 10s 倒计时）
                    for (let k = 0; k < 3; k++) {
                        const cd = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('cd') : null;
                        if (cd) { await this._flashArrow(cd); }
                        sys.showFloatingTip('⏱ 逆功率超过 32kW 动作值，定时限延时 10s 倒计时中…', 3200);
                        await sleep(1500);
                    }
                    await sleep(2000);   // 确保 10s 延时结束、完成跳闸
                    // ③ 箭头指示触点动作过程
                    const ct = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('contact') : null;
                    if (ct) { await this._flashArrow(ct); }
                    sys.showFloatingTip('⚡ 延时结束，触点动作：NC 断开、NO 闭合 → 信号灯熄灭，TRIP 指示灯亮', 4500);
                    await sleep(2200);
                    const led = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('trip-led') : null;
                    if (led) { await this._flashArrow(led); }
                    sys.showFloatingTip('🔴 TRIP 动作指示灯常亮，继电器跳闸保持', 3500);
                    await sleep(1500);
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    return rp && rp.isTripped();
                },
            },
            {
                msg: '第 3 步：发电机相角恢复超前12°、重新输出正功率，继电器处于跳闸保持状态，手动点击复位按钮进行复归。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const rp = sys.comps['rp'];
                    sys.showFloatingTip('第 3 步：弹出参数设置界面，逐步恢复发电机相位并复位继电器', 4000);
                    await sleep(1200);
                    // ① 第一次弹出参数设置界面：将相位恢复到 -6°（逆功率减小）
                    await _demoSetPhase(this, 'ac2', -6);
                    await sleep(2000);   // 观察逆功率读数减小
                    // ② 第二次弹出参数设置界面：恢复至 +12°（超前，重新输出正功率）
                    await _demoSetPhase(this, 'ac2', 12);
                    await sleep(3000);   // 观察功率方向恢复为"正"
                    // ③ 复位按钮动态演示：箭头指示 → 模拟点击复位
                    const rb = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('reset-btn') : null;
                    if (rb) { await this._flashArrow(rb); }
                    sys.showFloatingTip('👉 点击复位按钮，将继电器从跳闸保持状态复归', 3200);
                    await sleep(1000);
                    if (rp) rp.reset();
                    sys.showFloatingTip('✅ 复归完成：NC 重新闭合、信号灯再次点亮，方向显示"正"', 4000);
                    await sleep(2000);
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    return rp && !rp.isTripped();
                },
            },
            {
                msg: '第 4 步：逆功率继电器模拟测试——调换电流线圈的接线方向（电流从 I- 进、I+ 出）。此时发电机实际输出正功率（超前母线），但继电器测得功率方向反转，显示为"逆功率"。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const rp = sys.comps['rp'];
                    sys.showFloatingTip('第 4 步：调换电流线圈接线方向（I- 进、I+ 出），模拟反向接入测试', 4500);
                    await sleep(1200);
                    if (rp) rp.reset();          // 确保继电器处于正常（复位）状态
                    // ① 淡出删除两条旧线（同步电抗 → I+、I- → 发电机正极）
                    sys.showFloatingTip('拆除连线：同步电抗 → 电流线圈 I+', 2000);
                    await sleep(600);
                    await _fadeOutWire(sys, { from: 'xs_wire_r', to: 'rp_wire_ip', type: 'wire' });
                    await sleep(800);
                    sys.showFloatingTip('拆除连线：电流线圈 I- → 发电机正极', 2000);
                    await sleep(600);
                    await _fadeOutWire(sys, { from: 'rp_wire_in', to: 'ac2_wire_p', type: 'wire' });
                    await sleep(800);
                    // ② 动画接入两条新线（反向接线：同步电抗 → I-、I+ → 发电机正极）
                    sys.showFloatingTip('重新接线：同步电抗 → 电流线圈 I-（电流从 I- 进）', 2600);
                    await sys.connMgr.addConnectionAnimated({ from: 'xs_wire_r', to: 'rp_wire_in', type: 'wire' });
                    await sleep(600);
                    sys.showFloatingTip('重新接线：电流线圈 I+ → 发电机正极（电流从 I+ 出）', 2600);
                    await sys.connMgr.addConnectionAnimated({ from: 'rp_wire_ip', to: 'ac2_wire_p', type: 'wire' });
                    await sleep(3000);   // 等待功率稳定
                    // ③ 闪烁箭头指出"方向"指示变化
                    const dir = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('dir') : null;
                    if (dir) { await this._flashArrow(dir); }
                    sys.showFloatingTip('👉 反向接线后：发电机实际输出正功率，但继电器测得"逆功率"（方向显示"逆"）', 4800);
                    await sleep(2200);
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return rp
                        && c('xs_wire_r', 'rp_wire_in')   // 电流反向：I- 进
                        && c('rp_wire_ip', 'ac2_wire_p')  // 电流反向：I+ 出
                        && rp.getPower() < 0;             // 实际正功率，测得逆功率
                },
            },
            {
                msg: '第 5 步：将发电机电源 ac2 相位调为 +18°（发电机超前母线，实际输出正功率增大）。因电流线圈反向，继电器测得的逆功率超过 32kW 动作值，经固定 10s 延时后动作跳闸（NO 闭合、NC 断开），证明逆功率继电器功能完好。',
                mode: 'check',
                async act() {
                    const sys = this.sys;
                    const rp = sys.comps['rp'];
                    sys.showFloatingTip('第 5 步：弹出参数设置界面，将发电机相位调为 +18°，验证逆功率保护功能', 4000);
                    await sleep(1200);
                    // ① 弹出参数设置界面，逐步演示设置初相位 +18°
                    await _demoSetPhase(this, 'ac2', 18);
                    await sleep(500);
                    // ② 箭头指示延时过程（定时限 10s 倒计时）
                    for (let k = 0; k < 3; k++) {
                        const cd = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('cd') : null;
                        if (cd) { await this._flashArrow(cd); }
                        sys.showFloatingTip('⏱ 反向接线测得逆功率超 32kW 动作值，定时限延时 10s 倒计时中…', 3200);
                        await sleep(1500);
                    }
                    await sleep(2000);   // 确保 10s 延时结束、完成跳闸
                    // ③ 箭头指示触点动作过程
                    const ct = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('contact') : null;
                    if (ct) { await this._flashArrow(ct); }
                    sys.showFloatingTip('⚡ 延时结束，触点动作：NC 断开、NO 闭合 → 信号灯熄灭，TRIP 指示灯亮', 4500);
                    await sleep(2200);
                    const led = rp && rp.getClickablePartCenter ? rp.getClickablePartCenter('trip-led') : null;
                    if (led) { await this._flashArrow(led); }
                    sys.showFloatingTip('🔴 TRIP 指示灯亮：逆功率继电器功能完好，可靠动作', 3500);
                    await sleep(1500);
                },
                check() {
                    const rp = this.sys.comps['rp'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return rp
                        && c('xs_wire_r', 'rp_wire_in')
                        && c('rp_wire_ip', 'ac2_wire_p')
                        && rp.isTripped();
                },
            },
            {
                msg: '第 6 步：逆功率继电器知识测试。',
                mode: 'quiz',
                quizConfig: {
                    question: '逆功率继电器主要用于保护什么设备？',
                    options: [
                        '发电机（防止发电机从电网吸收功率转为电动机运行）',
                        '变压器（防止过载）',
                        '电动机（防止堵转）',
                        '线路（防止短路）',
                    ],
                    answer: 0,
                    analysis: '当并网运行的发电机因汽轮机（原动机）故障而失去原动力时，发电机将从电网吸收有功功率转为电动机运行，此时电网向发电机倒送功率（逆功率）。若不及时切除发电机，将导致汽轮机叶片过热损坏。逆功率继电器检测到逆功率超过整定值并经延时后，动作跳闸，将发电机从电网中解列。',
                },
            },
        ],
    },
};

export const componentConfigs = [
    // 母线电源（电网）
    { Class: ACPower, id: 'ac1', x: 60, y: 40, vRms: 220, freq: 50, phase: 0, label: '母线', isOn: true, visible: true },
    // 同步电抗（发电机内阻抗 Xs）
    { Class: Inductor, id: 'xs', x: 300, y: 320, inductance: 0.0005, rotation: 90, visible: true },
    // 发电机电源（可调相位 δ）
    { Class: ACPower, id: 'ac2', x: 60, y: 420, vRms: 220, freq: 50, phase: 0, label: '发电机', isOn: true, visible: true },
    // 公共地：两电源负极与继电器 U- 分别接地，减少中性线互连
    { Class: Ground, id: 'gnd1', x: 120, y: 260, visible: true },
    { Class: Ground, id: 'gnd2', x: 120, y: 660, visible: true },
    { Class: Ground, id: 'gnd3', x: 420, y: 360, visible: true },
    // 逆功率继电器
    { Class: ReversePowerRelay, id: 'rp', x: 520, y: 200, ratedPower: 400, actionRatio: 8, tMax: 10, tMin: 0.5, curveN: 2, sign: -1, visible: true },
    // 触点控制回路：DC 电源 + 信号灯（NO 断开 / NC 闭合）
    { Class: DCPower, id: 'dc', x: 1120, y: 120, voltage: 24, isOn: true, visible: true },
    { Class: LED, id: 'lamp1', x: 850, y: 280, color: 'red', visible: true },
    { Class: Resistor, id: 'rl', x: 980, y: 280, value: 2200, rotation: 0, visible: true },

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
];

// ─── 自动演示辅助函数（show 模式动画） ───

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 逐条（按回路分组并行）动画接线，每根线都有连线动画，用于第 1 步演示 */
async function _autoWireAnimated(wf) {
    const sys = wf.sys;
    sys.conns.length = 0;      // 清空现有连线，从零开始演示
    sys.redrawAll();
    const groups = [
        {
            tip: '① 主回路：母线正极 → 同步电抗 xs → 电流线圈 I+ / I- → 发电机正极',
            cons: [['ac1_wire_p', 'xs_wire_l'], ['xs_wire_r', 'rp_wire_ip'], ['rp_wire_in', 'ac2_wire_p']],
        },
        {
            tip: '② 公共地：两电源负极与电压线圈 U- 分别接地',
            cons: [['ac1_wire_n', 'gnd1_wire_gnd'], ['ac2_wire_n', 'gnd2_wire_gnd'], ['rp_wire_un', 'gnd3_wire_gnd']],
        },
        {
            tip: '③ 电压回路：母线正极 → 电压线圈 U+（并联测量母线电压）',
            cons: [['ac1_wire_p', 'rp_wire_up']],
        },
        {
            tip: '④ 触点控制回路：DC+ → 常闭触点 NC → 信号灯 → 限流电阻 → DC-',
            cons: [['dc_wire_p', 'rp_wire_NC'], ['rp_wire_COM', 'lamp1_wire_l'], ['lamp1_wire_r', 'rl_wire_l'], ['rl_wire_r', 'dc_wire_n']],
        },
    ];
    for (const g of groups) {
        sys.showFloatingTip(g.tip, 3200);
        await sleep(1200);
        await Promise.all(g.cons.map(([from, to]) =>
            sys.connMgr.addConnectionAnimated({ from, to, type: 'wire' })
        ));
    }
    sys.redrawAll();
}

/** 淡出删除一条连线（动画），用于第 4 步调换接线演示 */
async function _fadeOutWire(sys, conn) {
    await new Promise((resolve) => {
        const key = sys.connMgr.connKeyCanonical(conn);
        const node = sys.wireNodes ? sys.wireNodes.find(n => n.getAttr('connKey') === key) : null;
        if (!node) { resolve(); return; }
        node.to({
            opacity: 0, duration: 0.5,
            onFinish: () => { sys.connMgr.removeConn(conn); resolve(); },
        });
    });
}

/** 打开组件配置对话框，逐步演示参数设置过程并自动保存（第 2/5 步演示用） */
async function _demoSetPhase(wf, compId, targetDeg) {
    const sys = wf.sys;
    const comp = sys.comps[compId];
    if (!comp) return;
    comp.showConfigDialog();                 // ① 弹出参数设置界面
    await sleep(600);
    const input = document.getElementById('diag_phaseDeg');
    const modal = input ? input.closest('div[style*="position: fixed"]') : null;
    if (input) {
        // ② 高亮"初相位"输入框，模拟填写目标值
        await wf._flashDomElement(input, `请将发电机初相位改为 ${targetDeg}°`, 2400);
        input.value = targetDeg;
    }
    if (modal) {
        // ③ 高亮"保存"按钮并模拟点击确认
        const saveBtn = [...modal.querySelectorAll('button')].find(b => b.textContent.indexOf('保存') !== -1);
        if (saveBtn) {
            await wf._flashDomElement(saveBtn, '点击「保存」确认参数修改', 1800);
            saveBtn.click();
        }
    }
    await sleep(400);
}

// ─── 接线辅助 ───

function _autoWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：母线 ac1 → 同步电抗 xs → 继电器电流线圈 I+/I- → 发电机 ac2
        { from: 'ac1_wire_p', to: 'xs_wire_l', type: 'wire' },
        { from: 'xs_wire_r', to: 'rp_wire_ip', type: 'wire' },
        { from: 'rp_wire_in', to: 'ac2_wire_p', type: 'wire' },
        // 公共地：ac1 负极 / ac2 负极 / rp U- 分别接地
        { from: 'ac1_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac2_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'rp_wire_un', to: 'gnd3_wire_gnd', type: 'wire' },
        // 电压线圈并联于母线
        { from: 'ac1_wire_p', to: 'rp_wire_up', type: 'wire' },
        // 触点控制回路：DC+ → NC → 灯 → 限流电阻 → DC-
        { from: 'dc_wire_p', to: 'rp_wire_NC', type: 'wire' },
        { from: 'rp_wire_COM', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'dc_wire_n', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    sys.redrawAll();
}

/** 模拟测试接线：主回路电流线圈反向（I- 进、I+ 出），其余回路不变 */
function _reverseWire(sys) {
    sys.conns.length = 0;
    const cons = [
        // 主回路：母线 ac1 → 同步电抗 xs → 继电器电流线圈（反向：I- 进、I+ 出）→ 发电机 ac2
        { from: 'ac1_wire_p', to: 'xs_wire_l', type: 'wire' },
        { from: 'xs_wire_r', to: 'rp_wire_in', type: 'wire' },
        { from: 'rp_wire_ip', to: 'ac2_wire_p', type: 'wire' },
        // 公共地：ac1 负极 / ac2 负极 / rp U- 分别接地
        { from: 'ac1_wire_n', to: 'gnd1_wire_gnd', type: 'wire' },
        { from: 'ac2_wire_n', to: 'gnd2_wire_gnd', type: 'wire' },
        { from: 'rp_wire_un', to: 'gnd3_wire_gnd', type: 'wire' },
        // 电压线圈并联于母线
        { from: 'ac1_wire_p', to: 'rp_wire_up', type: 'wire' },
        // 触点控制回路：DC+ → NC → 灯 → 限流电阻 → DC-
        { from: 'dc_wire_p', to: 'rp_wire_NC', type: 'wire' },
        { from: 'rp_wire_COM', to: 'lamp1_wire_l', type: 'wire' },
        { from: 'lamp1_wire_r', to: 'rl_wire_l', type: 'wire' },
        { from: 'rl_wire_r', to: 'dc_wire_n', type: 'wire' },
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
    const ac1 = sys.comps['ac1'];
    const ac2 = sys.comps['ac2'];
    if (ac1) ac1.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 0, isOn: true });
    if (ac2) ac2.onConfigUpdate({ vRms: 220, freq: 50, phaseDeg: 12, isOn: true });
}

export function fiveStep() {
}
