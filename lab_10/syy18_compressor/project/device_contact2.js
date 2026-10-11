// 接触器特性测试仿真工程 — 5个操作项目
// 电路：AC L → 开关 → 功率计(IP→IN) → 接触器线圈A1，AC N → 接触器线圈A2

import { ACPower } from '../components/ACPower.js';
import { DCPower } from '../components/DCPower.js';
import { Switch } from '../components/Switch.js';
import { ThreePhaseContactor } from '../components/ThreePhaseContactor.js';
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { ContactCurveDisplay } from '../components/ContactCurveDisplay.js';

export const FAULT_CONFIGS = {
    stuck: {
        id: 'stuck', name: '卡死', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultStuck; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultStuck = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultStuck = false; },
    },
    coil_open: {
        id: 'coil_open', name: '线圈断线', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultCoilOpen; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultCoilOpen = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultCoilOpen = false; },
    },
    shading_ring: {
        id: 'shading_ring', name: '短路环脱落', system: '接触器',
        check()  { const c = window.sys && window.sys.comps && window.sys.comps.km1; return c && c._faultShadingRing; },
        trigger() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultShadingRing = true; },
        repair() { const c = window.sys && window.sys.comps && window.sys.comps.km1; if (c) c._faultShadingRing = false; },
    },
};

