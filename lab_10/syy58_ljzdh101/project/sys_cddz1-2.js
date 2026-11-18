
import { Multimeter } from '../components/Multimeter.js';
import { MF47Multimeter } from '../components/MF47Multimeter.js';
import { Oscilloscope_tri } from '../components/Osc_tri.js';
import { SignalGenerator } from '../components/SignalGenerator.js';
import { ProcessCalibrator } from '../components/ProcessCalibrator.js';
import { ElecMeter } from '../components/ElecMeter.js';
import { RealMegohmMeter } from '../components/RealMegohmMeter.js';
import { MotorControlBox } from '../components/MotorControlBox.js';
import { GroundBusBar } from '../components/GroundBusBar.js';
import { ThreePhaseMotor3D } from '../components/ThreePhaseMotor3D.js';
import { LowVoltageGroundCable } from '../components/LowVoltageGroundCable.js';



export const FAULT_CONFIGS = {

};

export const PROJECT_WORKFLOWS = {

    // ────────────────────────────────────────────────
    // 操作流程 1：固定式和便携式接地设备的认识
    // ────────────────────────────────────────────────
    'grounding-device-familiarization': {
        id: 'grounding-device-familiarization',
        name: '1. 固定式和便携式接地设备的认识',
        steps: [
            // ── 1. 接地母排 ──
            {
                msg: '第 1 步：请识别【接地母排】',
                mode: 'find', target: 'pe-busbar', subTarget: 'term-bus',
                async act() {
                    this.sys.showFloatingTip('【接地母排】是保护接地系统的总汇流排，PE1~PE4 接线柱汇接各设备 PE 线，母排本体经接地线连至大地参考点，正常时为 0V 等电位基准、不承载工作电流。', 4500);
                    await new Promise(r => setTimeout(r, 1300));
                },
                check() {
                    return this.sys.lastClickedPartId === 'pe-busbar/term-bus';
                },
            },
            // ── 2. 测试题：接地母排 ──
            {
                msg: '第 2 步：测试题——接地母排的特点', mode: 'quiz',
                quizConfig: {
                    question: '关于低压 PE 接地母排，下列说法正确的是？',
                    options: [
                        '用于汇接各设备保护接地线，并经接地线连至大地，正常时不承载工作电流',
                        '用于接通三相负载电流，属于相导体',
                        '必须与中性线断开且不得接任何设备外壳',
                        '接地母排上正常工作时流过全部负载电流',
                    ],
                    answer: 0,
                    analysis: '接地母排是保护接地系统（PE）的汇流排：各电气设备金属外壳的 PE 线集中接到母排上，母排再经接地导体与接地极（大地）相连。正常运行时金属外壳不带电、母排不承载工作电流，仅作等电位 0V 参考；一旦设备漏电，外壳电位被钳至接近大地，并形成故障电流驱动保护跳闸。',
                },
            },
            // ── 3. 控制箱接地排（箱内 PE 铜排） ──
            {
                msg: '第 3 步：请识别【控制箱接地排】',
                mode: 'find', target: 'motor-control-box', subTarget: 'pe-bar',
                async act() {
                    this.sys.showFloatingTip('【控制箱接地排】即控制箱内 PE 接线端子下方的黄绿导铜排，PE1~PE4 端子坐落在其上、内部等电位，作为箱内各 PE 线的汇接地基。', 4500);
                    await new Promise(r => setTimeout(r, 1300));
                },
                check() {
                    return this.sys.lastClickedPartId === 'motor-control-box/pe-bar';
                },
            },
            // ── 4. 箱体 PE 端子 ──
            {
                msg: '第 4 步：请识别【箱体 PE 端子】',
                mode: 'find', target: 'motor-control-box', subTarget: 'pe-body',
                async act() {
                    this.sys.showFloatingTip('【箱体 PE 端子】位于控制箱箱体，用黄绿软线将箱体金属外壳可靠接至 PE 端子排，保证外壳等电位接地。', 4500);
                    await new Promise(r => setTimeout(r, 1300));
                },
                check() {
                    return this.sys.lastClickedPartId === 'motor-control-box/pe-body';
                },
            },
            // ── 5. 柜门 PE 端子 ──
            {
                msg: '第 5 步：请识别【柜门 PE 端子】',
                mode: 'find', target: 'motor-control-box', subTarget: 'pe-terminal',
                async act() {
                    this.sys.showFloatingTip('【柜门 PE 端子】位于控制箱柜门上，用黄绿软线将可开启的柜门接至 PE 端子排——避免柜门打开后失去接地。', 4500);
                    await new Promise(r => setTimeout(r, 1300));
                },
                check() {
                    return this.sys.lastClickedPartId === 'motor-control-box/pe-terminal';
                },
            },
            // ── 6. 测试题：箱体/柜门 PE ──
            {
                msg: '第 6 步：测试题——箱体与柜门 PE 连接的作用', mode: 'quiz',
                quizConfig: {
                    question: '控制箱的箱体 PE 端子和柜门 PE 端子为何都要用黄绿软线接到 PE 端子排？',
                    options: [
                        '箱体与柜门均为可接触的金属导电部分，须可靠接地，开门时柜门仍通过软线保持接地，防止人体触电',
                        '仅为了美观，与安全无关',
                        '让 PE 端子排承载负载电流',
                        'PE 软线只作电气指示，不参与保护',
                    ],
                    answer: 0,
                    analysis: '凡人体易触及的金属外壳（箱体、柜门）都必须做保护接地。柜门是可开启的活动部件，若用硬导线可能随开合疲劳断裂，故采用柔性黄绿软线与 PE 端子排相连，保证在任何开合状态下柜门始终与接地系统等电位，一旦内部带电部件漏电即可经 PE 泄放、避免触电。',
                },
            },
            // ── 7. 电机 PE 端子 ──
            {
                msg: '第 7 步：请识别【电机 PE 端子】',
                mode: 'find', target: 'm-3d', subTarget: 'pe-terminal',
                async act() {
                    this.sys.showFloatingTip('【电机 PE 端子】即电机机座上的黄绿色保护接地端子，经固定黄绿线接到控制箱 PE1，使三相电机外壳可靠接地。', 4500);
                    await new Promise(r => setTimeout(r, 1300));
                },
                check() {
                    return this.sys.lastClickedPartId === 'm-3d/pe-terminal';
                },
            },
            // ── 8. 测试题：固定接地线 ──
            {
                msg: '第 8 步：测试题——固定接地线（PE 线）', mode: 'quiz',
                quizConfig: {
                    question: '固定式（永久性）保护接地线 PE 的标准颜色标识是？其主要作用是？',
                    options: [
                        '黄绿双色；将设备金属外壳与接地系统永久相连，漏电时起保护作用',
                        '蓝色；用于传输工作电流',
                        '红色；用于相线标识',
                        '黑色；仅作地线装饰标识',
                    ],
                    answer: 0,
                    analysis: '按国家标准，保护接地线（PE）采用黄绿双色绝缘。它把设备金属外壳、箱体、柜门、母排可靠地接到保护接地系统，形成等电位连接；当设备绝缘损坏致外壳带电时，PE 线提供低阻抗泄放通路并形成足够的故障电流使保护装置动作切断电源，防止触电。',
                },
            },
            // ── 9. 临时接地线 ──
            {
                msg: '第 9 步：请识别【临时接地线】',
                mode: 'find', target: 'lv-gnd-cable', subTarget: 'clamp-p1',
                async act() {
                    this.sys.showFloatingTip('【临时接地线】即三相短路接地线（便携式）：检修停电时挂接，将三相短接并可靠接地，泄放残余电荷、防止突然来电。', 4500);
                    await new Promise(r => setTimeout(r, 1300));
                },
                check() {
                    return this.sys.lastClickedPartId === 'lv-gnd-cable/clamp-p1';
                },
            },
            // ── 10. 测试题：临时接地线的作用 ──
            {
                msg: '第 10 步：测试题——临时接地线的作用', mode: 'quiz',
                quizConfig: {
                    question: '低压线路停电检修时挂接临时（三相短路）接地线的主要目的是？',
                    options: [
                        '将停电设备及线路三相短接并接地，泄放残余电荷，防止突然来电危及检修人员',
                        '给设备提供工作电压',
                        '作为测量仪表使用',
                        '代替绝缘工具使用',
                    ],
                    answer: 0,
                    analysis: '停电检修虽然断开了电源，但线路上仍可能残留感应电荷、静电或装置未断尽的电荷，且存在误送电（突然来电）的危险。三相短路接地线将三相导线短接并可靠接地，一旦任一相来电即形成接地短路，使保护装置跳闸或人员不触及高电位，从而保证安全。',
                },
            },
            // ── 11. 测试题：挂接与拆除顺序 ──
            {
                msg: '第 11 步：测试题——临时接地线的操作顺序', mode: 'quiz',
                quizConfig: {
                    question: '挂设临时接地线时，正确的操作顺序是？',
                    options: [
                        '先接接地端，后挂导体端；拆除时顺序相反（先拆导体端，后拆接地端）',
                        '先挂导体端，后接接地端；拆除时先拆接地端',
                        '挂接与拆除均无顺序要求',
                        '只需挂导体端，无需接接地端',
                    ],
                    answer: 0,
                    analysis: '挂设时先接接地端、后挂导体端，可保证接地线始终有可靠的接地参考，避免人体先触到尚未接地的导体而触电；拆除时顺序相反，先拆导体端再拆接地端，同样是为了保护操作人员安全。这是检修接地线的标准安全操作规程。',
                },
            },
        ],
    },

};

