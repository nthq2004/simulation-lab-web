/**
 * WorkflowManager - 流程与故障管理模块
 * 负责项目操作流程定义（stepsArray）、故障配置（FAULT_CONFIG）、
 * 流程切换、一键连线、系统启动、5点步进等业务逻辑
 */
export class WorkflowManager {
    /**
     * @param {object} sys - ControlSystem 实例
     */
    constructor(sys) {
        this.sys = sys;
        sys.requiredPipes = [

        ];
    }

    // ==========================================
    // 1. 流程初始化：填充下拉框 + 定义所有步骤
    // ==========================================
    initSteps() {
        const sys = this.sys;

        const projectConfigs = [
            { id: 0, name: "1. PID调节器接线及功能(项目7.4)" },
            { id: 1, name: "2. PID调节器的参数调节(项目7.4)" },
        ];

        const taskSelect = document.getElementById('taskSelect');
        if (taskSelect) {
            taskSelect.innerHTML = '<option value="" selected>请选择操作项目...</option>';
            projectConfigs.forEach(proj => {
                const opt = document.createElement('option');
                opt.value = proj.id;
                opt.textContent = proj.name;
                taskSelect.appendChild(opt);
            });
        }

        const conns = [
            // --- 1. PID 调节器工作电源回路 ---
            // 24V 直流电源正极 (P) -> PID 供电输入正极 (VCC)
            { from: 'dcpower_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            // 24V 直流电源负极 (N) -> PID 供电输入负极 (GND)
            { from: 'dcpower_wire_n', to: 'pid_wire_gnd', type: 'wire' },

            // --- 2. 传感器信号输入 (Pt100 三线制模拟) ---
            // 可变电阻左端 -> 温度变送器热电阻输入 A 端
            { from: 'varires_wire_l', to: 'temptr_wire_l', type: 'wire' },
            // 可变电阻右端 -> 同时接入变送器 B 端与 C 端 (实现三线制引线电阻补偿模拟)
            { from: 'varires_wire_r', to: 'temptr_wire_m', type: 'wire' },
            { from: 'varires_wire_r', to: 'temptr_wire_r', type: 'wire' },

            // --- 3. 测量反馈电流环路 (二线制变送器接法) ---
            // PID 内部配电输出正极 (PI1) -> 电流表1正极 (用于监测测量值 PV)
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            // 电流表1负极 -> 温度变送器信号正极 (串联进入环路)
            { from: 'ampmeter_wire_n', to: 'temptr_wire_p', type: 'wire' },
            // 温度变送器信号负极 -> PID 测量信号输入负极 (NI1)，完成测量电流闭环
            { from: 'temptr_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 4. 控制输出驱动环路 (PID 输出驱动执行器) ---
            // PID 控制信号输出正极 (PO1) -> 电流表2正极 (用于监测输出值 MV)
            { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' },
            // 电流表2负极 -> 电动阀门控制信号输入正极
            { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' },
            // 电动阀门信号负极 -> 返回 PID 控制信号输出负极 (NO1)，完成控制电流闭环
            { from: 'valve_wire_r', to: 'pid_wire_no1', type: 'wire' }
        ];
        sys.stepsArray[0] = [
            // --- 第一部分：基础电路建立 (1-4步) ---
            {
                msg: "步骤 1：建立控制系统供电回路 (24V -> PID)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[0]); // P -> VCC
                    await sys.addConnectionAnimated(conns[1]); // N -> GND
                },
                check: () => sys.conns.some(c => sys._connEqual(c, conns[0])) &&
                    sys.conns.some(c => sys._connEqual(c, conns[1]))
            },
            {
                msg: "步骤 2：接通24V电源，便于观察输入、输出接线过程中的变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.dcpower.isOn === true
            },
            {
                msg: "步骤 3：连接 Pt100 传感器模拟输入 (三线制连接)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[2]); // L -> L
                    await sys.addConnectionAnimated(conns[3]); // R -> M
                    await sys.addConnectionAnimated(conns[4]); // R -> R
                },
                check: () => [2, 3, 4].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 4：连接测量反馈回路 (PID配电 -> 电流表1 -> 变送器 -> PID输入)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[5]); // PI1 -> Amp1
                    await sys.addConnectionAnimated(conns[6]); // Amp1 -> TempTr+
                    await sys.addConnectionAnimated(conns[7]); // TempTr- -> NI1
                },
                check: () => [5, 6, 7].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 5：连接控制输出回路 (PID输出 -> 电流表2 -> 电动阀门 -> 回路闭合)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[8]);  // PO1 -> Amp2
                    await sys.addConnectionAnimated(conns[9]);  // Amp2 -> Valve+
                    await sys.addConnectionAnimated(conns[10]); // Valve- -> NO1
                },
                check: () => [8, 9, 10].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },

