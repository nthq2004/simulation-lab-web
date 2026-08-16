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
            { id: 0, name: "1. 热敏电阻NTC实现的温度变送器" },
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
            //1，连接NTC的分压电路
            { from: 'dcpower_wire_p', to: 'r10k_wire_l', type: 'wire' },
            { from: 'r10k_wire_r', to: 'ntc_wire_l', type: 'wire' },
            { from: 'ntc_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
            //2. 连接NTC输出电压到变送器
            { from: 'ntc_wire_l', to: 'ntctemp_wire_l', type: 'wire' },
            { from: 'ntc_wire_r', to: 'ntctemp_wire_r', type: 'wire' },
            //3. 连接变送器输出到PID输入回路
            { from: 'ntctemp_wire_p', to: 'pid_wire_pi1', type: 'wire' },
            { from: 'ntctemp_wire_n', to: 'pid_wire_ni1', type: 'wire' },
            //4. 连接PID电源
            { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' }
        ];
        sys.stepsArray[0] = [

            // --- 第1步：连接NTC分压电路 ---
            {
                msg: "步骤 1：连接NTC分压测温电路。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    await sys.addConnectionAnimated(conns[0]);
                    await sys.addConnectionAnimated(conns[1]);
                    await sys.addConnectionAnimated(conns[2]);
                    await sys.addConnectionAnimated(conns[3]);
                },
                check: () =>
                    [0, 1, 2, 3].every(i =>
                        sys.conns.some(c => sys._connEqual(c, conns[i]))
                    )
            },

            // --- 第2步：连接NTC到温度变送器 ---
            {
                msg: "步骤 2：连接NTC到智能温度变送器输入端。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    await sys.addConnectionAnimated(conns[4]);
                    await sys.addConnectionAnimated(conns[5]);
                },
                check: () =>
                    [4, 5].every(i =>
                        sys.conns.some(c => sys._connEqual(c, conns[i]))
                    )
            },

            // --- 第3步：连接变送器输出到PID ---
            {
                msg: "步骤 3：连接温度变送器输出到PID输入。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    await sys.addConnectionAnimated(conns[6]);
                    await sys.addConnectionAnimated(conns[7]);
                },
                check: () =>
                    [6, 7].every(i =>
                        sys.conns.some(c => sys._connEqual(c, conns[i]))
                    )
            },

            // --- 第4步：连接PID电源 ---
            {
                msg: "步骤 4：连接PID控制器电源。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    await sys.addConnectionAnimated(conns[8]);
                    await sys.addConnectionAnimated(conns[9]);
                },
                check: () =>
                    [8, 9].every(i =>
                        sys.conns.some(c => sys._connEqual(c, conns[i]))
                    )
            },

            // --- 第5步：开启电源 ---
            {
                msg: "步骤 5：开启两个直流电源。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    // 开启NTC分压电源
                    sys.comps.dcpower.isOn = true;
                    sys.comps.dcpower.update();

                    // 开启PID电源
                    sys.comps.dcpower2.isOn = true;
                    sys.comps.dcpower2.update();

                    sys.showFloatingTip("系统电源已开启", 2000);
                },
                check: () =>
                    sys.comps.dcpower.isOn &&
                    sys.comps.dcpower2.isOn
            },

            // --- 第6步：NTC温度 0 → 20℃ ---
            {
                msg: "步骤 6：设置NTC温度为 0℃。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.fiveStep( );
                },
                check: () => Math.abs(sys.comps.ntc._manualTemp) <= 1
            },

            // --- 第7步：NTC温度 25℃ ---
            {
                msg: "步骤 7：设置NTC温度为 25℃。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.fiveStep();
                },
                check: () => Math.abs(sys.comps.ntc._manualTemp - 25) <= 1
            },

            // --- 第8步：NTC温度 40 → 60℃ ---
            {
                msg: "步骤 8：设置NTC温度为 50℃。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.fiveStep();
                },
                check: () => Math.abs(sys.comps.ntc._manualTemp - 50) <= 1
            },

            // --- 第9步：NTC温度 60 → 80℃ ---
            {
                msg: "步骤 9：设置NTC温度为 75℃。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.fiveStep();
                },
                check: () => Math.abs(sys.comps.ntc._manualTemp - 75) <= 1
            },

            // --- 第10步：NTC温度 80 → 100℃ ---
            {
                msg: "步骤 10：设置NTC温度为 100℃。",
                act: async () => {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    this.fiveStep();

                    sys.showFloatingTip("NTC温度测试完成", 2000);
                },
                check: () => Math.abs(sys.comps.ntc._manualTemp - 100) <= 1
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
                name: "本项目无故障设置",
                trigger: () => {
                },
                check: () => false,
                repair: () => {
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
            //1，连接NTC的分压电路
            { from: 'dcpower_wire_p', to: 'r10k_wire_l', type: 'wire' },
            { from: 'r10k_wire_r', to: 'ntc_wire_l', type: 'wire' },
            { from: 'ntc_wire_r', to: 'gnd_wire_gnd', type: 'wire' },
            { from: 'dcpower_wire_n', to: 'gnd_wire_gnd', type: 'wire' },
            //2. 连接NTC输出电压到变送器
            { from: 'ntc_wire_l', to: 'ntctemp_wire_l', type: 'wire' },
            { from: 'ntc_wire_r', to: 'ntctemp_wire_r', type: 'wire' },
            //3. 连接变送器输出到PID输入回路
            { from: 'ntctemp_wire_p', to: 'pid_wire_pi1', type: 'wire' },
            { from: 'ntctemp_wire_n', to: 'pid_wire_ni1', type: 'wire' },
            //4. 连接PID电源
            { from: 'dcpower2_wire_p', to: 'pid_wire_vcc', type: 'wire' },
            { from: 'dcpower2_wire_n', to: 'pid_wire_gnd', type: 'wire' }
        ];

        sys.redrawAll();
    }

    /** 启动系统：开启电源、泵、发动机，切换 PID 至自动模式 */
    async applyStartSystem() {
        sys.comps.dcpower.isOn = true;
        sys.comps.dcpower.update();
        sys.comps.dcpower2.isOn = true;
        sys.comps.dcpower2.update();
    }

    /**
     * 5点步进系统：根据 PID 模式切换步进目标
     * 手动模式：步进 PID 输出 (0, 25, 50, 75, 100)
     * 自动模式：步进设定值 (0.25, 0.5, 0.75, 1, 0)
     */
    fiveStep() {
        const sys = this.sys;
        const pid = sys.comps['pid'];
        const ntc = sys.comps['ntc'];

        if (!pid || !ntc) return;

        // 1. 获取当前 PID 模式 (假设 pid.mode 为 'MAN' 或 'AUTO')
        const isManual = true;

        // 2. 定义不同模式下的步进序列
        const steps = isManual
            ? [0, 25, 50, 75, 100]                   // 手动模式：PID 输出百分比 (%)
            : [100 + 25 * 0.3851, 100 + 50 * 0.3851, 100 + 75 * 0.3851, 100 + 100 * 0.3851, 100]; // 自动模式：Pt100 电阻值 (Ω)


        if (sys._testStep === undefined || sys._testStep >= steps.length) {
            sys._testStep = 0;
        }
        const nextIndex = sys._testStep;
        const targetValue = steps[nextIndex];

        if (isManual) {
            // --- 手动模式逻辑 ---
            // 设置 PID 的手动输出值
            ntc._manualTemp = targetValue;

        } else {
            // // 设置可变电阻值 (模拟 Pt100)
            // varires.currentResistance = targetValue;
            // if (typeof varires.update === 'function') {
            //     varires.update();
            // }
        }
        sys._testStep = (nextIndex + 1) % steps.length;
    }
}