export const componentConfigs = [
 
    // ── 测量仪表（隐藏，按需显示）──
    { Class: Multimeter, id: 'multimeter', x: 500, y: 100, visible: false },
    { Class: MF47Multimeter, id: 'mf47-panel', x: 650, y: 100, visible: false },
    { Class: Oscilloscope_tri, id: 'osc', x: 50, y: 50, visible: false },
    { Class: SignalGenerator, id: 'sg', x: 50, y: 50, visible: false },
    { Class: ProcessCalibrator, id: 'cali', x: 50, y: 50, visible: false },
    { Class: ElecMeter, id: 'elecmeter', x: 50, y: 50, visible: false },
    // ── 手摇式兆欧表（摇表，2500V 型；隐藏，测试绝缘时按需调出）──
    { Class: RealMegohmMeter, id: 'megohm', x: 200, y: 50, voltage: 2500, label: '手摇兆欧表(2500V)', visible: false },
    // ── 电机控制箱（打开状态，内含供电开关/设备/端子/保护接地）──
    { Class: MotorControlBox, id: 'motor-control-box', x: 120, y: 10, visible: true },
    // ── 接地母排（4 接线柱同簇接地；第 2 柱接电机控制箱 PE4 端）──
    { Class: GroundBusBar, id: 'pe-busbar', x: 1120, y: 760, visible: true },
    // ── 三相异步电动机（3D 立体；三相端口 u/v/w + 机座 PE 端子）──
    //    PE 端子经黄绿导线接电机控制箱 PE1 端
    { Class: ThreePhaseMotor3D, id: 'm-3d', x: 390, y: 750, visible: true },
    // ── 低压临时接地线（三相短路接地线；p1/p2/p3/gnd 四端口内部短接，不自动接线）──
    //    放置在电机附近，供检修时手动挂接三相母线与接地桩
    { Class: LowVoltageGroundCable, id: 'lv-gnd-cable', x: 1280, y: 500, visible: true },

];