            // --- 第二部分：理论考核 (第5步) ---
            {
                msg: "步骤 6：PID调节器的SV和PV分别代表什么含义？",
                mode: "quiz",
                quizConfig: {
                    question: "在当前 PID 温度控制系统中，SV 和 PV 分别代表什么含义？",
                    options: [
                        "SV 是测量值(电流)，PV 是设定值(温度)",
                        "SV 是设定值(目标温度)，PV 是过程测量值(反馈温度)",
                        "SV 是阀门开度，PV 是电源电压",
                        "SV 是输出电流，PV 是电阻阻值"
                    ],
                    answer: 1,
                    analysis: "SV (Setpoint Value) 是我们希望系统达到的目标值；PV (Process Value) 是传感器实时采集到的测量值。"
                },
                check: () => true
            },

            // --- 第三部分：动态操作演示 (6-7步) ---
            {
                msg: "步骤 7：演示测量值变化：调节可变电阻至 119.25Ω，观察测量电流变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 119.4; // 对应约 50°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 119.4Ω (50°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 119.25) < 0.5
            },
            {
                msg: "步骤 8：演示输出变量变化：将 PID 切换至手动，设置输出为 60%，观察输出电流变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    if (pid) {
                        pid.mode = 'MAN'; // 切换手动
                        pid.OUT = 60; // 设置输出 60%
                        sys.showFloatingTip("PID 切换至手动模式，输出已设为 60%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查 PID 输出是否为 60
                check: () => Math.abs(sys.comps['pid'].OUT - 60) < 1
            }
        ];
        sys.stepsArray[1] = [
            // --- 1. 初始化检查 ---
            {
                msg: "步骤 1：系统初始化。检查所有电路连接完整，并确保 24V 直流电源已合上。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    // 自动补全接线
                    for (const conn of conns) {
                        if (!sys.conns.some(c => sys._connEqual(c, conn))) {
                            await sys.addConnectionAnimated(conn);
                        }
                    }
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps.dcpower.isOn && conns.every(conn => sys.conns.some(c => sys._connEqual(c, conn)))
            },

            // --- 2. 模式切换 ---
            {
                msg: "步骤 2：将 PID 调节器设置为‘自动’(AUTO)模式，准备进入闭环控制。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    if (pid) {
                        pid.mode = 'AUTO';
                    }
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => sys.comps['pid'].mode === 'AUTO'
            },

