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
            { id: 0, name: "1. 气动薄膜调节阀的接线" },
            { id: 1, name: "2. 气动薄膜调节阀故障排除" },
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
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },            

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
            { from: 'pid_wire_po1', to: 'valve2_wire_l', type: 'wire' },
            // 电流表2负极 -> 电动阀门控制信号输入正极
            // 电动阀门信号负极 -> 返回 PID 控制信号输出负极 (NO1)，完成控制电流闭环
            { from: 'valve2_wire_r', to: 'pid_wire_no1', type: 'wire' },

            // --- 5. 电气阀门定位器气路---
            // 气源气压 -> 电气阀门定位器气源口
            { from: 'cab_pipe_o', to: 'valve2_pipe_s', type: 'pipe' },
            // 电气阀门定位器气压输出口 -> 气动薄膜调节器阀气压入口
            { from: 'valve2_pipe_o', to: 'valve2_pipe_i', type: 'pipe' },
        ];
        sys.stepsArray[0] = [
            // --- 第一部分：基础电路建立 (1-4步) ---
            {
                msg: "步骤 1：建立控制系统供电回路 (24V -> PID)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[0]); // P -> VCC
                    await sys.addConnectionAnimated(conns[1]); // N -> GND
                    await sys.addConnectionAnimated(conns[2]); // N -> GND
                },
                check: () => sys.conns.some(c => sys._connEqual(c, conns[0])) &&
                    sys.conns.some(c => sys._connEqual(c, conns[1])) &&
                    sys.conns.some(c => sys._connEqual(c, conns[2]))
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
                    await sys.addConnectionAnimated(conns[3]); // L -> L
                    await sys.addConnectionAnimated(conns[4]); // R -> M
                    await sys.addConnectionAnimated(conns[5]); // R -> R
                },
                check: () => [3, 4, 5].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 4：连接测量反馈回路 (PID配电 -> 电流表1 -> 变送器 -> PID输入)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[6]); // PI1 -> Amp1
                    await sys.addConnectionAnimated(conns[7]); // Amp1 -> TempTr+
                    await sys.addConnectionAnimated(conns[8]); // TempTr- -> NI1
                },
                check: () => [6, 7, 8].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 5：连接控制输出回路 (PID输出 -> 电流表2 -> 电动阀门 -> 回路闭合)。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[9]);  // PO1 -> Amp2
                    await sys.addConnectionAnimated(conns[10]); // Valve- -> NO1
                },
                check: () => [9, 10].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            {
                msg: "步骤 6：连接电气阀门定位器气源， 连接定位器输出 ->气动薄膜调节阀输入口。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    await sys.addConnectionAnimated(conns[11]);  // 
                    await sys.addConnectionAnimated(conns[12]); //
                },
                check: () => [11, 12].every(i => sys.conns.some(c => sys._connEqual(c, conns[i])))
            },
            // --- 第二部分：理论考核 (第7步) ---
            {
                msg: "步骤 7：电气阀门定位器信号转换：输入信号和输出信号分别是什么？",
                mode: "quiz",
                quizConfig: {
                    question: "在标准工业控制中，电气阀门定位器的主要作用是将（ ）信号转换为（ ）信号？",
                    options: [
                        "0-10V 电压信号 转换为 4-20mA 电流信号",
                        "4-20mA 电流信号 转换为 0.02-0.1MPa 气压信号",
                        "0.02-0.1MPa 气压信号 转换为 4-20mA 电流信号",
                        "RS485 数字信号 转换为 0-100% 阀位反馈信号"
                    ],
                    answer: 1,
                    analysis: "电气阀门定位器（E/P转换）的核心任务是接收控制系统的电流信号（4-20mA），并将其成比例地转换为气动执行器所需的压力信号（通常为0.02-0.1MPa）。"
                },
                check: () => true
            },

            // --- 第三部分：动态操作演示 (8步) ---
            {
                msg: "步骤 8：考核调节阀选型：气开式与气关式的区别及安全性。",
                mode: "quiz",
                quizConfig: {
                    question: "关于“气关式”调节阀（Air-to-Close），以下描述正确的是：",
                    options: [
                        "随着输入气压增加，阀门开度逐渐变大",
                        "当仪表风气源突然中断时，阀门会自动处于全闭状态",
                        "当仪表风气源突然中断时，阀门会自动处于全开状态（故障开）",
                        "气关阀主要用于防止下游压力过低，而不是出于断气安全考虑"
                    ],
                    answer: 2,
                    analysis: "气关阀（FO，Fail Open）指有气时关闭，无气时开启。在化工生产中，如果气源中断，为了防止加热炉憋压或反应堆过热，通常选择气关阀以确保阀门全开，保证安全排放。"
                },
                check: () => true
            },
            {
                msg: "步骤 9：演示输出变量变化：将 PID 切换至手动，设置输出为 60%，观察输出电流和阀门开度变化。",
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

            // --- 2. 设置漏气故障 ---
            {
                msg: "步骤 2：模拟气动回路故障。设置定位器至膜头管路“漏气”。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = sys.comps['valve2']; // 使用指定的 id
                    if (valve) {
                        valve.isLeaking = true;
                        sys.showFloatingTip("警告：检测到气路密封失效（漏气）", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => sys.comps['valve2'].isLeaking === true
            },

            // --- 3. 观察漏气下的工作状态 ---
            {
                msg: "步骤 3：调节 PID 输出至 80%，观察阀门行程是否能达到预定开度。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid']; // 使用指定的 id
                    if (pid) {
                        pid.OUT =80;
                        sys.showFloatingTip("PID 输出已设为 80%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                // 漏气时，valve2.travel 受到 0.5~0.8 随机系数影响，永远达不到 0.8
                check: () => Math.abs(sys.comps['pid'].OUT - 80) < 1
            },

            // --- 4. 修复漏气故障 ---
            {
                msg: "步骤 4：修复漏气故障。恢复气路密封，观察阀门行程变化。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = sys.comps['valve2'];
                    if (valve) {
                        valve.isLeaking = false;
                        sys.showFloatingTip("气路修复完毕，压力恢复正常", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => sys.comps['valve2'].isLeaking === false
            },

            // --- 5. 设置卡死故障 ---
            {
                msg: "步骤 5：模拟机械故障。设置阀门机械“卡死”。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = sys.comps['valve2'];
                    if (valve) {
                        valve.isStuck = true;
                        sys.showFloatingTip("警告：阀芯发生机械卡死", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => sys.comps['valve2'].isStuck === true
            },

            // --- 6. 改变输出观察卡死 ---
            {
                msg: "步骤 6：连续改变 PID 输出（50% -> 30%）。观察：压力表动，但阀杆不动。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const pid = sys.comps['pid'];
                    if (pid) {
                        pid.OUT = 50;
                        sys.showFloatingTip("调节至 50%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                        pid.OUT =30;
                        sys.showFloatingTip("调节至 30%", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => Math.abs(sys.comps['pid'].OUT - 30) < 1
            },

            // --- 7. 修复卡死故障 ---
            {
                msg: "步骤 7：修复卡死故障。排除机械阻力，观察阀门是否恢复受控状态。",
                act: async () => {
                    await new Promise(r => setTimeout(r, 3000));
                    const valve = sys.comps['valve2'];
                    if (valve) {
                        valve.isStuck = false;
                        sys.showFloatingTip("机械故障排除，阀门恢复动作", 3000);
                        await new Promise(r => setTimeout(r, 3000));
                    }
                },
                check: () => sys.comps['valve2'].isStuck === false
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
                name: "1. 气动薄膜调节阀漏气故障",
                trigger: () => { if (sys.comps['valve2']) sys.comps['valve2'].isLeaking = true;
                 },
                check: () => sys.comps['valve2'].isLeaking === true,
                repair: () => { if (sys.comps['valve2']) sys.comps['valve2'].isLeaking = false;
                    sys.comps['valve2'].update(1000*sys.comps['valve2'].current);
                 }
            },
            2: {
                id: 2,
                name: "2. 气动薄膜调节阀卡死故障",
                trigger: () => { if (sys.comps['valve2']) sys.comps['valve2'].isStuck = true; },
                check: () => sys.comps['valve2'].isStuck === true,
                repair: () => { if (sys.comps['valve2']) sys.comps['valve2'].isStuck = false;
                    sys.comps['valve2'].update(1000*sys.comps['valve2'].current);
                 }
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
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },            

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

            // --- 4. 控制输出驱动环路 (PID 输出驱动电气阀门定位器) ---
            // PID 控制信号输出正极 (PO1) -> 电流表2正极 (用于监测输出值 MV)
            { from: 'pid_wire_po1', to: 'valve2_wire_l', type: 'wire' },
            // 电流表2负极 -> 电动阀门定位器控制信号输入正极
            // 电动阀门定位器信号负极 -> 返回 PID 控制信号输出负极 (NO1)，完成控制电流闭环
            { from: 'valve2_wire_r', to: 'pid_wire_no1', type: 'wire' },

            // --- 5. 电气阀门定位器气路---
            // 气源气压 -> 电气阀门定位器气源口
            { from: 'cab_pipe_o', to: 'valve2_pipe_s', type: 'pipe' },
            // 电气阀门定位器气压输出口 -> 气动薄膜调节器阀气压入口
            { from: 'valve2_pipe_o', to: 'valve2_pipe_i', type: 'pipe' },
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
            ? [25, 50, 75, 100, 0]                   // 手动模式：PID 输出百分比 (%)
            : [100+25*0.3851, 100+50*0.3851, 100+75*0.3851, 100+100*0.3851, 100]; // 自动模式：Pt100 电阻值 (Ω)


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
            // 设置可变电阻值 (模拟 Pt100)
            varires.currentResistance = targetValue;
            if (typeof varires.update === 'function') {
                varires.update();
            }
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