// ─── 接线辅助 ───

const _sleep = ms => new Promise(r => setTimeout(r, ms));


// ─── 固定预接线（设备固有保护接地 PE，开机即已接好，不依赖自动接线）───
// custom:'green-yellow' = 采用活动黄绿相间导线（组件移动时自动重绘），不画系统导线
export const PREWIRED_CONNS = [
    // 接地母排第 2 柱 ↔ 电机控制箱 PE 第 4 端（pe4）
    { from: 'pe-busbar_wire_pe2', to: 'motor-control-box_wire_pe4', type: 'wire', custom: 'green-yellow' },
    // 电机机座 PE 端子 ↔ 电机控制箱 PE 第 1 端（pe1）
    { from: 'm-3d_wire_pe', to: 'motor-control-box_wire_pe1', type: 'wire', custom: 'green-yellow' },
];

/** 系统初始化时建立固定预接线（PE 保护接地，开机即导通并显示黄绿线） */
export function applyPrewired(sys) {
    if (!sys) return;
    PREWIRED_CONNS.forEach(c => sys.connMgr.addConn(c));
}



function _autoWire(sys) {
    // 保留固定预接线（custom 标记，开机已由 applyPrewired 建立），
    // 仅清空其余可动接线，避免自动接线破坏 PE 保护接地回路
    const keep = (sys.conns || []).filter(c => c.custom);
    sys.conns.length = 0;
    sys.conns.push(...keep);

    const cons = [
        // 电机三相进线：U/V/W ↔ 电机控制箱出线端（out1/out2/out3）
        { from: 'm-3d_wire_u', to: 'motor-control-box_wire_out1', type: 'wire' },
        { from: 'm-3d_wire_v', to: 'motor-control-box_wire_out2', type: 'wire' },
        { from: 'm-3d_wire_w', to: 'motor-control-box_wire_out3', type: 'wire' },
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
 
}

export function fiveStep() {
}
