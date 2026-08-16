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
            { id: 0, name: "1. 传感器、变送器功能及测试（项目8.2.1" },
            { id: 1, name: "2. PID调节器的功能接测试(项目8.2.2)" },
            { id: 2, name: "3. 执行器的功能及测试（项目8.2.3）" }
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
                msg: "步骤 2：接通24V电源，并设置PID调节器模式为自动。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    sys.comps.pid.mode = 'AUTO';
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.dcpower.isOn === true && sys.comps.pid.mode === 'AUTO'
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


            // --- 第二部分：理论考核 (第5步) ---
            {
                msg: "步骤 5：传感器和变送器的作用是什么？",
                mode: "quiz",
                quizConfig: {
                    question: "在自动控制系统中，传感器和变送器分别起什么作用？",
                    options: [
                        "传感器负责调节控制输出，变送器负责执行机构动作",
                        "传感器用于检测物理量，变送器将其转换为标准信号（如4-20mA）",
                        "传感器用于供电，变送器用于信号放大",
                        "传感器用于通信，变送器用于存储数据"
                    ],
                    answer: 1,
                    analysis: "传感器用于检测温度、压力、液位等物理量；变送器将传感器信号转换为标准工业信号（如4-20mA或0-10V），以便控制系统处理。"
                },
                check: () => true
            },

            // --- 第三部分：动态操作演示 (6-7步) ---
            {
                msg: "步骤 6：演示测量值变化：调节可变电阻至 109.62Ω，观察测量电流变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 109.62; // 对应约 50°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 109.62Ω (25°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 109.62) < 0.5
            },
            {
                msg: "步骤 7：演示测量值变化：调节可变电阻至 119.25Ω，观察测量电流变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 119.25; // 对应约 50°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 119.25Ω (50°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 119.25) < 0.5
            },
            {
                msg: "步骤 8：演示测量值变化：调节可变电阻至 128.88Ω，观察测量电流变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 128.88; // 对应约 75°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 128.88Ω (75°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 128.88) < 0.5
            },
            {
                msg: "步骤 9：演示测量值变化：调节可变电阻至 138.51Ω，观察测量电流变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 138.51; // 对应约 100°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 138.51Ω (100°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 138.51) < 0.5
            },
        ];
        sys.stepsArray[1] = [
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
                msg: "步骤 2：接通24V电源，并设置PID调节器模式为自动。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    sys.comps.pid.mode = 'AUTO';
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.dcpower.isOn === true && sys.comps.pid.mode === 'AUTO'
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

            // --- 第二部分：理论考核 (第6步) ---
            {
                msg: "步骤 6：调节器的作用是什么？",
                mode: "quiz",
                quizConfig: {
                    question: "在自动控制系统中，调节器（Controller）的主要作用是什么？",
                    options: [
                        "用于检测现场物理量（如温度、压力等）",
                        "将物理量转换为标准信号（如4-20mA）",
                        "将测量值与设定值比较并输出控制信号驱动执行机构",
                        "直接驱动执行机构完成机械动作"
                    ],
                    answer: 2,
                    analysis: "调节器（Controller）的核心作用是将设定值（SV）与测量值（PV）进行比较，根据控制算法（如PID）计算并输出控制信号，用于调节执行机构，使系统稳定在目标状态。"
                },
                check: () => true
            },

            // --- 第三部分：动态操作演示 (6-7步) ---
            {
                msg: "步骤 7：观察平衡状态：调节可变电阻至 123.11Ω，使系统达到平衡状态，观察PID输出。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 123.11; // 对应约 50°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 123.11Ω (50°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 123.11) < 0.5
            },
            {
                msg: "步骤 8：演示测量值变化，调节可变电阻至 119.25Ω，偏差值为+10度，观察PID输出。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 119.25; // 对应约 50°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 119.25Ω (50°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 119.25) < 0.5
            },
            {
                msg: "步骤 9：演示测量值变化：调节可变电阻至 126.96Ω，偏差值为-10度，观察PID输出。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const varires = sys.comps['varires'];
                    // 模拟手动调节电阻
                    if (varires) {
                        varires.currentResistance = 126.96; // 对应约 70°C
                        varires.update();
                        sys.showFloatingTip("电阻已调节至 126.96Ω (70°C)", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 检查电阻值是否接近目标值
                check: () => Math.abs(sys.comps['varires'].currentResistance - 126.96) < 0.5
            },

        ];
        sys.stepsArray[2] = [
            // --- 1. 初始化检查 ---
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
                msg: "步骤 2：接通24V电源，并设置PID调节器模式为手动。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();
                    sys.comps.pid.mode = 'MAN';
                    await new Promise(r => setTimeout(r, 3000));
                },
                check: () => sys.comps.dcpower.isOn === true && sys.comps.pid.mode === 'MAN'
            },
            {
                msg: "步骤 3：连接控制输出回路 (PID输出 -> 电流表2 -> 电动阀门 -> 回路闭合)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[8]);  // PO1 -> Amp2
                    await sys.addConnectionAnimated(conns[9]);  // Amp2 -> Valve+
                    await sys.addConnectionAnimated(conns[10]); // Valve- -> NO1
                },
                check: () => [8, 9, 10].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            // --- 第二部分：理论考核 (第6步) ---
            {
                msg: "步骤 4：气动执行器的作用是什么？",
                mode: "quiz",
                quizConfig: {
                    question: "在自动控制系统中，气动执行器的主要作用是什么？",
                    options: [
                        "用于检测压力、温度等物理量",
                        "将控制信号转换为气压信号",
                        "将气压信号转换为机械位移，驱动阀门动作",
                        "对信号进行PID运算处理"
                    ],
                    answer: 2,
                    analysis: "气动执行器的作用是将控制系统输出的气压信号转换为机械位移（如阀杆移动），从而实现阀门开度调节，属于执行机构。"
                },
                check: () => true
            },
            {
                msg: "步骤 5：电气阀门定位器的功能是什么？",
                mode: "quiz",
                quizConfig: {
                    question: "在自动控制系统中，电气阀门定位器的主要功能是什么？",
                    options: [
                        "将物理量转换为电信号",
                        "根据输入控制信号(4-20mA)精确控制阀门开度位置",
                        "提供系统电源",
                        "实现数据通信与存储"
                    ],
                    answer: 1,
                    analysis: "电气阀门定位器接收控制信号（如4-20mA），并调节气动执行器的气压，使阀门开度精确达到目标位置，同时提高响应速度和控制精度。"
                },
                check: () => true
            },
            // --- 3. 平衡状态演示 ---
            {
                msg: "步骤 6：手动调节阀阀门开度，将输出值手动调节到25，观察输出电流和阀门开度。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    pid.OUT = 25;
                    sys.showFloatingTip("手动设置PID输出：OUT=25, I=8mA，阀门开度=25%", 5000);
                    await new Promise(r => setTimeout(r, 5000));
                },
                check: () => Math.abs(sys.comps['pid'].OUT - 25) < 0.3 && Math.abs(sys.comps['ampmeter2'].value - 8) < 0.1
            },

            {
                msg: "步骤 7：手动调节阀阀门开度，将输出值手动调节到50，观察输出电流和阀门开度。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    pid.OUT = 50;
                    sys.showFloatingTip("手动设置PID输出：OUT=50, I=12mA，阀门开度=50%", 5000);
                    await new Promise(r => setTimeout(r, 5000));
                },
                check: () => Math.abs(sys.comps['pid'].OUT - 50) < 0.3 && Math.abs(sys.comps['ampmeter2'].value - 12) < 0.1
            },

            {
                msg: "步骤 8：手动调节阀阀门开度，将输出值手动调节到75，观察输出电流和阀门开度。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    pid.OUT = 75;
                    sys.showFloatingTip("手动设置PID输出：OUT=75, I=16mA，阀门开度=75%", 5000);
                    await new Promise(r => setTimeout(r, 5000));
                },
                check: () => Math.abs(sys.comps['pid'].OUT - 75) < 0.3 && Math.abs(sys.comps['ampmeter2'].value - 16) < 0.1
            },

            {
                msg: "步骤 9：手动调节阀阀门开度，将输出值手动调节到100，观察输出电流和阀门开度。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    pid.OUT = 100;
                    sys.showFloatingTip("手动设置PID输出：OUT=100, I=20mA，阀门开度=100%", 5000);
                    await new Promise(r => setTimeout(r, 5000));
                },
                check: () => Math.abs(sys.comps['pid'].OUT - 100) < 0.3 && Math.abs(sys.comps['ampmeter2'].value - 20) < 0.1
            },
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
            ? [25, 50, 75, 100,0]                   // 手动模式：PID 输出百分比 (%)
            : [109.62, 119.25, 128.88, 138.51, 100]; // 自动模式：Pt100 电阻值 (Ω)


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