export const PROJECT_WORKFLOWS = {

    // ============================================================
    // 项目1：接触器线圈电阻和电感
    // ============================================================
    'coil-params': {
        id: 'coil-params',
        name: '1. 接触器线圈电阻和电感',
        steps: [
            {
                msg: '第 1 步：接通交流电源（220V/50Hz），串联数字功率计测量线圈稳态工作电流。接线：交流电源L→开关左端→开关右端→功率计I+→功率计I-→线圈A1；交流电源N→线圈A2。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const ac = sys.comps['ac1'];
                    const sw = sys.comps['sw1'];
                    const em = sys.comps['elecmeter'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    if (sw) sw.isOn = false;
                    await new Promise(r => setTimeout(r, 200));
                    const cons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    if (em) { em.group.position({ x: 700, y: 100 }); em.group.visible(true); }
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
                    if (sw) sw.isOn = true;
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    const em = this.sys.comps['elecmeter'];
                    const ac = this.sys.comps['ac1'];
                    return km && km.getState() === 'on'
                        && em && em.group.isVisible()
                        && ac && ac.isOn
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：测试题',
                mode: 'quiz',
                quizConfig: {
                    question: '交流接触器线圈在吸合后的稳态阻抗（模）约为多少？\n（提示：电源电压220V/50Hz，观察功率计电流读数 I_ac）',
                    options: [
                        'Z ≈ 1012 Ω（气隙最大时开环阻抗）',
                        'Z ≈ 4815 Ω（吸合后稳态阻抗）',
                        'Z ≈ 500 Ω',
                        'Z ≈ 2000 Ω',
                    ],
                    answer: 1,
                    analysis: '吸合后气隙最小，电感最大（L_closed ≈ 15H），感抗 XL = 2πfL ≈ 4712Ω，Z = √(R² + XL²) = √(1000² + 4712²) ≈ 4815Ω，I = 220/4815 ≈ 0.046A。',
                },
            },
            {
                msg: '第 3 步：断开交流电源，接通直流电源（220V），串联功率计测量直流稳态工作电流。接线：直流电源+→开关左端→开关右端→功率计I+→I-→线圈A1；直流电源-→线圈A2。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const ac = sys.comps['ac1'];
                    const sw = sys.comps['sw1'];
                    if (ac) ac.onConfigUpdate({ isOn: false });
                    if (sw) sw.isOn = false;
                    await new Promise(r => setTimeout(r, 300));
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'dc1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'dc1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const dc = sys.comps['dc1'];
                    if (dc) { dc.isOn = true; dc.update(); }
                    if (sw) sw.isOn = true;
                    const em = sys.comps['elecmeter'];
                    if (em) em.group.visible(true);
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    const dc = this.sys.comps['dc1'];
                    const em = this.sys.comps['elecmeter'];
                    return km && km.getState() === 'on'
                        && dc && dc.isOn
                        && em && em.group.isVisible()
                        && c('dc1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'km1_wire_a1')
                        && c('dc1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 4 步：测试题',
                mode: 'quiz',
                quizConfig: {
                    question: '交流接触器线圈的直流电阻约为多少？\n（提示：直流电源220V，观察功率计电流读数 I_dc）',
                    options: [
                        'R ≈ 500 Ω',
                        'R ≈ 1000 Ω（I_dc ≈ 0.22A，R = V/I）',
                        'R ≈ 2000 Ω',
                        'R ≈ 1500 Ω',
                    ],
                    answer: 1,
                    analysis: '直流稳态时电感相当于短路（dI/dt=0），只有电阻起作用。I_dc = V/R = 220/1000 = 0.22A，故 R = V/I = 220/0.22 = 1000Ω。',
                },
            },
            {
                msg: '第 5 步：测试题',
                mode: 'quiz',
                quizConfig: {
                    question: '交流接触器线圈吸合后的电感 L 约为多少？\n（提示：已知 Z = √(R² + (2πfL)²)，R = 1000Ω，Z ≈ 4815Ω，f = 50Hz）',
                    options: [
                        'L ≈ 5 H',
                        'L ≈ 10 H',
                        'L ≈ 15 H',
                        'L ≈ 20 H',
                    ],
                    answer: 2,
                    analysis: '由 Z² = R² + (2πfL)² 可得 L = √(Z² - R²) / (2πf) = √(4815² - 1000²) / (314) ≈ 4712/314 ≈ 15H。吸合后气隙极小，磁路磁阻小，电感最大。',
                },
            },
        ],
    },

    // ============================================================
    // 项目2：接触器起动电流和保持电流
    // ============================================================
    'start-hold-current': {
        id: 'start-hold-current',
        name: '2. 接触器起动电流和保持电流',
        steps: [
            {
                msg: '第 1 步：设置接触器卡死故障（勾选故障面板「卡死」），按项目1接线串联数字功率计，接通交流电源。观察卡死状态下的电流（≈起动瞬间的冲击电流）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const km = sys.comps['km1'];
                    if (km) km._faultStuck = true;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const ac = sys.comps['ac1'];
                    const sw = sys.comps['sw1'];
                    const em = sys.comps['elecmeter'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
                    if (sw) sw.isOn = true;
                    if (em) { em.group.position({ x: 700, y: 100 }); em.group.visible(true); }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    const em = this.sys.comps['elecmeter'];
                    const ac = this.sys.comps['ac1'];
                    return km && km._faultStuck
                        && km.getState() === 'off'
                        && em && em.group.isVisible()
                        && ac && ac.isOn
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：排除卡死故障（取消勾选「卡死」），观察接触器自动吸合。功率计电流从大电流（约0.217A）下降至保持电流（约0.046A）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const km = this.sys.comps['km1'];
                    if (km) km._faultStuck = false;
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on';
                },
            },
            {
                msg: '第 3 步：测试题',
                mode: 'quiz',
                quizConfig: {
                    question: '卡死状态下接触器线圈电流为什么比正常吸合后大得多？',
                    options: [
                        '因为卡死后线圈电阻变小',
                        '因为卡死后动衔铁无法闭合，气隙最大，电感最小（L_open ≈ 0.5H），阻抗最小，电流最大（I ≈ 0.217A）',
                        '因为卡死后电源电压升高',
                        '因为卡死后线圈匝间短路',
                    ],
                    answer: 1,
                    analysis: '卡死状态下动衔铁无法吸合，气隙保持最大，电感仅为 L_open ≈ 0.5H，感抗 XL ≈ 157Ω，阻抗 Z ≈ 1012Ω，电流 I ≈ 0.217A。正常吸合后电感增大至约15H，阻抗 Z ≈ 4815Ω，电流仅约0.046A。起动瞬间电流相当于卡死电流。',
                },
            },
        ],
    },

    // ============================================================
    // 项目3：线圈断线故障检测
    // ============================================================
    'coil-open-detect': {
        id: 'coil-open-detect',
        name: '3. 线圈断线故障检测',
        steps: [
            {
                msg: '第 1 步：设置线圈断线故障（勾选故障面板「线圈断线」），按图示接线并接通交流电源。接触器不动作。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const km = sys.comps['km1'];
                    if (km) km._faultCoilOpen = true;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const ac = sys.comps['ac1'];
                    const sw = sys.comps['sw1'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
                    if (sw) sw.isOn = true;
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    return km && km._faultCoilOpen && km.getState() === 'off'
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：调出数字万用表（切换至交流电压档），红表笔接线圈 A1，黑表笔接 A2，测量线圈两端电压。可观察到电压正常（220V），说明电源供电正常。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const mm = sys.comps['multimeter'];
                    if (mm) {
                        mm.group.position({ x: 920, y: 100 });
                        mm.group.visible(true);
                        if (mm.setMode) mm.setMode('ACV');
                    }
                    sys.connMgr.addConn({ from: 'multimeter_wire_v', to: 'km1_wire_a1', type: 'wire' });
                    sys.connMgr.addConn({ from: 'multimeter_wire_com', to: 'km1_wire_a2', type: 'wire' });
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const mm = this.sys.comps['multimeter'];
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    return mm && mm.group.isVisible()
                        && c('multimeter_wire_v', 'km1_wire_a1')
                        && c('multimeter_wire_com', 'km1_wire_a2');
                },
            },
            {
                msg: '第 3 步：用手按压接触器动衔铁区域（模拟手动按压），接触器触发吸合，说明机械部分正常。以上现象可判断为线圈断线。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const km = this.sys.comps['km1'];
                    if (km) { km._momentaryHeld = true; km.update('on'); }
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on' && km._momentaryHeld;
                },
            },
            {
                msg: '第 4 步：排除断线故障（取消勾选「线圈断线」），接触器恢复正常吸合。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const km = this.sys.comps['km1'];
                    if (km) km._faultCoilOpen = false;
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on' && !km._faultCoilOpen;
                },
            },
        ],
    },

    // ============================================================
    // 项目4：短路环脱落故障
    // ============================================================
    'shading-ring-fault': {
        id: 'shading-ring-fault',
        name: '4. 短路环脱落故障',
        steps: [
            {
                msg: '第 1 步：设置短路环脱落故障（勾选故障面板「短路环脱落」）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const km = this.sys.comps['km1'];
                    if (km) km._faultShadingRing = true;
                    await new Promise(r => setTimeout(r, 300));
                },
                check() {
                    const km = this.sys.comps['km1'];
                    return km && km._faultShadingRing;
                },
            },
            {
                msg: '第 2 步：按图示接线并接通交流电源。接触器可以吸合，但会发出明显的振动和噪音（观察到接触器动铁芯抖动、触点闪烁）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const ac = sys.comps['ac1'];
                    const sw = sys.comps['sw1'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
                    if (sw) sw.isOn = true;
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    return km && km._faultShadingRing && km.getState() === 'on'
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 3 步：接入数字功率计（串联在线圈回路中），测量稳态工作电流。可观察到电流偏大（因电感波动导致平均阻抗下降）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'elecmeter_wire_ip', type: 'wire' },
                        { from: 'elecmeter_wire_in', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const em = sys.comps['elecmeter'];
                    if (em) { em.group.position({ x: 700, y: 100 }); em.group.visible(true); }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    const em = this.sys.comps['elecmeter'];
                    return km && km._faultShadingRing && km.getState() === 'on'
                        && em && em.group.isVisible()
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'elecmeter_wire_ip')
                        && c('elecmeter_wire_in', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 4 步：排除短路环脱落故障（取消勾选「短路环脱落」），接触器恢复正常吸合，噪音消失，电流恢复正常。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const km = this.sys.comps['km1'];
                    if (km) km._faultShadingRing = false;
                    await new Promise(r => setTimeout(r, 1500));
                },
                check() {
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on' && !km._faultShadingRing;
                },
            },
        ],
    },

    // ============================================================
    // 项目5：吸力特性和电流特性
    // ============================================================
    'curve-characteristic': {
        id: 'curve-characteristic',
        name: '5. 吸力特性和电流特性',
        steps: [
            {
                msg: '第 1 步：设置卡死故障（勾选「卡死」），接线并接通交流电源。观察特性图上电流工作点（蓝色圆点）和吸力工作点（红色圆点）的位置。卡死时气隙最大（δ≈7mm），电流最大（约0.217A），吸力最小。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const sys = this.sys;
                    const km = sys.comps['km1'];
                    if (km) km._faultStuck = true;
                    sys.conns.length = 0;
                    const cons = [
                        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
                        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
                        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
                    ];
                    cons.forEach(c => sys.connMgr.addConn(c));
                    const ac = sys.comps['ac1'];
                    const sw = sys.comps['sw1'];
                    if (ac) ac.onConfigUpdate({ vRms: 220, freq: 50, isOn: true });
                    if (sw) sw.isOn = true;
                    const cd = sys.comps['curveDisplay'];
                    if (cd) { cd.group.position({ x: 750, y: 200 }); cd.group.visible(true); }
                    sys.redrawAll();
                    await new Promise(r => setTimeout(r, 1000));
                },
                check() {
                    const c = (a, b) => this.sys.isPortConnected(a, b);
                    const km = this.sys.comps['km1'];
                    const cd = this.sys.comps['curveDisplay'];
                    return km && km._faultStuck
                        && cd && cd.group.isVisible()
                        && c('ac1_wire_p', 'sw1_wire_l')
                        && c('sw1_wire_r', 'km1_wire_a1')
                        && c('ac1_wire_n', 'km1_wire_a2');
                },
            },
            {
                msg: '第 2 步：排除卡死故障（取消勾选「卡死」），观察接触器吸合过程。特性图上的电流工作点和吸力工作点随气隙减小而移动：电流减小、吸力增大，最终达到吸合稳态工作点（δ≈0mm，电流≈0.046A，吸力最大）。',
                mode: 'check',
                async act() {
                    await new Promise(r => setTimeout(r, 500));
                    const km = this.sys.comps['km1'];
                    if (km) km._faultStuck = false;
                    await new Promise(r => setTimeout(r, 2000));
                },
                check() {
                    const km = this.sys.comps['km1'];
                    return km && km.getState() === 'on';
                },
            },
        ],
    },
};