            // --- 3. 平衡状态演示 ---
            {
                msg: "步骤 3：模拟平衡状态。调节电阻至 123.11Ω (对应 60℃)。此时测量值=设定值，观察输出:OUT =50, 输出电流12mA。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    if (varires) {
                        varires.currentResistance = 123.11;
                        varires.update();
                    }
                    sys.showFloatingTip("PV=SV，系统处于平衡态。OUT=50%, I=12mA", 5000);
                    await new Promise(r => setTimeout(r, 5000));
                },
                check: () => Math.abs(sys.comps['varires'].currentResistance - 123.11) < 0.3 && Math.abs(sys.comps['ampmeter2'].value - 12) < 0.1
            },

            // --- 4. 比例作用演示 (产生偏差) ---
            {
                msg: "步骤 4：产生负偏差。将电阻调至 119.25Ω (对应 50℃)。观察比例作用下的输出跃变。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    if (varires) {
                        varires.currentResistance = 119.25;
                        varires.update();
                    }
                    sys.showFloatingTip("偏差增大到10度，PID输出跳变至 90%, I=18.4mA", 5000);
                    await new Promise(r => setTimeout(r, 5000));
                },
                check: () => Math.abs(sys.comps['ampmeter2'].value - 18.4) < 0.2
            },

            // --- 5. 比例系数 P 的影响 ---
            {
                msg: "步骤 5：调节比例带。将 P 参数从 4 调至 3，观察输出如何随比例作用减弱而减小。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    if (pid) {
                        pid.P = 3;
                    }
                    sys.showFloatingTip("P值减小(比例作用减弱)，输出回落至 80%, I=16.8mA", 6000);
                    await new Promise(r => setTimeout(r, 6000));
                },
                check: () => Math.abs(sys.comps['pid'].P - 3) < 1 && Math.abs(sys.comps['ampmeter2'].value - 16.8) < 0.2
            },

            // --- 6. 积分参数设置 ---
            {
                msg: "步骤 6：引入积分作用。将积分时间 (Ti) 设置为 20s，用于消除系统静差。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    if (pid) {
                        pid.I = 20;
                    }
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(sys.comps['pid'].I - 20) < 2
            },

            // --- 7. 积分作用考核 ---
            {
                msg: "步骤 7：积分特性考核:积分作用(I)的主要职能,积分时间 Ti的含义。",
                mode: "quiz",
                quizConfig: {
                    question: "在 PID 调节中，积分作用(I)的主要职能是什么？积分时间 Ti 越小意味着什么？",
                    options: [
                        "消除静差；Ti 越小积分作用越强",
                        "加快响应速度；Ti 越小积分作用越弱",
                        "防止超调；Ti 越小积分作用越强",
                        "抑制干扰；Ti 越小积分作用越弱"
                    ],
                    answer: 0,
                    analysis: "积分作用的主要目的是消除静差。积分时间 Ti 是在积分项前面的分母位置（或代表重复时间），Ti 越小，积分速度越快，作用越强。"
                },
                check: () => true
            },

            // --- 8. 微分参数设置 ---
            {
                msg: "步骤 8：引入微分作用。将微分时间 (Td) 设置为 5s，增强系统的预见性。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    if (pid) {
                        pid.D = 5;
                    }
                    await new Promise(r => setTimeout(r, 2000));
                },
                check: () => Math.abs(sys.comps['pid'].D - 5) < 1
            },

            // --- 9. 微分作用考核 ---
            {
                msg: "步骤 9：微分特性考核：微分作用(D)的主要功能。",
                mode: "quiz",
                quizConfig: {
                    question: "微分作用(D)在控制系统中通常起什么作用？",
                    options: [
                        "消除测量噪声的干扰",
                        "在偏差变化剧烈时产生超前调节，抑制超调",
                        "彻底消除系统进入稳态后的余差",
                        "降低系统的整体响应速度以求稳定"
                    ],
                    answer: 1,
                    analysis: "微分作用是根据偏差的变化率进行调节的，具有“超前控制”的特点，能改善系统的动态特性，减小超调量。"
                },
                check: () => true
            },
            // --- 10. 比例带和比例系数概念分辨 ---
            {
                msg: "步骤 10：概念辨析：比例带 (PB)调小， 与比例系数 (Kp) 调大，对控制过程有什么影响？",
                mode: "quiz",
                quizConfig: {
                    question: "在工业 PID 调节器中，如果将“比例带 (PB)”数值调小，或者将“比例系数 (Kp)”数值调大，对系统控制效果的影响是：",
                    options: [
                        "都会使控制作用变得更温和，响应变慢",
                        "都会使控制作用变得更灵敏、更剧烈",
                        "比例带调小使控制变剧烈，比例系数调大使控制变温和",
                        "两者互为倒数，调小比例带等同于调小比例系数"
                    ],
                    answer: 1,
                    analysis: "比例系数 Kp 越大响应越猛；而比例带 PB 表示使输出改变 100% 所需的偏差范围，带子越‘窄’（数值越小），说明微小的偏差就能引起巨大的输出变化，因此两者在逻辑上是同向的激进调节。"
                },
                check: () => true
            }
        ];

    }

    // ==========================================
    // 2. 故障初始化
    // ==========================================
    initFault() {
        const sys = this.sys;

        sys.FAULT_CONFIG = {
            1: {
                id: 1,
                name: "本项目无故障设置. ",
                trigger: () => { },
                check: () => { },
                repair: () => { }
            },
        };

        const faultForm = document.getElementById('faultForm');
        if (faultForm) {
            faultForm.innerHTML = '';
            Object.values(sys.FAULT_CONFIG).forEach(fault => {
                const label = document.createElement('label');
                label.className = 'f-checkbox';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = fault.id;
                checkbox.id = `fault_check_${fault.id}`;
                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(` ${fault.name}`));
                faultForm.appendChild(label);
            });
        }
    }

    // ==========================================
    // 3. 流程切换与控制
    // ==========================================

    /** 项目选择框调用的函数，用于切换任务流程 */
    switchWorkflow(taskValue) {
        const sys = this.sys;
        if (!taskValue) {
            console.log("未选择任何任务，清空流程数据");
            sys.workflowComp._workflow = [];
            sys.workflowComp._workflowIdx = 0;
            if (sys.workflowComp._workflowPanelEl) {
                sys.workflowComp.closeWorkflowPanel();
            }
            return;
        }
        console.log("切换至任务:", taskValue);
        sys.workflowComp._workflow = sys.stepsArray[taskValue];
        sys.workflowComp._workflowIdx = 0;
        if (sys.workflowComp._workflowPanelEl) {
            sys.workflowComp.closeWorkflowPanel();
        }
    }

    /** 根据用户选择的方式（单步/完整/评估/演练）打开流程面板 */
    openWorkflowPanel(mode) {
        const sys = this.sys;
        if (mode === 'step') {
            sys.workflowComp.stepByStep();
        } else {
            sys.workflowComp.openWorkflowPanel(mode);
        }
    }

    // ==========================================
    // 4. 快捷操作
    // ==========================================

    /** 一键自动连线：将预设的逻辑关系注入连接池 */
    applyAllPresets() {
        const sys = this.sys;
        // 1. 定义预设连接关系
        sys.conns = [
            // --- 1. PID 调节器工作电源回路 ---
            // 24V 直流电源正极 (P) -> PID 供电输入正极 (VCC)
            { from: 'dcpower_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            // 24V 直流电源负极 (N) -> PID 供电输入负极 (GND)
            { from: 'dcpower_wire_n', to: 'pid_wire_gnd', type: 'wire' },

            // --- 2. 传感器信号输入 (Pt100 三线制模拟) ---
            // 可变电阻左端 -> 温度变送器热电阻输入 A 端
            { from: 'varires_wire_l', to: 'temptr_wire_l', type: 'wire' },
            // 可变电阻右端 -> 同时接入变送器 B 端与 C 端 (实现三线制引线电阻补偿模拟)
            { from: 'varires_wire_r', to: 'temptr_wire_m', type: 'wire' },
            { from: 'varires_wire_r', to: 'temptr_wire_r', type: 'wire' },

            // --- 3. 测量反馈电流环路 (二线制变送器接法) ---
            // PID 内部配电输出正极 (PI1) -> 电流表1正极 (用于监测测量值 PV)
            { from: 'pid_wire_pi1', to: 'ampmeter_wire_p', type: 'wire' },
            // 电流表1负极 -> 温度变送器信号正极 (串联进入环路)
            { from: 'ampmeter_wire_n', to: 'temptr_wire_p', type: 'wire' },
            // 温度变送器信号负极 -> PID 测量信号输入负极 (NI1)，完成测量电流闭环
            { from: 'temptr_wire_n', to: 'pid_wire_ni1', type: 'wire' },

            // --- 4. 控制输出驱动环路 (PID 输出驱动执行器) ---
            // PID 控制信号输出正极 (PO1) -> 电流表2正极 (用于监测输出值 MV)
            { from: 'pid_wire_po1', to: 'ampmeter2_wire_p', type: 'wire' },
            // 电流表2负极 -> 电动阀门控制信号输入正极
            { from: 'ampmeter2_wire_n', to: 'valve_wire_l', type: 'wire' },
            // 电动阀门信号负极 -> 返回 PID 控制信号输出负极 (NO1)，完成控制电流闭环
            { from: 'valve_wire_r', to: 'pid_wire_no1', type: 'wire' }
        ];

        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {

        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        // const pid = sys.comps['pid'];
        const pid = sys.comps['pid'];
        const varires = sys.comps['varires'];

        if (!pid || !varires) return;

        // 1. 获取当前 PID 模式 (假设 pid.mode 为 'MAN' 或 'AUTO')
        const isManual = pid.mode === 'MAN';

        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [0, 25, 50, 75, 100]                   // 手动模式：PID 输出百分比 (%)
            : [115.40, 119.25, 123.11, 126.96, 130.81]; // 自动模式：Pt100 电阻值 (Ω)


        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            // --- 手动模式逻辑 ---
            // 设置 PID 的手动输出值
            pid.OUT = targetValue;

        } else {
            // --- 自动模式逻辑 ---
            // 设置可变电阻值 (模拟 Pt100)
            varires.currentResistance = targetValue;
            if (typeof varires.update === 'function') {
                varires.update();
            }
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