export const componentConfigs = [
    { Class: ACPower, id: 'ac1', x: 20, y: 120, vRms: 220, freq: 50, isOn: true, visible: true },
    { Class: DCPower, id: 'dc1', x: 20, y: 420, voltage: 220, isOn: true, visible: true },
    { Class: Switch, id: 'sw1', x: 260, y: 220, visible: true },
    { Class: ThreePhaseContactor, id: 'km1', x: 440, y: 120, visible: true, initState: 'off', coilResistance: 1000 },

    { Class: ContactCurveDisplay, id: 'curveDisplay', x: 1050, y: 100, visible: true},

    { Class: Multimeter, id: 'multimeter', x: 920, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 1050, y: 150, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 700, y: 100, visible: false },
];

function _sameCluster(sys, portA, portB) {
    const solver = sys.voltageSolver;
    if (!solver || !solver.portToCluster) return false;
    return solver.portToCluster.get(portA) === solver.portToCluster.get(portB);
}

function _wireBaseAC(sys) {
    sys.conns.length = 0;
    const cons = [
        { from: 'ac1_wire_p', to: 'sw1_wire_l', type: 'wire' },
        { from: 'sw1_wire_r', to: 'km1_wire_a1', type: 'wire' },
        { from: 'ac1_wire_n', to: 'km1_wire_a2', type: 'wire' },
    ];
    cons.forEach(c => sys.connMgr.addConn(c));
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
    sys.redrawAll();
}

export function initSlider(sys) {
}

export function applyAllPresets() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _wireBaseAC(sys);
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
}

export async function applyStartSystem() {
    const sys = this && this.sys ? this.sys : window.sys;
    if (!sys) return;
    _wireBaseAC(sys);
    const ac = sys.comps['ac1'];
    if (ac) ac.onConfigUpdate({ isOn: true });
    const sw = sys.comps['sw1'];
    if (sw) sw.isOn = true;
}

export function fiveStep() {}
